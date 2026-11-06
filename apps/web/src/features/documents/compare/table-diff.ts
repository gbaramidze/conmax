import { tr } from '@/lib/tr'
// Сверка двух таблиц (листов Excel): строки сопоставляются по ключу, по числовым колонкам считается разница и итоги.
// Чистая логика без обращений к сети и React — проверяется отдельно от экрана.

export type Cell = string | number | boolean | Date | null | undefined

/** Лист как прочитан из файла: ячейки по строкам, без разбора шапки. */
export interface RawSheet {
  name: string
  rows: Cell[][]
}

export interface TableRow {
  /** Номер строки в исходном листе (с 1), как в Excel */
  n: number
  cells: Cell[]
}

export interface ParsedTable {
  /** Названия колонок как в файле (повторы получают « (2)») */
  headers: string[]
  /** Те же названия в нормализованном виде — по ним колонки двух таблиц сопоставляются */
  norms: string[]
  rows: TableRow[]
  /** Номер строки шапки (с 1) */
  headerRow: number
}

export type RowStatus = 'added' | 'removed' | 'changed' | 'same'

export interface DiffColumn {
  name: string
  norm: string
  numeric: boolean
  isKey: boolean
  /** Хотя бы в одной строке значение этой колонки изменилось */
  hasChanges: boolean
  /** Порядковый номер («№», «п/п»): сдвигается при вставке строк, поэтому не сверяется */
  isNumbering: boolean
}

export interface CellChange {
  /** Индекс в DiffTable.columns */
  col: number
  before: Cell
  after: Cell
  numeric: boolean
  /** Для чисел: после − до (пустая ячейка считается нулём) */
  delta: number | null
  /** Для чисел: изменение в процентах к «было»; null, если «было» пусто или 0 */
  pct: number | null
}

export interface DiffRow {
  status: RowStatus
  /** Ключ для показа: значения ключевых колонок через « · » */
  key: string
  rowA: number | null
  rowB: number | null
  /** Значения по общим колонкам (индексы DiffTable.columns); у добавленных a нет, у удалённых нет b */
  a: Cell[] | null
  b: Cell[] | null
  changes: CellChange[]
  /** Строка «Итого» из самого файла: в суммы не входит, но в различиях показывается */
  isTotal: boolean
}

const AVERAGED = /цен|тариф|ставк|курс|price|rate|процент|%|коэф|скидк|наценк/

export interface ColumnTotal {
  col: number
  name: string
  /** Нормализованное название — по нему колонки разных листов складываются в итоги книги */
  norm: string
  /** Сколько заполненных значений было в «было» и «стало» (для среднего по книге) */
  nBefore: number
  nAfter: number
  /** sum — сумма колонки; avg — среднее (для цен, ставок и процентов, где сумма ничего не значит) */
  mode: 'sum' | 'avg'
  before: number
  after: number
  delta: number
  pct: number | null
  /** Из чего сложилась разница: новые строки, удалённые строки, изменённые значения */
  fromAdded: number
  fromRemoved: number
  fromChanged: number
  /** Сколько значений выросло и сколько снизилось среди изменённых строк */
  up: number
  down: number
}

export interface TableDiff {
  columns: DiffColumn[]
  rows: DiffRow[]
  counts: Record<RowStatus, number>
  totals: ColumnTotal[]
  /** Колонки, которые есть только в одном из файлов (в сверку не входят) */
  onlyA: string[]
  onlyB: string[]
  /** Сколько строк делили ключ с другими (сопоставлены по порядку) */
  duplicateKeys: number
  keyNorms: string[]
}

// ---------------------------------------------------------------------------
// Разбор значений
// ---------------------------------------------------------------------------

const isEmpty = (v: Cell) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

export function normText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).toLowerCase().replace(/ё/g, 'е').replace(/[\s ]+/g, ' ').trim()
}

/** «1 234,50», «12.5», «−3», «1 200 ₾», «15%» → число; не число → null. Коды с ведущими нулями («001») числами не считаются. */
export function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.replace(/[\s ]/g, '').replace(/[₾₽$€]|руб\.?|р\.$|%$/gi, '').replace(/[−–]/g, '-')
  if (!/^[-+]?\d[\d.,]*$/.test(s)) return null
  if (/^[-+]?0\d/.test(s)) return null // код вроде «001»
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','
    s = s.split(dec === '.' ? ',' : '.').join('')
    if (dec === ',') s = s.replace(',', '.')
  } else if (lastComma >= 0) {
    s = (s.match(/,/g)?.length ?? 0) > 1 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if ((s.match(/\./g)?.length ?? 0) > 1) {
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const sameNumber = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))

const cellText = (v: Cell) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/[\s ]+/g, ' ').trim())

// ---------------------------------------------------------------------------
// Шапка и колонки
// ---------------------------------------------------------------------------

/** Первая строка, похожая на шапку: несколько заполненных текстовых ячеек. Номер с 0. */
export function detectHeaderRow(rows: Cell[][]): number {
  const head = rows.slice(0, 30)
  const filled = head.map((r) => r.filter((c) => !isEmpty(c)).length)
  const widest = Math.max(0, ...filled)
  for (let i = 0; i < head.length; i++) {
    const cells = head[i].filter((c) => !isEmpty(c))
    if (cells.length < Math.min(2, widest) || cells.length < widest * 0.6) continue
    const text = cells.filter((c) => typeof c === 'string' && toNumber(c) === null).length
    if (text / cells.length >= 0.8) return i
  }
  return 0
}

const colLetter = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Лист → таблица с шапкой в строке headerIdx (с 0); пустые строки отбрасываются. */
export function parseTable(rows: Cell[][], headerIdx: number): ParsedTable {
  const head = rows[headerIdx] ?? []
  const width = Math.max(head.length, ...rows.slice(headerIdx + 1).map((r) => r.length), 0)
  const seen = new Map<string, number>()
  const headers: string[] = []
  const norms: string[] = []
  for (let c = 0; c < width; c++) {
    const raw = cellText(head[c]) || tr('Колонка {{v1}}', { v1: colLetter(c) })
    let norm = normText(raw)
    const times = (seen.get(norm) ?? 0) + 1
    seen.set(norm, times)
    if (times > 1) norm = `${norm} (${times})`
    headers.push(times > 1 ? `${raw} (${times})` : raw)
    norms.push(norm)
  }
  const body: TableRow[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i]
    if (cells.every(isEmpty)) continue
    body.push({ n: i + 1, cells: Array.from({ length: width }, (_, c) => cells[c] ?? null) })
  }
  return { headers, norms, rows: body, headerRow: headerIdx + 1 }
}

/** Колонки, которые есть в обеих таблицах (по названию), в порядке первой. */
export function commonColumns(a: ParsedTable, b: ParsedTable) {
  const bIdx = new Map(b.norms.map((n, i) => [n, i]))
  const cols: { name: string; norm: string; a: number; b: number }[] = []
  a.norms.forEach((norm, i) => {
    const j = bIdx.get(norm)
    if (j !== undefined) cols.push({ name: a.headers[i], norm, a: i, b: j })
  })
  const inCommon = new Set(cols.map((c) => c.norm))
  return {
    cols,
    onlyA: a.headers.filter((_, i) => !inCommon.has(a.norms[i])),
    onlyB: b.headers.filter((_, i) => !inCommon.has(b.norms[i])),
  }
}

const TOTAL_RE = /^(итого|всего|итог|total|sum)(?![\p{L}\p{N}])/iu

export function rowIsTotal(cells: Cell[]): boolean {
  const first = cells.find((c) => !isEmpty(c))
  return typeof first === 'string' && TOTAL_RE.test(first.trim())
}

/** Колонка числовая, если не менее 70% непустых ячеек (в обеих таблицах вместе) — числа. */
function numericColumns(a: ParsedTable, b: ParsedTable, cols: { a: number; b: number }[]): boolean[] {
  return cols.map((c) => {
    let filled = 0
    let nums = 0
    for (const [t, idx] of [[a, c.a], [b, c.b]] as const) {
      for (const r of t.rows) {
        const v = r.cells[idx]
        if (isEmpty(v)) continue
        filled++
        if (toNumber(v) !== null) nums++
      }
    }
    return filled > 0 && nums / filled >= 0.7
  })
}

// ---------------------------------------------------------------------------
// Автоопределение ключа
// ---------------------------------------------------------------------------

const STRONG_HINT = /шифр|код|артикул|обозначени|марка|sku|(^|\s)id(\s|$)|номенклатур/
const MEDIUM_HINT = /наименовани|название|материал|работ|вид |описани|позици|name|title|item|товар|услуг/
export const NUMBERING = /^(№|n|no|#|п\/п|№ ?п\/п|номер|поз\.?|пп)$|п\/п/

/** Какие колонки взять ключом: уникальные, заполненные, по названию похожие на шифр или наименование. */
export function suggestKey(a: ParsedTable, b: ParsedTable): string[] {
  const { cols } = commonColumns(a, b)
  if (cols.length === 0) return []
  const numeric = numericColumns(a, b, cols)

  const stats = cols.map((c, i) => {
    const per = [[a, c.a], [b, c.b]].map(([t, idx]) => {
      const rows = (t as ParsedTable).rows.filter((r) => !rowIsTotal(r.cells))
      const vals = rows.map((r) => normText(r.cells[idx as number])).filter(Boolean)
      return { fill: rows.length ? vals.length / rows.length : 0, uniq: vals.length ? new Set(vals).size / vals.length : 0 }
    })
    const fill = Math.min(per[0].fill, per[1].fill)
    const uniq = Math.min(per[0].uniq, per[1].uniq)
    const name = c.norm
    let score = fill * uniq
    if (STRONG_HINT.test(name)) score += 0.35
    else if (MEDIUM_HINT.test(name)) score += 0.2
    if (NUMBERING.test(name)) score -= 0.5 // номер по порядку «едет» при вставке строк
    if (numeric[i]) score -= 0.4
    return { norm: c.norm, fill, uniq, score, ok: fill >= 0.8 && uniq >= 0.9, numeric: numeric[i] }
  })

  const good = stats.filter((s) => s.ok).sort((x, y) => y.score - x.score)
  if (good.length > 0) return [good[0].norm]

  // одной колонки мало: пробуем пару из самых подходящих текстовых
  const text = stats.filter((s) => !s.numeric && s.fill >= 0.8).sort((x, y) => y.score - x.score).slice(0, 4)
  let best: { norms: string[]; uniq: number } | null = null
  for (let i = 0; i < text.length; i++) {
    for (let j = i + 1; j < text.length; j++) {
      const norms = [text[i].norm, text[j].norm]
      const uniq = Math.min(...[a, b].map((t) => combinedUniqueness(t, norms)))
      if (!best || uniq > best.uniq) best = { norms, uniq }
    }
  }
  if (best && best.uniq >= 0.9) return best.norms

  const fallback = [...stats].sort((x, y) => y.score - x.score)[0]
  return fallback ? [fallback.norm] : []
}

function combinedUniqueness(t: ParsedTable, norms: string[]): number {
  const idx = norms.map((n) => t.norms.indexOf(n))
  if (idx.some((i) => i < 0)) return 0
  const keys = t.rows.filter((r) => !rowIsTotal(r.cells)).map((r) => idx.map((i) => normText(r.cells[i])).join('␟'))
  return keys.length ? new Set(keys).size / keys.length : 0
}

// ---------------------------------------------------------------------------
// Сверка
// ---------------------------------------------------------------------------

interface KeyedRow {
  row: TableRow
  key: string
  display: string
  isTotal: boolean
}

function keyRows(t: ParsedTable, keyIdx: number[]): { rows: KeyedRow[]; duplicates: number } {
  const seen = new Map<string, number>()
  let duplicates = 0
  const rows = t.rows.map((row) => {
    const parts = keyIdx.map((i) => normText(row.cells[i]))
    const isTotal = rowIsTotal(row.cells)
    // «Итого» сопоставляется с «Итого»; строка без ключа — только с точно такой же
    let base = isTotal
      ? `\u0001${normText(row.cells.find((c) => !isEmpty(c)))}`
      : parts.some(Boolean)
        ? parts.join('␟')
        : `\u0000${row.cells.map(normText).join('␟')}`
    const display = keyIdx.map((i) => cellText(row.cells[i])).filter(Boolean).join(' · ') || cellText(row.cells.find((c) => !isEmpty(c)))
    const times = (seen.get(base) ?? 0) + 1
    seen.set(base, times)
    if (times > 1) duplicates++
    if (times === 2) duplicates++ // первая строка группы тоже делит ключ
    base = `${base}␞${times}`
    return { row, key: base, display, isTotal }
  })
  return { rows, duplicates }
}

/** Сверка таблицы «было» (a) с таблицей «стало» (b). keyNorms — нормализованные названия ключевых колонок. */
export function compareTables(a: ParsedTable, b: ParsedTable, keyNorms: string[]): TableDiff {
  const { cols, onlyA, onlyB } = commonColumns(a, b)
  const numeric = numericColumns(a, b, cols)
  const keyCols = keyNorms.filter((k) => cols.some((c) => c.norm === k))
  const effectiveKeys = keyCols.length > 0 ? keyCols : cols.length > 0 ? [cols[0].norm] : []
  const columns: DiffColumn[] = cols.map((c, i) => ({
    name: c.name,
    norm: c.norm,
    numeric: numeric[i] && !effectiveKeys.includes(c.norm) && !NUMBERING.test(c.norm),
    isKey: effectiveKeys.includes(c.norm),
    hasChanges: false,
    isNumbering: NUMBERING.test(c.norm) && !effectiveKeys.includes(c.norm),
  }))

  const ka = keyRows(a, effectiveKeys.map((k) => a.norms.indexOf(k)))
  const kb = keyRows(b, effectiveKeys.map((k) => b.norms.indexOf(k)))
  const pick = (r: TableRow, side: 'a' | 'b') => cols.map((c) => r.cells[side === 'a' ? c.a : c.b])

  const bByKey = new Map(kb.rows.map((r, i) => [r.key, i]))
  const matchedB = new Set<number>()
  const after = new Map<number, DiffRow[]>() // удалённые строки встают после ближайшей предыдущей совпавшей
  const pairs = new Map<number, DiffRow>() // индекс строки b → результат
  let last = -1

  const totals: ColumnTotal[] = columns.map((c, col) => ({
    col, name: c.name, norm: c.norm, nBefore: 0, nAfter: 0, mode: AVERAGED.test(c.norm) ? 'avg' : 'sum', before: 0, after: 0, delta: 0, pct: null, fromAdded: 0, fromRemoved: 0, fromChanged: 0, up: 0, down: 0,
  }))
  const num = (v: Cell) => toNumber(v) ?? 0
  const filled = { before: columns.map(() => 0), after: columns.map(() => 0) }
  const addTo = (field: 'before' | 'after', r: KeyedRow, vals: Cell[]) => {
    if (r.isTotal) return
    columns.forEach((c, i) => {
      if (!c.numeric) return
      totals[i][field] += num(vals[i])
      if (toNumber(vals[i]) !== null) filled[field][i]++
    })
  }
  ka.rows.forEach((r) => addTo('before', r, pick(r.row, 'a')))
  kb.rows.forEach((r) => addTo('after', r, pick(r.row, 'b')))

  for (const r of ka.rows) {
    const bi = bByKey.get(r.key)
    const av = pick(r.row, 'a')
    if (bi === undefined) {
      const row: DiffRow = { status: 'removed', key: r.display, rowA: r.row.n, rowB: null, a: av, b: null, changes: [], isTotal: r.isTotal }
      if (!r.isTotal) columns.forEach((c, i) => c.numeric && (totals[i].fromRemoved -= num(av[i])))
      after.set(last, [...(after.get(last) ?? []), row])
      continue
    }
    matchedB.add(bi)
    last = bi
    const bv = pick(kb.rows[bi].row, 'b')
    const changes: CellChange[] = []
    columns.forEach((c, i) => {
      if (c.isKey || c.isNumbering) return
      if (c.numeric) {
        const x = toNumber(av[i])
        const y = toNumber(bv[i])
        if (x === null && y === null) {
          if (cellText(av[i]) !== cellText(bv[i])) changes.push({ col: i, before: av[i], after: bv[i], numeric: false, delta: null, pct: null })
          return
        }
        if (x !== null && y !== null && sameNumber(x, y)) return
        const delta = (y ?? 0) - (x ?? 0)
        changes.push({ col: i, before: av[i], after: bv[i], numeric: true, delta, pct: x ? (delta / Math.abs(x)) * 100 : null })
        if (!r.isTotal) {
          totals[i].fromChanged += delta
          if (delta > 0) totals[i].up++
          else totals[i].down++
        }
      } else if (cellText(av[i]) !== cellText(bv[i])) {
        changes.push({ col: i, before: av[i], after: bv[i], numeric: false, delta: null, pct: null })
      }
    })
    changes.forEach((ch) => (columns[ch.col].hasChanges = true))
    pairs.set(bi, {
      status: changes.length > 0 ? 'changed' : 'same',
      key: kb.rows[bi].display || r.display,
      rowA: r.row.n,
      rowB: kb.rows[bi].row.n,
      a: av,
      b: bv,
      changes,
      isTotal: r.isTotal,
    })
  }

  const rows: DiffRow[] = [...(after.get(-1) ?? [])]
  kb.rows.forEach((r, bi) => {
    const bv = pick(r.row, 'b')
    if (!matchedB.has(bi)) {
      if (!r.isTotal) columns.forEach((c, i) => c.numeric && (totals[i].fromAdded += num(bv[i])))
      rows.push({ status: 'added', key: r.display, rowA: null, rowB: r.row.n, a: null, b: bv, changes: [], isTotal: r.isTotal })
    } else {
      rows.push(pairs.get(bi)!)
    }
    rows.push(...(after.get(bi) ?? []))
  })

  const counts: Record<RowStatus, number> = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const r of rows) counts[r.status]++
  // отмечаем колонки, где что-то изменилось, также для добавленных/удалённых строк не нужно — это про значения
  const numericTotals = totals.filter((_, i) => columns[i].numeric)
  for (const t of numericTotals) {
    t.nBefore = filled.before[t.col]
    t.nAfter = filled.after[t.col]
    if (t.mode === 'avg') {
      // среднее по заполненным строкам; разложение на новые/удалённые/изменённые для среднего не имеет смысла
      t.before = filled.before[t.col] ? t.before / filled.before[t.col] : 0
      t.after = filled.after[t.col] ? t.after / filled.after[t.col] : 0
      t.fromAdded = t.fromRemoved = t.fromChanged = 0
    }
    t.delta = t.after - t.before
    t.pct = t.before !== 0 ? (t.delta / Math.abs(t.before)) * 100 : null
  }

  return { columns, rows, counts, totals: numericTotals, onlyA, onlyB, duplicateKeys: ka.duplicates + kb.duplicates, keyNorms: effectiveKeys }
}

/** Сумма и число заполненных значений по числовым колонкам одной таблицы (для целиком новых или удалённых листов). */
export function sheetNumericStats(t: ParsedTable): { norm: string; name: string; sum: number; n: number; avg: boolean }[] {
  const rows = t.rows.filter((r) => !rowIsTotal(r.cells))
  const out: { norm: string; name: string; sum: number; n: number; avg: boolean }[] = []
  t.norms.forEach((norm, c) => {
    if (NUMBERING.test(norm) || STRONG_HINT.test(norm)) return
    let filled = 0
    let sum = 0
    let n = 0
    for (const r of rows) {
      const v = r.cells[c]
      if (isEmpty(v)) continue
      filled++
      const x = toNumber(v)
      if (x !== null) {
        sum += x
        n++
      }
    }
    if (filled > 0 && n / filled >= 0.7) out.push({ norm, name: t.headers[c], sum, n, avg: AVERAGED.test(norm) })
  })
  return out
}
