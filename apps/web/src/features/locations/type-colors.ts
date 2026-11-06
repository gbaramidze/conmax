// Цвет типа номера: стабильный по месту названия в алфавитном списке всех типов проекта, чтобы на плитках этажей и в дереве
// один тип всегда был одного цвета; помещения без типа — серые. Оттенок идёт «золотым углом» (137,5°), поэтому соседние
// по алфавиту типы заметно различаются, а светлота чередуется — цветов хватает на любое число типов.
export const NO_TYPE_COLOR = '#94a3b8'

/** Функция «название типа → цвет» по списку всех типов проекта. */
export function typeColors(typeNames: string[]): (name: string | null | undefined) => string {
  const sorted = [...new Set(typeNames)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return (name) => {
    if (!name) return NO_TYPE_COLOR
    const i = Math.max(sorted.indexOf(name), 0)
    return `hsl(${Math.round((220 + i * 137.508) % 360)} ${i % 2 ? 62 : 72}% ${i % 3 === 1 ? 38 : i % 3 === 2 ? 46 : 52}%)`
  }
}
