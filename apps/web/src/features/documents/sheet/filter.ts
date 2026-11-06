import { currentLocale } from '@/lib/i18n'
// Фильтры листа: диапазон (из файла или найденный по шапке), список значений колонки, видимые строки и сортировка просмотра.
import { detectHeaderRow } from '../compare/table-diff'
import { point } from '../edit/formula-shift'
import { plain, rowMap, type EditSheet } from '../edit/sheet-model'

/** Диапазон фильтра в нынешних строках листа (индексы с 0) */
export interface FilterRange {
  header: number
  last: number
  c1: number
  c2: number
}

/** Что убрано фильтром: по колонкам — набор скрытых значений (как они показаны на экране) */
export type FilterState = Record<number, Set<string>>

export interface SortState {
  c: number
  dir: 1 | -1
}

/** Диапазон автофильтра из файла; если его нет — шапка находится сама, фильтр охватывает всю таблицу под ней */
export function filterRange(sheet: EditSheet): FilterRange | null {
  const n = sheet.rows.length
  const af = sheet.layout.autoFilter
  if (af) {
    const shift = { map: rowMap(sheet), finalLength: n }
    const header = point(af.r1, shift, 'start')
    const last = point(af.r2, shift, 'end')
    if (header !== null && last !== null && last > header && header < n) return { header, last: Math.min(last, n - 1), c1: af.c1, c2: Math.min(af.c2, sheet.width - 1) }
  }
  if (n < 3) return null
  const head = sheet.rows.slice(0, 30).map((r) => r.cells.map(plain))
  const header = detectHeaderRow(head)
  const cells = head[header] ?? []
  let c2 = -1
  let filled = 0
  cells.forEach((v, c) => {
    if (v !== null && v !== undefined && v !== '') {
      c2 = c
      filled++
    }
  })
  if (filled < 2 || n - header < 3) return null
  return { header, last: n - 1, c1: 0, c2 }
}

const compare = (a: string, b: string): number => {
  const na = Number(a.replace(/\s/g, '').replace(',', '.'))
  const nb = Number(b.replace(/\s/g, '').replace(',', '.'))
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a.localeCompare(b, currentLocale(), { numeric: true, sensitivity: 'base' })
}

export interface ViewOptions {
  range: FilterRange | null
  state: FilterState
  sort: SortState | null
  /** Показанный на экране текст ячейки */
  text: (r: number, c: number) => string
}

/** Строки, которые показываются: без скрытых в файле и без отфильтрованных; в диапазоне фильтра они могут быть отсортированы */
export function visibleRows(sheet: EditSheet, { range, state, sort, text }: ViewOptions): number[] {
  const out: number[] = []
  const cols = Object.keys(state).map(Number)
  const inRange: number[] = []
  sheet.rows.forEach((row, r) => {
    if (row.hidden) return
    if (range && r > range.header && r <= range.last) {
      if (row.id >= 0 && cols.some((c) => state[c].has(text(r, c)))) return
      inRange.push(r)
      return
    }
    out.push(r)
  })
  if (!range) return out
  if (sort) inRange.sort((a, b) => sort.dir * compare(text(a, sort.c), text(b, sort.c)) || a - b)
  // строки диапазона идут на своих местах между шапкой и хвостом
  const head = out.filter((r) => r <= range.header)
  const tail = out.filter((r) => r > range.last)
  return [...head, ...inRange, ...tail]
}

/** Значения колонки для списка в фильтре: учитывают фильтры других колонок */
export function columnValues(sheet: EditSheet, range: FilterRange, c: number, state: FilterState, text: (r: number, c: number) => string): { value: string; count: number }[] {
  const others = Object.keys(state).map(Number).filter((x) => x !== c)
  const counts = new Map<string, number>()
  for (let r = range.header + 1; r <= range.last; r++) {
    const row = sheet.rows[r]
    if (!row || row.hidden) continue
    if (row.id >= 0 && others.some((o) => state[o].has(text(r, o)))) continue
    const v = text(r, c)
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => compare(a.value, b.value))
}
