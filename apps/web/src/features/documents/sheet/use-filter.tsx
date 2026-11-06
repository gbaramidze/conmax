import { useMemo, useState, type ReactNode } from 'react'
import type { EditSheet } from '../edit/sheet-model'
import { columnValues, filterRange, visibleRows, type FilterRange, type FilterState, type SortState } from './filter'
import { FilterButton } from './filter-menu'

export interface SheetFilter {
  /** Фильтры включены (по умолчанию выключены: кнопка «Фильтры» включает) */
  on: boolean
  setOn: (on: boolean) => void
  /** В таблице есть что фильтровать (кнопка показывается только тогда) */
  available: boolean
  range: FilterRange | null
  /** Строки, которые показываются */
  rows: number[]
  /** Сколько колонок отфильтровано */
  active: number
  clear: () => void
  /** Кнопка фильтра для ячейки шапки или ничего */
  extra: (r: number, c: number) => ReactNode
}

/**
 * Фильтры листа: выключены, пока их не включат кнопкой. Диапазон берётся из файла, а если автофильтра там нет, строится по шапке таблицы.
 * text — как значение ячейки выглядит на экране; textKey меняется, когда меняются показанные значения.
 */
export function useSheetFilter(sheet: EditSheet, text: (r: number, c: number) => string, textKey: unknown, allowSort: boolean): SheetFilter {
  const [on, setOn] = useState(false)
  const [state, setState] = useState<FilterState>({})
  const [sort, setSort] = useState<SortState | null>(null)

  const candidate = useMemo(() => filterRange(sheet), [sheet])
  const range = on ? candidate : null
  const rows = useMemo(
    () => visibleRows(sheet, { range, state, sort: allowSort ? sort : null, text }),
    // text меняется при каждой отрисовке; о смене значений говорит textKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, range, state, sort, allowSort, textKey],
  )

  return {
    on,
    setOn,
    available: !!candidate,
    range,
    rows,
    active: Object.values(state).filter((s) => s.size > 0).length,
    clear: () => {
      setState({})
      setSort(null)
    },
    extra: (r, c) => {
      if (!range || r !== range.header || c < range.c1 || c > range.c2) return null
      return (
        <FilterButton
          col={c}
          getValues={() => columnValues(sheet, range, c, state, text)}
          excluded={state[c]}
          onChange={(set) => setState((s) => ({ ...s, [c]: set }))}
          sort={sort?.c === c ? { dir: sort.dir } : null}
          onSort={allowSort ? (dir) => setSort(dir === null ? null : { c, dir }) : undefined}
        />
      )
    },
  }
}
