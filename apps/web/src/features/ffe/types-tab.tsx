import { EntityDocuments } from '@/features/documents/entity-documents'
import { RenderGallery } from '@/features/renders/gallery'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { BedDouble, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useShowMore } from '@/components/show-more'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  applyRoomType,
  deleteRoomType,
  ffeError,
  ffeItemsQuery,
  roomSpecsQuery,
  roomTypesQuery,
  setTypeItem,
  upsertRoomType,
  type FfeItem,
  type RoomType,
} from '@/features/ffe/api'
import { locationLabel, locationsQuery, type LocationRow } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { tr } from '@/lib/tr'

/** Типы номеров (King, Junior Suite…): у каждого свой набор мебели; назначается номерам целыми группами. */
export function TypesTab({ projectId, code, canEdit, focusType }: { projectId: string; code: string; canEdit: boolean; focusType?: string }) {
  const { data } = useSuspenseQuery(roomTypesQuery(projectId))
  const { data: items } = useSuspenseQuery(ffeItemsQuery(projectId))
  const { data: specs } = useSuspenseQuery(roomSpecsQuery(projectId))
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<string | null>(focusType ?? null)
  const { data: places = [] } = useSuspenseQuery(locationsQuery(projectId))
  // переход по ссылке из схемы или зоны: нужный тип раскрыт и показан на экране
  useEffect(() => {
    if (!focusType) return
    setOpen(focusType)
    const t = window.setTimeout(() => document.getElementById(`type-${focusType}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150)
    return () => window.clearTimeout(t)
  }, [focusType])
  const [editing, setEditing] = useState<RoomType | 'new' | null>(null)
  const [assigning, setAssigning] = useState<RoomType | null>(null)
  const [removing, setRemoving] = useState<RoomType | null>(null)

  const roomsByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of specs) if (s.type_id) m.set(s.type_id, (m.get(s.type_id) ?? 0) + 1)
    return m
  }, [specs])
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const remove = useMutation({
    mutationFn: (t: RoomType) => deleteRoomType(projectId, t.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Тип удалён'))
      setRemoving(null)
    },
    onError: (e) => toast.error(ffeError(e)),
  })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Типы номеров с набором мебели. Назначьте тип номерам — состав каждого номера заполнится сам, потом его можно поправить.')}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> {tr('Новый тип')}
          </Button>
        )}
      </div>

      {data.types.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <p className="font-medium">{tr('Типов номеров пока нет')}</p>
          <p className="max-w-prose text-sm text-muted-foreground">{tr('Создайте тип, например King или Junior Suite, и добавьте в него позиции из каталога.')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.types.map((t) => {
            const lines = data.items.filter((i) => i.type_id === t.id)
            const pieces = lines.reduce((s, l) => s + l.qty, 0)
            const isOpen = open === t.id
            return (
              <li key={t.id} id={`type-${t.id}`} className={`scroll-mt-20 overflow-hidden rounded-lg border bg-card shadow-soft ${focusType === t.id ? 'ring-2 ring-primary' : ''}`}>
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <BedDouble className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)}>
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.area ? `${t.area} ${tr('м²')} · ` : ''}
                      {tr('Номеров: {{n}}', { n: roomsByType.get(t.id) ?? 0 })} · {tr('позиций: {{n}}, штук: {{p}}', { n: lines.length, p: pieces })}
                    </span>
                  </button>
                  {canEdit && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setAssigning(t)}>
                        <Users /> {tr('Назначить номерам')}
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={tr('Изменить {{name}}', { name: t.name })} onClick={() => setEditing(t)}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={tr('Удалить {{name}}', { name: t.name })} onClick={() => setRemoving(t)}>
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
                {isOpen && (
                  <>
                    <TypeRooms code={code} typeId={t.id} specs={specs} places={places} canEdit={canEdit} onAssign={() => setAssigning(t)} />
                    <TypeItems projectId={projectId} type={t} lines={lines} items={items} itemById={itemById} canEdit={canEdit} />
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && <TypeDialog projectId={projectId} code={code} type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => setOpen(id)} />}
      {assigning && <AssignDialog projectId={projectId} type={assigning} onClose={() => setAssigning(null)} />}
      {removing && (
        <Dialog open onOpenChange={(o) => !o && setRemoving(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr('Удалить тип «{{name}}»?', { name: removing.name })}</DialogTitle>
              <DialogDescription>{tr('Тип, который назначен номерам, удалить нельзя: сначала смените или снимите тип у номеров.')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoving(null)}>{tr('Отмена')}</Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{tr('Удалить')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

function TypeItems({ projectId, type, lines, items, itemById, canEdit }: { projectId: string; type: RoomType; lines: { item_id: string; qty: number }[]; items: FfeItem[]; itemById: Map<string, FfeItem>; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState('')
  const [addQty, setAddQty] = useState('1')
  const free = items.filter((i) => !lines.some((l) => l.item_id === i.id))

  const set = useMutation({
    mutationFn: (v: { itemId: string; qty: number }) => setTypeItem(projectId, type.id, v.itemId, v.qty),
    onSuccess: async (rooms) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      if (rooms > 0) toast.success(tr('Состав обновлён в номерах этого типа: {{n}}', { n: rooms }))
    },
    onError: (e) => toast.error(ffeError(e)),
  })

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/20 p-3">
      {type.specs && <p className="whitespace-pre-line text-sm text-muted-foreground">{type.specs}</p>}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('В типе пока нет позиций.')}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => {
              const it = itemById.get(l.item_id)
              return (
                <tr key={l.item_id} className="border-b last:border-b-0">
                  <td className="ident w-28 py-1.5 pr-2">{it?.code}</td>
                  <td className="py-1.5 pr-2">{it?.name}</td>
                  <td className="w-28 py-1.5 text-right">
                    {canEdit ? (
                      <Input
                        key={`${l.item_id}-${l.qty}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="ml-auto h-8 w-20 text-right tabular-nums"
                        defaultValue={l.qty}
                        aria-label={tr('Количество: {{name}}', { name: it?.name ?? '' })}
                        onBlur={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isInteger(n) && n >= 0 && n !== l.qty) set.mutate({ itemId: l.item_id, qty: n })
                        }}
                      />
                    ) : (
                      <span className="tabular-nums">{l.qty}</span>
                    )}
                  </td>
                  <td className="w-12 py-1.5 text-right">
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать из типа: {{name}}', { name: it?.name ?? '' })} onClick={() => set.mutate({ itemId: l.item_id, qty: 0 })}>
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={tr('Добавить позицию')} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:max-w-sm">
            <option value="">{tr('Добавить позицию из каталога…')}</option>
            {free.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {i.name}
              </option>
            ))}
          </select>
          <Input type="number" inputMode="numeric" min={1} className="h-9 w-20 text-right" value={addQty} aria-label={tr('Количество')} onChange={(e) => setAddQty(e.target.value)} />
          <Button
            size="sm"
            disabled={!adding || !(Number(addQty) >= 1) || set.isPending}
            onClick={() => {
              set.mutate({ itemId: adding, qty: Number(addQty) })
              setAdding('')
              setAddQty('1')
            }}
          >
            <Plus /> {tr('Добавить')}
          </Button>
        </div>
      )}
    </div>
  )
}

function TypeDialog({ projectId, code, type, onClose, onSaved }: { projectId: string; code: string; type: RoomType | null; onClose: () => void; onSaved: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(type?.name ?? '')
  const [area, setArea] = useState(type?.area ? String(type.area) : '')
  const [specs, setSpecs] = useState(type?.specs ?? '')
  const areaNum = area.trim() === '' ? null : Number(area.replace(',', '.'))
  const areaBad = areaNum !== null && !(areaNum > 0)

  const save = useMutation({
    mutationFn: () => upsertRoomType({ projectId, id: type?.id ?? null, name: name.trim(), area: areaNum, specs: specs.trim() }),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Тип сохранён'))
      onSaved(id)
      onClose()
    },
    onError: (e) => toast.error(ffeError(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{type ? tr('Тип «{{name}}»', { name: type.name }) : tr('Новый тип номера')}</DialogTitle>
          <DialogDescription>{tr('Название, площадь и особенности, общие для всех номеров этого типа.')}</DialogDescription>
        </DialogHeader>
        <form
          id="type-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !areaBad && !save.isPending) save.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="t-name">{tr('Название')}</Label>
            <Input id="t-name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} placeholder="King, Junior Suite…" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="t-area">{tr('Площадь, м²')}</Label>
            <Input id="t-area" inputMode="decimal" value={area} aria-invalid={areaBad} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="t-specs">{tr('Особенности')}</Label>
            <Textarea id="t-specs" rows={3} maxLength={4000} value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder={tr('Вид, отделка, особые требования')} />
          </div>
        </form>
        {type ? (
          <>
            <RenderGallery projectId={projectId} entity={{ type: 'room_type', id: type.id }} canEdit title={tr('Рендеры типа')} hint={tr('Показываются на плитках этажа и на странице каждого номера этого типа.')} />
            <EntityDocuments entity={{ type: 'room_type', id: type.id }} projectId={projectId} code={code} title={tr('Схема номера этого типа')} />
            <p className="-mt-1 text-xs text-muted-foreground">{tr('Планировка номера (PDF или картинка): загружается один раз на тип и сама подставляется как схема в инспекцию каждого номера этого типа и на его страницу. Новая ревизия действует сразу для всех номеров.')}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{tr('Рендеры и технический план можно добавить после сохранения типа.')}</p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="type-form" disabled={!name.trim() || areaBad || save.isPending}>{tr('Сохранить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Назначить тип всем номерам выбранного корпуса, секции или этажа (по желанию — только тем, у кого типа ещё нет). */
function AssignDialog({ projectId, type, onClose }: { projectId: string; type: RoomType; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: rows } = useSuspenseQuery(locationsQuery(projectId))
  const { data: specs } = useSuspenseQuery(roomSpecsQuery(projectId))
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [onlyFree, setOnlyFree] = useState(true)
  const node = rows.find((r) => r.id === nodeId)
  const typed = useMemo(() => new Set(specs.filter((s) => s.type_id).map((s) => s.location_id)), [specs])
  const targets = useMemo(
    () => (node ? rows.filter((r) => r.kind === 'room' && (r.path.startsWith(node.path + '.') || r.id === node.id) && (!onlyFree || !typed.has(r.id))) : []),
    [rows, node, onlyFree, typed],
  )

  const apply = useMutation({
    mutationFn: () => applyRoomType(projectId, targets.map((r) => r.id), type.id),
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Тип назначен номерам: {{n}}', { n }))
      onClose()
    },
    onError: (e) => toast.error(ffeError(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Назначить тип «{{name}}»', { name: type.name })}</DialogTitle>
          <DialogDescription>{tr('Выберите корпус, секцию или этаж: тип получат все номера внутри.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <LocationPicker projectId={projectId} value={nodeId} onChange={setNodeId} placeholder={tr('Корпус, секция или этаж')} />
          <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="size-4" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
            {tr('Только номера без типа')}
          </label>
          <p className="text-sm text-muted-foreground">
            {node ? tr('{{where}}: номеров будет назначено — {{n}}', { where: locationLabel(node.path, rows), n: targets.length }) : tr('Место не выбрано.')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={targets.length === 0 || apply.isPending} onClick={() => apply.mutate()}>
            {tr('Назначить ({{n}})', { n: targets.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Номера этого типа: нажатие открывает номер; «Назначить номерам» добавляет к типу ещё номера. */
function TypeRooms({ code, typeId, specs, places, canEdit, onAssign }: { code: string; typeId: string; specs: { location_id: string; type_id: string | null }[]; places: LocationRow[]; canEdit: boolean; onAssign: () => void }) {
  const rooms = useMemo(() => {
    const byId = new Map(places.map((l) => [l.id, l]))
    return specs
      .filter((x) => x.type_id === typeId)
      .map((x) => byId.get(x.location_id))
      .filter((l): l is LocationRow => !!l)
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  }, [specs, places, typeId])
  const { shown, more } = useShowMore(rooms, 60, typeId)
  return (
    <div className="flex flex-col gap-2 border-t bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {tr('Номера этого типа')} <span className="font-normal text-muted-foreground">{rooms.length}</span>
        </h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onAssign}>
            <Users /> {tr('Назначить номерам')}
          </Button>
        )}
      </div>
      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Этот тип пока не назначен ни одному номеру.')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label={tr('Номера этого типа')}>
          {shown.map((r) => (
            <li key={r.id}>
              <Link to="/projects/$code/locations/$path" params={{ code, path: r.path }} title={locationLabel(r.path, places)} className="inline-flex min-h-8 items-center rounded-md border bg-background px-2 text-xs tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                {r.name.replace(/^(номер|помещение|квартира|room)\s*/i, '') || r.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more}
    </div>
  )
}
