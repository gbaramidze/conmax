import { displaySymbol, toDisplay } from '@/features/projects/display-currency'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { phasing, type BudgetActual, type BudgetForecast, type BudgetModel, type CbsItem } from './api'
import { addMonths, THIS_MONTH } from './months'

/** Цифры статьи в раскладке (с вложенными). */
export interface RowInfo {
  /** Факт закрытых месяцев — «выполнено» */
  fact: number
  /** План (прогноз) открытых месяцев */
  plan: number
  /** Бюджет − факт − план: 0 — сходится, больше 0 — не разложено, меньше 0 — расписано лишнее */
  un: number
  /** Месяц → сумма: факт для закрытых, план для открытых */
  months: Map<string, number>
  /** Акты, уже внесённые в ещё открытые месяцы */
  pending: Map<string, number>
}

export interface LookaheadData {
  closed: string | null
  isClosed: (m: string) => boolean
  info: Map<string, RowInfo>
  grand: RowInfo
  /** Все месяцы, где есть суммы, по порядку */
  allMonths: string[]
  /** Первый открытый месяц */
  firstOpen: string
  /** Прошедшие, но не закрытые месяцы */
  unclosed: string[]
}

export function buildLookahead(items: CbsItem[], model: BudgetModel, forecast: BudgetForecast[], actuals: BudgetActual[], closedThrough: string | null): LookaheadData {
  const ph = phasing(forecast, actuals, closedThrough)
  const own = new Map<string, Map<string, number>>()
  const pendingOwn = new Map<string, Map<string, number>>()
  const add = (map: Map<string, Map<string, number>>, item: string, m: string, v: number) => {
    const row = map.get(item) ?? new Map<string, number>()
    row.set(m, (row.get(m) ?? 0) + v)
    map.set(item, row)
  }
  for (const [item, row] of ph.fact) for (const [m, v] of row) add(ph.isClosed(m) ? own : pendingOwn, item, m, v)
  for (const [item, row] of ph.plan) for (const [m, v] of row) if (!ph.isClosed(m)) add(own, item, m, v)

  const kids = new Map<string | null, string[]>()
  for (const it of items) kids.set(it.parent_id, [...(kids.get(it.parent_id) ?? []), it.id])
  const bac = new Map(model.rows.map((r) => [r.id, r.bac]))
  const info = new Map<string, RowInfo>()
  const merge = (into: Map<string, number>, from: Map<string, number>) => {
    for (const [m, v] of from) into.set(m, (into.get(m) ?? 0) + v)
  }
  const roll = (id: string): RowInfo => {
    const months = new Map(own.get(id) ?? [])
    const pending = new Map(pendingOwn.get(id) ?? [])
    for (const k of kids.get(id) ?? []) {
      const ki = roll(k)
      merge(months, ki.months)
      merge(pending, ki.pending)
    }
    let fact = 0
    let plan = 0
    for (const [m, v] of months) if (ph.isClosed(m)) fact += v
    else plan += v
    const r: RowInfo = { fact, plan, un: (bac.get(id) ?? 0) - fact - plan, months, pending }
    info.set(id, r)
    return r
  }
  const grand: RowInfo = { fact: 0, plan: 0, un: 0, months: new Map(), pending: new Map() }
  for (const root of kids.get(null) ?? []) {
    const r = roll(root)
    grand.fact += r.fact
    grand.plan += r.plan
    merge(grand.months, r.months)
    merge(grand.pending, r.pending)
  }
  grand.un = model.total.bac - grand.fact - grand.plan

  const allMonths = [...grand.months.keys()].filter((m) => Math.abs(grand.months.get(m) ?? 0) >= 0.5).sort()
  const firstOpen = ph.closed ? addMonths(ph.closed, 1) : THIS_MONTH
  const unclosed: string[] = []
  if (ph.closed) for (let m = firstOpen; m < THIS_MONTH; m = addMonths(m, 1)) unclosed.push(m)
  return { closed: ph.closed, isClosed: ph.isClosed, info, grand, allMonths, firstOpen, unclosed }
}

/**
 * Короткая сумма в валюте показа: «$1,75 млн», «226,8 млн ₾», «85,1 тыс ₾», «514 тыс ₾». Точность — три-четыре значащие
 * цифры: миллионы до сотни — два знака после запятой, от сотни — один; тысячи до сотни — один знак, от сотни — без знаков.
 * Сокращения — через словари (те же ключи, что на экране EVM): встроенный в браузер `notation: 'compact'` для
 * грузинского не знает сокращений и подставляет русское «млн».
 */
export function money(n: number): string {
  const sym = displaySymbol()
  const v = toDisplay(n)
  const a = Math.abs(v)
  const num = (x: number, digits: number) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: digits }).format(x)
  const big = (x: number) => num(x, x >= 100 ? 1 : 2)
  const body =
    a >= 1e9
      ? tr('{{v1}} млрд', { v1: big(a / 1e9) })
      : a >= 1e6
        ? tr('{{v1}} млн', { v1: big(a / 1e6) })
        : a >= 1e3
          ? tr('{{v1}} тыс', { v1: num(a / 1e3, a >= 1e5 ? 0 : 1) })
          : num(Math.round(a), 0)
  const sign = v < 0 && a >= 0.5 ? '−' : ''
  return sym === '$' ? `${sign}$${body}` : `${sign}${body} ${sym}`
}

/** Полная сумма в валюте показа, до единицы: «19 545 141 ₾», «$7 238 941» — для подсказки при наведении. */
export function fullMoney(n: number): string {
  const sym = displaySymbol()
  const v = toDisplay(n)
  const body = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(Math.abs(Math.round(v)))
  const sign = v <= -0.5 ? '−' : ''
  return sym === '$' ? `${sign}$${body}` : `${sign}${body} ${sym}`
}

/**
 * Одна и та же фраза с короткими суммами (на экран) и полными (в подсказку): build получает форматтер сумм.
 * Пример: `both((m) => tr('Выполнено {{s}}', { s: m(x) }))` → { text: 'Выполнено 15,6 млн ₾', title: 'Выполнено 15 605 265 ₾' }.
 */
export function both(build: (m: (n: number) => string) => string): { text: string; title: string } {
  return { text: build(money), title: build(fullMoney) }
}

/** Название статьи: на грузинском интерфейсе — грузинское из файла, если есть. */
export function itemLabel(row: { name: string }, item: CbsItem | undefined): { main: string; sub: string | null } {
  const alt = item?.alt_name ?? null
  if (alt && document.documentElement.lang === 'ka') return { main: alt, sub: row.name }
  return { main: row.name, sub: alt }
}

/** Месяцы графика: с января текущего года (или раньше, если открытые месяцы раньше) до последнего месяца с суммой. */
export function chartRange(data: LookaheadData): string[] {
  if (data.allMonths.length === 0) return []
  const start = [`${THIS_MONTH.slice(0, 4)}-01`, data.firstOpen].sort()[0]
  const end = [data.allMonths[data.allMonths.length - 1], addMonths(start, 11)].sort()[1]
  const out: string[] = []
  for (let m = start; m <= end; m = addMonths(m, 1)) out.push(m)
  return out
}

/**
 * «Сходится с бюджетом»: расхождение меньше 10 единиц валюты не считается ошибкой — это копейки округления
 * (в самом файле V7 у статьи 8.6 CHECK = −0,41 $) и пересчёта валюты.
 */
export const isBalanced = (un: number) => Math.abs(un) < 10

/** Кусок круговой диаграммы */
export interface Slice {
  label: string
  value: number
  color: string
}

/** Цвета кусков: различимы между собой и в светлой, и в тёмной теме; последний — «Прочее». */
export const SLICE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#65a30d']
export const OTHER_COLOR = '#94a3b8'

/** Самые крупные куски по убыванию; остальное — «Прочее». */
export function topSlices(list: { label: string; value: number }[], max = 7): Slice[] {
  const sorted = list.filter((x) => x.value > 0.5).sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, max).map((x, i) => ({ ...x, color: SLICE_COLORS[i % SLICE_COLORS.length] }))
  const rest = sorted.slice(max).reduce((s, x) => s + x.value, 0)
  return rest > 0.5 ? [...head, { label: tr('Прочее'), value: rest, color: OTHER_COLOR }] : head
}

/** Разделы верхнего уровня как куски: название (грузинское на грузинском интерфейсе) и значение. */
export function sectionSlices(rows: { id: string; depth: number; code: string; name: string }[], byId: Map<string, CbsItem>, value: (id: string) => number, max = 7): Slice[] {
  return topSlices(
    rows.filter((r) => r.depth === 0).map((r) => ({ label: `${r.code} ${itemLabel(r, byId.get(r.id)).main}`, value: value(r.id) })),
    max,
  )
}

/** Процент a от b, целый */
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
