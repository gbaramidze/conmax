// Сверка книг Excel целиком: листы сопоставляются между собой, каждая пара сверяется отдельно, итоги складываются по книге.
import {
  commonColumns,
  compareTables,
  detectHeaderRow,
  parseTable,
  rowIsTotal,
  sheetNumericStats,
  suggestKey,
  type ParsedTable,
  type RawSheet,
  type RowStatus,
  type TableDiff,
} from '@/features/documents/compare/table-diff'

export const normSheetName = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s ]+/g, ' ').trim()

export interface SheetMatch {
  /** Индексы листов в «было» и «стало»; null — листа с этой стороны нет */
  a: number | null
  b: number | null
  by: 'name' | 'order' | 'manual'
}

/**
 * Листы сопоставляются по названию (без учёта регистра и лишних пробелов). Если ни одно название не совпало,
 * а листов поровну — по порядку. Остальные: только в «было» — лист удалён, только в «стало» — новый.
 */
export function autoMatchSheets(sa: RawSheet[], sb: RawSheet[]): SheetMatch[] {
  const bByName = new Map<string, number>()
  sb.forEach((s, i) => {
    const k = normSheetName(s.name)
    if (!bByName.has(k)) bByName.set(k, i)
  })
  const used = new Set<number>()
  const matches: SheetMatch[] = sa.map((s, a) => {
    const b = bByName.get(normSheetName(s.name))
    if (b !== undefined && !used.has(b)) {
      used.add(b)
      return { a, b, by: 'name' as const }
    }
    return { a, b: null, by: 'name' as const }
  })
  if (used.size === 0 && sa.length === sb.length) return sa.map((_, i) => ({ a: i, b: i, by: 'order' as const }))
  sb.forEach((_, b) => {
    if (!used.has(b)) matches.push({ a: null, b, by: 'name' })
  })
  return matches
}

/** Ручные правки: для листа «было» (индекс) — какой лист «стало» ему соответствует (null — никакой). */
export function applyOverrides(auto: SheetMatch[], sb: RawSheet[], overrides: Record<number, number | null>): SheetMatch[] {
  if (Object.keys(overrides).length === 0) return auto
  const map = new Map<number, SheetMatch>()
  for (const m of auto) if (m.a !== null) map.set(m.a, { ...m })
  for (const [aKey, b] of Object.entries(overrides)) {
    const a = Number(aKey)
    if (!map.has(a)) continue
    if (b !== null) for (const m of map.values()) if (m.a !== a && m.b === b) m.b = null // лист «стало» занят другим — освобождаем его
    map.set(a, { a, b, by: 'manual' })
  }
  const usedB = new Set([...map.values()].map((m) => m.b).filter((b): b is number => b !== null))
  const out = auto.filter((m) => m.a !== null).map((m) => map.get(m.a!)!)
  sb.forEach((_, b) => {
    if (!usedB.has(b)) out.push({ a: null, b, by: 'name' })
  })
  return out
}

export interface SheetSettings {
  headerA?: string
  headerB?: string
  key?: string[]
}

interface Base {
  id: string
  /** Название листа в «было» / «стало» */
  nameA: string | null
  nameB: string | null
}

export type SheetResult =
  | (Base & {
      kind: 'compared'
      by: SheetMatch['by']
      ta: ParsedTable
      tb: ParsedTable
      common: ReturnType<typeof commonColumns>
      keys: string[]
      autoKey: string[]
      diff: TableDiff
    })
  | (Base & { kind: 'unmatched'; by: SheetMatch['by']; ta: ParsedTable; tb: ParsedTable })
  | (Base & { kind: 'removed'; table: ParsedTable; rows: number })
  | (Base & { kind: 'added'; table: ParsedTable; rows: number })

const rowOr = (text: string | undefined, auto: number) => {
  const n = Number(text)
  return text && Number.isInteger(n) && n >= 1 ? n - 1 : auto
}

const parse = (s: RawSheet, header: string | undefined) => parseTable(s.rows, rowOr(header, detectHeaderRow(s.rows)))

export function compareWorkbooks(sa: RawSheet[], sb: RawSheet[], matches: SheetMatch[], settings: Record<string, SheetSettings>): SheetResult[] {
  return matches.map((m): SheetResult => {
    const id = `a${m.a ?? ''}b${m.b ?? ''}`
    const st = settings[id] ?? {}
    const A = m.a === null ? null : sa[m.a]
    const B = m.b === null ? null : sb[m.b]
    const base = { id, nameA: A?.name ?? null, nameB: B?.name ?? null }
    if (A && B) {
      const ta = parse(A, st.headerA)
      const tb = parse(B, st.headerB)
      const common = commonColumns(ta, tb)
      if (common.cols.length === 0) return { ...base, kind: 'unmatched', by: m.by, ta, tb }
      const autoKey = suggestKey(ta, tb)
      const keys = (st.key ?? autoKey).filter((k) => common.cols.some((c) => c.norm === k))
      return { ...base, kind: 'compared', by: m.by, ta, tb, common, keys, autoKey, diff: compareTables(ta, tb, keys) }
    }
    const table = parse((A ?? B)!, A ? st.headerA : st.headerB)
    const rows = table.rows.filter((r) => !rowIsTotal(r.cells)).length
    return A ? { ...base, kind: 'removed', table, rows } : { ...base, kind: 'added', table, rows }
  })
}

/** Строки листа по статусам; у целиком нового листа все строки «добавлены», у удалённого — «удалены». */
export function sheetCounts(r: SheetResult): Record<RowStatus, number> {
  if (r.kind === 'compared') return r.diff.counts
  return { added: r.kind === 'added' ? r.rows : 0, removed: r.kind === 'removed' ? r.rows : 0, changed: 0, same: 0 }
}

export const sheetHasChanges = (r: SheetResult) => {
  const c = sheetCounts(r)
  return c.added + c.removed + c.changed > 0
}

export const sheetTitle = (r: SheetResult) =>
  r.nameA && r.nameB && normSheetName(r.nameA) !== normSheetName(r.nameB) ? `${r.nameA.trim()} → ${r.nameB.trim()}` : (r.nameA ?? r.nameB ?? '').trim()

export function workbookCounts(results: SheetResult[]): Record<RowStatus, number> {
  const out: Record<RowStatus, number> = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const r of results) {
    const c = sheetCounts(r)
    for (const k of Object.keys(out) as RowStatus[]) out[k] += c[k]
  }
  return out
}

export interface WorkbookTotal {
  norm: string
  name: string
  mode: 'sum' | 'avg'
  before: number
  after: number
  delta: number
  pct: number | null
  fromAdded: number
  fromRemoved: number
  fromChanged: number
  up: number
  down: number
}

interface Acc {
  name: string
  avg: boolean
  sumB: number
  sumA: number
  nB: number
  nA: number
  add: number
  rem: number
  chg: number
  up: number
  down: number
}

/** Итоги по колонкам всей книги: одноимённые колонки разных листов складываются, новые и удалённые листы входят целиком. */
export function workbookTotals(results: SheetResult[]): WorkbookTotal[] {
  const acc = new Map<string, Acc>()
  const get = (norm: string, name: string, avg: boolean) => {
    let a = acc.get(norm)
    if (!a) {
      a = { name, avg, sumB: 0, sumA: 0, nB: 0, nA: 0, add: 0, rem: 0, chg: 0, up: 0, down: 0 }
      acc.set(norm, a)
    }
    return a
  }
  for (const r of results) {
    if (r.kind === 'compared') {
      for (const t of r.diff.totals) {
        const a = get(t.norm, t.name, t.mode === 'avg')
        a.sumB += t.mode === 'avg' ? t.before * t.nBefore : t.before
        a.sumA += t.mode === 'avg' ? t.after * t.nAfter : t.after
        a.nB += t.nBefore
        a.nA += t.nAfter
        a.add += t.fromAdded
        a.rem += t.fromRemoved
        a.chg += t.fromChanged
        a.up += t.up
        a.down += t.down
      }
    } else if (r.kind === 'added' || r.kind === 'removed') {
      for (const s of sheetNumericStats(r.table)) {
        const a = get(s.norm, s.name, s.avg)
        if (r.kind === 'added') {
          a.sumA += s.sum
          a.nA += s.n
          a.add += s.sum
        } else {
          a.sumB += s.sum
          a.nB += s.n
          a.rem -= s.sum
        }
      }
    }
  }
  return [...acc].map(([norm, a]): WorkbookTotal => {
    const before = a.avg ? (a.nB ? a.sumB / a.nB : 0) : a.sumB
    const after = a.avg ? (a.nA ? a.sumA / a.nA : 0) : a.sumA
    const delta = after - before
    return {
      norm,
      name: a.name,
      mode: a.avg ? 'avg' : 'sum',
      before,
      after,
      delta,
      pct: before !== 0 ? (delta / Math.abs(before)) * 100 : null,
      fromAdded: a.avg ? 0 : a.add,
      fromRemoved: a.avg ? 0 : a.rem,
      fromChanged: a.avg ? 0 : a.chg,
      up: a.up,
      down: a.down,
    }
  })
}
