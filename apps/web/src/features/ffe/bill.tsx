import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtMoney } from '@/features/budget/api'
import { buildMatrix, MatrixTable, type MatrixBy } from '@/features/ffe/matrix'
import { ExportButton } from '@/features/export/export-button'
import { contractorName, useContractsModel } from '@/features/ffe/contracts-model'
import {
  FFE_STATUS_DOT,
  FFE_STATUS_LABELS,
  FFE_STATUSES,
  ffeError,
  ffeItemsQuery,
  roomFfeQuery,
  roomSpecsQuery,
  roomTypesQuery,
  setItemStatus,
  statusTotals,
  type FfeItem,
  type FfeStatus,
  type RoomFfe,
} from '@/features/ffe/api'
import { locationLabel, locationsQuery, type LocationRow } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { tr } from '@/lib/tr'

type View = 'items' | 'rooms' | 'matrix'

/** Ведомость «что и где»: по позициям (сколько кроватей и в каких номерах) и по номерам (что стоит в каждом). */
export function BillTab({ projectId, code, canEdit, canBudget }: { projectId: string; code: string; canEdit: boolean; canBudget: boolean }) {
  const model = useContractsModel(projectId)
  const { data: items } = useSuspenseQuery(ffeItemsQuery(projectId))
  const { data: rows } = useSuspenseQuery(roomFfeQuery(projectId))
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const { data: specs } = useSuspenseQuery(roomSpecsQuery(projectId))
  const { data: typeData } = useSuspenseQuery(roomTypesQuery(projectId))
  const queryClient = useQueryClient()

  const [view, setView] = useState<View>('items')
  const [scope, setScope] = useState<string | null>(null)
  const [status, setStatus] = useState<FfeStatus | ''>('')
  const [query, setQuery] = useState('')
  const [contractFilter, setContractFilter] = useState('')
  const [matrixBy, setMatrixBy] = useState<MatrixBy>('floor')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const typeName = useMemo(() => {
    const names = new Map(typeData.types.map((t) => [t.id, t.name]))
    return new Map(specs.map((s) => [s.location_id, s.type_id ? (names.get(s.type_id) ?? '') : '']))
  }, [specs, typeData.types])
  const scopeNode = scope ? locById.get(scope) : undefined

  // строки ведомости с учётом места, статуса и поиска
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const loc = locById.get(r.location_id)
      if (!loc) return false
      if (scopeNode && !(loc.path === scopeNode.path || loc.path.startsWith(scopeNode.path + '.'))) return false
      if (status && r.status !== status) return false
      if (contractFilter) {
        const c = model.contractAt(loc.path)
        if (contractFilter === '__none__' ? !!c : c?.id !== contractFilter) return false
      }
      if (q) {
        const it = itemById.get(r.item_id)
        if (!(it?.code.toLowerCase().includes(q) || it?.name.toLowerCase().includes(q) || loc.name.toLowerCase().includes(q))) return false
      }
      return true
    })
  }, [rows, locById, scopeNode, status, query, itemById, contractFilter, model])

  const matrix = useMemo(() => buildMatrix({ lines: filtered, itemById, locById, typeName, by: matrixBy }), [filtered, itemById, locById, typeName, matrixBy])
  const totals = useMemo(() => statusTotals(filtered), [filtered])
  const money = useMemo(() => filtered.reduce((sum, r) => sum + (model.lineAmount(r) ?? 0), 0), [filtered, model])
  const contractLabel = (locationId: string) => {
    const path = locById.get(locationId)?.path
    const c = path ? model.contractAt(path) : undefined
    return c ? contractorName(c) : ''
  }
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const setStatusMutation = useMutation({
    mutationFn: (v: { ids: string[]; status: FfeStatus }) => setItemStatus(projectId, v.ids, v.status),
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe', 'rows', projectId] })
      toast.success(tr('Статус изменён у строк: {{n}}', { n }))
    },
    onError: (e) => toast.error(ffeError(e)),
  })
  const change = (ids: string[], s: FfeStatus) => setStatusMutation.mutate({ ids, status: s })

  const roomName = (id: string) => locById.get(id)?.name ?? '—'
  const roomPlace = (id: string) => {
    const l = locById.get(id)
    return l ? locationLabel(l.path, locations) : '—'
  }

  // ---- по позициям
  const byItem = useMemo(() => {
    const m = new Map<string, RoomFfe[]>()
    for (const r of filtered) m.set(r.item_id, [...(m.get(r.item_id) ?? []), r])
    return [...m.entries()]
      .map(([itemId, lines]) => ({ item: itemById.get(itemId), itemId, lines, totals: statusTotals(lines) }))
      .filter((x): x is { item: FfeItem; itemId: string; lines: RoomFfe[]; totals: ReturnType<typeof statusTotals> } => !!x.item)
      .sort((a, b) => a.item.code.localeCompare(b.item.code, undefined, { numeric: true }))
  }, [filtered, itemById])

  // ---- по номерам
  const byRoom = useMemo(() => {
    const m = new Map<string, RoomFfe[]>()
    for (const r of filtered) m.set(r.location_id, [...(m.get(r.location_id) ?? []), r])
    const order = new Map(locations.map((l, i) => [l.id, i]))
    return [...m.entries()]
      .map(([locationId, lines]) => ({ locationId, lines, totals: statusTotals(lines) }))
      .sort((a, b) => (order.get(a.locationId) ?? 0) - (order.get(b.locationId) ?? 0))
  }, [filtered, locations])

  const roomsTotal = locations.filter((l: LocationRow) => l.kind === 'room' && (!scopeNode || l.path.startsWith(scopeNode.path + '.'))).length
  const withoutType = locations.filter((l) => l.kind === 'room' && (!scopeNode || l.path.startsWith(scopeNode.path + '.')) && !typeName.get(l.id)).length

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={tr('Всего штук')} value={totals.total} />
        {FFE_STATUSES.map((s) => (
          <Stat key={s} label={FFE_STATUS_LABELS[s]} value={totals[s]} dot={FFE_STATUS_DOT[s]} active={status === s} onClick={() => setStatus(status === s ? '' : s)} />
        ))}
      </div>

      {canBudget && model.contracts.length > 0 && (
        <p className="text-sm text-muted-foreground">{tr('Стоимость показанной мебели по договорам: {{sum}}', { sum: fmtMoney(money) })}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={tr('Вид ведомости')} className="flex rounded-md border p-0.5">
          {(
            [
              ['items', tr('По позициям')],
              ['rooms', tr('По номерам')],
              ['matrix', tr('Сводная таблица')],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-8 rounded px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Input className="w-full sm:w-56" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Код, позиция или номер')} aria-label={tr('Поиск по ведомости')} />
        {model.contracts.length > 0 && (
          <select value={contractFilter} onChange={(e) => setContractFilter(e.target.value)} aria-label={tr('Подрядчик')} className="h-9 max-w-52 rounded-md border bg-background px-2 text-sm">
            <option value="">{tr('Все подрядчики')}</option>
            {model.contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {contractorName(c)} · {c.number ?? c.title}
              </option>
            ))}
            <option value="__none__">{tr('Без подрядчика')}</option>
          </select>
        )}
        <div className="flex min-w-0 items-center gap-1 sm:w-72">
          <div className="min-w-0 flex-1">
            <LocationPicker projectId={projectId} value={scope} onChange={setScope} placeholder={tr('Весь проект')} />
          </div>
          {scope && (
            <Button size="icon" variant="ghost" aria-label={tr('Сбросить место')} onClick={() => setScope(null)}>
              <X />
            </Button>
          )}
        </div>
        <ExportButton
          fileName={tr('Мебель {{code}}', { code })}
          disabled={filtered.length === 0}
          build={() =>
            view === 'matrix'
              ? {
                  name: matrixBy === 'floor' ? tr('По этажам') : tr('По типам номеров'),
                  headers: [tr('Код'), tr('Название'), tr('Всего'), ...matrix.columns.map((c) => c.label)],
                  rows: [
                    ...matrix.rows.map((r) => [r.item.code, r.item.name, r.total, ...matrix.columns.map((c) => r.cells.get(c.key) ?? '')]),
                    [tr('Итого'), '', matrix.grandTotal, ...matrix.columns.map((c) => matrix.columnTotals.get(c.key) ?? 0)],
                  ],
                }
              : view === 'items'
              ? {
                  name: tr('По позициям'),
                  headers: [tr('Код'), tr('Название'), tr('Категория'), tr('Ед.'), tr('Всего'), ...FFE_STATUSES.map((s) => FFE_STATUS_LABELS[s]), tr('Номеров')],
                  rows: byItem.map((x) => [x.item.code, x.item.name, x.item.category ?? '', x.item.unit, x.totals.total, ...FFE_STATUSES.map((s) => x.totals[s]), x.lines.length]),
                }
              : {
                  name: tr('По номерам'),
                  headers: [tr('Номер'), tr('Место'), tr('Тип'), tr('Код'), tr('Позиция'), tr('Количество'), tr('Статус'), tr('Подрядчик'), ...(canBudget ? [tr('Сумма')] : [])],
                  rows: byRoom.flatMap((r) =>
                    r.lines.map((l) => [roomName(r.locationId), roomPlace(r.locationId), typeName.get(r.locationId) ?? '', itemById.get(l.item_id)?.code ?? '', itemById.get(l.item_id)?.name ?? '', l.qty, FFE_STATUS_LABELS[l.status], contractLabel(r.locationId), ...(canBudget ? [model.lineAmount(l) ?? ''] : [])]),
                  ),
                }
          }
        />
      </div>

      {withoutType > 0 && (
        <p className="text-sm text-muted-foreground">
          {tr('Номеров без типа: {{n}} из {{total}} — для них ведомость строится только по своим позициям.', { n: withoutType, total: roomsTotal })}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
          {rows.length === 0 ? tr('Ведомость пуста. Заполните каталог и типы номеров и назначьте тип номерам.') : tr('По этим условиям ничего нет. Ослабьте фильтры.')}
        </div>
      ) : view === 'matrix' ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{tr('Столбцы:')}</span>
            {(
              [
                ['floor', tr('этажи')],
                ['type', tr('типы номеров')],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={matrixBy === v}
                onClick={() => setMatrixBy(v)}
                className={`min-h-8 rounded-full border px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${matrixBy === v ? 'border-foreground bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
            <span className="text-xs text-muted-foreground">{tr('Сколько штук каждой позиции на каждом этаже или в каждом типе номеров; учитываются фильтры выше.')}</span>
          </div>
          <MatrixTable data={matrix} by={matrixBy} code={code} />
        </div>
      ) : view === 'items' ? (
        <ul className="overflow-hidden rounded-lg border bg-card shadow-soft">
          {byItem.map((x) => {
            const isOpen = open.has(x.itemId)
            return (
              <li key={x.itemId} className="border-b last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <button type="button" className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} onClick={() => toggle(x.itemId)}>
                    {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="ident shrink-0">{x.item.code}</span>
                    <span className="min-w-0 truncate">{x.item.name}</span>
                  </button>
                  <StatusBar totals={x.totals} />
                  <span className="w-28 shrink-0 text-right tabular-nums">
                    {x.totals.total} {x.item.unit}
                    <span className="block text-xs text-muted-foreground">{tr('номеров: {{n}}', { n: x.lines.length })}</span>
                  </span>
                  {canEdit && (
                    <StatusSelect label={tr('Статус всех строк позиции {{code}}', { code: x.item.code })} value="" placeholder={tr('Всем…')} onChange={(s) => change(x.lines.map((l) => l.id), s)} />
                  )}
                </div>
                {isOpen && (
                  <ul className="border-t bg-muted/20">
                    {x.lines
                      .slice()
                      .sort((a, b) => (locById.get(a.location_id)?.path ?? '').localeCompare(locById.get(b.location_id)?.path ?? '', undefined, { numeric: true }))
                      .map((l) => (
                        <LineRow key={l.id} code={code} line={l} title={roomName(l.location_id)} place={roomPlace(l.location_id)} unit={x.item.unit} canEdit={canEdit} onStatus={(s) => change([l.id], s)} path={locById.get(l.location_id)?.path ?? ''} contractor={contractLabel(l.location_id)} amount={canBudget ? model.lineAmount(l) : null} />
                      ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <ul className="overflow-hidden rounded-lg border bg-card shadow-soft">
          {byRoom.map((r) => {
            const isOpen = open.has(r.locationId)
            const installed = r.totals.total > 0 ? Math.round((r.totals.installed / r.totals.total) * 100) : 0
            return (
              <li key={r.locationId} className="border-b last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <button type="button" className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} onClick={() => toggle(r.locationId)}>
                    {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="min-w-0 truncate font-medium">{roomName(r.locationId)}</span>
                    {typeName.get(r.locationId) && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">{typeName.get(r.locationId)}</span>}
                    <span className="hidden min-w-0 truncate text-xs text-muted-foreground md:inline">{roomPlace(r.locationId)}</span>
                  </button>
                  <StatusBar totals={r.totals} />
                  <span className="w-28 shrink-0 text-right tabular-nums">
                    {tr('{{n}} шт.', { n: r.totals.total })}
                    <span className="block text-xs text-muted-foreground">{tr('установлено {{p}}%', { p: installed })}</span>
                  </span>
                  {canEdit && <StatusSelect label={tr('Статус всех позиций номера {{name}}', { name: roomName(r.locationId) })} value="" placeholder={tr('Всем…')} onChange={(s) => change(r.lines.map((l) => l.id), s)} />}
                </div>
                {isOpen && (
                  <ul className="border-t bg-muted/20">
                    {r.lines.map((l) => {
                      const it = itemById.get(l.item_id)
                      return <LineRow key={l.id} code={code} line={l} title={`${it?.code ?? ''} · ${it?.name ?? ''}`} place="" unit={it?.unit ?? ''} canEdit={canEdit} onStatus={(s) => change([l.id], s)} path={locById.get(l.location_id)?.path ?? ''} noLink contractor={contractLabel(l.location_id)} amount={canBudget ? model.lineAmount(l) : null} />
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Stat({ label, value, dot, active, onClick }: { label: string; value: number; dot?: string; active?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span className={`size-2 rounded-full ${dot}`} aria-hidden />}
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </>
  )
  const cls = `flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-left shadow-soft ${active ? 'border-foreground' : ''}`
  return onClick ? (
    <button type="button" aria-pressed={active} onClick={onClick} className={`${cls} outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Полоса долей по статусам: сразу видно, сколько уже установлено. */
function StatusBar({ totals }: { totals: ReturnType<typeof statusTotals> }) {
  if (totals.total === 0) return null
  return (
    <span
      className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted max-sm:hidden"
      role="img"
      aria-label={FFE_STATUSES.map((s) => `${FFE_STATUS_LABELS[s]}: ${totals[s]}`).join(', ')}
    >
      {FFE_STATUSES.map((s) => (totals[s] > 0 ? <span key={s} className={FFE_STATUS_DOT[s]} style={{ width: `${(totals[s] / totals.total) * 100}%` }} /> : null))}
    </span>
  )
}

function StatusSelect({ value, onChange, label, placeholder }: { value: FfeStatus | ''; onChange: (s: FfeStatus) => void; label: string; placeholder?: string }) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => e.target.value && onChange(e.target.value as FfeStatus)}
      className="h-8 shrink-0 rounded-md border bg-background px-1.5 text-xs"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {FFE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {FFE_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
}

function LineRow({ code, line, title, place, unit, canEdit, onStatus, path, noLink, contractor, amount }: { code: string; line: RoomFfe; title: string; place: string; unit: string; canEdit: boolean; onStatus: (s: FfeStatus) => void; path: string; noLink?: boolean; contractor: string; amount: number | null }) {
  return (
    <li className="flex min-h-10 flex-wrap items-center gap-2 border-b px-3 py-1 pl-9 text-sm last:border-b-0">
      <span className="min-w-0 flex-1">
        {noLink ? (
          <span className="truncate">{title}</span>
        ) : (
          <Link to="/projects/$code/locations/$path" params={{ code, path }} className="hover:underline">
            {title}
          </Link>
        )}
        {place && <span className="ml-2 hidden text-xs text-muted-foreground md:inline">{place}</span>}
        {line.source === 'manual' && <span className="ml-2 text-xs text-muted-foreground">{tr('своя правка')}</span>}
        {contractor && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{contractor}</span>}
      </span>
      {amount !== null && <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtMoney(amount)}</span>}
      <span className="w-16 shrink-0 text-right tabular-nums">
        {line.qty} {unit}
      </span>
      {canEdit ? (
        <StatusSelect label={tr('Статус')} value={line.status} onChange={onStatus} />
      ) : (
        <span className="flex w-28 items-center gap-1.5 text-xs">
          <span className={`size-2 rounded-full ${FFE_STATUS_DOT[line.status]}`} aria-hidden />
          {FFE_STATUS_LABELS[line.status]}
        </span>
      )}
    </li>
  )
}
