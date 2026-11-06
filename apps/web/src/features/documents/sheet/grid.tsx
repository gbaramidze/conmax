import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { colName, displayMerges, isFormula, plain, styleOf, type ECell, type EditSheet } from '../edit/sheet-model'
import { colPx, type SheetImage } from './layout'
import { formatValue } from './numfmt'
import { borderCss, fontPx, styleCss, type CellStyle } from './style'

export const ROW_HEADER_W = 44
export const COL_HEADER_H = 22
const GRID_LINE = '1px solid #e2e8f0'

/** Выделение: прямоугольник и активная ячейка (индексы строк и колонок листа) */
export interface GridSelection {
  r1: number
  c1: number
  r2: number
  c2: number
  r: number
  c: number
}

export interface SheetGridProps {
  sheet: EditSheet
  /** Индексы показываемых строк по порядку (после фильтров и подгрузки) */
  rows: number[]
  /** Значение ячейки с пересчитанным результатом формулы */
  valueAt: (r: number, c: number) => ECell
  /** Только просмотр: длинный текст может занять соседние пустые ячейки, как в Excel */
  readOnly?: boolean
  selection?: GridSelection | null
  /** Ячейка, в которой сейчас стоит поле ввода */
  editing?: { r: number; c: number } | null
  renderEditor?: (r: number, c: number) => ReactNode
  onCellDown?: (r: number, c: number, e: MouseEvent) => void
  onCellEnter?: (r: number, c: number, e: MouseEvent) => void
  onCellDouble?: (r: number, c: number) => void
  onRowHeader?: (r: number, e: MouseEvent) => void
  onColHeader?: (c: number, e: MouseEvent) => void
  /** Ячейка изменена пользователем (подсвечивается) */
  modified?: (r: number, c: number) => boolean
  /** Дополнение справа в ячейке (кнопка фильтра в шапке) */
  cellExtra?: (r: number, c: number) => ReactNode
}

interface Spot {
  left: number
  top: number
  width: number
  height: number
}

/** Как значение ячейки выглядит на экране: формат из файла, а у формулы без значения — сама формула */
export function displayText(v: ECell, st: CellStyle): string {
  if (isFormula(v) && v.result === undefined) return `=${v.formula}`
  return formatValue(plain(v), st.numFmt)
}

/** Лист как в Excel: ширины колонок и высоты строк из файла, заливка, шрифты, границы, объединённые ячейки, рисунки */
export function SheetGrid({ sheet, rows, valueAt, readOnly, selection, editing, renderEditor, onCellDown, onCellEnter, onCellDouble, onRowHeader, onColHeader, modified, cellExtra }: SheetGridProps) {
  const layout = sheet.layout
  const cols = useMemo(() => Array.from({ length: sheet.width }, (_, c) => c).filter((c) => !layout.hiddenCols.includes(c)), [sheet.width, layout.hiddenCols])
  const colLeft = useMemo(() => {
    const left = new Map<number, number>()
    let x = 0
    for (const c of cols) {
      left.set(c, x)
      x += colPx(layout, c)
    }
    return { left, total: x }
  }, [cols, layout])

  const rowHeight = (r: number) => sheet.rows[r]?.h ?? layout.defaultRow
  const rowTop = useMemo(() => {
    const top = new Map<number, number>()
    let y = 0
    for (const r of rows) {
      top.set(r, y)
      y += sheet.rows[r]?.h ?? layout.defaultRow
    }
    return { top, total: y }
  }, [rows, sheet.rows, layout.defaultRow])
  const idIndex = useMemo(() => {
    const m = new Map<number, number>()
    sheet.rows.forEach((row, i) => {
      if (row.id >= 0) m.set(row.id, i)
    })
    return m
  }, [sheet.rows])

  // объединённые ячейки: в каком видимом ряду стоит главная ячейка и сколько рядов занимает
  const merges = useMemo(() => {
    const visible = new Set(rows)
    const cover = new Map<string, { r1: number; c1: number; r2: number; c2: number; first: number; rowSpan: number; colSpan: number }>()
    for (const m of displayMerges(sheet)) {
      const vis: number[] = []
      for (let r = m.r1; r <= m.r2; r++) if (visible.has(r)) vis.push(r)
      if (vis.length === 0) continue
      const colSpan = cols.filter((c) => c >= m.c1 && c <= m.c2).length
      const info = { ...m, first: vis[0], rowSpan: vis.length, colSpan: Math.max(1, colSpan) }
      for (const r of vis) for (let c = m.c1; c <= m.c2; c++) cover.set(`${r}:${c}`, info)
    }
    return cover
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.rows, sheet.layout.merges, rows, cols])

  const inSel = (r: number, c: number) => !!selection && r >= selection.r1 && r <= selection.r2 && c >= selection.c1 && c <= selection.c2

  function renderRow(r: number, i: number) {
    const row = sheet.rows[r]
    const h = rowHeight(r)
    const next = rows[i + 1]
    const tds: ReactNode[] = []
    let skip = 0
    cols.forEach((c, ci) => {
      if (skip > 0) {
        skip--
        return
      }
      const m = merges.get(`${r}:${c}`)
      if (m && (m.first !== r || m.c1 !== c)) return
      const dr = m ? m.r1 : r
      const dc = m ? m.c1 : c
      const drow = sheet.rows[dr]
      const st = styleOf(drow, dc)
      const v = valueAt(dr, dc)
      const shown = displayText(v, st)
      const p = plain(v)

      let colSpan = m ? m.colSpan : 1
      const rowSpan = m ? m.rowSpan : 1
      // длинный текст занимает соседние пустые ячейки справа (только в просмотре)
      if (readOnly && !m && typeof p === 'string' && !st.wrap && (!st.h || st.h === 'left') && shown.length > 3) {
        const need = shown.length * fontPx(st) * 0.5 + 8
        let have = colPx(layout, c)
        while (have < need && ci + colSpan < cols.length) {
          const nc = cols[ci + colSpan]
          const nv = drow?.cells[nc]
          const nst = styleOf(drow, nc)
          if ((nv !== null && nv !== undefined && nv !== '') || nst.bg) break
          have += colPx(layout, nc)
          colSpan++
        }
        skip = colSpan - 1
      } else if (m) skip = colSpan - 1

      const nextCol = cols[ci + colSpan]
      // общая граница двух ячеек рисуется один раз: своя правая/нижняя или левая/верхняя у соседа
      const right = st.borders?.r ?? (nextCol !== undefined ? styleOf(sheet.rows[dr], nextCol).borders?.l : undefined)
      const bottomRow = m ? m.r2 + 1 : next
      const bottom = st.borders?.b ?? (bottomRow !== undefined ? styleOf(sheet.rows[bottomRow], dc).borders?.t : undefined)
      const top = i === 0 ? st.borders?.t : undefined
      const left = ci === 0 ? st.borders?.l : undefined

      const align = st.h ?? (typeof p === 'number' || p instanceof Date ? 'right' : typeof p === 'boolean' || (typeof p === 'string' && /^#[A-Z/0!?]+$/.test(p)) ? 'center' : 'left')
      const sel = inSel(r, c)
      const active = selection && selection.r === r && selection.c === c
      const shadows: string[] = []
      if (sel && !active) shadows.push('inset 0 0 0 9999px rgba(59,130,246,0.16)')
      if (modified?.(dr, dc)) shadows.push('inset 0 0 0 9999px rgba(245,158,11,0.28)')
      if (!m && sheet.rows[r]?.id < 0) shadows.push('inset 0 0 0 9999px rgba(16,185,129,0.14)')

      const css: CSSProperties = {
        height: h,
        padding: 0,
        position: 'relative',
        background: st.bg,
        borderRight: borderCss(right) ?? GRID_LINE,
        borderBottom: borderCss(bottom) ?? GRID_LINE,
        ...(top ? { borderTop: borderCss(top) } : {}),
        ...(left ? { borderLeft: borderCss(left) } : {}),
        ...(shadows.length > 0 ? { boxShadow: shadows.join(',') } : {}),
        ...(active ? { outline: '2px solid #2563eb', outlineOffset: -2 } : {}),
      }
      const isEditing = !!editing && editing.r === r && editing.c === c
      tds.push(
        <td
          key={c}
          role="gridcell"
          aria-selected={!!sel}
          data-cell={`${r}:${c}`}
          colSpan={colSpan > 1 ? colSpan : undefined}
          rowSpan={rowSpan > 1 ? rowSpan : undefined}
          style={css}
          className="scroll-ml-12 scroll-mt-8"
          onMouseDown={onCellDown ? (e) => onCellDown(r, c, e) : undefined}
          onMouseEnter={onCellEnter ? (e) => onCellEnter(r, c, e) : undefined}
          onDoubleClick={onCellDouble ? () => onCellDouble(r, c) : undefined}
        >
          <div
            className="absolute inset-0 flex overflow-hidden px-[3px]"
            style={{
              ...styleCss(st),
              alignItems: st.v === 'top' ? 'flex-start' : st.v === 'middle' ? 'center' : 'flex-end',
              justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
              lineHeight: 1.25,
            }}
          >
            <span
              className="min-w-0"
              style={{ whiteSpace: st.wrap ? 'pre-wrap' : 'pre', textAlign: align === 'justify' ? 'justify' : align, overflow: 'hidden', wordBreak: st.wrap ? 'break-word' : undefined, maxWidth: '100%' }}
              title={isFormula(valueAt(dr, dc)) ? `=${(valueAt(dr, dc) as { formula: string }).formula}` : undefined}
            >
              {shown}
            </span>
          </div>
          {cellExtra && <span className="absolute right-0.5 top-1/2 z-[3] -translate-y-1/2">{cellExtra(r, c)}</span>}
          {isEditing && renderEditor?.(r, c)}
        </td>,
      )
    })

    return (
      <tr key={row.key} style={{ height: h }}>
        <th
          onMouseDown={onRowHeader ? (e) => onRowHeader(r, e) : undefined}
          className={`sticky left-0 z-10 select-none border-b border-r border-slate-300 bg-slate-100 px-1 text-right text-[11px] font-normal tabular-nums ${selection && r >= selection.r1 && r <= selection.r2 ? 'bg-slate-300 text-slate-900' : 'text-slate-500'} ${onRowHeader ? 'cursor-pointer' : ''}`}
          style={{ height: h, width: ROW_HEADER_W }}
        >
          {r + 1}
        </th>
        {tds}
      </tr>
    )
  }

  /** Где на листе стоит рисунок: по строкам из файла, но с учётом вставленных и убранных строк */
  function place(im: SheetImage): Spot | null {
    const colX = (col: number, off: number) => {
      const left = colLeft.left.get(col)
      if (left !== undefined) return left + off
      if (col >= sheet.width) return colLeft.total + (col - sheet.width) * layout.defaultCol + off
      return null
    }
    const rowY = (id: number, off: number) => {
      const idx = idIndex.get(id)
      if (idx === undefined) return null
      const top = rowTop.top.get(idx)
      return top === undefined ? null : top + off
    }
    const x = colX(im.from.col, im.from.colOff)
    const y = rowY(im.from.row, im.from.rowOff)
    if (x === null || y === null) return null
    let w = im.width ?? 0
    let hgt = im.height ?? 0
    if (im.to) {
      const x2 = colX(im.to.col, im.to.colOff)
      const y2 = rowY(im.to.row, im.to.rowOff)
      if (x2 !== null && x2 > x) w = x2 - x
      if (y2 !== null && y2 > y) hgt = y2 - y
    }
    if (!w || !hgt) return null
    return { left: ROW_HEADER_W + x, top: COL_HEADER_H + y, width: w, height: hgt }
  }

  const totalWidth = ROW_HEADER_W + colLeft.total
  return (
    <div className="relative bg-white text-neutral-900" style={{ width: totalWidth, minHeight: COL_HEADER_H + rowTop.total, colorScheme: 'light' }}>
      <table className="border-separate border-spacing-0" style={{ tableLayout: 'fixed', width: totalWidth }}>
        <colgroup>
          <col style={{ width: ROW_HEADER_W }} />
          {cols.map((c) => (
            <col key={c} style={{ width: colPx(layout, c) }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: COL_HEADER_H }}>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-slate-300 bg-slate-100" style={{ height: COL_HEADER_H }} />
            {cols.map((c) => (
              <th
                key={c}
                onMouseDown={onColHeader ? (e) => onColHeader(c, e) : undefined}
                className={`sticky top-0 z-20 select-none border-b border-r border-slate-300 px-1 text-center text-[11px] font-normal ${selection && c >= selection.c1 && c <= selection.c2 ? 'bg-slate-300 text-slate-900' : 'bg-slate-100 text-slate-500'} ${onColHeader ? 'cursor-pointer' : ''}`}
                style={{ height: COL_HEADER_H }}
              >
                {colName(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map((r, i) => renderRow(r, i))}</tbody>
      </table>
      {layout.images.map((im) => {
        const spot = place(im)
        return spot ? <img key={im.id} src={im.url} alt="" draggable={false} className="pointer-events-none absolute select-none object-fill" style={{ ...spot, zIndex: 4 }} /> : null
      })}
    </div>
  )
}
