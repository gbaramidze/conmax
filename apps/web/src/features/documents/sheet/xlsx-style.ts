// Оформление ячейки exceljs ⇄ наша модель CellStyle. Читается весь стиль, записывается только то, что поменял пользователь.
import { resolveColor, type BorderKind, type BorderSide, type CellStyle, type ColorRef, type StylePatch } from './style'

/** То, что нам нужно от ячейки exceljs (типы библиотеки здесь слишком строгие) */
export interface XCell {
  font?: Record<string, unknown>
  fill?: Record<string, unknown>
  border?: Record<string, unknown>
  alignment?: Record<string, unknown>
  numFmt?: string
}

type XBorder = { style?: string; color?: ColorRef } | undefined

function borderSide(b: XBorder, theme: string[]): BorderSide | undefined {
  if (!b?.style) return undefined
  const s = b.style
  const style: BorderKind = s.includes('Dash') || s.includes('dash') || s === 'dashDot' ? 'dashed' : s.includes('ot') && s !== 'double' ? 'dotted' : s === 'hair' ? 'hair' : s.includes('medium') ? 'medium' : s === 'thick' ? 'thick' : s === 'double' ? 'double' : 'thin'
  return { style, color: resolveColor(b.color, theme) ?? '#000000' }
}

const cache = new Map<string, CellStyle | undefined>()

export const resetStyleCache = () => cache.clear()

/** Оформление ячейки из файла; одинаковые стили возвращаются одним и тем же объектом */
export function readCellStyle(cell: XCell, theme: string[]): CellStyle | undefined {
  const f = cell.font as { bold?: boolean; italic?: boolean; underline?: unknown; strike?: boolean; color?: ColorRef; size?: number; name?: string } | undefined
  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: ColorRef } | undefined
  const a = cell.alignment as { horizontal?: string; vertical?: string; wrapText?: boolean } | undefined
  const b = cell.border as Record<'top' | 'right' | 'bottom' | 'left', XBorder> | undefined
  const key = JSON.stringify([f, fill, a, b, cell.numFmt])
  if (cache.has(key)) return cache.get(key)

  const s: CellStyle = {}
  if (f) {
    if (f.bold) s.bold = true
    if (f.italic) s.italic = true
    if (f.underline) s.underline = true
    if (f.strike) s.strike = true
    const color = resolveColor(f.color, theme)
    if (color && color !== '#000000') s.color = color
    if (f.size && f.size !== 11) s.size = f.size
    if (f.name && f.name !== 'Calibri') s.font = f.name
  }
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = resolveColor(fill.fgColor, theme)
    if (bg && bg !== '#ffffff') s.bg = bg
  }
  if (a) {
    if (a.horizontal === 'left' || a.horizontal === 'center' || a.horizontal === 'right' || a.horizontal === 'justify') s.h = a.horizontal
    else if (a.horizontal === 'centerContinuous') s.h = 'center'
    if (a.vertical === 'top') s.v = 'top'
    else if (a.vertical === 'middle' || a.vertical === 'center') s.v = 'middle'
    else if (a.vertical === 'bottom') s.v = 'bottom'
    if (a.wrapText) s.wrap = true
  }
  if (b) {
    const borders = { t: borderSide(b.top, theme), r: borderSide(b.right, theme), b: borderSide(b.bottom, theme), l: borderSide(b.left, theme) }
    for (const k of ['t', 'r', 'b', 'l'] as const) if (!borders[k]) delete borders[k]
    if (Object.keys(borders).length > 0) s.borders = borders
  }
  if (cell.numFmt && cell.numFmt !== 'General') s.numFmt = cell.numFmt

  const out = Object.keys(s).length > 0 ? s : undefined
  cache.set(key, out)
  return out
}

const argb = (hex: string) => ({ argb: `FF${hex.replace('#', '').toUpperCase()}` })

/** Записывает в ячейку exceljs только то, что в правке; остальное оформление ячейки не трогается */
export function applyPatchToCell(cell: XCell, patch: StylePatch): void {
  const c = cell as { font?: unknown; fill?: unknown; border?: unknown; alignment?: unknown; numFmt?: string; style?: unknown }
  // у ячеек с одинаковым стилем exceljs хранит один общий объект: даём этой ячейке собственный, иначе правка заденет соседей
  c.style = JSON.parse(JSON.stringify(c.style ?? {}))

  if ('bold' in patch || 'italic' in patch || 'underline' in patch || 'strike' in patch || 'color' in patch || 'size' in patch || 'font' in patch) {
    const font: Record<string, unknown> = { ...(cell.font ?? {}) }
    if ('bold' in patch) font.bold = !!patch.bold
    if ('italic' in patch) font.italic = !!patch.italic
    if ('underline' in patch) font.underline = patch.underline ? true : false
    if ('strike' in patch) font.strike = !!patch.strike
    if ('color' in patch) {
      if (patch.color) font.color = argb(patch.color)
      else delete font.color
    }
    if ('size' in patch) {
      if (patch.size) font.size = patch.size
      else delete font.size
    }
    if ('font' in patch) {
      if (patch.font) font.name = patch.font
      else delete font.name
    }
    c.font = font
  }

  if ('bg' in patch) c.fill = patch.bg ? { type: 'pattern', pattern: 'solid', fgColor: argb(patch.bg) } : { type: 'pattern', pattern: 'none' }

  if ('h' in patch || 'v' in patch || 'wrap' in patch) {
    const al: Record<string, unknown> = { ...(cell.alignment ?? {}) }
    if ('h' in patch) {
      if (patch.h) al.horizontal = patch.h
      else delete al.horizontal
    }
    if ('v' in patch) {
      if (patch.v) al.vertical = patch.v
      else delete al.vertical
    }
    if ('wrap' in patch) al.wrapText = !!patch.wrap
    c.alignment = al
  }

  if (patch.borders) {
    const border: Record<string, unknown> = { ...(cell.border ?? {}) }
    const names = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const
    for (const k of ['t', 'r', 'b', 'l'] as const) {
      const v = patch.borders[k]
      if (v === undefined) continue
      if (v === null) delete border[names[k]]
      else border[names[k]] = { style: v.style, ...(v.color ? { color: argb(v.color) } : {}) }
    }
    c.border = border
  }

  if ('numFmt' in patch) c.numFmt = patch.numFmt ?? 'General'
}
