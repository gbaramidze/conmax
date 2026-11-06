// Сдвиг ссылок в формулах Excel, когда в листе добавили или убрали строки.
// exceljs при вставке и удалении строк формулы не трогает, поэтому ссылки пересчитываем сами (как это делает Excel).

/** Карта строк листа: map[исходная строка (с 0)] = новая строка (с 0) или -1, если строку удалили */
export interface RowShift {
  map: number[]
  /** Сколько строк стало в листе (включая добавленные) */
  finalLength: number
}

const REF = /"(?:[^"]|"")*"|(?<![\p{L}\p{N}_.$])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![\p{L}\p{N}_(])/gu

/** Новое положение строки idx (с 0); для начала диапазона удалённая строка заменяется следующей, для конца — предыдущей; null — строки больше нет */
export function point(idx: number, shift: RowShift, role: 'single' | 'start' | 'end'): number | null {
  const { map } = shift
  if (idx >= map.length) return idx + (shift.finalLength - map.length)
  if (map[idx] >= 0) return map[idx]
  if (role === 'start') {
    for (let j = idx + 1; j < map.length; j++) if (map[j] >= 0) return map[j]
  } else if (role === 'end') {
    for (let j = idx - 1; j >= 0; j--) if (map[j] >= 0) return map[j]
  }
  return null
}

/**
 * Пересчитывает ссылки формулы на строки листов, которые изменились. Ссылки без имени листа относятся к листу самой формулы.
 * Если ссылаемая строка удалена, ссылка становится #REF!, как в Excel.
 */
export function shiftFormula(formula: string, ownSheet: string, shifts: Map<string, RowShift>): string {
  const key = (s: string) => s.toLowerCase()
  return formula.replace(REF, (all, quoted: string | undefined, bare: string | undefined, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
    if (all.startsWith('"')) return all
    const sheetName = quoted !== undefined ? quoted.replace(/''/g, "'") : (bare ?? ownSheet)
    const shift = shifts.get(key(sheetName))
    if (!shift) return all
    const prefix = quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
    if (r2 === undefined) {
      const row = point(Number(r1) - 1, shift, 'single')
      return row === null ? `${prefix}#REF!` : `${prefix}${d1}${c1}${d2}${row + 1}`
    }
    const start = point(Number(r1) - 1, shift, 'start')
    const end = point(Number(r2) - 1, shift, 'end')
    if (start === null || end === null || start > end) return `${prefix}#REF!`
    return `${prefix}${d1}${c1}${d2}${start + 1}:${d3}${c2}${d4}${end + 1}`
  })
}
