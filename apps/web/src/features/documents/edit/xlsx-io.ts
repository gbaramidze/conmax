import { tr } from '@/lib/tr'
// Чтение и запись .xlsx для правки. Файл открывает exceljs, и при сохранении изменяются только те ячейки и строки, которые тронул пользователь:
// оформление, ширины колонок, формулы, форматы чисел остальных ячеек остаются как в исходном файле.
import type { CellValue, Workbook, Worksheet } from 'exceljs'
import { applyPatchToCell, readCellStyle, resetStyleCache, type XCell } from '../sheet/xlsx-style'
import { charsToPx, EMU_PER_PX, type Anchor, type Merge, type SheetImage, type SheetLayout } from '../sheet/layout'
import { parseTheme, type CellStyle } from '../sheet/style'
import { point, type RowShift } from './formula-shift'
import { resultKey } from './recalc'
import { buildShifts, cellChanged, isFormula, nextKey, sig, type Cell, type ECell, type EditRow, type EditSheet, type FormulaCell } from './sheet-model'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function exceljs() {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

function scalar(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('error' in o) return String(o.error)
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('')
    return null
  }
  return v as string | number | boolean
}

function cellValue(cell: { value: CellValue; formula?: string }): ECell {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if ('formula' in o || 'sharedFormula' in o) {
      const f: FormulaCell = { formula: String(cell.formula ?? o.formula ?? '') }
      const res = scalar(o.result)
      if (res !== null) f.result = res
      return f
    }
    if ('hyperlink' in o) return scalar(o.text) ?? String(o.hyperlink)
    return scalar(v)
  }
  return v
}

export interface LoadedWorkbook {
  wb: Workbook
  sheets: EditSheet[]
  /** Что в файле exceljs не сохранит (диаграммы, сводные таблицы, макросы…) */
  lost: string[]
}

/** Имена файлов внутри zip по центральному каталогу (без распаковки) */
export function zipNames(buf: ArrayBuffer): string[] {
  const b = new Uint8Array(buf)
  const dv = new DataView(buf)
  const dec = new TextDecoder()
  const out: string[] = []
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) return out
  let p = dv.getUint32(end + 16, true)
  const count = dv.getUint16(end + 10, true)
  for (let n = 0; n < count && p + 46 <= b.length && dv.getUint32(p, true) === 0x02014b50; n++) {
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    out.push(dec.decode(b.subarray(p + 46, p + 46 + nameLen)))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function lostInXlsx(names: string[]): string[] {
  const lost: string[] = []
  if (names.some((n) => n.startsWith('xl/charts/') || n.startsWith('xl/chartsheets/'))) lost.push(tr('диаграммы'))
  if (names.some((n) => n.startsWith('xl/pivotTables/') || n.startsWith('xl/pivotCache/'))) lost.push(tr('сводные таблицы'))
  if (names.some((n) => n.startsWith('xl/slicers/'))) lost.push(tr('срезы'))
  if (names.some((n) => n.startsWith('xl/embeddings/') || n === 'xl/vbaProject.bin')) lost.push(tr('вложенные объекты и макросы'))
  if (names.some((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n)) && !names.some((n) => n.startsWith('xl/media/')) && !names.some((n) => n.startsWith('xl/charts/'))) lost.push(tr('фигуры и надписи'))
  return lost
}

const A1_REF = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/

const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** «B7:C9» → диапазон с нуля */
function a1ToMerge(ref: string): Merge | null {
  const m = A1_REF.exec(ref)
  if (!m) return null
  const c1 = colIndex(m[1])
  const r1 = Number(m[2]) - 1
  return { r1, c1, r2: m[4] ? Number(m[4]) - 1 : r1, c2: m[3] ? colIndex(m[3]) : c1 }
}

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }

type XAnchor = { nativeCol?: number; nativeRow?: number; nativeColOff?: number; nativeRowOff?: number }
const anchorOf = (a: XAnchor): Anchor => ({ col: a.nativeCol ?? 0, row: a.nativeRow ?? 0, colOff: (a.nativeColOff ?? 0) / EMU_PER_PX, rowOff: (a.nativeRowOff ?? 0) / EMU_PER_PX })

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

/** Рисунки листа: картинки превращаются в data-адреса (отдельно освобождать нечего, адрес живёт вместе с данными листа) */
function readImages(wb: Workbook, ws: Worksheet): SheetImage[] {
  const out: SheetImage[] = []
  for (const im of ws.getImages()) {
    const media = wb.getImage(Number(im.imageId)) as unknown as { extension?: string; buffer?: Uint8Array } | undefined
    const range = im.range as unknown as { tl: XAnchor; br?: XAnchor; ext?: { width: number; height: number } }
    if (!media?.buffer || !range?.tl) continue
    const url = toDataUrl(media.buffer, MIME[media.extension ?? 'png'] ?? 'image/png')
    out.push({ id: `${im.imageId}-${out.length}`, url, from: anchorOf(range.tl), ...(range.br ? { to: anchorOf(range.br) } : {}), ...(range.ext ? { width: range.ext.width, height: range.ext.height } : {}) })
  }
  return out
}

/** Сколько строк и колонок надо показать, чтобы рисунок поместился */
function imageExtent(im: SheetImage, defaultCol: number, defaultRow: number): { row: number; col: number } {
  if (im.to) return { row: im.to.row + 1, col: im.to.col + 1 }
  return { row: im.from.row + Math.ceil(((im.height ?? 100) + im.from.rowOff) / defaultRow), col: im.from.col + Math.ceil(((im.width ?? 100) + im.from.colOff) / defaultCol) }
}

type XFilter = string | { from: { row: number; col: number }; to: { row: number; col: number } } | undefined

export async function readXlsx(buf: ArrayBuffer): Promise<LoadedWorkbook> {
  const ExcelJS = await exceljs()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  resetStyleCache()
  const theme = parseTheme((wb.model as unknown as { themes?: Record<string, string> }).themes?.theme1)
  const MERGE = ExcelJS.ValueType.Merge
  const sheets: EditSheet[] = wb.worksheets.map((ws) => {
    const props = ws.properties as unknown as { defaultColWidth?: number; defaultRowHeight?: number }
    const defaultCol = charsToPx(props.defaultColWidth ?? 8.43)
    const defaultRow = Math.round(((props.defaultRowHeight ?? 15) * 96) / 72)

    const grid = new Map<number, Map<number, ECell>>()
    const styles = new Map<number, Map<number, CellStyle>>()
    const locked = new Map<number, number[]>()
    let last = 0
    let width = 0
    let styledRow = 0
    let styledCol = 0
    const maxRow = Math.min(ws.rowCount, 200_000)
    for (let rn = 1; rn <= maxRow; rn++) {
      const row = ws.findRow(rn)
      if (!row) continue
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const st = readCellStyle(cell as unknown as XCell, theme)
        if (st) {
          const m = styles.get(rn - 1) ?? new Map<number, CellStyle>()
          m.set(cn - 1, st)
          styles.set(rn - 1, m)
          if (st.bg || st.borders) {
            styledRow = Math.max(styledRow, rn)
            styledCol = Math.max(styledCol, cn)
          }
        }
        if (cell.type === MERGE) {
          const l = locked.get(rn - 1) ?? []
          l.push(cn - 1)
          locked.set(rn - 1, l)
          return
        }
        const v = cellValue(cell as unknown as { value: CellValue; formula?: string })
        if (v === null || v === '') return
        const r = grid.get(rn - 1) ?? new Map<number, ECell>()
        r.set(cn - 1, v)
        grid.set(rn - 1, r)
        last = Math.max(last, rn)
        width = Math.max(width, cn)
      })
    }

    const images = readImages(wb, ws)
    let imageRow = 0
    let imageCol = 0
    for (const im of images) {
      const e = imageExtent(im, defaultCol, defaultRow)
      imageRow = Math.max(imageRow, e.row)
      imageCol = Math.max(imageCol, e.col)
    }
    // строки и колонки с одним лишь оформлением или рисунком показываем, но не дальше разумного
    const count = Math.max(last, Math.min(Math.max(styledRow, imageRow), Math.max(last + 300, 300)))
    const cols = Math.max(width, Math.min(Math.max(styledCol, imageCol), Math.max(width + 30, 30)), 1)

    const orig: ECell[][] = []
    const rows: EditRow[] = []
    for (let i = 0; i < count; i++) {
      const cells: ECell[] = Array.from({ length: cols }, (_, c) => grid.get(i)?.get(c) ?? null)
      orig.push(cells)
      const l = locked.get(i)
      const st = styles.get(i)
      const xr = ws.findRow(i + 1)
      const rowStyles = st ? Array.from({ length: cols }, (_, c) => st.get(c)) : undefined
      rows.push({
        id: i,
        key: nextKey(),
        cells: cells.slice(),
        ...(l ? { locked: l } : {}),
        ...(rowStyles?.some(Boolean) ? { styles: rowStyles } : {}),
        ...(xr?.height ? { h: Math.round((xr.height * 96) / 72) } : {}),
        ...(xr?.hidden ? { hidden: true } : {}),
      })
    }

    const colWidths: number[] = []
    const hiddenCols: number[] = []
    for (let c = 0; c < cols; c++) {
      const col = ws.getColumn(c + 1)
      if (col.width) colWidths[c] = charsToPx(col.width)
      if (col.hidden) hiddenCols.push(c)
    }
    const filter = ws.autoFilter as unknown as XFilter
    const autoFilter: Merge | null = !filter ? null : typeof filter === 'string' ? a1ToMerge(filter) : { r1: filter.from.row - 1, c1: filter.from.col - 1, r2: filter.to.row - 1, c2: filter.to.col - 1 }
    const merges = ((ws.model as unknown as { merges?: string[] }).merges ?? []).map(a1ToMerge).filter((m): m is Merge => !!m)
    const layout: SheetLayout = { colWidths, hiddenCols, defaultCol, defaultRow, merges, images, autoFilter }
    return { name: ws.name, rows, orig, width: cols, layout }
  })
  return { wb, sheets, lost: lostInXlsx(zipNames(buf)) }
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

function mergesOf(ws: Worksheet): string[] {
  return ((ws.model as unknown as { merges?: string[] }).merges ?? []).slice()
}

const A1 = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/

const colLetters = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/** Объединённые ячейки после сдвига строк; те, что целиком оказались в удалённых строках, пропадают */
function remapMerge(range: string, shift: RowShift | undefined): string | null {
  const m = A1.exec(range)
  if (!m || !shift) return range
  const { map } = shift
  const at = (r: number) => (r - 1 < map.length ? map[r - 1] : r - 1 + (shift.finalLength - map.length))
  let top = at(Number(m[2]))
  let bottom = at(Number(m[4]))
  if (top < 0) top = map.slice(Number(m[2]), Number(m[4])).find((x) => x >= 0) ?? -1
  if (bottom < 0) bottom = [...map.slice(Number(m[2]) - 1, Number(m[4]) - 1)].reverse().find((x) => x >= 0) ?? -1
  if (top < 0 || bottom < 0 || bottom < top) return null
  return `${m[1]}${top + 1}:${m[3]}${bottom + 1}`
}

function toCellValue(v: ECell): CellValue {
  if (v === null || v === undefined || v === '') return null
  if (isFormula(v)) return (v.result === undefined ? { formula: v.formula } : { formula: v.formula, result: v.result as never }) as CellValue
  return v as CellValue
}

/**
 * Вносит правки в открытую книгу: удаляет и добавляет строки (объединённые ячейки сдвигаются вслед за ними),
 * записывает изменённые ячейки, затем формулы с уже сдвинутыми ссылками и пересчитанными значениями.
 */
export function applyEdits(wb: Workbook, sheets: EditSheet[], results?: Map<string, Cell>): void {
  const shifts = buildShifts(sheets)

  if (shifts.size > 0) {
    // общие формулы превращаем в обычные, чтобы их можно было переписать
    for (const ws of wb.worksheets) {
      ws.eachRow({ includeEmpty: false }, (row) =>
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value as unknown
          if (v && typeof v === 'object' && 'sharedFormula' in (v as object)) {
            const f = (cell as unknown as { formula?: string }).formula
            const result = (v as { result?: unknown }).result
            if (f) cell.value = (result === undefined ? { formula: f } : { formula: f, result }) as CellValue
          }
        }),
      )
    }
  }

  for (const s of sheets) {
    const ws = wb.getWorksheet(s.name)
    if (!ws) continue
    const shift = shifts.get(s.name.toLowerCase())
    if (shift) {
      const merges = mergesOf(ws)
      for (const m of merges) ws.unMergeCells(m)
      const kept = new Set(s.rows.filter((r) => r.id >= 0).map((r) => r.id))
      for (let id = s.orig.length - 1; id >= 0; id--) if (!kept.has(id)) ws.spliceRows(id + 1, 1)
      s.rows.forEach((row, index) => {
        if (row.id >= 0) return
        ws.spliceRows(index + 1, 0, [])
        const src = index > 0 ? ws.getRow(index) : undefined
        const dst = ws.getRow(index + 1)
        if (src) {
          if (src.height) dst.height = src.height
          src.eachCell({ includeEmpty: true }, (cell, cn) => {
            dst.getCell(cn).style = JSON.parse(JSON.stringify(cell.style ?? {}))
          })
        }
      })
      for (const m of merges) {
        const r = remapMerge(m, shift)
        if (r) ws.mergeCells(r)
      }
      // рисунки и автофильтр едут вместе со строками
      for (const im of ws.getImages()) {
        const range = im.range as unknown as { tl: XAnchor; br?: XAnchor }
        if (range.tl.nativeRow !== undefined) range.tl.nativeRow = point(range.tl.nativeRow, shift, 'start') ?? range.tl.nativeRow
        if (range.br?.nativeRow !== undefined) range.br.nativeRow = point(range.br.nativeRow, shift, 'end') ?? range.br.nativeRow
      }
      const filter = ws.autoFilter as unknown as XFilter
      if (filter) {
        const text = typeof filter === 'string' ? filter : `${colLetters(filter.from.col)}${filter.from.row}:${colLetters(filter.to.col)}${filter.to.row}`
        const moved = remapMerge(text, shift)
        ws.autoFilter = (moved ?? undefined) as never
      }
    }
    s.rows.forEach((row, index) => {
      const before = row.id >= 0 ? s.orig[row.id] : undefined
      const width = Math.max(row.cells.length, before?.length ?? 0)
      for (let c = 0; c < width; c++) {
        const after = row.cells[c] ?? null
        if (before ? !cellChanged(s, row.id, before[c], after, shifts) : sig(after) === '') continue
        ws.getCell(index + 1, c + 1).value = toCellValue(after)
      }
    })
    // оформление, которое применил пользователь
    s.rows.forEach((row, index) =>
      row.patch?.forEach((patch, c) => {
        if (patch) applyPatchToCell(ws.getCell(index + 1, c + 1) as unknown as XCell, patch)
      }),
    )
  }

  // формулы: ссылки уже сдвинуты в модели, а значения свежие, если их пересчитали; в файле остаются свежими до того, как Excel пересчитает всё сам
  sheets.forEach((s, si) => {
    const ws = wb.getWorksheet(s.name)
    if (!ws) return
    s.rows.forEach((row, index) =>
      row.cells.forEach((cell, c) => {
        if (!isFormula(cell)) return
        const fresh = results?.get(resultKey(si, row.key, c))
        const target = ws.getCell(index + 1, c + 1)
        const cur = target.value as unknown
        const same = !!cur && typeof cur === 'object' && 'formula' in (cur as object) && (cur as { formula: string }).formula === cell.formula
        if (same && fresh === undefined) return
        const value = fresh !== undefined ? fresh : cell.result
        const result = typeof value === 'string' && /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)$/.test(value) ? { error: value } : value
        target.value = (result === undefined || result === null ? { formula: cell.formula } : { formula: cell.formula, result }) as unknown as CellValue
      }),
    )
  })
  wb.calcProperties.fullCalcOnLoad = true
}

export async function writeXlsx(wb: Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf as ArrayBuffer], { type: XLSX_MIME })
}
