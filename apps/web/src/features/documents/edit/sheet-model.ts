import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
// Модель правки таблицы: строки с устойчивыми номерами, разбор введённого текста, операции со строками и сводка «что изменилось».
// Чистая логика без React и exceljs — проверяется отдельно от экрана.
import { normalizePatch, mergePatch, mergeStyle, type CellStyle, type StylePatch } from '../sheet/style'
import { EMPTY_LAYOUT, type Merge, type SheetLayout } from '../sheet/layout'
import { point, shiftFormula, type RowShift } from './formula-shift'

export type Cell = string | number | boolean | Date | null | undefined
/** Ячейка с формулой: на экране виден результат, в поле ввода — сама формула */
export interface FormulaCell {
  formula: string
  result?: Cell
}
export type ECell = Cell | FormulaCell

export interface EditRow {
  /** Номер строки в исходном листе (с 0); -1 у добавленных строк */
  id: number
  /** Ключ для React, не меняется при вставках и удалениях */
  key: number
  cells: ECell[]
  /** Колонки, которые правке не поддаются (хвост объединённой ячейки) */
  locked?: number[]
  /** В строке что-то вводили: только такие строки сверяются с исходной */
  touched?: boolean
  /** Оформление ячеек из файла */
  styles?: (CellStyle | undefined)[]
  /** Оформление, которое применил пользователь поверх файла */
  patch?: (StylePatch | undefined)[]
  /** Высота строки в пикселях, если она не по умолчанию */
  h?: number
  /** Строка скрыта в файле */
  hidden?: boolean
}

export interface EditSheet {
  name: string
  rows: EditRow[]
  /** Значения листа как в файле: по ним считаются изменения */
  orig: ECell[][]
  width: number
  /** Ширины колонок, объединённые ячейки, рисунки, автофильтр */
  layout: SheetLayout
}

export { EMPTY_LAYOUT }

/** Оформление ячейки: из файла и поверх него правка пользователя */
export const styleOf = (row: EditRow | undefined, c: number): CellStyle => mergeStyle(row?.styles?.[c], row?.patch?.[c])

/** Применяет оформление к ячейкам (индексы строк и колонок листа); совпадающее с файлом отбрасывается */
export function patchCells(sheet: EditSheet, cells: { r: number; c: number }[], patch: StylePatch): EditSheet {
  const byRow = new Map<number, number[]>()
  for (const { r, c } of cells) byRow.set(r, [...(byRow.get(r) ?? []), c])
  const rows = sheet.rows.slice()
  let changed = false
  for (const [r, cols] of byRow) {
    const row = rows[r]
    if (!row) continue
    const next = (row.patch ?? []).slice()
    for (const c of cols) {
      const merged = mergePatch(next[c], patch)
      const clean = normalizePatch(row.styles?.[c], merged)
      if (JSON.stringify(clean ?? null) === JSON.stringify(next[c] ?? null)) continue
      while (next.length <= c) next.push(undefined)
      next[c] = clean
      changed = true
    }
    rows[r] = { ...row, patch: next.some(Boolean) ? next : undefined }
  }
  return changed ? { ...sheet, rows, width: Math.max(sheet.width, ...cells.map((x) => x.c + 1)) } : sheet
}

/** Убирает всё, что пользователь применил к ячейкам */
export function resetPatch(sheet: EditSheet, cells: { r: number; c: number }[]): EditSheet {
  const rows = sheet.rows.slice()
  let changed = false
  for (const { r, c } of cells) {
    const row = rows[r]
    if (!row?.patch?.[c]) continue
    const next = row.patch.slice()
    next[c] = undefined
    rows[r] = { ...row, patch: next.some(Boolean) ? next : undefined }
    changed = true
  }
  return changed ? { ...sheet, rows } : sheet
}

/**
 * Объединённые ячейки в нынешних строках: строка исходного листа ушла — диапазон сжимается, строка вставлена внутрь — растёт.
 * Диапазон, целиком оказавшийся в удалённых строках, пропадает.
 */
export function displayMerges(sheet: EditSheet): Merge[] {
  const shift = { map: rowMap(sheet), finalLength: sheet.rows.length }
  const out: Merge[] = []
  for (const m of sheet.layout.merges) {
    const top = point(m.r1, shift, 'start')
    const bottom = point(m.r2, shift, 'end')
    if (top === null || bottom === null || bottom < top) continue
    out.push({ r1: top, r2: bottom, c1: m.c1, c2: m.c2 })
  }
  return out
}

let keySeq = 1
export const nextKey = () => keySeq++

export const isFormula = (v: ECell): v is FormulaCell => typeof v === 'object' && v !== null && !(v instanceof Date) && 'formula' in v
export const plain = (v: ECell): Cell => (isFormula(v) ? v.result : v)

const pad2 = (n: number) => String(n).padStart(2, '0')
const dateText = (d: Date) => `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
const numFmt = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 6 })

/** Как ячейка выглядит в таблице */
export function displayCell(v: ECell): string {
  const p = plain(v)
  if (p === null || p === undefined) return ''
  if (p instanceof Date) return dateText(p)
  if (typeof p === 'number') return numFmt.format(p)
  if (typeof p === 'boolean') return p ? tr('Да') : tr('Нет')
  return String(p)
}

/** Что показывается в поле ввода при правке ячейки */
export function rawText(v: ECell): string {
  if (isFormula(v)) return `=${v.formula}`
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return dateText(v)
  if (typeof v === 'number') return String(v).replace('.', ',')
  if (typeof v === 'boolean') return v ? tr('Да') : tr('Нет')
  return v
}

/** Подпись значения для сравнения: формула и результат — разные значения */
export function sig(v: ECell): string {
  if (isFormula(v)) return `f:${v.formula}`
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date) return `d:${v.getTime()}`
  return `${typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's'}:${v}`
}
const sameCell = (a: ECell, b: ECell) => sig(a) === sig(b)

const NUMBER = /^[-+−]?(?:\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,]\d+)?$/
const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Введённый текст → значение ячейки. Тип берётся по прежнему значению: в числовой ячейке число остаётся числом,
 * текст с ведущим нулём («001») числом не становится. Строка с «=» — формула (кроме CSV).
 */
export function parseInput(text: string, prev: ECell, opts: { csv?: boolean } = {}): ECell {
  if (text === rawText(prev)) return prev
  if (!opts.csv && text.length > 1 && text.startsWith('=')) return { formula: text.slice(1) }
  if (text.trim() === '') return null
  const p = plain(prev)
  if (opts.csv) return text
  const t = text.trim()
  const prevEmpty = p === null || p === undefined || p === ''
  if (typeof p === 'number' || (prevEmpty && !/^[-+]?0\d/.test(t))) {
    if (NUMBER.test(t)) return Number(t.replace(/[  ]/g, '').replace('−', '-').replace(',', '.'))
  }
  if (p instanceof Date) {
    const m = DATE.exec(t)
    if (m) {
      const [y, mo, d] = m[1] ? [+m[3], +m[2], +m[1]] : [+m[4], +m[5], +m[6]]
      const date = new Date(Date.UTC(y, mo - 1, d))
      if (date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return date
    }
  }
  if (typeof p === 'boolean') {
    if (/^(да|true|истина|1)$/i.test(t)) return true
    if (/^(нет|false|ложь|0)$/i.test(t)) return false
  }
  return text
}

export function setCell(sheet: EditSheet, rowIndex: number, col: number, value: ECell): EditSheet {
  const row = sheet.rows[rowIndex]
  if (!row || row.locked?.includes(col)) return sheet
  if (sameCell(row.cells[col], value)) return sheet
  const cells = row.cells.slice()
  while (cells.length <= col) cells.push(null)
  cells[col] = value
  const rows = sheet.rows.slice()
  rows[rowIndex] = { ...row, cells, touched: true }
  return { ...sheet, rows, width: Math.max(sheet.width, col + 1) }
}

/** После вставки или удаления строки ссылки во всех формулах книги сдвигаются, как это делает Excel */
function shiftAll(sheets: EditSheet[], target: string, shift: RowShift): EditSheet[] {
  const shifts = new Map([[target.toLowerCase(), shift]])
  return sheets.map((sheet) => {
    let changed = false
    const rows = sheet.rows.map((row) => {
      let cells: ECell[] | null = null
      row.cells.forEach((cell, c) => {
        if (!isFormula(cell)) return
        const formula = shiftFormula(cell.formula, sheet.name, shifts)
        if (formula === cell.formula) return
        cells ??= row.cells.slice()
        cells[c] = { ...cell, formula }
      })
      if (!cells) return row
      changed = true
      return { ...row, cells }
    })
    return changed ? { ...sheet, rows } : sheet
  })
}

/** Вставляет пустую строку после строки afterIndex (null — в конец) листа si и возвращает индекс новой строки */
export function insertRowAt(sheets: EditSheet[], si: number, afterIndex: number | null): { sheets: EditSheet[]; index: number } {
  const sheet = sheets[si]
  const index = afterIndex === null ? sheet.rows.length : afterIndex + 1
  const rows = sheet.rows.slice()
  const above = index > 0 ? sheet.rows[index - 1] : undefined
  // новая строка берёт оформление и высоту у строки над ней, как в Excel
  rows.splice(index, 0, { id: -1, key: nextKey(), cells: [], ...(above?.styles ? { styles: above.styles.slice() } : {}), ...(above?.patch ? { patch: above.patch.slice() } : {}), ...(above?.h ? { h: above.h } : {}) })
  const map = Array.from({ length: sheet.rows.length }, (_, i) => (i < index ? i : i + 1))
  const next = sheets.slice()
  next[si] = { ...sheet, rows }
  return { sheets: shiftAll(next, sheet.name, { map, finalLength: rows.length }), index }
}

export function deleteRowAt(sheets: EditSheet[], si: number, index: number): EditSheet[] {
  const sheet = sheets[si]
  if (index < 0 || index >= sheet.rows.length) return sheets
  const rows = sheet.rows.slice()
  rows.splice(index, 1)
  const map = Array.from({ length: sheet.rows.length }, (_, i) => (i < index ? i : i === index ? -1 : i - 1))
  const next = sheets.slice()
  next[si] = { ...sheet, rows }
  return shiftAll(next, sheet.name, { map, finalLength: rows.length })
}

export interface CellChange {
  sheet: string
  /** Адрес вида B5 по положению в итоговом листе */
  address: string
  before: ECell
  after: ECell
}

export interface SheetChanges {
  name: string
  cells: number
  added: number
  removed: number
  /** Ячеек, к которым применили оформление */
  styled: number
  list: CellChange[]
}

export const colName = (i: number) => {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

/** Ячейка изменена руками: формула, которая лишь сдвинулась вслед за строками, изменением не считается */
export function cellChanged(sheet: EditSheet, rowId: number, before: ECell, after: ECell, shifts: Map<string, RowShift>): boolean {
  if (rowId >= 0 && isFormula(before) && isFormula(after)) return shiftFormula(before.formula, sheet.name, shifts) !== after.formula
  return !sameCell(before, after)
}

/** Изменения листа относительно исходного состояния */
export function sheetChanges(sheet: EditSheet, shifts: Map<string, RowShift>): SheetChanges {
  const kept = new Set<number>()
  const list: CellChange[] = []
  let cells = 0
  let added = 0
  let styled = 0
  sheet.rows.forEach((row, index) => {
    if (row.id < 0) {
      added++
      return
    }
    kept.add(row.id)
    styled += row.patch?.filter(Boolean).length ?? 0
    if (!row.touched) return
    const before = sheet.orig[row.id] ?? []
    const width = Math.max(before.length, row.cells.length)
    for (let c = 0; c < width; c++) {
      if (!cellChanged(sheet, row.id, before[c], row.cells[c], shifts)) continue
      cells++
      list.push({ sheet: sheet.name, address: `${colName(c)}${index + 1}`, before: before[c], after: row.cells[c] })
    }
  })
  return { name: sheet.name, cells, added, removed: sheet.orig.length - kept.size, styled, list }
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export interface SheetsSummary {
  changed: boolean
  cells: number
  added: number
  removed: number
  styled: number
  text: string
}

/** Заметка к версии: «Изменено ячеек: 3 на листах «Смета»; добавлено строк: 1; удалено строк: 0.» и первые изменения */
export function summarizeSheets(sheets: EditSheet[]): SheetsSummary {
  const shifts = buildShifts(sheets)
  const all = sheets.map((s) => sheetChanges(s, shifts))
  const cells = all.reduce((n, s) => n + s.cells, 0)
  const added = all.reduce((n, s) => n + s.added, 0)
  const removed = all.reduce((n, s) => n + s.removed, 0)
  const styled = all.reduce((n, s) => n + s.styled, 0)
  if (cells + added + removed + styled === 0) return { changed: false, cells, added, removed, styled, text: '' }

  const parts: string[] = []
  if (cells > 0) {
    const names = all.filter((s) => s.cells > 0).map((s) => `«${s.name}»`)
    // у CSV листа нет: имя «CSV» служебное
    parts.push(sheets.length === 1 && sheets[0].name === 'CSV' ? tr('изменено ячеек: {{cells}}', { cells }) : tr('изменено ячеек: {{cells}} на {{where}} {{names}}', { cells, where: names.length === 1 ? tr('листе') : tr('листах'), names: names.join(', ') }))
  }
  if (added > 0) parts.push(tr('добавлено строк: {{added}}', { added }))
  if (removed > 0) parts.push(tr('удалено строк: {{removed}}', { removed }))
  if (styled > 0) parts.push(tr('изменено оформление ячеек: {{styled}}', { styled }))
  let text = `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase())

  const show = (v: ECell) => {
    const t = isFormula(v) ? `=${v.formula}` : displayCell(v)
    return t ? clip(t) : tr('пусто')
  }
  const examples = all.flatMap((s) => s.list).slice(0, 3).map((c) => `${sheets.length > 1 ? `${c.sheet}!${c.address}` : c.address}: ${show(c.before)} → ${show(c.after)}`)
  if (examples.length > 0) text += tr(' Например: {{v1}}.', { v1: examples.join('; ') })
  return { changed: true, cells, added, removed, styled, text }
}

/**
 * Новое положение строк: map[исходный номер строки (с 0)] = номер в итоговом листе (с 0) или -1, если строку удалили.
 * По нему сдвигаются ссылки в формулах и объединённые ячейки.
 */
export function rowMap(sheet: EditSheet): number[] {
  const map = new Array<number>(sheet.orig.length).fill(-1)
  sheet.rows.forEach((row, index) => {
    if (row.id >= 0) map[row.id] = index
  })
  return map
}

/** Сдвиги строк по листам, где строки добавляли или убирали (ключ — имя листа в нижнем регистре) */
export function buildShifts(sheets: EditSheet[]): Map<string, RowShift> {
  const shifts = new Map<string, RowShift>()
  for (const s of sheets) {
    if (s.rows.length !== s.orig.length || s.rows.some((r, i) => r.id !== i)) shifts.set(s.name.toLowerCase(), { map: rowMap(s), finalLength: s.rows.length })
  }
  return shifts
}

/** Формула в этой ячейке осталась исходной (с поправкой на сдвиг строк), её не правили руками */
export function isOriginalFormula(sheet: EditSheet, rowIndex: number, col: number, shifts: Map<string, RowShift>): boolean {
  const row = sheet.rows[rowIndex]
  const cell = row?.cells[col]
  const before = row && row.id >= 0 ? sheet.orig[row.id]?.[col] : undefined
  return !!cell && isFormula(cell) && before !== undefined && isFormula(before) && !cellChanged(sheet, row.id, before, cell, shifts)
}
