import { Link } from '@tanstack/react-router'
import type { FfeItem, RoomFfe } from '@/features/ffe/api'
import type { LocationRow } from '@/features/locations/api'
import { tr } from '@/lib/tr'

export type MatrixBy = 'floor' | 'type'

export interface MatrixColumn {
  key: string
  label: string
  path?: string
}

export interface MatrixRow {
  item: FfeItem
  cells: Map<string, number>
  total: number
}

export interface MatrixData {
  columns: MatrixColumn[]
  rows: MatrixRow[]
  columnTotals: Map<string, number>
  grandTotal: number
}

/** Позиции × этажи или позиции × типы номеров: сколько чего и где. */
export function buildMatrix(input: { lines: RoomFfe[]; itemById: Map<string, FfeItem>; locById: Map<string, LocationRow>; typeName: Map<string, string>; by: MatrixBy }): MatrixData {
  const { lines, itemById, locById, typeName, by } = input
  const columns = new Map<string, MatrixColumn & { order: number }>()
  const rows = new Map<string, MatrixRow>()
  const columnTotals = new Map<string, number>()
  let grandTotal = 0
  for (const l of lines) {
    const item = itemById.get(l.item_id)
    const room = locById.get(l.location_id)
    if (!item || !room) continue
    let key: string
    if (by === 'floor') {
      const floor = room.parent_id ? locById.get(room.parent_id) : undefined
      key = floor?.id ?? '-'
      if (!columns.has(key) && floor) columns.set(key, { key, label: floor.name.replace(/^Этаж\s*/i, '') || floor.code, path: floor.path, order: floor.sort })
    } else {
      const t = typeName.get(l.location_id) ?? ''
      key = t || '-'
      if (!columns.has(key)) columns.set(key, { key, label: t || tr('Без типа'), order: 0 })
    }
    const row = rows.get(item.id) ?? { item, cells: new Map<string, number>(), total: 0 }
    row.cells.set(key, (row.cells.get(key) ?? 0) + l.qty)
    row.total += l.qty
    rows.set(item.id, row)
    columnTotals.set(key, (columnTotals.get(key) ?? 0) + l.qty)
    grandTotal += l.qty
  }
  const cols = [...columns.values()].sort((a, b) => (by === 'floor' ? a.order - b.order : a.label.localeCompare(b.label, undefined, { numeric: true })))
  return {
    columns: cols,
    rows: [...rows.values()].sort((a, b) => a.item.code.localeCompare(b.item.code, undefined, { numeric: true })),
    columnTotals,
    grandTotal,
  }
}

export function MatrixTable({ data, by, code }: { data: MatrixData; by: MatrixBy; code: string }) {
  return (
    <div className="max-h-[70svh] overflow-auto rounded-lg border bg-card shadow-soft">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 min-w-56 border-b bg-muted px-3 py-2 text-left font-medium">{tr('Позиция')}</th>
            <th className="sticky top-0 z-10 border-b bg-muted px-2 py-2 text-right font-medium">{tr('Всего')}</th>
            {data.columns.map((c) => (
              <th key={c.key} className="sticky top-0 z-10 whitespace-nowrap border-b bg-muted px-2 py-2 text-right font-medium" title={by === 'floor' ? tr('Этаж {{n}}', { n: c.label }) : c.label}>
                {c.path && by === 'floor' ? (
                  <Link to="/projects/$code/locations/$path" params={{ code, path: c.path }} className="hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.item.id} className="group">
              <td className="sticky left-0 z-10 border-b bg-card px-3 py-1.5 group-hover:bg-muted">
                <span className="ident mr-2 text-xs text-muted-foreground">{r.item.code}</span>
                {r.item.name !== r.item.code && r.item.name}
              </td>
              <td className="border-b bg-muted/30 px-2 py-1.5 text-right font-semibold tabular-nums group-hover:bg-muted">{r.total}</td>
              {data.columns.map((c) => {
                const n = r.cells.get(c.key)
                return (
                  <td key={c.key} className={`border-b px-2 py-1.5 text-right tabular-nums group-hover:bg-muted ${n ? '' : 'text-muted-foreground/40'}`}>
                    {n ?? '·'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky bottom-0 left-0 z-20 border-t bg-muted px-3 py-2 font-semibold">{tr('Итого')}</td>
            <td className="sticky bottom-0 z-10 border-t bg-muted px-2 py-2 text-right font-semibold tabular-nums">{data.grandTotal}</td>
            {data.columns.map((c) => (
              <td key={c.key} className="sticky bottom-0 z-10 border-t bg-muted px-2 py-2 text-right font-semibold tabular-nums">
                {data.columnTotals.get(c.key) ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
