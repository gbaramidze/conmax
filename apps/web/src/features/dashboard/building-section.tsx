import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { buildingSectionQuery, dashboardQuery, fmtPercent, type FloorCell } from '@/features/dashboard/api'
import { locationsQuery } from '@/features/locations/api'

type Metric = 'progress' | 'problems' | 'walks' | 'checks'

const METRIC_LABELS: Record<Metric, string> = {
  progress: tr('Готовность'),
  problems: tr('Проблемы'),
  walks: tr('Обходы'),
  checks: tr('Расхождения'),
}

const DAY_MS = 86_400_000

interface Look {
  /** Цвет заливки: класс Tailwind или готовый стиль для плавной шкалы */
  className: string
  style?: React.CSSProperties
  text: string
}

const NEUTRAL = 'bg-muted text-muted-foreground'
const HATCH: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, currentColor 14%, transparent) 5px 6px)',
}

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : null
}

/** Как выглядит этаж в выбранном срезе: цвет и текст в ячейке. Цвет всегда дублируется текстом. */
function look(f: FloorCell, metric: Metric, staleDays: number): Look {
  if (metric === 'progress') {
    if (f.percent === null) return { className: NEUTRAL, style: HATCH, text: '—' }
    const p = Math.max(0, Math.min(100, Number(f.percent)))
    return {
      className: p >= 55 ? 'text-white' : 'text-foreground',
      style: { backgroundColor: `color-mix(in srgb, #15803d ${p}%, var(--muted))` },
      text: `${Math.round(p)}%`,
    }
  }
  if (metric === 'problems') {
    const hot = f.overdue + f.blocked
    if (hot >= 3) return { className: 'bg-red-600 text-white', text: String(hot + f.punch) }
    if (hot >= 1) return { className: 'bg-red-300 text-red-950 dark:bg-red-500/70 dark:text-white', text: String(hot + f.punch) }
    if (f.punch > 0) return { className: 'bg-amber-300 text-amber-950 dark:bg-amber-500/70 dark:text-white', text: String(f.punch) }
    return { className: 'bg-green-100 text-green-900 dark:bg-green-500/25 dark:text-green-100', text: f.open_tasks > 0 ? '✓' : '·' }
  }
  if (metric === 'walks') {
    const d = daysSince(f.last_walk)
    if (d === null) return { className: NEUTRAL, style: HATCH, text: tr('нет') }
    if (d <= staleDays) return { className: 'bg-green-300 text-green-950 dark:bg-green-500/60 dark:text-white', text: tr('{{d}} дн', { d }) }
    if (d <= staleDays * 2) return { className: 'bg-amber-300 text-amber-950 dark:bg-amber-500/70 dark:text-white', text: tr('{{d}} дн', { d }) }
    return { className: 'bg-red-300 text-red-950 dark:bg-red-500/70 dark:text-white', text: tr('{{d}} дн', { d }) }
  }
  const n = f.discrepancies ?? 0
  return n > 0
    ? { className: 'bg-red-300 text-red-950 dark:bg-red-500/70 dark:text-white', text: String(n) }
    : { className: 'bg-green-100 text-green-900 dark:bg-green-500/25 dark:text-green-100', text: '✓' }
}

function details(f: FloorCell, label: string): string {
  const parts = [`${label}: ${f.percent === null ? tr('нет объёмов') : tr('готово {{v1}}', { v1: fmtPercent(f.percent) })}`]
  if (f.overdue > 0) parts.push(tr('просрочено задач: {{overdue}}', { overdue: f.overdue }))
  if (f.blocked > 0) parts.push(tr('заблокировано: {{blocked}}', { blocked: f.blocked }))
  if (f.punch > 0) parts.push(tr('замечаний: {{punch}}', { punch: f.punch }))
  parts.push(tr('открытых задач: {{open_tasks}}', { open_tasks: f.open_tasks }))
  if (f.discrepancies !== null && f.discrepancies > 0) parts.push(tr('расхождений проверок: {{discrepancies}}', { discrepancies: f.discrepancies }))
  if (f.last_walk !== undefined && f.discrepancies !== null) {
    const d = daysSince(f.last_walk)
    parts.push(d === null ? tr('обхода не было') : tr('последний обход {{d}} дн назад', { d }))
  }
  return parts.join('\n')
}

const floorLabel = (f: FloorCell) => f.name.replace(/^Этаж\s*/i, '') || f.code

/**
 * «Разрез здания»: каждый корпус схемой по этажам (сверху вниз), секции — колонками. Ячейка раскрашена выбранным срезом:
 * готовность, проблемы (просрочки, блокировки, замечания), давность обхода, открытые расхождения проверок.
 * Клик по этажу открывает его: задачи, документы и заметки места.
 */
export function BuildingSection({ projectId, code }: { projectId: string; code: string }) {
  const { data: cells, isPending } = useQuery(buildingSectionQuery(projectId))
  const { data: dashboard } = useQuery(dashboardQuery(projectId))
  const { data: locations } = useQuery(locationsQuery(projectId))
  const [metric, setMetric] = useState<Metric>('progress')

  const staleDays = dashboard?.attention?.stale_days ?? 7
  const internal = (cells ?? []).some((c) => c.discrepancies !== null)
  const metrics = (['progress', 'problems', ...(internal ? (['walks', 'checks'] as const) : [])] as Metric[])
  const nameOf = useMemo(() => new Map((locations ?? []).map((l) => [l.path, l.name])), [locations])
  const buildingPercent = useMemo(() => new Map((dashboard?.by_location ?? []).filter((l) => l.depth === 1).map((l) => [l.path, l.percent])), [dashboard])

  const buildings = useMemo(() => {
    const byBuilding = new Map<string, FloorCell[]>()
    for (const c of cells ?? []) byBuilding.set(c.building, [...(byBuilding.get(c.building) ?? []), c])
    return [...byBuilding.entries()].map(([path, floors]) => {
      const sections = [...new Set(floors.map((f) => f.section).filter((s): s is string => !!s))]
      // ряды — этажи по порядку от верхнего к нижнему; ключ — код этажа внутри корпуса
      const rowsByCode = new Map<string, number>()
      for (const f of floors) rowsByCode.set(f.code, Math.max(rowsByCode.get(f.code) ?? -Infinity, f.sort))
      const rows = [...rowsByCode.entries()].sort((a, b) => b[1] - a[1]).map(([c, sort]) => ({ code: c, sort }))
      return { path, sections, rows, floors }
    })
  }, [cells])

  if (isPending) return <p className="text-sm text-muted-foreground">{tr('Строим разрез здания…')}</p>
  if (buildings.length === 0) return null

  return (
    <section className="flex flex-col gap-3" aria-label={tr('Разрез здания')}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{tr('Разрез здания')}</h2>
          <p className="text-sm text-muted-foreground">{tr('Этажи сверху вниз, секции — колонками. Нажмите этаж, чтобы открыть его.')}</p>
        </div>
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={tr('Что показывать')}>
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={`h-8 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${metric === m ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4 rounded-lg border bg-card p-4 shadow-soft">
        {buildings.map((b) => {
          const cols = Math.max(b.sections.length, 1)
          const groundAfter = b.rows.findIndex((r) => r.sort <= 0) // первый подземный ряд — над ним линия земли
          const rowH = b.rows.length > 12 ? 'h-6' : 'h-8' // высокий корпус рисуем плотнее
          return (
            <figure key={b.path} className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="flex items-baseline gap-2 text-sm">
                <span className="font-semibold">{nameOf.get(b.path) ?? b.path}</span>
                <span className="text-xs text-muted-foreground">{fmtPercent(buildingPercent.get(b.path))}</span>
              </figcaption>

              {/* кровля */}
              <div className="ml-7 h-1.5 rounded-t bg-foreground/70" aria-hidden />
              <div className="flex gap-1.5">
                <ol className="flex w-5 flex-col gap-[3px] text-right text-[11px] leading-none text-muted-foreground" aria-hidden>
                  {b.sections.length > 0 && <li className="h-4" />}
                  {b.rows.map((r, i) => {
                    const f = b.floors.find((x) => x.code === r.code)!
                    return (
                      <li key={r.code} className={`flex ${rowH} items-center justify-end ${i === groundAfter ? 'mt-1.5' : ''}`}>
                        {floorLabel(f)}
                      </li>
                    )
                  })}
                </ol>
                <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 4rem)` }}>
                  {b.sections.length > 0 &&
                    b.sections.map((s) => (
                      <div key={s} className="h-4 truncate text-center text-[11px] leading-4 text-muted-foreground">
                        {nameOf.get(`${b.path}.${s}`) ?? s}
                      </div>
                    ))}
                  {b.rows.flatMap((r, i) =>
                    (b.sections.length > 0 ? b.sections : [null]).map((s) => {
                      const f = b.floors.find((x) => x.code === r.code && x.section === s)
                      const gap = i === groundAfter ? 'mt-1.5' : ''
                      if (!f) return <div key={`${r.code}:${s}`} className={`${rowH} rounded-sm border border-dashed border-border/60 ${gap}`} aria-hidden />
                      const l = look(f, metric, staleDays)
                      const label = `${nameOf.get(b.path) ?? b.path}${s ? `, ${nameOf.get(`${b.path}.${s}`) ?? s}` : ''}, ${f.name}`
                      return (
                        <Link
                          key={f.path}
                          to="/projects/$code/locations/$path"
                          params={{ code, path: f.path }}
                          title={details(f, label)}
                          aria-label={tr('{{v1}}. Значение: {{text}}', { v1: details(f, label).replace(/\n/g, '; '), text: l.text })}
                          className={`relative flex ${rowH} items-center justify-center rounded-sm text-xs font-medium tabular-nums outline-none transition-transform hover:z-10 hover:scale-105 hover:shadow focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring ${l.className} ${gap}`}
                          style={l.style}
                        >
                          {l.text}
                          {metric === 'progress' && f.overdue > 0 && (
                            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] leading-none text-white ring-2 ring-card" aria-hidden>
                              {f.overdue}
                            </span>
                          )}
                        </Link>
                      )
                    }),
                  )}
                </div>
              </div>
              {groundAfter >= 0 && <p className="ml-7 text-[11px] text-muted-foreground">{tr('Ниже линии земли — подземные этажи')}</p>}
            </figure>
          )
        })}
      </div>

      <Legend metric={metric} staleDays={staleDays} />
    </section>
  )
}

function Swatch({ className, style, children }: { className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-3 rounded-sm ${className ?? ''}`} style={style} aria-hidden />
      {children}
    </span>
  )
}

function Legend({ metric, staleDays }: { metric: Metric; staleDays: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {metric === 'progress' && (
        <>
          <span className="inline-flex items-center gap-1.5">
            0%
            <span className="h-2.5 w-24 rounded-sm" style={{ background: 'linear-gradient(to right, var(--muted), #15803d)' }} aria-hidden />
            100%
          </span>
          <Swatch className="bg-muted" style={HATCH}>{tr('нет объёмов')}</Swatch>
          <Swatch className="rounded-full bg-red-600">{tr('просроченных задач на этаже')}</Swatch>
        </>
      )}
      {metric === 'problems' && (
        <>
          <Swatch className="bg-green-200">{tr('без проблем')}</Swatch>
          <Swatch className="bg-amber-300">{tr('замечания')}</Swatch>
          <Swatch className="bg-red-300">{tr('просрочки или блокировки')}</Swatch>
          <Swatch className="bg-red-600">{tr('3 и больше')}</Swatch>
          <span>{tr('В ячейке — число замечаний, просроченных и заблокированных задач.')}</span>
        </>
      )}
      {metric === 'walks' && (
        <>
          <Swatch className="bg-green-300">{tr('не старше')}{' '}{staleDays}{tr('дн')}</Swatch>
          <Swatch className="bg-amber-300">{tr('до')}{' '}{staleDays * 2}{tr('дн')}</Swatch>
          <Swatch className="bg-red-300">{tr('давно')}</Swatch>
          <Swatch className="bg-muted" style={HATCH}>{tr('обхода не было')}</Swatch>
        </>
      )}
      {metric === 'checks' && (
        <>
          <Swatch className="bg-green-200">{tr('расхождений нет')}</Swatch>
          <Swatch className="bg-red-300">{tr('открытые расхождения (число в ячейке)')}</Swatch>
        </>
      )}
    </p>
  )
}
