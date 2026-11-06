import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, FileText, Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { ItemAvatar } from '@/features/ffe/item-avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DocThumb } from '@/features/documents/doc-thumb'
import { Textarea } from '@/components/ui/textarea'
import {
  applyRoomType,
  FFE_STATUS_DOT,
  FFE_STATUS_LABELS,
  FFE_STATUSES,
  ffeDocsQuery,
  ffeError,
  ffeItemsQuery,
  roomLinesQuery,
  roomSpecsQuery,
  roomTypesQuery,
  setItemStatus,
  setRoomItem,
  setRoomSpecs,
  statusTotals,
  type FfeStatus,
} from '@/features/ffe/api'
import type { LocationRow } from '@/features/locations/api'
import { fmtMoney } from '@/features/budget/api'
import { contractorName, useContractsModel } from '@/features/ffe/contracts-model'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'

/** Спецификация номера: название, тип, площадь, особенности, состав мебели с чертежами и статусом каждой позиции. */
export function RoomSpec({ projectId, code, loc, canEdit, canBudget }: { projectId: string; code: string; loc: LocationRow; canEdit: boolean; canBudget: boolean }) {
  const model = useContractsModel(projectId, false)
  const contract = model.contractAt(loc.path)
  const queryClient = useQueryClient()
  const { data: items } = useSuspenseQuery(ffeItemsQuery(projectId))
  const { data: typeData } = useSuspenseQuery(roomTypesQuery(projectId))
  const { data: specs } = useSuspenseQuery(roomSpecsQuery(projectId))
  const { data: rows } = useSuspenseQuery(roomLinesQuery(projectId, loc.id))
  const { data: docsByItem } = useSuspenseQuery(ffeDocsQuery(projectId))
  const spec = specs.find((s) => s.location_id === loc.id)
  const lines = useMemo(() => rows.filter((r) => r.location_id === loc.id), [rows, loc.id])
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const type = typeData.types.find((t) => t.id === spec?.type_id)
  const totals = statusTotals(lines)

  const [name, setName] = useState(loc.name)
  const [area, setArea] = useState(spec?.area ? String(spec.area) : '')
  const [notes, setNotes] = useState(spec?.specs ?? '')
  const [adding, setAdding] = useState('')
  const [addQty, setAddQty] = useState('1')
  // список мебели свёрнут по умолчанию; выбор запоминается в браузере
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('room-ffe-open') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('room-ffe-open', open ? '1' : '0')
    } catch {
      // состояние останется только на эту страницу
    }
  }, [open])
  const areaNum = area.trim() === '' ? null : Number(area.replace(',', '.'))
  const areaBad = areaNum !== null && !(areaNum > 0)
  const dirty = name.trim() !== loc.name || (areaNum ?? null) !== (spec?.area ?? null) || notes.trim() !== (spec?.specs ?? '')

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'ffe' || q.queryKey[0] === 'locations' })

  const save = useMutation({
    mutationFn: () => setRoomSpecs({ projectId, locationId: loc.id, name: name.trim() === loc.name ? null : name.trim(), area: areaNum, specs: notes.trim() }),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Спецификация номера сохранена'))
    },
    onError: (e) => toast.error(ffeError(e)),
  })
  const setType = useMutation({
    mutationFn: (typeId: string | null) => applyRoomType(projectId, [loc.id], typeId),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Тип номера изменён, состав обновлён'))
    },
    onError: (e) => toast.error(ffeError(e)),
  })
  const setQty = useMutation({
    mutationFn: (v: { itemId: string; qty: number }) => setRoomItem(projectId, loc.id, v.itemId, v.qty),
    onSuccess: refresh,
    onError: (e) => toast.error(ffeError(e)),
  })
  const setStatus = useMutation({
    mutationFn: (v: { ids: string[]; status: FfeStatus }) => setItemStatus(projectId, v.ids, v.status),
    onSuccess: refresh,
    onError: (e) => toast.error(ffeError(e)),
  })

  const free = items.filter((i) => !lines.some((l) => l.item_id === i.id))

  return (
    <section className="flex flex-col gap-3" aria-label={tr('Спецификация номера')}>
      <h3 className="text-sm font-semibold max-sm:px-1">{tr('Спецификация номера')}</h3>

      <div className="grid grid-cols-2 gap-2 max-sm:rounded-xl max-sm:border max-sm:bg-card max-sm:p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6rem]">
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
          <Label htmlFor="rs-name" className="text-xs text-muted-foreground">{tr('Название номера')}</Label>
          <Input id="rs-name" value={name} maxLength={200} disabled={!canEdit} onChange={(e) => setName(e.target.value)} placeholder="Junior Suite 1" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rs-type" className="text-xs text-muted-foreground">{tr('Тип номера')}</Label>
          <select
            id="rs-type"
            value={spec?.type_id ?? ''}
            disabled={!canEdit || setType.isPending}
            onChange={(e) => setType.mutate(e.target.value || null)}
            className="h-11 rounded-lg border bg-background px-2 text-base md:h-9 md:text-sm"
          >
            <option value="">{tr('Без типа')}</option>
            {typeData.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rs-area" className="text-xs text-muted-foreground">{tr('Площадь, м²')}</Label>
          <Input id="rs-area" inputMode="decimal" value={area} aria-invalid={areaBad} disabled={!canEdit} onChange={(e) => setArea(e.target.value)} placeholder={type?.area ? String(type.area) : ''} />
        </div>
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-3">
          <Label htmlFor="rs-notes" className="text-xs text-muted-foreground">{tr('Особенности номера')}</Label>
          <Textarea id="rs-notes" rows={2} maxLength={4000} value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} placeholder={type?.specs ?? tr('Вид, отделка, особые требования')} />
        </div>
      </div>
      {canEdit && (
        <Button size="sm" className="self-start max-sm:h-11 max-sm:w-full max-sm:text-base" disabled={!dirty || !name.trim() || areaBad || save.isPending} onClick={() => save.mutate()}>
          {tr('Сохранить спецификацию')}
        </Button>
      )}

      {contract && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          {tr('Подрядчик: {{name}}', { name: contractorName(contract) })} · {contract.number ? `№ ${contract.number}` : contract.title}
          {contract.signed_on ? ` · ${tr('подписан {{d}}', { d: new Date(`${contract.signed_on}T00:00:00`).toLocaleDateString(currentLocale()) })}` : ''}
          {contract.signer ? ` · ${contract.signer.full_name}` : ''}
        </p>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-controls="room-ffe-list"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 sm:rounded-lg sm:py-0"
      >
        <ChevronRight className={`size-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
        <span className="text-sm font-medium">{tr('Мебель и оборудование')}</span>
        <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground sm:ml-auto">
          {lines.length > 0 ? tr('{{p}} поз., {{n}} шт., установлено {{i}}', { p: lines.length, n: totals.total, i: totals.installed }) : tr('не задана')}
          {lines.length > 0 && totals.total > 0 && (
            <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
              <span className="block h-full bg-emerald-500" style={{ width: `${Math.round((100 * totals.installed) / totals.total)}%` }} />
            </span>
          )}
        </span>
        </span>
      </button>
      <div id="room-ffe-list" hidden={!open} className="flex flex-col gap-3">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Состав не задан. Выберите тип номера или добавьте позиции вручную.')}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm sm:rounded-lg">
          {lines.map((l) => {
            const it = itemById.get(l.item_id)
            return (
              <li key={l.id} className="flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:py-1.5">
                <div className="flex min-w-0 items-start gap-3 sm:contents">
                {/* миниатюры привязанных файлов (чертёж, каталожный лист): нажатие открывает файл, наведение мышью увеличивает */}
                <span className="flex shrink-0 gap-1 empty:hidden sm:w-24 sm:empty:flex" aria-hidden={(docsByItem.get(l.item_id) ?? []).length === 0}>
                  {(docsByItem.get(l.item_id) ?? []).slice(0, 2).map((d) => (
                    <Link key={d.id} to="/projects/$code/plan/$id" params={{ code, id: d.id }} search={{}} title={d.title} className="relative block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <DocThumb d={d} canGenerate={canEdit} className="h-14 w-16 sm:h-10 sm:w-11" />
                    </Link>
                  ))}
                </span>
                <span className="min-w-0 flex-1 basis-40 leading-snug">
                  <span className="ident mr-2 text-xs text-muted-foreground max-sm:block">{it?.code}</span>
                  <span className="max-sm:text-base max-sm:font-medium">{it?.name}</span>
                  {(docsByItem.get(l.item_id) ?? []).slice(0, 3).map((d) => (
                    <Link key={d.id} to="/projects/$code/plan/$id" params={{ code, id: d.id }} search={{}} className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline max-sm:ml-0 max-sm:mr-3 max-sm:mt-1 max-sm:min-h-8" title={d.title}>
                      <FileText className="size-3" aria-hidden /> {d.code ?? tr('чертёж')}
                    </Link>
                  ))}
                  {l.source === 'manual' && <span className="ml-2 text-xs text-muted-foreground">{tr('своя правка')}</span>}
                </span>
                </div>
                <div className="flex items-center gap-2 sm:contents">
                {canBudget && model.lineAmount(l) !== null && <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtMoney(model.lineAmount(l) ?? 0)}</span>}
                {canEdit ? (
                  <span className="flex items-center max-sm:rounded-lg max-sm:border max-sm:bg-background">
                    <button
                      type="button"
                      disabled={l.qty <= 1 || setQty.isPending}
                      aria-label={tr('Меньше: {{name}}', { name: it?.name ?? '' })}
                      onClick={() => setQty.mutate({ itemId: l.item_id, qty: l.qty - 1 })}
                      className="inline-flex size-10 items-center justify-center rounded-l-lg outline-none active:bg-muted disabled:opacity-40 sm:hidden"
                    >
                      <Minus className="size-4" />
                    </button>
                    <Input
                      key={`${l.id}-${l.qty}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="w-16 text-right tabular-nums max-sm:w-10 max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:text-center max-sm:shadow-none md:h-8"
                      defaultValue={l.qty}
                      aria-label={tr('Количество: {{name}}', { name: it?.name ?? '' })}
                      onBlur={(e) => {
                        const n = Number(e.target.value)
                        if (Number.isInteger(n) && n >= 0 && n !== l.qty) setQty.mutate({ itemId: l.item_id, qty: n })
                      }}
                    />
                    <button
                      type="button"
                      disabled={setQty.isPending}
                      aria-label={tr('Больше: {{name}}', { name: it?.name ?? '' })}
                      onClick={() => setQty.mutate({ itemId: l.item_id, qty: l.qty + 1 })}
                      className="inline-flex size-10 items-center justify-center rounded-r-lg outline-none active:bg-muted disabled:opacity-40 sm:hidden"
                    >
                      <Plus className="size-4" />
                    </button>
                  </span>
                ) : (
                  <span className="w-16 text-right tabular-nums">{l.qty}</span>
                )}
                {canEdit ? (
                  <select
                    value={l.status}
                    aria-label={tr('Статус')}
                    onChange={(e) => setStatus.mutate({ ids: [l.id], status: e.target.value as FfeStatus })}
                    className="h-8 rounded-md border bg-background px-1.5 text-xs max-sm:h-11 max-sm:min-w-0 max-sm:flex-1 max-sm:rounded-lg max-sm:px-2 max-sm:text-sm"
                  >
                    {FFE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {FFE_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className={`size-2 rounded-full ${FFE_STATUS_DOT[l.status]}`} aria-hidden />
                    {FFE_STATUS_LABELS[l.status]}
                  </span>
                )}
                {canEdit && (
                  <Button size="icon" variant="ghost" className="size-8 max-sm:size-10" aria-label={tr('Убрать из номера: {{name}}', { name: it?.name ?? '' })} onClick={() => setQty.mutate({ itemId: l.item_id, qty: 0 })}>
                    <Trash2 />
                  </Button>
                )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && free.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <SearchSelect
            value={adding}
            onChange={setAdding}
            options={free.map((i) => ({ value: i.id, label: i.code, hint: i.name !== i.code ? i.name : undefined, avatar: <ItemAvatar docs={docsByItem.get(i.id)} canGenerate={canEdit} /> }))}
            ariaLabel={tr('Добавить позицию')}
            placeholder={tr('Добавить позицию из каталога…')}
            className="min-w-0 flex-1"
          />
          <Input type="number" inputMode="numeric" min={1} className="h-9 w-16 text-right" value={addQty} aria-label={tr('Количество')} onChange={(e) => setAddQty(e.target.value)} />
          <Button
            size="sm"
            disabled={!adding || !(Number(addQty) >= 1) || setQty.isPending}
            onClick={() => {
              setQty.mutate({ itemId: adding, qty: Number(addQty) })
              setAdding('')
              setAddQty('1')
            }}
          >
            <Plus /> {tr('Добавить')}
          </Button>
        </div>
      )}
      </div>
    </section>
  )
}
