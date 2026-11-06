import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import type { Cell } from '@/features/documents/compare/table-diff'

const number = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 })
const date = new Intl.DateTimeFormat(currentLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })

export const fmtNumber = (n: number) => number.format(n)

/** «+1 250» / «−20»; ноль без знака. */
export const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + number.format(Math.abs(n))

/** «+5,9 %»; null (было 0 или пусто) → «—». */
export const fmtPercent = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${percent.format(Math.abs(p))} %`)

export function fmtCell(v: Cell): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return number.format(v)
  if (v instanceof Date) return date.format(v)
  if (typeof v === 'boolean') return v ? tr('да') : tr('нет')
  return String(v)
}

/** Рост — красным (цена или объём выросли), снижение — зелёным; ещё и стрелка, чтобы не зависеть от цвета. */
export const TREND = {
  up: { arrow: '▲', cls: 'text-red-700 dark:text-red-300', excel: '#b91c1c' },
  down: { arrow: '▼', cls: 'text-green-700 dark:text-green-300', excel: '#15803d' },
  flat: { arrow: '', cls: 'text-muted-foreground', excel: '#6b7280' },
} as const

export const trend = (delta: number | null) => (delta === null || delta === 0 ? TREND.flat : delta > 0 ? TREND.up : TREND.down)
