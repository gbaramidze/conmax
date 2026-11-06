// Пересчёт формул прямо в редакторе: изменили цену — сумма и итог обновились. Считает fast-formula-parser (около 280 функций Excel).
// Сначала парсер проверяется на исходных данных файла: формулы, для которых он выдал не то же, что посчитал Excel, считаются ненадёжными,
// их значения остаются прежними, а в окне сохранения об этом честно сказано.
import { buildShifts, isFormula, isOriginalFormula, type Cell, type EditSheet, type FormulaCell } from './sheet-model'

/** Ключ результата: лист, устойчивый ключ строки, колонка */
export const resultKey = (sheet: number, rowKey: number, col: number) => `${sheet}|${rowKey}|${col}`

export interface RecalcResult {
  /** Новые значения формул, которые отличаются от записанных в файле */
  values: Map<string, Cell>
  /** Формул, значение которых пересчитать не удалось: у них прежнее значение до открытия в Excel */
  stale: number
}

export interface Recalc {
  run: (sheets: EditSheet[]) => RecalcResult
  /** Сколько формул в файле всего */
  formulas: number
}

/** Слишком большие книги не пересчитываем: правка важнее */
const MAX_FORMULAS = 20_000
const EXCEL_EPOCH = 25569
const FAILED = Symbol('failed')

const serial = (d: Date) => d.getTime() / 86_400_000 + EXCEL_EPOCH
const asNumber = (v: Cell): Cell => (v instanceof Date ? serial(v) : v)

interface Position {
  sheet: string
  row: number
  col: number
}
interface ParserLike {
  parse: (text: string, pos: Position) => unknown
}
type ParserCtor = (new (cfg: unknown) => ParserLike) & { FormulaError: new (...a: unknown[]) => { _error?: string } }

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  return a === b
}

export async function createRecalc(initial: EditSheet[]): Promise<Recalc | null> {
  const count = initial.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.cells.filter(isFormula).length, 0), 0)
  if (count === 0) return { run: () => ({ values: new Map(), stale: 0 }), formulas: 0 }
  if (count > MAX_FORMULAS) return null

  const mod = await import('fast-formula-parser')
  const FormulaParser = ((mod as unknown as { default?: ParserCtor }).default ?? (mod as unknown as ParserCtor)) as ParserCtor

  /** Считает все формулы; для ключей из unreliable берёт значение, записанное в файле */
  function evaluate(sheets: EditSheet[], unreliable: Set<string> | null): Map<string, Cell | typeof FAILED> {
    const shifts = buildShifts(sheets)
    const names = new Map(sheets.map((s, i) => [s.name.toLowerCase(), i]))
    const memo = new Map<string, Cell | typeof FAILED>()
    const active = new Set<string>()
    const pool: ParserLike[] = []

    const parserAt = (depth: number): ParserLike =>
      (pool[depth] ??= new FormulaParser({
        onCell: ({ sheet, row, col }: Position) => valueAt(names.get(sheet.toLowerCase()), row - 1, col - 1, depth + 1),
        onRange: ({ sheet, from, to }: { sheet: string; from: Position; to: Position }) => {
          const si = names.get(sheet.toLowerCase())
          const rows: unknown[][] = []
          for (let r = from.row; r <= to.row; r++) {
            const line: unknown[] = []
            for (let c = from.col; c <= to.col; c++) line.push(valueAt(si, r - 1, c - 1, depth + 1))
            rows.push(line)
          }
          return rows
        },
      }))

    function valueAt(si: number | undefined, r: number, c: number, depth: number): unknown {
      if (si === undefined || r < 0 || c < 0) return null
      const cell = sheets[si].rows[r]?.cells[c]
      if (cell === undefined || cell === null || cell === '') return null
      if (!isFormula(cell)) return asNumber(cell)
      const v = formulaAt(si, r, c, depth)
      return v === FAILED ? (asNumber(cell.result ?? null) ?? null) : v
    }

    function formulaAt(si: number, r: number, c: number, depth: number): Cell | typeof FAILED {
      const row = sheets[si].rows[r]
      const cell = row.cells[c] as FormulaCell
      const k = `${si}:${r}:${c}`
      const known = memo.get(k)
      if (known !== undefined) return known
      if (active.has(k) || depth > 200) return FAILED
      if (unreliable?.has(resultKey(si, row.key, c)) && isOriginalFormula(sheets[si], r, c, shifts)) {
        memo.set(k, FAILED)
        return FAILED
      }
      active.add(k)
      let value: Cell | typeof FAILED
      try {
        const res = parserAt(depth).parse(cell.formula, { sheet: sheets[si].name, row: r + 1, col: c + 1 })
        const first = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0][0] : res[0]) : res
        value = first instanceof FormulaParser.FormulaError ? (first._error ?? '#VALUE!') : first === undefined ? null : (first as Cell)
      } catch {
        value = FAILED
      }
      active.delete(k)
      memo.set(k, value)
      return value
    }

    const out = new Map<string, Cell | typeof FAILED>()
    sheets.forEach((s, si) =>
      s.rows.forEach((row, r) =>
        row.cells.forEach((cell, c) => {
          if (isFormula(cell)) out.set(resultKey(si, row.key, c), formulaAt(si, r, c, 0))
        }),
      ),
    )
    return out
  }

  // проверка на исходных данных: где парсер расходится с Excel, формулы считаем ненадёжными
  const unreliable = new Set<string>()
  const base = evaluate(initial, null)
  initial.forEach((s, si) =>
    s.rows.forEach((row) =>
      row.cells.forEach((cell, c) => {
        if (!isFormula(cell)) return
        const k = resultKey(si, row.key, c)
        const v = base.get(k)
        const cached = asNumber(cell.result ?? null)
        if (v === FAILED || (cached !== null && cached !== undefined && !same(v, cached))) unreliable.add(k)
      }),
    ),
  )

  return {
    formulas: count,
    run(sheets) {
      const out = evaluate(sheets, unreliable)
      const values = new Map<string, Cell>()
      let stale = 0
      sheets.forEach((s, si) =>
        s.rows.forEach((row) =>
          row.cells.forEach((cell, c) => {
            if (!isFormula(cell)) return
            const k = resultKey(si, row.key, c)
            const v = out.get(k)
            if (v === FAILED || v === undefined) {
              stale++
              return
            }
            const cached = asNumber(cell.result ?? null)
            if (cached === null || cached === undefined || !same(v, cached)) values.set(k, v)
          }),
        ),
      )
      return { values, stale }
    },
  }
}
