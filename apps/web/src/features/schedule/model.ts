import { currentLocale } from '@/lib/i18n'
import type { Activity, ScheduleLink } from '@/features/schedule/api'

// ---------------------------------------------------------------------------
// Даты: строка «YYYY-MM-DD» ↔ номер суток (без часовых поясов и переходов на летнее время)
// ---------------------------------------------------------------------------
export const DAY_MS = 86_400_000

export const dayOf = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}
export const isoOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)
export const todayDay = (): number => dayOf(new Date().toLocaleDateString('sv'))
/** День недели: 1 — понедельник … 7 — воскресенье. */
export const dowOf = (day: number): number => ((new Date(day * DAY_MS).getUTCDay() + 6) % 7) + 1

export interface Calendar {
  workdays: number[]
  holidays: Set<string>
}

export function calendarFromSettings(settings: unknown): Calendar {
  const s = (settings ?? {}) as { workdays?: unknown; holidays?: unknown }
  const workdays = Array.isArray(s.workdays) && s.workdays.length > 0 ? s.workdays.map(Number) : [1, 2, 3, 4, 5]
  const holidays = new Set(Array.isArray(s.holidays) ? s.holidays.map(String) : [])
  return { workdays, holidays }
}

export const isWorkday = (day: number, cal: Calendar): boolean => cal.workdays.includes(dowOf(day)) && !cal.holidays.has(isoOf(day))

/** Ближайший рабочий день на или после day. */
export function nextWorkday(day: number, cal: Calendar): number {
  let d = day
  for (let i = 0; i < 400 && !isWorkday(d, cal); i++) d++
  return d
}

/** Сколько рабочих дней в промежутке [from, to] включительно. */
export function workdaysBetween(from: number, to: number, cal: Calendar): number {
  let n = 0
  for (let d = from; d <= to; d++) if (isWorkday(d, cal)) n++
  return n
}

// ---------------------------------------------------------------------------
// Дерево работ → плоский список строк
// ---------------------------------------------------------------------------
export interface Row {
  a: Activity
  depth: number
  wbs: string
  hasChildren: boolean
  index: number
}

export function buildRows(activities: Activity[], collapsed: Set<string>): Row[] {
  const byParent = new Map<string | null, Activity[]>()
  const ids = new Set(activities.map((a) => a.id))
  for (const a of activities) {
    // работа с удалённым или невидимым родителем показывается на верхнем уровне
    const key = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null
    const list = byParent.get(key) ?? []
    list.push(a)
    byParent.set(key, list)
  }
  for (const list of byParent.values()) list.sort((x, y) => x.sort - y.sort || (x.start_date ?? '').localeCompare(y.start_date ?? '') || x.name.localeCompare(y.name, currentLocale()))

  const rows: Row[] = []
  const walk = (parent: string | null, depth: number, prefix: string) => {
    const list = byParent.get(parent) ?? []
    list.forEach((a, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      const hasChildren = (byParent.get(a.id)?.length ?? 0) > 0
      rows.push({ a, depth, wbs, hasChildren, index: rows.length })
      if (hasChildren && !collapsed.has(a.id)) walk(a.id, depth + 1, wbs)
    })
  }
  walk(null, 0, '')
  return rows
}

/** Идентификаторы групп, у которых есть вложенные работы. */
export const groupIds = (activities: Activity[]): string[] => {
  const parents = new Set(activities.map((a) => a.parent_id).filter(Boolean) as string[])
  return [...parents]
}

// ---------------------------------------------------------------------------
// Шкала и геометрия
// ---------------------------------------------------------------------------
export type Zoom = 'day' | 'week' | 'month'
export const PX_PER_DAY: Record<Zoom, number> = { day: 28, week: 9, month: 3 }
export const ROW_H = 34
export const HEADER_H = 52

export interface Scale {
  origin: number // первый показанный день
  days: number
  px: number
  x: (day: number) => number
}

export function makeScale(activities: Activity[], zoom: Zoom, baselineDays: number[] = []): Scale {
  const days: number[] = []
  for (const a of activities) {
    if (a.start_date) days.push(dayOf(a.start_date))
    if (a.finish_date) days.push(dayOf(a.finish_date))
  }
  days.push(...baselineDays, todayDay())
  const min = Math.min(...days)
  const max = Math.max(...days)
  // с запасом: слева неделя, справа месяц; начало — с понедельника
  let origin = min - 7
  origin -= dowOf(origin) - 1
  const total = Math.max(max + 30 - origin, 60)
  const px = PX_PER_DAY[zoom]
  return { origin, days: total, px, x: (d) => (d - origin) * px }
}

export interface Bar {
  x1: number
  x2: number
  y: number
  mid: number
}

/** Положение полосы работы: x1 — левый край первого дня, x2 — правый край последнего. */
export function barOf(a: Activity, row: number, scale: Scale): Bar | null {
  if (!a.start_date || !a.finish_date) return null
  const s = dayOf(a.start_date)
  const f = dayOf(a.finish_date)
  const y = row * ROW_H
  if (a.kind === 'milestone') {
    const cx = scale.x(s) + scale.px / 2
    return { x1: cx, x2: cx, y, mid: y + ROW_H / 2 }
  }
  return { x1: scale.x(s), x2: scale.x(f + 1), y, mid: y + ROW_H / 2 }
}

/** Ломаная стрелки зависимости между полосами. */
export function linkPath(type: ScheduleLink['type'], p: Bar, s: Bar): string {
  const fromEnd = type === 'FS' || type === 'FF'
  const toStart = type === 'FS' || type === 'SS'
  const sx = fromEnd ? p.x2 : p.x1
  const ex = toStart ? s.x1 : s.x2
  const sy = p.mid
  const ey = s.mid
  const out = fromEnd ? 8 : -8
  const inn = toStart ? -8 : 8
  const x1 = sx + out
  const ax = ex + inn
  // прямой случай: стрелка идёт вправо, не заходя на другие полосы
  if (fromEnd && toStart && ax >= x1) return `M${sx},${sy} H${ax} V${ey} H${ex}`
  const midY = ey > sy ? sy + ROW_H / 2 : sy - ROW_H / 2
  return `M${sx},${sy} H${x1} V${midY} H${ax} V${ey} H${ex}`
}

export const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y.slice(2)}`
}
