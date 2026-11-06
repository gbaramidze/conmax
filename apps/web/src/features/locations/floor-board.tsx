import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Check, LayoutGrid, ListChecks, Rows3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { roomTypesQuery } from '@/features/ffe/api'
import { PURPOSE_LABELS, type LocationPurpose } from '@/features/locations/api'
import { NO_TYPE_COLOR, typeColors } from '@/features/locations/type-colors'
import { floorBoardQuery, type BoardRoom } from '@/features/renders/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const shortName = (r: BoardRoom) => r.name.replace(/^(номер|помещение|квартира|room)\s*/i, '') || r.name
const pct = (r: BoardRoom) => (r.ffe_total > 0 ? Math.round((100 * r.ffe_installed) / r.ffe_total) : null)
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

type View = 'tiles' | 'table'

/**
 * Этаж компактно: строка-сводка, легенда типов одной лентой и мелкие плитки (номер, цвет типа, мебель, задачи).
 * Тип, площадь и мебель — во всплывающей подсказке плитки; подробности и сравнение — в режиме «Таблица».
 */
export function FloorBoard({
  projectId,
  floorId,
  code,
  selecting,
  picked,
  onToggle,
}: {
  projectId: string
  floorId: string
  code: string
  selecting: boolean
  picked: Set<string>
  onToggle: (id: string) => void
}) {
  const { data: rooms = [], isPending } = useQuery(floorBoardQuery(floorId))
  const { data: typeData } = useQuery(roomTypesQuery(projectId))
  const colorFor = useMemo(() => typeColors((typeData?.types ?? []).map((t) => t.name)), [typeData])
  const [view, setView] = useState<View>('tiles')
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [onlyTasks, setOnlyTasks] = useState(false)

  const typeInfo = useMemo(() => {
    const m = new Map<string, { name: string; color: string; count: number }>()
    for (const r of rooms) {
      const key = r.type_name ?? ''
      const cur = m.get(key) ?? { name: key || tr('Без типа'), color: colorFor(key), count: 0 }
      cur.count += 1
      m.set(key, cur)
    }
    return m
  }, [rooms, colorFor])
  const colorOf = (r: BoardRoom) => typeInfo.get(r.type_name ?? '')?.color ?? NO_TYPE_COLOR

  const shown = useMemo(() => rooms.filter((r) => (types.size === 0 || types.has(r.type_name ?? '')) && (!onlyTasks || r.tasks_open > 0)), [rooms, types, onlyTasks])

  const totals = useMemo(() => {
    const ffeTotal = rooms.reduce((s, r) => s + r.ffe_total, 0)
    const ffeDone = rooms.reduce((s, r) => s + r.ffe_installed, 0)
    return {
      area: rooms.reduce((s, r) => s + (r.area ?? 0), 0),
      ffe: ffeTotal > 0 ? Math.round((100 * ffeDone) / ffeTotal) : null,
      open: rooms.reduce((s, r) => s + r.tasks_open, 0),
      overdue: rooms.reduce((s, r) => s + r.tasks_overdue, 0),
    }
  }, [rooms])

  if (isPending) return <p className="text-sm text-muted-foreground">{tr('Загружаем помещения…')}</p>
  if (rooms.length === 0) return <p className="text-sm text-muted-foreground">{tr('На этаже пока нет помещений.')}</p>

  const toggleType = (key: string) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const open = (r: BoardRoom) => ({ to: '/projects/$code/locations/$path' as const, params: { code, path: r.path } })
  const hint = (r: BoardRoom) =>
    [r.name, r.type_name, r.area ? `${nf.format(r.area)} ${tr('м²')}` : null, pct(r) !== null ? `${tr('Мебель')} ${pct(r)}%` : null, r.tasks_open ? tr('Открытых задач: {{n}}', { n: r.tasks_open }) : null].filter(Boolean).join(' · ')

  const chip = (on: boolean) =>
    cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-foreground bg-foreground/5 font-medium' : 'bg-background hover:bg-muted')

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          <b className="font-semibold text-foreground">{rooms.length}</b> {tr('помещ.')}
        </span>
        <span>
          <b className="font-semibold text-foreground">{[...typeInfo.keys()].filter(Boolean).length}</b> {tr('типов')}
        </span>
        {totals.area > 0 && (
          <span>
            <b className="font-semibold text-foreground">{nf.format(totals.area)}</b> {tr('м²')}
          </span>
        )}
        {totals.ffe !== null && (
          <span>
            {tr('мебель')} <b className="font-semibold text-foreground">{totals.ffe}%</b>
          </span>
        )}
        {totals.open > 0 && (
          <span className={cn(totals.overdue > 0 && 'text-red-700 dark:text-red-300')}>
            {tr('задач')} <b className="font-semibold">{totals.open}</b>
            {totals.overdue > 0 && ` (${tr('просрочено')} ${totals.overdue})`}
          </span>
        )}
        <span className="ml-auto inline-flex overflow-hidden rounded-md border" role="group" aria-label={tr('Вид')}>
          <button type="button" aria-pressed={view === 'tiles'} onClick={() => setView('tiles')} title={tr('Плитки')} aria-label={tr('Плитки')} className={cn('inline-flex size-6 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring', view === 'tiles' ? 'bg-muted text-foreground' : 'hover:bg-muted/60')}>
            <LayoutGrid className="size-3.5" />
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} title={tr('Таблица')} aria-label={tr('Таблица')} className={cn('inline-flex size-6 items-center justify-center border-l outline-none focus-visible:ring-2 focus-visible:ring-ring', view === 'table' ? 'bg-muted text-foreground' : 'hover:bg-muted/60')}>
            <Rows3 className="size-3.5" />
          </button>
        </span>
      </p>

      <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label={tr('Фильтр по типам номеров')}>
        {[...typeInfo].sort((a, b) => a[1].name.localeCompare(b[1].name, undefined, { numeric: true })).map(([key, t]) => (
          <button key={key || 'none'} type="button" aria-pressed={types.has(key)} onClick={() => toggleType(key)} className={chip(types.has(key))}>
            <span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} />
            {t.name}
            <span className="tabular-nums text-muted-foreground">{t.count}</span>
          </button>
        ))}
        <button type="button" aria-pressed={onlyTasks} onClick={() => setOnlyTasks((v) => !v)} className={chip(onlyTasks)}>
          <ListChecks className="size-3" /> {tr('С задачами')}
        </button>
        {(types.size > 0 || onlyTasks) && (
          <button type="button" onClick={() => { setTypes(new Set()); setOnlyTasks(false) }} className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {tr('Сбросить')}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{tr('Ничего не подходит под фильтр.')}</p>
      ) : view === 'tiles' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5" aria-label={tr('Помещения этажа')}>
          {shown.map((r) => {
            const done = pct(r)
            const on = picked.has(r.id)
            const body = (
              <>
                <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: colorOf(r) }} />
                <span className="flex items-start justify-between gap-1">
                  <span className="text-sm font-semibold leading-none tabular-nums">{shortName(r)}</span>
                  {selecting ? (
                    <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')}>
                      {on && <Check className="size-3" />}
                    </span>
                  ) : r.tasks_open > 0 ? (
                    <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-medium leading-4 tabular-nums', r.tasks_overdue > 0 ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200')}>
                      {r.tasks_overdue > 0 && <AlertTriangle className="size-2.5" aria-hidden />}
                      {r.tasks_open}
                    </span>
                  ) : null}
                </span>
                <span className="h-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  {done !== null && <span className="block h-full bg-emerald-500" style={{ width: `${done}%` }} />}
                </span>
              </>
            )
            const cls = cn('relative flex h-10 w-full flex-col justify-between overflow-hidden rounded-md border bg-card py-1.5 pl-2.5 pr-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring', on && 'ring-2 ring-primary')
            return (
              <li key={r.id}>
                {selecting ? (
                  <button type="button" role="checkbox" aria-checked={on} aria-label={hint(r)} title={hint(r)} onClick={() => onToggle(r.id)} className={cls}>
                    {body}
                  </button>
                ) : (
                  <Link {...open(r)} aria-label={hint(r)} title={hint(r)} className={cls}>
                    {body}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                {selecting && <th className="w-8 px-2 py-1" />}
                <th className="px-2 py-1 font-medium">{tr('Помещение')}</th>
                <th className="px-2 py-1 font-medium">{tr('Тип')}</th>
                <th className="px-2 py-1 text-right font-medium">{tr('м²')}</th>
                <th className="px-2 py-1 font-medium">{tr('Мебель')}</th>
                <th className="px-2 py-1 text-right font-medium">{tr('Задачи')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => {
                const done = pct(r)
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    {selecting && (
                      <td className="px-2 py-1">
                        <input type="checkbox" className="size-3.5" aria-label={r.name} checked={picked.has(r.id)} onChange={() => onToggle(r.id)} />
                      </td>
                    )}
                    <td className="px-2 py-1 font-medium">
                      <Link {...open(r)} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: colorOf(r) }} />
                        {r.type_name ?? PURPOSE_LABELS[(r.purpose ?? 'other') as LocationPurpose]}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.area ? nf.format(r.area) : '—'}</td>
                    <td className="px-2 py-1 tabular-nums">{done === null ? '—' : `${done}%`}</td>
                    <td className={cn('px-2 py-1 text-right tabular-nums', r.tasks_overdue > 0 && 'font-medium text-red-700 dark:text-red-300')}>{r.tasks_open || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
