/**
 * Разбор файла раскладки бюджета по месяцам (вида «Budget 2026 — Look Ahead 2027–2028»): дерево статей с кодами,
 * бюджет, факт до первого месяца (колонка «YTD-2025»), месяцы факта и прогноза. Модуль без зависимостей от интерфейса,
 * чтобы его можно было проверить на файле отдельно.
 *
 * Месяцы находятся в строке заголовков: дата (31.01.2026) — месяц; число-год (2027), за которым идут 1…12, — месяцы
 * этого года. Если месяц встречается дважды, первая колонка — факт, вторая — прогноз (так устроен лист: «2026 факт» и
 * «2026 прогноз»). Коды чинятся: число 2.1 после 2.9 — это 2.10; статьи раздела 9 с кодами 8.x получают 9.x.
 * Суммы группы в файле включают вложенные, поэтому загружается только «своя» часть: строка группы минус вложенные.
 */
export type Cell = string | number | boolean | Date | null | undefined

export interface MonthCol {
  month: string // 'YYYY-MM'
  fact: number | null
  forecast: number | null
  /** Колонка одна: факт или прогноз решает граница закрытых месяцев */
  single: number | null
}

export interface Layout {
  header: number
  codeCol: number
  nameCol: number
  altCol: number | null
  budgetCol: number
  preCol: number | null
  /** Месяц, на который ложится факт «до начала» (декабрь года из «YTD-2025») */
  preMonth: string | null
  months: MonthCol[]
}

export interface ParsedItem {
  row: number
  code: string
  sourceCode: string
  fixed: boolean
  name: string
  altName: string | null
  depth: number
  parentCode: string | null
  costType: 'contingency' | 'other'
  /** Значения строки как в файле (с вложенными): бюджет, факт до начала, по колонкам месяцев */
  total: { budget: number; pre: number; cols: Map<number, number> }
  /** Своя часть статьи (строка минус вложенные) */
  own: { budget: number; pre: number; cols: Map<number, number> }
}

export type Warning =
  | { kind: 'unallocated'; code: string; name: string; diff: number }
  | { kind: 'negative_own'; code: string; name: string }
  | { kind: 'duplicate_code'; code: string; name: string }

export interface Parsed {
  layout: Layout
  items: ParsedItem[]
  /** Последний месяц, где в колонках факта есть суммы */
  lastFactMonth: string | null
}

const GEORGIAN = /[Ⴀ-ჿ]/

const cellText = (c: Cell) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString() : String(c).trim())

export function cellNumber(c: Cell): number {
  if (typeof c === 'number') return Number.isFinite(c) ? c : 0
  if (typeof c !== 'string') return 0
  const s = c.replace(/[\s ]/g, '').replace(',', '.')
  const n = Number(s)
  return s && Number.isFinite(n) ? n : 0
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

function monthOf(c: Cell): string | null {
  if (c instanceof Date && !Number.isNaN(c.getTime())) return ym(c.getUTCFullYear(), c.getUTCMonth() + 1)
  if (typeof c === 'number' && c > 36000 && c < 73000 && Number.isInteger(c)) {
    // серийный номер даты Excel без формата
    const d = new Date(Date.UTC(1899, 11, 30) + c * 86400000)
    return ym(d.getUTCFullYear(), d.getUTCMonth() + 1)
  }
  if (typeof c === 'string') {
    const iso = c.match(/^(\d{4})-(\d{2})-\d{2}/)
    if (iso) return ym(Number(iso[1]), Number(iso[2]))
    const dm = c.match(/^\d{1,2}[./-](\d{1,2})[./-](\d{4})$/)
    if (dm) return ym(Number(dm[2]), Number(dm[1]))
  }
  return null
}

/** Ищет строку заголовков и колонки. null — лист не похож на раскладку бюджета. */
export function detectLayout(rows: Cell[][]): Layout | null {
  let best: Layout | null = null
  let bestScore = 0
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const r = rows[h] ?? []
    const texts = r.map((c) => cellText(c).toLowerCase())
    const codeCol = texts.findIndex((t) => /^(n|№|no\.?|nr|код|code|#)$/.test(t))
    const budgetCol = texts.findIndex((t) => /grand budget|^budget$|^бюджет|total budget/.test(t))
    if (codeCol < 0 || budgetCol < 0) continue
    // месяцы правее бюджета
    const seen = new Map<string, number[]>()
    let year: number | null = null
    for (let c = budgetCol + 1; c < r.length; c++) {
      const v = r[c]
      const m = monthOf(v)
      if (m) {
        seen.set(m, [...(seen.get(m) ?? []), c])
        year = null
        continue
      }
      if (typeof v === 'number' && Number.isInteger(v)) {
        if (v >= 2000 && v <= 2100) year = v
        else if (year !== null && v >= 1 && v <= 12) seen.set(ym(year, v), [...(seen.get(ym(year, v)) ?? []), c])
      }
    }
    if (seen.size < 3) continue
    const firstMonth = [...seen.keys()].sort()[0]
    const firstYear = Number(firstMonth.slice(0, 4))
    let preCol: number | null = null
    let preMonth: string | null = null
    texts.forEach((t, i) => {
      const m = t.match(/^ytd[- ]?(\d{4})$/)
      if (m && Number(m[1]) < firstYear && preCol === null) {
        preCol = i
        preMonth = ym(Number(m[1]), 12)
      }
    })
    const months: MonthCol[] = [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cols]) => (cols.length >= 2 ? { month, fact: cols[0], forecast: cols[1], single: null } : { month, fact: null, forecast: null, single: cols[0] }))
    // второе название: колонка сразу за названием, где много грузинского текста
    const sample = rows.slice(h + 1, h + 120)
    const georgian = (col: number) => sample.filter((x) => GEORGIAN.test(cellText(x?.[col]))).length
    const altCol = georgian(codeCol + 2) >= 5 ? codeCol + 2 : null
    const score = seen.size + 10
    if (score > bestScore) {
      bestScore = score
      best = { header: h, codeCol, nameCol: codeCol + 1, altCol, budgetCol, preCol, preMonth, months }
    }
  }
  return best
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Код из ячейки: текст, глубина, было ли это число (тогда 2.10 и 2.1 неотличимы). */
function readCode(c: Cell): { text: string; depth: number; numeric: boolean } | null {
  if (typeof c === 'number') {
    if (!Number.isFinite(c)) return null
    if (Number.isInteger(c)) return { text: String(c), depth: 1, numeric: true }
    return { text: String(round2(c)), depth: 2, numeric: true }
  }
  const s = cellText(c).replace(/\.+$/, '')
  if (!s || s.length > 40) return null
  return { text: s, depth: s.split('.').length, numeric: false }
}

export function parseLookahead(rows: Cell[][], layout: Layout): Parsed {
  const items: ParsedItem[] = []
  const used = new Set<string>()
  // стек по глубине: исправленный код, код из файла, последний номер вложенной
  const stack: { code: string; src: string; last: number }[] = []
  const colsOf = (r: Cell[]) => {
    const m = new Map<number, number>()
    for (const mc of layout.months) for (const c of [mc.fact, mc.forecast, mc.single]) if (c !== null) m.set(c, cellNumber(r[c]))
    return m
  }

  for (let i = layout.header + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const raw = readCode(r[layout.codeCol])
    const name = cellText(r[layout.nameCol])
    if (!raw || !name) continue
    let depth = Math.min(raw.depth, stack.length + 1)
    let code = raw.text
    let parentCode: string | null = null
    if (depth === 1) {
      stack.length = 0
    } else {
      const parent = stack[depth - 2]
      if (!parent) depth = 1
      else {
        parentCode = parent.code
        if (raw.numeric) code = `${parent.code}.${parent.last + 1}`
        else {
          const parts = raw.text.split('.')
          const prefix = parts.slice(0, -1).join('.')
          if (prefix !== parent.code) code = `${parent.code}.${parts[parts.length - 1]}`
        }
        if (used.has(code.toLowerCase())) code = `${parent.code}.${parent.last + 1}`
        const last = Number(code.split('.').pop())
        parent.last = Number.isFinite(last) ? Math.max(parent.last, last) : parent.last + 1
        stack.length = depth - 1
      }
    }
    if (depth === 1) stack.length = 0
    stack[depth - 1] = { code, src: raw.text, last: 0 }
    used.add(code.toLowerCase())
    const alt = layout.altCol === null ? '' : cellText(r[layout.altCol])
    const total = { budget: cellNumber(r[layout.budgetCol]), pre: layout.preCol === null ? 0 : cellNumber(r[layout.preCol]), cols: colsOf(r) }
    items.push({
      row: i + 1,
      code,
      sourceCode: raw.text,
      fixed: code !== raw.text,
      name,
      altName: alt && GEORGIAN.test(alt) ? alt : null,
      depth,
      parentCode,
      costType: /contingency|резерв|непредвид/i.test(name) ? 'contingency' : 'other',
      total,
      own: { budget: total.budget, pre: total.pre, cols: new Map(total.cols) },
    })
  }

  // Своя часть группы = строка минус вложенные. Строка-заголовок с нулём (как «3.1 GuestRoom Floors», когда раздел
  // складывает статьи напрямую) своей суммы не имеет, а её итог — сумма вложенных. Считаем снизу вверх.
  const kids = new Map<string, ParsedItem[]>()
  for (const it of items) if (it.parentCode) kids.set(it.parentCode, [...(kids.get(it.parentCode) ?? []), it])
  const eff = new Map<ParsedItem, { budget: number; pre: number; cols: Map<number, number> }>()
  const split = (row: number, kidsSum: number): [own: number, effective: number] => {
    if (Math.abs(row - kidsSum) < 0.5) return [0, row]
    if (Math.abs(row) < 0.005) return [0, kidsSum]
    return [round2(row - kidsSum), row]
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const list = kids.get(it.code) ?? []
    if (list.length === 0) {
      eff.set(it, it.total)
      continue
    }
    const sum = (f: (x: { budget: number; pre: number; cols: Map<number, number> }) => number) => list.reduce((s, k) => s + f(eff.get(k)!), 0)
    const [ob, eb] = split(it.total.budget, sum((x) => x.budget))
    const [op, ep] = split(it.total.pre, sum((x) => x.pre))
    const ownCols = new Map<number, number>()
    const effCols = new Map<number, number>()
    for (const [c, v] of it.total.cols) {
      const [o, e] = split(v, sum((x) => x.cols.get(c) ?? 0))
      ownCols.set(c, o)
      effCols.set(c, e)
    }
    it.own = { budget: ob, pre: op, cols: ownCols }
    eff.set(it, { budget: eb, pre: ep, cols: effCols })
  }
  for (const it of items) it.total = eff.get(it)!

  let lastFactMonth: string | null = null
  for (const mc of layout.months) {
    if (mc.fact === null) continue
    if (items.some((it) => Math.abs(it.own.cols.get(mc.fact!) ?? 0) >= 0.5)) lastFactMonth = mc.month
  }
  return { layout, items, lastFactMonth }
}

/** Значение месяца статьи с учётом границы закрытых месяцев: факт для закрытых, прогноз для открытых. */
function monthValue(cols: Map<number, number>, mc: MonthCol, closed: string | null): { fact: number; forecast: number } {
  const isClosed = closed !== null && mc.month <= closed
  const get = (c: number | null) => (c === null ? 0 : (cols.get(c) ?? 0))
  if (mc.single !== null) return isClosed ? { fact: get(mc.single), forecast: 0 } : { fact: 0, forecast: get(mc.single) }
  return isClosed ? { fact: get(mc.fact), forecast: 0 } : { fact: 0, forecast: get(mc.forecast) }
}

export interface LookaheadPayload {
  items: { code: string; name: string; amount: number; cost_type: string; alt_name: string | null; source_code: string | null }[]
  actuals: { item_code: string; month: string; amount: number }[]
  forecast: { item_code: string; month: string; amount: number }[]
  closed_through: string | null
  replace_actuals: boolean
}

export interface LookaheadSummary {
  budget: number
  fact: number
  forecast: number
  /** Бюджет − факт − прогноз по всему файлу */
  unallocated: number
  fixedCodes: ParsedItem[]
  warnings: Warning[]
  firstForecastMonth: string | null
  lastForecastMonth: string | null
}

/**
 * Готовит данные для import_budget_lookahead и сводку для предпросмотра. closed — 'YYYY-MM' последнего закрытого месяца;
 * factor — пересчёт сумм файла в основную валюту проекта (например, доллары × 2,7 = лари), суммы округляются до копеек.
 */
export function buildPayload(p: Parsed, closed: string | null, factor = 1): { payload: LookaheadPayload; summary: LookaheadSummary } {
  const fx = (n: number) => round2(n * factor)
  const payload: LookaheadPayload = { items: [], actuals: [], forecast: [], closed_through: closed ? `${closed}-01` : null, replace_actuals: true }
  const warnings: Warning[] = []
  let budget = 0
  let fact = 0
  let forecast = 0
  let first: string | null = null
  let last: string | null = null
  const seenCodes = new Set<string>()
  for (const it of p.items) {
    if (seenCodes.has(it.code.toLowerCase())) warnings.push({ kind: 'duplicate_code', code: it.code, name: it.name })
    seenCodes.add(it.code.toLowerCase())
    if (it.own.budget < -0.5) warnings.push({ kind: 'negative_own', code: it.code, name: it.name })
    const amount = fx(Math.max(it.own.budget, 0))
    payload.items.push({
      code: it.code,
      name: it.name,
      amount,
      cost_type: it.costType,
      alt_name: it.altName,
      source_code: it.fixed ? it.sourceCode : null,
    })
    budget += amount
    if (Math.abs(fx(it.own.pre)) >= 0.01 && p.layout.preMonth) {
      payload.actuals.push({ item_code: it.code, month: `${p.layout.preMonth}-01`, amount: fx(it.own.pre) })
      fact += fx(it.own.pre)
    }
    for (const mc of p.layout.months) {
      const v = monthValue(it.own.cols, mc, closed)
      const vf = fx(v.fact)
      const vp = fx(v.forecast)
      if (Math.abs(vf) >= 0.01) {
        payload.actuals.push({ item_code: it.code, month: `${mc.month}-01`, amount: vf })
        fact += vf
      }
      if (vp >= 0.01) {
        payload.forecast.push({ item_code: it.code, month: `${mc.month}-01`, amount: vp })
        forecast += vp
        if (!first || mc.month < first) first = mc.month
        if (!last || mc.month > last) last = mc.month
      }
    }
  }
  // «не распределено» по строкам файла (с вложенными): показываем самые глубокие статьи, где сумма месяцев не сходится
  const diffOf = (it: ParsedItem) => {
    let s = it.total.pre
    for (const mc of p.layout.months) {
      const v = monthValue(it.total.cols, mc, closed)
      s += v.fact + v.forecast
    }
    return round2(it.total.budget - s)
  }
  const kidsOf = new Map<string, ParsedItem[]>()
  for (const it of p.items) if (it.parentCode) kidsOf.set(it.parentCode, [...(kidsOf.get(it.parentCode) ?? []), it])
  for (const it of p.items) {
    const d = diffOf(it)
    if (Math.abs(d) < 1) continue
    const kids = kidsOf.get(it.code) ?? []
    const kidsDiff = kids.reduce((s, k) => s + diffOf(k), 0)
    if (Math.abs(d - kidsDiff) >= 1) warnings.push({ kind: 'unallocated', code: it.code, name: it.name, diff: fx(d - kidsDiff) })
  }
  return {
    payload,
    summary: {
      budget: round2(budget),
      fact: round2(fact),
      forecast: round2(forecast),
      unallocated: round2(budget - fact - forecast),
      fixedCodes: p.items.filter((it) => it.fixed),
      warnings,
      firstForecastMonth: first,
      lastForecastMonth: last,
    },
  }
}
