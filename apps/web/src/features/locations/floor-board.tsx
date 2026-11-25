import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Check, ImageOff, LayoutGrid, ListChecks, Rows3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { roomTypesQuery } from '@/features/ffe/api'
import { PURPOSE_LABELS, type LocationPurpose } from '@/features/locations/api'
import { NO_TYPE_COLOR, typeColors } from '@/features/locations/type-colors'
import { floorBoardQuery, imageUrlsQuery, type BoardRoom } from '@/features/renders/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const shortName = (r: BoardRoom) => r.name.replace(/^(номер|помещение|квартира|room|ნომერი|ოთახი|ბინა)\s*/i, '') || r.name
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
  // обложки номеров одной пачкой ссылок; у номеров одного типа обложка общая — ключи без повторов
  const coverKeys = useMemo(() => [...new Set(rooms.map((r) => r.cover_key).filter((k): k is string => !!k))], [rooms])
  const { data: coverUrls } = useQuery(imageUrlsQuery(coverKeys))

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
    cn(
      'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
      on ? 'border-primary bg-primary/15 font-medium' : 'bg-background hover:bg-muted',
    )
  const typeCount = [...typeInfo.keys()].filter(Boolean).length
  const stat = 'flex min-w-0 flex-col gap-1 rounded-xl border bg-background px-3 py-2.5'

  return (
    <div className="flex flex-col gap-3">
      {/* сводка этажа карточками: одна цифра — одна карточка */}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
        <div className={stat}>
          <dt className="text-xs text-muted-foreground">{tr('Помещения')}</dt>
          <dd className="text-xl font-semibold leading-none tabular-nums">{rooms.length}</dd>
        </div>
        <div className={stat}>
          <dt className="text-xs text-muted-foreground">{tr('Типы номеров')}</dt>
          <dd className="text-xl font-semibold leading-none tabular-nums">{typeCount}</dd>
        </div>
        {totals.area > 0 && (
          <div className={stat}>
            <dt className="text-xs text-muted-foreground">{tr('Площадь, м²')}</dt>
            <dd className="text-xl font-semibold leading-none tabular-nums">{nf.format(totals.area)}</dd>
          </div>
        )}
        <div className={stat}>
          <dt className="text-xs text-muted-foreground">{tr('Мебель и оборудование')}</dt>
          <dd className="flex items-center gap-2">
            <span className="text-xl font-semibold leading-none tabular-nums">{totals.ffe === null ? '—' : `${totals.ffe}%`}</span>
            {totals.ffe !== null && (
              <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${totals.ffe}%` }} />
              </span>
            )}
          </dd>
        </div>
        <div className={cn(stat, totals.overdue > 0 && 'border-destructive/40 bg-destructive/5')}>
          <dt className="text-xs text-muted-foreground">{tr('Открытые задачи')}</dt>
          <dd className="flex items-baseline gap-2">
            <span className="text-xl font-semibold leading-none tabular-nums">{totals.open}</span>
            {totals.overdue > 0 && <span className="text-xs font-medium text-destructive">{tr('просрочено: {{n}}', { n: totals.overdue })}</span>}
          </dd>
        </div>
      </dl>

      {/* фильтр по типам: на компьютере переносится строками, на телефоне — лента с прокруткой без полосы */}
      <div className="flex items-start gap-2">
        <div
          className="-mx-1 flex min-w-0 flex-1 gap-1.5 px-1 max-sm:overflow-x-auto max-sm:[scrollbar-width:none] sm:flex-wrap max-sm:[&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label={tr('Фильтр по типам номеров')}
        >
          {[...typeInfo].sort((a, b) => a[1].name.localeCompare(b[1].name, undefined, { numeric: true })).map(([key, t]) => (
            <button key={key || 'none'} type="button" aria-pressed={types.has(key)} onClick={() => toggleType(key)} className={chip(types.has(key))}>
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: t.color }} />
              {t.name}
              <span className="tabular-nums text-muted-foreground">{t.count}</span>
            </button>
          ))}
          <button type="button" aria-pressed={onlyTasks} onClick={() => setOnlyTasks((v) => !v)} className={chip(onlyTasks)}>
            <ListChecks className="size-3.5" /> {tr('С задачами')}
          </button>
          {(types.size > 0 || onlyTasks) && (
            <button type="button" onClick={() => { setTypes(new Set()); setOnlyTasks(false) }} className="h-8 shrink-0 px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              {tr('Сбросить')}
            </button>
          )}
        </div>
        <span className="inline-flex shrink-0 overflow-hidden rounded-lg border bg-background" role="group" aria-label={tr('Вид')}>
          <button type="button" aria-pressed={view === 'tiles'} onClick={() => setView('tiles')} title={tr('Плитки')} aria-label={tr('Плитки')} className={cn('inline-flex size-8 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring', view === 'tiles' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
            <LayoutGrid className="size-4" />
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} title={tr('Таблица')} aria-label={tr('Таблица')} className={cn('inline-flex size-8 items-center justify-center border-l outline-none focus-visible:ring-2 focus-visible:ring-ring', view === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
            <Rows3 className="size-4" />
          </button>
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">{tr('Ничего не подходит под фильтр.')}</p>
      ) : view === 'tiles' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5 max-sm:grid-cols-2" aria-label={tr('Помещения этажа')}>
          {shown.map((r) => {
            const done = pct(r)
            const on = picked.has(r.id)
            const src = r.cover_key ? coverUrls?.get(r.cover_key) : undefined
            const body = (
              <>
                {/* обложка номера (своя или рендер его типа) — видно, что за номер, не открывая его */}
                <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted" style={src ? undefined : { backgroundColor: `color-mix(in srgb, ${colorOf(r)} 14%, transparent)` }}>
                  {src ? (
                    <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                  ) : (
                    <ImageOff className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50" aria-hidden />
                  )}
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-1" style={{ background: colorOf(r) }} />
                  {selecting ? (
                    <span aria-hidden className={cn('absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md border-2 shadow', on ? 'border-primary bg-primary text-primary-foreground' : 'border-white bg-black/25')}>
                      {on && <Check className="size-4" />}
                    </span>
                  ) : r.tasks_open > 0 ? (
                    <span className={cn('absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums shadow', r.tasks_overdue > 0 ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950')}>
                      {r.tasks_overdue > 0 && <AlertTriangle className="size-3" aria-hidden />}
                      {r.tasks_open}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-1 flex-col gap-0.5 px-2.5 pb-2 pt-1.5">
                <span className="text-lg font-semibold leading-tight tabular-nums">{shortName(r)}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorOf(r) }} />
                  <span className="truncate">{r.type_name ?? PURPOSE_LABELS[(r.purpose ?? 'other') as LocationPurpose]}</span>
                </span>
                {/* площадь и мебель — только если есть что показать: пустых серых полосок больше нет */}
                <span className="mt-auto flex items-center gap-1.5 pt-0.5 text-[11px] tabular-nums text-muted-foreground empty:hidden">
                  {r.area ? <span>{`${nf.format(r.area)} ${tr('м²')}`}</span> : null}
                  {done !== null && (
                    <span className="ml-auto flex items-center gap-1" title={`${tr('Мебель')} ${done}%`}>
                      <span className="h-1 w-8 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="block h-full bg-emerald-500" style={{ width: `${done}%` }} />
                      </span>
                      {done}%
                    </span>
                  )}
                </span>
                </span>
              </>
            )
            const cls = cn(
              'group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-left outline-none transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring',
              on && 'ring-2 ring-primary',
            )
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
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm [&_td]:py-2 [&_th]:py-2 [&_td:first-child]:pl-3 [&_th:first-child]:pl-3 [&_td:last-child]:pr-3 [&_th:last-child]:pr-3">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
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
