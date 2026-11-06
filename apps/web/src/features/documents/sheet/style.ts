// Оформление ячеек Excel: чтение из файла, слияние с правкой пользователя, перевод в CSS.
// Чистая логика без React и exceljs, поэтому проверяется отдельно от экрана.
import type { CSSProperties } from 'react'

export type BorderKind = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair'
export interface BorderSide {
  style: BorderKind
  /** #rrggbb */
  color?: string
}
export interface Borders {
  t?: BorderSide
  r?: BorderSide
  b?: BorderSide
  l?: BorderSide
}

export interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Цвет текста, #rrggbb */
  color?: string
  /** Заливка, #rrggbb */
  bg?: string
  /** Размер шрифта в пунктах */
  size?: number
  font?: string
  h?: 'left' | 'center' | 'right' | 'justify'
  v?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  borders?: Borders
  numFmt?: string
}

type Nullable<T> = { [K in keyof T]?: T[K] | null }
/** Правка пользователя поверх оформления из файла: null — убрать (например, заливку или границу) */
export type StylePatch = Nullable<Omit<CellStyle, 'borders'>> & { borders?: Nullable<Borders> }

const SIDES = ['t', 'r', 'b', 'l'] as const

export function mergeStyle(base: CellStyle | undefined, patch: StylePatch | undefined): CellStyle {
  if (!patch) return base ?? {}
  const out: Record<string, unknown> = { ...(base ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'borders') continue
    if (v === null) delete out[k]
    else if (v !== undefined) out[k] = v
  }
  if (patch.borders) {
    const borders: Borders = { ...(base?.borders ?? {}) }
    for (const side of SIDES) {
      const v = patch.borders[side]
      if (v === null) delete borders[side]
      else if (v) borders[side] = v
    }
    if (Object.keys(borders).length > 0) out.borders = borders
    else delete out.borders
  }
  return out as CellStyle
}

/** Склеивает две правки подряд: вторая важнее */
export function mergePatch(a: StylePatch | undefined, b: StylePatch): StylePatch {
  const out: StylePatch = { ...(a ?? {}), ...b }
  if (a?.borders || b.borders) out.borders = { ...(a?.borders ?? {}), ...(b.borders ?? {}) }
  return out
}

const sameBorder = (a: BorderSide | undefined | null, b: BorderSide | undefined) => (!a && !b) || (!!a && !!b && a.style === b.style && (a.color ?? '') === (b.color ?? ''))

/** Убирает из правки то, что совпадает с оформлением из файла (включил жирный и выключил — правки нет) */
export function normalizePatch(base: CellStyle | undefined, patch: StylePatch): StylePatch | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'borders' || v === undefined) continue
    const before = (base as Record<string, unknown> | undefined)?.[k]
    if ((v === null && before === undefined) || v === before) continue
    out[k] = v
  }
  if (patch.borders) {
    const borders: Nullable<Borders> = {}
    for (const side of SIDES) {
      const v = patch.borders[side]
      if (v === undefined || sameBorder(v, base?.borders?.[side])) continue
      borders[side] = v
    }
    if (Object.keys(borders).length > 0) out.borders = borders
  }
  return Object.keys(out).length > 0 ? (out as StylePatch) : undefined
}

export const isEmptyStyle = (s: CellStyle | undefined) => !s || Object.keys(s).length === 0

// ---------------------------------------------------------------------------
// Цвета
// ---------------------------------------------------------------------------

export interface ColorRef {
  argb?: string
  theme?: number
  tint?: number
  indexed?: number
}

// стандартная палитра Excel для индексных цветов
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
]

/** Тема по умолчанию (Office 2013+), если в файле темы нет */
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72']

/** Цвета темы файла в том порядке, в каком на них ссылается Excel: светлый 1, тёмный 1, светлый 2, тёмный 2, акценты 1–6, ссылки */
export function parseTheme(xml: string | undefined): string[] {
  if (!xml) return DEFAULT_THEME
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0]
  if (!scheme) return DEFAULT_THEME
  const pick = (name: string) => {
    const block = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme)?.[1] ?? ''
    return /srgbClr val="([0-9A-Fa-f]{6})"/.exec(block)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(block)?.[1]
  }
  const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
  return names.map((n, i) => pick(n) ?? DEFAULT_THEME[i])
}

function applyTint(hex: string, tint: number): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const hue = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    return tt < 1 / 6 ? p + (q - p) * 6 * tt : tt < 1 / 2 ? q : tt < 2 / 3 ? p + (q - p) * (2 / 3 - tt) * 6 : p
  }
  let rr = l
  let gg = l
  let bb = l
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    rr = hue(p, q, h + 1 / 3)
    gg = hue(p, q, h)
    bb = hue(p, q, h - 1 / 3)
  }
  const to = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')
  return `${to(rr)}${to(gg)}${to(bb)}`
}

/** Цвет из файла → #rrggbb; undefined — «авто» (цвет по умолчанию) */
export function resolveColor(c: ColorRef | undefined, theme: string[]): string | undefined {
  if (!c) return undefined
  let hex: string | undefined
  if (c.argb) hex = c.argb.length === 8 ? c.argb.slice(2) : c.argb
  else if (c.theme !== undefined) hex = theme[c.theme]
  else if (c.indexed !== undefined) hex = c.indexed >= 64 ? undefined : INDEXED[c.indexed]
  if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return undefined
  if (c.tint) hex = applyTint(hex, c.tint)
  return `#${hex.toLowerCase()}`
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export const DEFAULT_FONT_PT = 11
const PX_PER_PT = 96 / 72

const FONT_STACK = 'Calibri, Carlito, "Segoe UI", system-ui, sans-serif'

export function styleCss(s: CellStyle): CSSProperties {
  const css: CSSProperties = { fontFamily: s.font ? `"${s.font}", ${FONT_STACK}` : FONT_STACK, fontSize: `${(s.size ?? DEFAULT_FONT_PT) * PX_PER_PT}px` }
  if (s.bold) css.fontWeight = 700
  if (s.italic) css.fontStyle = 'italic'
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  if (deco) css.textDecoration = deco
  if (s.color) css.color = s.color
  if (s.bg) css.backgroundColor = s.bg
  return css
}

const BORDER_CSS: Record<BorderKind, [number, string]> = {
  thin: [1, 'solid'],
  medium: [2, 'solid'],
  thick: [3, 'solid'],
  dashed: [1, 'dashed'],
  dotted: [1, 'dotted'],
  double: [3, 'double'],
  hair: [1, 'dotted'],
}

export function borderCss(b: BorderSide | undefined): string | undefined {
  if (!b) return undefined
  const [w, kind] = BORDER_CSS[b.style] ?? BORDER_CSS.thin
  return `${w}px ${kind} ${b.color ?? '#000000'}`
}

/** Размер шрифта в пикселях (для оценки ширины текста) */
export const fontPx = (s: CellStyle) => (s.size ?? DEFAULT_FONT_PT) * PX_PER_PT
