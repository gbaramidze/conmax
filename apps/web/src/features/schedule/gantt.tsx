import { tr } from '@/lib/tr'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, ScheduleLink } from '@/features/schedule/api'
import {
  barOf,
  dayOf,
  dowOf,
  fmtDate,
  HEADER_H,
  isoOf,
  linkPath,
  nextWorkday,
  ROW_H,
  todayDay,
  workdaysBetween,
  type Bar,
  type Calendar,
  type Row,
  type Scale,
  type Zoom,
} from '@/features/schedule/model'

const MONTHS = [tr('янв'), tr('фев'), tr('мар'), tr('апр'), tr('май'), tr('июн'), tr('июл'), tr('авг'), tr('сен'), tr('окт'), tr('ноя'), tr('дек')]

export interface BaselineRow {
  start_date: string | null
  finish_date: string | null
}

interface DragState {
  id: string
  mode: 'move' | 'resize'
  startX: number
  dx: number
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/**
 * Диаграмма Ганта: слева таблица работ, справа шкала времени с полосами, зависимостями и критическим путём.
 * Полосу можно сдвинуть (задаёт «начать не раньше») или растянуть за правый край (меняет длительность).
 */
export function Gantt({
  rows,
  links,
  scale,
  zoom,
  baseline,
  selectedId,
  criticalOnly,
  canEdit,
  calendar,
  height,
  onSelect,
  onToggle,
  onMove,
  onResize,
}: {
  rows: Row[]
  links: ScheduleLink[]
  scale: Scale
  zoom: Zoom
  baseline: Map<string, BaselineRow> | null
  selectedId: string | null
  criticalOnly: boolean
  canEdit: boolean
  calendar: Calendar
  height: string
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onMove: (id: string, startIso: string) => void
  onResize: (id: string, durationDays: number) => void
}) {
  const narrow = useIsNarrow()
  const tableW = narrow ? 170 : 460
  const timelineW = scale.days * scale.px
  const [drag, setDragState] = useState<DragState | null>(null)
  // актуальное состояние перетаскивания для обработчика отпускания (state обновляется асинхронно)
  const dragRef = useRef<DragState | null>(null)
  const setDrag = (d: DragState | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const scroller = useRef<HTMLDivElement>(null)
  const today = todayDay()

  // при открытии прокручиваем к сегодняшнему дню
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !scroller.current) return
    scrolled.current = true
    scroller.current.scrollLeft = Math.max(0, scale.x(today) - 220)
  }, [scale, today])

  const rowOf = useMemo(() => new Map(rows.map((r) => [r.a.id, r.index])), [rows])
  const bars = useMemo(() => {
    const m = new Map<string, Bar>()
    for (const r of rows) {
      const b = barOf(r.a, r.index, scale)
      if (b) m.set(r.a.id, b)
    }
    return m
  }, [rows, scale])

  const visibleLinks = useMemo(
    () =>
      links
        .map((l) => ({ l, p: bars.get(l.predecessor_id), s: bars.get(l.successor_id) }))
        .filter((x): x is { l: ScheduleLink; p: Bar; s: Bar } => !!x.p && !!x.s),
    [links, bars],
  )
  const criticalIds = useMemo(() => new Set(rows.filter((r) => r.a.is_critical).map((r) => r.a.id)), [rows])

  // шапка шкалы: месяцы и подпись дней/недель
  const header = useMemo(() => {
    const months: { x: number; w: number; label: string }[] = []
    const ticks: { x: number; w: number; label: string; weekend?: boolean }[] = []
    let d = scale.origin
    const end = scale.origin + scale.days
    while (d < end) {
      const dt = new Date(d * 86_400_000)
      const y = dt.getUTCFullYear()
      const m = dt.getUTCMonth()
      const next = Math.floor(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1) / 86_400_000)
      const to = Math.min(next, end)
      months.push({ x: scale.x(d), w: (to - d) * scale.px, label: `${MONTHS[m]} ${String(y).slice(2)}` })
      d = to
    }
    if (zoom === 'day') {
      for (let k = scale.origin; k < end; k++) ticks.push({ x: scale.x(k), w: scale.px, label: String(new Date(k * 86_400_000).getUTCDate()), weekend: dowOf(k) >= 6 })
    } else if (zoom === 'week') {
      for (let k = scale.origin; k < end; k += 7) ticks.push({ x: scale.x(k), w: 7 * scale.px, label: String(new Date(k * 86_400_000).getUTCDate()) })
    }
    return { months, ticks }
  }, [scale, zoom])

  const weekends = useMemo(() => {
    if (zoom === 'month') return []
    const out: number[] = []
    for (let k = scale.origin; k < scale.origin + scale.days; k++) if (dowOf(k) >= 6) out.push(k)
    return out
  }, [scale, zoom])

  const gridLines = useMemo(() => {
    const out: { x: number; strong: boolean }[] = []
    if (zoom === 'day') {
      for (let k = scale.origin; k < scale.origin + scale.days; k++) if (dowOf(k) === 1) out.push({ x: scale.x(k), strong: true })
    } else {
      header.months.forEach((m) => out.push({ x: m.x, strong: true }))
    }
    return out
  }, [scale, zoom, header.months])

  function startDrag(e: React.PointerEvent, a: Activity, mode: 'move' | 'resize') {
    if (!canEdit || a.kind === 'summary' || (mode === 'resize' && a.kind === 'milestone')) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id: a.id, mode, startX: e.clientX, dx: 0 })
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current
    if (d) setDrag({ ...d, dx: e.clientX - d.startX })
  }
  function endDrag(a: Activity) {
    const d = dragRef.current
    setDrag(null)
    if (!d || !a.start_date || !a.finish_date) return
    const days = Math.round(d.dx / scale.px)
    if (Math.abs(d.dx) < 4 || days === 0) {
      onSelect(a.id)
      return
    }
    if (d.mode === 'move') {
      onMove(a.id, isoOf(nextWorkday(dayOf(a.start_date) + days, calendar)))
    } else {
      const start = dayOf(a.start_date)
      const finish = Math.max(dayOf(a.finish_date) + days, start)
      onResize(a.id, Math.max(workdaysBetween(start, finish, calendar), 1))
    }
  }

  const bodyH = rows.length * ROW_H

  return (
    <div ref={scroller} className="relative overflow-auto rounded-lg border bg-card shadow-soft" style={{ height }}>
      <div className="flex min-w-full flex-col" style={{ width: tableW + timelineW }}>
        {/* шапка */}
        <div className="sticky top-0 z-30 flex border-b bg-muted/80 backdrop-blur" style={{ height: HEADER_H }}>
          <div className="sticky left-0 z-40 flex shrink-0 items-end border-r bg-muted text-xs font-medium text-muted-foreground" style={{ width: tableW }}>
            <span className="w-10 px-2 py-1.5">№</span>
            <span className="min-w-0 flex-1 px-2 py-1.5">{tr('Работа')}</span>
            {!narrow && (
              <>
                <span className="w-9 px-1 py-1.5 text-right">{tr('Дн.')}</span>
                <span className="w-[62px] px-1 py-1.5 text-right">{tr('Начало')}</span>
                <span className="w-[62px] px-1 py-1.5 text-right">{tr('Конец')}</span>
                <span className="w-9 px-1 py-1.5 text-right">{tr('Рез.')}</span>
              </>
            )}
          </div>
          <div className="relative isolate shrink-0" style={{ width: timelineW }}>
            {header.months.map((m) => (
              <div key={m.x} className="absolute top-0 flex h-6 items-center border-l px-1.5 text-xs font-medium" style={{ left: m.x, width: m.w }}>
                <span className="truncate">{m.label}</span>
              </div>
            ))}
            {header.ticks.map((t) => (
              <div
                key={t.x}
                className={`absolute top-6 flex h-[26px] items-center justify-center border-l text-[11px] ${t.weekend ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
                style={{ left: t.x, width: t.w }}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {/* тело */}
        <div className="flex">
          <div className="sticky left-0 z-20 shrink-0 border-r bg-card" style={{ width: tableW }}>
            {rows.map((r) => {
              const a = r.a
              const selected = selectedId === a.id
              return (
                <div
                  key={a.id}
                  role="row"
                  aria-selected={selected}
                  onClick={() => onSelect(a.id)}
                  className={`flex cursor-pointer items-center border-b text-sm ${selected ? 'bg-signal/15' : 'hover:bg-muted/50'}`}
                  style={{ height: ROW_H }}
                >
                  <span className="w-10 shrink-0 px-2 text-xs tabular-nums text-muted-foreground">{r.wbs}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1 pr-2" style={{ paddingLeft: r.depth * 14 }}>
                    {r.hasChildren ? (
                      <button
                        type="button"
                        className="grid size-5 shrink-0 place-items-center rounded hover:bg-muted"
                        aria-label={tr('Свернуть или развернуть «{{name}}»', { name: a.name })}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggle(a.id)
                        }}
                      >
                        <Chevron open={rows.some((x) => x.a.parent_id === a.id)} />
                      </button>
                    ) : (
                      <span className="size-5 shrink-0" />
                    )}
                    <span className={`truncate ${a.kind === 'summary' ? 'font-semibold' : ''} ${a.is_critical ? 'text-red-700 dark:text-red-300' : ''}`} title={a.name}>
                      {a.name}
                    </span>
                  </span>
                  {!narrow && (
                    <>
                      <span className="w-9 shrink-0 px-1 text-right text-xs tabular-nums text-muted-foreground">{a.kind === 'summary' ? '' : a.duration_days}</span>
                      <span className="w-[62px] shrink-0 px-1 text-right text-xs tabular-nums text-muted-foreground">{fmtDate(a.start_date)}</span>
                      <span className="w-[62px] shrink-0 px-1 text-right text-xs tabular-nums text-muted-foreground">{fmtDate(a.finish_date)}</span>
                      <span className={`w-9 shrink-0 px-1 text-right text-xs tabular-nums ${a.total_float !== null && a.total_float <= 0 ? 'font-medium text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>
                        {a.total_float ?? ''}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* isolate: полосы и стрелки — в своём слое, чтобы при прокрутке не наезжать на закреплённую таблицу и шапку */}
          <div
            className="relative isolate shrink-0"
            style={{
              width: timelineW,
              height: bodyH,
              backgroundImage: `linear-gradient(to bottom, transparent ${ROW_H - 1}px, var(--border) ${ROW_H - 1}px)`,
              backgroundSize: `100% ${ROW_H}px`,
            }}
          >
            {weekends.map((k) => (
              <div key={k} className="absolute inset-y-0 bg-muted/50" style={{ left: scale.x(k), width: scale.px }} />
            ))}
            {gridLines.map((g) => (
              <div key={g.x} className="absolute inset-y-0 border-l border-border/70" style={{ left: g.x }} />
            ))}
            {selectedId && rowOf.has(selectedId) && <div className="absolute inset-x-0 bg-signal/10" style={{ top: rowOf.get(selectedId)! * ROW_H, height: ROW_H }} />}

            {/* сегодня */}
            <div className="absolute inset-y-0 z-10 w-px bg-red-500" style={{ left: scale.x(today) + scale.px / 2 }} title={tr('Сегодня')} />

            {/* полосы */}
            {rows.map((r) => {
              const a = r.a
              const b = bars.get(a.id)
              if (!b) return null
              const dragging = drag?.id === a.id
              const dxDays = dragging ? Math.round(drag!.dx / scale.px) : 0
              const shift = dragging && drag!.mode === 'move' ? dxDays * scale.px : 0
              const grow = dragging && drag!.mode === 'resize' ? dxDays * scale.px : 0
              const dim = criticalOnly && !a.is_critical
              const base = baseline?.get(a.id)
              const baseBar = base?.start_date && base.finish_date ? { x1: scale.x(dayOf(base.start_date)), x2: scale.x(dayOf(base.finish_date) + 1) } : null
              const color = a.actual_finish
                ? 'bg-green-600'
                : a.is_critical
                  ? 'bg-red-600'
                  : a.kind === 'summary'
                    ? 'bg-foreground/80'
                    : 'bg-sky-600'

              return (
                <div key={a.id} className={dim ? 'opacity-25' : ''}>
                  {baseBar && a.kind !== 'milestone' && (
                    <div className="absolute z-0 h-1 rounded bg-muted-foreground/50" style={{ left: baseBar.x1, width: Math.max(baseBar.x2 - baseBar.x1, 3), top: b.y + ROW_H - 8 }} title={tr('Базовый план')} />
                  )}
                  {a.kind === 'milestone' ? (
                    <div
                      className={`absolute z-20 size-3.5 rotate-45 ${a.is_critical ? 'bg-red-600' : 'bg-amber-500'} ${canEdit ? 'cursor-grab' : ''}`}
                      style={{ left: b.x1 - 7 + shift, top: b.mid - 7 }}
                      title={`${a.name} — ${fmtDate(a.start_date)}`}
                      onPointerDown={(e) => startDrag(e, a, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={() => endDrag(a)}
                      onClick={() => onSelect(a.id)}
                    />
                  ) : a.kind === 'summary' ? (
                    <div className="absolute z-10" style={{ left: b.x1, width: Math.max(b.x2 - b.x1, 4), top: b.mid - 5 }} title={`${a.name}: ${fmtDate(a.start_date)} — ${fmtDate(a.finish_date)}`} onClick={() => onSelect(a.id)}>
                      <div className="h-2.5 rounded-sm bg-foreground/80" />
                      <div className="absolute -bottom-1 left-0 size-0 border-x-4 border-t-[5px] border-x-transparent border-t-foreground/80" />
                      <div className="absolute -bottom-1 right-0 size-0 border-x-4 border-t-[5px] border-x-transparent border-t-foreground/80" />
                    </div>
                  ) : (
                    <div
                      className={`absolute z-20 flex items-center overflow-hidden rounded ${color} ${canEdit ? 'cursor-grab' : ''} ${selectedId === a.id ? 'ring-2 ring-foreground/60' : ''} ${dragging ? 'opacity-80' : ''}`}
                      style={{ left: b.x1 + shift, width: Math.max(b.x2 - b.x1 + grow, 6), top: b.y + 8, height: ROW_H - 18 }}
                      title={`${a.name}: ${fmtDate(a.start_date)} — ${fmtDate(a.finish_date)}${a.percent_complete > 0 ? `, ${Math.round(a.percent_complete)}%` : ''}`}
                      onPointerDown={(e) => startDrag(e, a, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={() => endDrag(a)}
                      onClick={() => !canEdit && onSelect(a.id)}
                    >
                      {a.percent_complete > 0 && <div className="absolute inset-y-0 left-0 bg-black/30" style={{ width: `${Math.min(a.percent_complete, 100)}%` }} />}
                      {canEdit && (
                        <div
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                          aria-hidden
                          onPointerDown={(e) => startDrag(e, a, 'resize')}
                          onPointerMove={moveDrag}
                          onPointerUp={(e) => {
                            e.stopPropagation()
                            endDrag(a)
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* зависимости */}
            <svg className="pointer-events-none absolute inset-0 z-30" width={timelineW} height={bodyH} aria-hidden>
              <defs>
                <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
                </marker>
              </defs>
              {visibleLinks.map(({ l, p, s }) => {
                const crit = criticalIds.has(l.predecessor_id) && criticalIds.has(l.successor_id)
                const dim = criticalOnly && !crit
                return (
                  <path
                    key={l.id}
                    d={linkPath(l.type, p, s)}
                    fill="none"
                    strokeWidth={crit ? 1.6 : 1}
                    markerEnd="url(#arrow)"
                    className={crit ? 'text-red-600' : 'text-muted-foreground'}
                    stroke="currentColor"
                    opacity={dim ? 0.15 : 0.85}
                  />
                )
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
}
