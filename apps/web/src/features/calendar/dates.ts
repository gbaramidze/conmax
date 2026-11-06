import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { addDays, mondayOf } from '@/features/weekly/api'
import type { CalendarRange } from '@/features/calendar/types'

export { addDays, mondayOf }

export type CalendarView = 'month' | 'week' | 'day' | 'agenda'

/** Сегодня «YYYY-MM-DD» (локальная дата пользователя, как и в списке задач). */
export const todayIso = () => new Date().toLocaleDateString('sv')

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`

/** Сдвиг на n месяцев с сохранением числа, насколько позволяет месяц. */
export function addMonths(iso: string, n: number): string {
  const d = utc(iso)
  const day = d.getUTCDate()
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Сетка месяца: с понедельника первой недели до воскресенья последней. */
export function monthRange(anchor: string): CalendarRange {
  const first = firstOfMonth(anchor)
  const last = addDays(addMonths(first, 1), -1)
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) }
}

export const weekRange = (anchor: string): CalendarRange => ({ from: mondayOf(anchor), to: addDays(mondayOf(anchor), 6) })

export const inMonth = (iso: string, anchor: string) => iso.slice(0, 7) === anchor.slice(0, 7)

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat(currentLocale(), { ...opts, timeZone: 'UTC' })
  return (iso: string) => cap(f.format(utc(iso)))
}

export const monthTitle = fmt({ month: 'long', year: 'numeric' })
export const dayTitle = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
export const dayShort = fmt({ weekday: 'short', day: 'numeric' })
export const dayMonthShort = fmt({ day: 'numeric', month: 'short' })
export const dayMonthYear = fmt({ day: 'numeric', month: 'long', year: 'numeric' })

export const WEEKDAYS = [tr('Пн'), tr('Вт'), tr('Ср'), tr('Чт'), tr('Пт'), tr('Сб'), tr('Вс')] as const

/** Заголовок периода для текущего вида. */
export function periodTitle(view: CalendarView, anchor: string): string {
  if (view === 'month' || view === 'agenda') return monthTitle(anchor)
  if (view === 'day') return dayTitle(anchor)
  const { from, to } = weekRange(anchor)
  return `${dayMonthShort(from)} – ${dayMonthShort(to)} ${to.slice(0, 4)}`
}

/** Шаг навигации: месяц для «месяца» и «повестки», неделя, день. */
export function shiftAnchor(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === 'week') return addDays(anchor, 7 * dir)
  if (view === 'day') return addDays(anchor, dir)
  return addMonths(anchor, dir)
}
