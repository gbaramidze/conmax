import { currentLocale } from '@/lib/i18n'

/** Месяцы раскладки бюджета: ключ 'YYYY-MM'. */
export const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export const addMonths = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1))
  return ym(d.getUTCFullYear(), d.getUTCMonth() + 1)
}

export const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))

const now = new Date()
/** Текущий месяц по часам пользователя */
export const THIS_MONTH = ym(now.getFullYear(), now.getMonth() + 1)

const shortFmt = new Intl.DateTimeFormat(currentLocale(), { month: 'short', timeZone: 'UTC' })
const longFmt = new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
const asDate = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1))
export const monthShort = (m: string) => shortFmt.format(asDate(m)).replace('.', '')
export const monthLong = (m: string) => longFmt.format(asDate(m))

/** «Разложить»: поровну или колоколом — тот же расчёт, что в базе (spread_budget_forecast); копейки остатка в последний месяц. */
export function spreadParts(total: number, months: number, shape: 'equal' | 'scurve'): number[] {
  const w = Array.from({ length: months }, (_, i) => (shape === 'equal' ? 1 : Math.sin((Math.PI * (i + 0.5)) / months)))
  const sum = w.reduce((s, x) => s + x, 0)
  let given = 0
  return w.map((x, i) => {
    const part = i === months - 1 ? Math.round((total - given) * 100) / 100 : Math.round(((total * x) / sum) * 100) / 100
    given += part
    return part
  })
}
