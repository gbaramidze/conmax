// Раскладка листа Excel: ширины колонок, объединённые ячейки, рисунки, автофильтр.
// Строки здесь указаны номерами исходного листа (с 0): при вставке и удалении строк положение считается заново по карте строк.

export interface Merge {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** Угол рисунка: колонка и строка исходного листа и смещение внутри ячейки в пикселях */
export interface Anchor {
  col: number
  row: number
  colOff: number
  rowOff: number
}

export interface SheetImage {
  id: string
  /** Адрес картинки (data:) */
  url: string
  from: Anchor
  /** Правый нижний угол (у рисунка «с привязкой к ячейкам»); иначе берутся width и height */
  to?: Anchor
  width?: number
  height?: number
}

export interface SheetLayout {
  /** Ширины колонок в пикселях; не указанные — defaultCol */
  colWidths: number[]
  hiddenCols: number[]
  defaultCol: number
  /** Высота строки по умолчанию в пикселях */
  defaultRow: number
  merges: Merge[]
  images: SheetImage[]
  /** Диапазон автофильтра из файла */
  autoFilter: Merge | null
}

export const DEFAULT_COL_PX = 64
export const DEFAULT_ROW_PX = 20

export const EMPTY_LAYOUT: SheetLayout = { colWidths: [], hiddenCols: [], defaultCol: 96, defaultRow: DEFAULT_ROW_PX, merges: [], images: [], autoFilter: null }

export const colPx = (layout: SheetLayout, c: number) => (layout.hiddenCols.includes(c) ? 0 : (layout.colWidths[c] ?? layout.defaultCol))

/** Ширина колонки в символах Excel → пиксели (для шрифта Calibri 11) */
export const charsToPx = (chars: number) => Math.round(chars * 7 + 5)

export const EMU_PER_PX = 9525
