import type { InspectionRow, InspectionSchedule, ItemStatus, TaskStats } from '@/features/inspections/api'
import type { LocationRow } from '@/features/locations/api'
import { addDays, mondayOf } from '@/features/weekly/api'

/** Состояние места по последней выданной инспекции: A / C / R; draft — есть только черновик; none — не проверялось. */
export type PlaceState = ItemStatus | 'draft' | 'none'

export interface PlaceInfo {
  id: string
  path: string
  state: PlaceState
  /** дата последней выданной инспекции */
  lastDate: string | null
  /** сколько дней прошло с неё (на сегодня) */
  daysAgo: number | null
  /** сколько отчётов по месту (без удалённых) */
  reports: number
  /** период расписания места, если оно включено */
  scheduleDays: number | null
}

/** Без расписания место считается «давно не проверялось» после этого числа дней. */
export const STALE_DAYS = 30
/** Черновик старше этого числа дней просит внимания. */
export const DRAFT_DAYS = 3

const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Сколько целых дней от a до b (b позже — положительное). */
export const daysBetweenIso = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86_400_000)

const byNewest = (a: InspectionRow, b: InspectionRow) => b.inspection_date.localeCompare(a.inspection_date) || b.number - a.number

/**
 * Места для охвата: помещения; если помещений в дереве нет — листья дерева. Места, по которым уже есть отчёты, входят всегда,
 * даже если это этаж или зона, поэтому ни один отчёт не выпадает из сводки.
 */
export function computePlaces(locations: LocationRow[], reports: InspectionRow[], schedules: InspectionSchedule[], today: string): PlaceInfo[] {
  const parents = new Set(locations.map((l) => l.parent_id))
  const rooms = locations.filter((l) => l.kind === 'room')
  const base = rooms.length > 0 ? rooms : locations.filter((l) => !parents.has(l.id))

  const byPlace = new Map<string, InspectionRow[]>()
  for (const r of reports) if (r.location_id) byPlace.set(r.location_id, [...(byPlace.get(r.location_id) ?? []), r])

  const ids = new Set(base.map((l) => l.id))
  const universe = [...base, ...locations.filter((l) => byPlace.has(l.id) && !ids.has(l.id))]
  const days = new Map(schedules.filter((s) => s.active).map((s) => [s.location_id, s.period_days]))

  return universe.map((l) => {
    const list = (byPlace.get(l.id) ?? []).sort(byNewest)
    const issued = list.find((r) => r.status === 'issued')
    const state: PlaceState = issued ? (issued.result ?? 'A') : list.length > 0 ? 'draft' : 'none'
    return {
      id: l.id,
      path: l.path,
      state,
      lastDate: issued?.inspection_date ?? null,
      daysAgo: issued ? Math.max(0, daysBetweenIso(issued.inspection_date, today)) : null,
      reports: list.length,
      scheduleDays: days.get(l.id) ?? null,
    }
  })
}

/** Место давно не проверялось: последняя выданная инспекция старше периода расписания (или STALE_DAYS без расписания). */
export const isStale = (p: PlaceInfo): boolean => p.daysAgo !== null && p.daysAgo > (p.scheduleDays ?? STALE_DAYS)

export interface WeekBar {
  start: string
  a: number
  c: number
  r: number
  draft: number
}

export interface ContractorRow {
  key: string
  name: string | null
  reports: number
  a: number
  c: number
  r: number
  /** замечаний C и R, не подтверждённых как устранённые */
  open: number
  lastDate: string | null
}

export interface Overview {
  reports: { total: number; issued: number; drafts: number; a: number; c: number; r: number }
  items: { a: number; c: number; r: number; open: number }
  remarks: { total: number; withTask: number; active: number; review: number; done: number; resolved: number; overdue: number; readyReports: number }
  places: { total: number; a: number; c: number; r: number; draft: number; none: number; stale: number }
  last: { date: string; daysAgo: number; id: string; key: string } | null
  weeks: WeekBar[]
  contractors: ContractorRow[]
  stale: PlaceInfo[]
  untouched: PlaceInfo[]
  /** места, где последняя выданная инспекция — «не принято» */
  rejected: PlaceInfo[]
  oldDrafts: InspectionRow[]
  readyReports: InspectionRow[]
  overdueSchedules: InspectionSchedule[]
}

export const WEEKS = 12

/** Период «с даты по дату», включительно; пустая граница — без ограничения. */
export interface DateRange {
  from: string | null
  to: string | null
}

/** Последние `days` дней, включая сегодня (пусто — всё время). */
export function lastDays(today: string, days: number | null): DateRange {
  return { from: days === null ? null : addDays(today, -(days - 1)), to: null }
}

/** Отчёты, у которых дата инспекции попадает в период. */
export function inRange<T extends { inspection_date: string }>(rows: T[], range: DateRange): T[] {
  return rows.filter((r) => (!range.from || r.inspection_date >= range.from) && (!range.to || r.inspection_date <= range.to))
}

/**
 * Сводка для обзора. Отчётные цифры (выдано, итоги, замечания, подрядчики) берутся за период; охват мест всегда на сегодня:
 * место проверено, если по нему есть выданный отчёт, и состояние места — по самому свежему.
 */
export function computeOverview(
  reports: InspectionRow[],
  places: PlaceInfo[],
  stats: Map<string, TaskStats> | undefined,
  schedules: InspectionSchedule[],
  today: string,
  range: DateRange,
): Overview {
  const inPeriod = inRange(reports, range)
  const issued = inPeriod.filter((r) => r.status === 'issued')

  const items = { a: 0, c: 0, r: 0, open: 0 }
  for (const r of inPeriod) {
    items.a += r.cnt_a
    items.c += r.cnt_c
    items.r += r.cnt_r
    items.open += r.cnt_open
  }

  const remarks = { total: 0, withTask: 0, active: 0, review: 0, done: 0, resolved: 0, overdue: 0, readyReports: 0 }
  const readyReports: InspectionRow[] = []
  for (const r of inPeriod) {
    const s = stats?.get(r.id)
    if (!s) continue
    remarks.total += s.remarks
    remarks.withTask += s.with_task
    remarks.active += s.active
    remarks.review += s.review
    remarks.done += s.done
    remarks.resolved += s.resolved
    remarks.overdue += s.overdue
    if (s.ready) {
      remarks.readyReports += 1
      readyReports.push(r)
    }
  }

  const newest = reports.filter((r) => r.status === 'issued').sort(byNewest)[0]

  // динамика: последние WEEKS недель, по дате инспекции
  const lastMonday = mondayOf(today)
  const weeks: WeekBar[] = Array.from({ length: WEEKS }, (_, i) => ({ start: addDays(lastMonday, -7 * (WEEKS - 1 - i)), a: 0, c: 0, r: 0, draft: 0 }))
  for (const r of reports) {
    const bar = weeks.find((w) => r.inspection_date >= w.start && r.inspection_date <= addDays(w.start, 6))
    if (!bar) continue
    if (r.status === 'draft') bar.draft += 1
    else if (r.result === 'R') bar.r += 1
    else if (r.result === 'C') bar.c += 1
    else bar.a += 1
  }

  const groups = new Map<string, ContractorRow>()
  for (const r of inPeriod) {
    const key = r.contractor_org_id ?? ''
    const g = groups.get(key) ?? { key, name: r.contractor?.name ?? null, reports: 0, a: 0, c: 0, r: 0, open: 0, lastDate: null }
    g.reports += 1
    if (r.status === 'issued') {
      if (r.result === 'R') g.r += 1
      else if (r.result === 'C') g.c += 1
      else g.a += 1
      if (!g.lastDate || r.inspection_date > g.lastDate) g.lastDate = r.inspection_date
    }
    const s = stats?.get(r.id)
    if (s) g.open += Math.max(0, s.remarks - s.resolved)
    groups.set(key, g)
  }

  const count = (state: PlaceState) => places.filter((p) => p.state === state).length
  const stale = places.filter(isStale).sort((a, b) => (b.daysAgo ?? 0) - (a.daysAgo ?? 0))

  return {
    reports: {
      total: inPeriod.length,
      issued: issued.length,
      drafts: inPeriod.length - issued.length,
      a: issued.filter((r) => r.result === 'A' || !r.result).length,
      c: issued.filter((r) => r.result === 'C').length,
      r: issued.filter((r) => r.result === 'R').length,
    },
    items,
    remarks,
    places: { total: places.length, a: count('A'), c: count('C'), r: count('R'), draft: count('draft'), none: count('none'), stale: stale.length },
    last: newest ? { date: newest.inspection_date, daysAgo: Math.max(0, daysBetweenIso(newest.inspection_date, today)), id: newest.id, key: newest.key } : null,
    weeks,
    contractors: [...groups.values()].sort((a, b) => b.reports - a.reports),
    stale,
    untouched: places.filter((p) => p.state === 'none'),
    rejected: places.filter((p) => p.state === 'R').sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0)),
    oldDrafts: reports.filter((r) => r.status === 'draft' && daysBetweenIso(r.inspection_date, today) > DRAFT_DAYS).sort(byNewest),
    readyReports,
    overdueSchedules: schedules.filter((s) => s.active && s.next_due < today).sort((a, b) => a.next_due.localeCompare(b.next_due)),
  }
}

/** Ближайшие даты расписания в пределах [from, to] (первая — next_due, дальше с шагом периода). Для календаря и «ближайших». */
export function occurrences(s: Pick<InspectionSchedule, 'next_due' | 'period_days'>, from: string, to: string): string[] {
  const out: string[] = []
  let d = s.next_due
  for (let i = 0; i < 800 && d <= to; i += 1) {
    if (d >= from) out.push(d)
    d = addDays(d, s.period_days)
  }
  return out
}
