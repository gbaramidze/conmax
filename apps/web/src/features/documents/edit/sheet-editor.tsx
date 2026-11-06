import { tr } from '@/lib/tr'
import { Filter, FilterX, Paintbrush, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import type { Workbook } from 'exceljs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SheetGrid, displayText, type GridSelection } from '../sheet/grid'
import { colPx } from '../sheet/layout'
import type { StylePatch } from '../sheet/style'
import { useSheetFilter } from '../sheet/use-filter'
import { createRecalc, resultKey, type Recalc, type RecalcResult } from './recalc'
import {
  colName,
  deleteRowAt,
  insertRowAt,
  isFormula,
  parseInput,
  patchCells,
  rawText,
  resetPatch,
  setCell,
  sig,
  styleOf,
  summarizeSheets,
  type ECell,
  type EditSheet,
} from './sheet-model'
import { StyleToolbar } from './style-toolbar'
import { writeCsv, type CsvMeta } from './text-io'
import type { EditorHost } from './types'
import { applyEdits, writeXlsx, XLSX_MIME } from './xlsx-io'

export type SheetSource = { kind: 'xlsx'; wb: Workbook; sheets: EditSheet[]; lost: string[] } | { kind: 'csv'; sheet: EditSheet; meta: CsvMeta }

const PAGE = 500
const HISTORY = 100
interface Pos {
  r: number
  c: number
}
interface Editing extends Pos {
  text: string
  /** Правят в строке значения над таблицей, а не в самой ячейке */
  inBar?: boolean
}

/**
 * Правка таблицы на месте. Лист выглядит как в Excel (стили, ширины, рисунки, фильтры); ячейки правятся набором или двойным щелчком,
 * к выделенным ячейкам применяется оформление. Enter и Tab подтверждают, Esc отменяет ввод, шаг назад — кнопкой или Ctrl+Z.
 */
export function SheetEditor({ source, host }: { source: SheetSource; host: EditorHost }) {
  const csv = source.kind === 'csv'
  const initial = useMemo(() => (source.kind === 'xlsx' ? source.sheets : [source.sheet]), [source])
  const [sheets, setSheets] = useState<EditSheet[]>(initial)
  const sheetsRef = useRef(initial)
  const [past, setPast] = useState<EditSheet[][]>([])
  const [future, setFuture] = useState<EditSheet[][]>([])
  const [active, setActive] = useState(0)

  const sheetIdx = Math.min(active, sheets.length - 1)
  const sheet = sheets[sheetIdx]
  const summary = useMemo(() => summarizeSheets(sheets), [sheets])

  // пересчёт формул: парсер подгружается только для таблиц с формулами
  const [recalc, setRecalc] = useState<Recalc | null>(null)
  const [calc, setCalc] = useState<RecalcResult>({ values: new Map(), stale: 0 })
  useEffect(() => {
    if (source.kind !== 'xlsx') return
    let alive = true
    createRecalc(initial)
      .then((r) => alive && setRecalc(r))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [source, initial])
  useEffect(() => {
    if (!recalc) return
    const t = setTimeout(() => setCalc(recalc.run(sheets)), 200)
    return () => clearTimeout(t)
  }, [recalc, sheets])

  useEffect(() => host.setDirty(summary.changed), [host, summary.changed])

  host.bind(() => {
    const fresh = recalc && summary.changed ? recalc.run(sheetsRef.current) : null
    const notes: string[] = []
    if (source.kind === 'csv' && source.meta.converted) notes.push(tr('Файл был в кодировке {{v1}}; новая версия сохранится в UTF-8.', { v1: source.meta.converted === 'utf-16' ? 'UTF-16' : 'Windows-1251' }))
    if (source.kind === 'xlsx' && fresh && fresh.stale > 0) notes.push(tr('Значения ещё {{stale}} формул обновятся, когда файл откроют в Excel: до этого показаны прежние.', { stale: fresh.stale }))
    if (source.kind === 'xlsx' && !recalc && summary.changed) notes.push(tr('Значения формул обновятся, когда файл откроют в Excel: до этого показаны прежние.'))
    return {
      changed: summary.changed,
      summary: summary.text + (fresh && fresh.values.size > 0 ? tr(' Пересчитано формул: {{size}}.', { size: fresh.values.size }) : ''),
      notes,
      mime: source.kind === 'xlsx' ? XLSX_MIME : 'text/csv',
      ack: source.kind === 'xlsx' && source.lost.length > 0 ? tr('Понимаю, что в новой версии не сохранятся: {{v1}}.', { v1: source.lost.join(', ') }) : undefined,
      build: async () => {
        if (source.kind === 'csv') return writeCsv(sheets[0], source.meta)
        applyEdits(source.wb, sheetsRef.current, fresh?.values)
        return writeXlsx(source.wb)
      },
    }
  })

  /** Изменение листов с записью в историю для «Назад» */
  const change = (next: (s: EditSheet[]) => EditSheet[]) => {
    const cur = sheetsRef.current
    const n = next(cur)
    if (n === cur) return
    sheetsRef.current = n
    setPast((p) => [...p.slice(-(HISTORY - 1)), cur])
    setFuture([])
    setSheets(n)
  }
  const undo = () => {
    const prev = past[past.length - 1]
    if (!prev) return
    setPast(past.slice(0, -1))
    setFuture((f) => [...f, sheetsRef.current])
    sheetsRef.current = prev
    setSheets(prev)
  }
  const redo = () => {
    const next = future[future.length - 1]
    if (!next) return
    setFuture(future.slice(0, -1))
    setPast((p) => [...p, sheetsRef.current])
    sheetsRef.current = next
    setSheets(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetPane
        key={sheet.name}
        sheet={sheet}
        sheetIdx={sheetIdx}
        csv={csv}
        calc={calc}
        summary={summary}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        undo={undo}
        redo={redo}
        change={change}
      />
      {sheets.length > 1 && (
        <div role="tablist" aria-label={tr('Листы')} className="flex gap-1 overflow-x-auto border-t bg-muted/40 p-1">
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              role="tab"
              aria-selected={i === sheetIdx}
              onClick={() => setActive(i)}
              className={`min-h-8 shrink-0 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${i === sheetIdx ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/60'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface PaneProps {
  sheet: EditSheet
  sheetIdx: number
  csv: boolean
  calc: RecalcResult
  summary: ReturnType<typeof summarizeSheets>
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  change: (next: (s: EditSheet[]) => EditSheet[]) => void
}

/** Один лист: выделение, ввод, фильтры, панель оформления и сама таблица */
function SheetPane({ sheet, sheetIdx, csv, calc, summary, canUndo, canRedo, undo, redo, change }: PaneProps) {
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 })
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 })
  const [editing, setEditingState] = useState<Editing | null>(null)
  const editRef = useRef<Editing | null>(null)
  const [limit, setLimit] = useState(PAGE)
  // панель оформления свёрнута, пока её не откроют: таблице нужно место
  const [styleBar, setStyleBar] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  const dragging = useRef(false)

  const setEditing = (e: Editing | null) => {
    editRef.current = e
    if (!e) refocus.current = true
    setEditingState(e)
  }

  const width = Math.max(sheet.width, sheet.rows.length > 0 ? 1 : 4)
  const rowCount = sheet.rows.length
  const valueAt = (r: number, c: number): ECell => {
    const row = sheet.rows[r]
    const v = row?.cells[c]
    if (!isFormula(v)) return v
    const fresh = calc.values.get(resultKey(sheetIdx, row.key, c))
    return fresh !== undefined ? { ...v, result: fresh } : v
  }
  const textOf = (r: number, c: number) => displayText(valueAt(r, c), styleOf(sheet.rows[r], c))

  const filter = useSheetFilter(sheet, textOf, calc, false)
  const cols = useMemo(() => Array.from({ length: width }, (_, c) => c).filter((c) => !sheet.layout.hiddenCols.includes(c)), [width, sheet.layout.hiddenCols])
  // показанные строки: страница из 500 строк поверх фильтров
  const rows = useMemo(() => {
    const cut = filter.rows.findIndex((r) => r >= limit)
    return cut < 0 ? filter.rows : filter.rows.slice(0, cut)
  }, [filter.rows, limit])
  const rowPos = (r: number) => filter.rows.indexOf(r)

  const range = { r1: Math.min(anchor.r, sel.r), r2: Math.max(anchor.r, sel.r), c1: Math.min(anchor.c, sel.c), c2: Math.max(anchor.c, sel.c) }
  const selection: GridSelection | null = rowCount > 0 ? { ...range, r: sel.r, c: sel.c } : null
  /** Ячейки выделения: только видимые строки и колонки */
  const selectedCells = () => {
    const out: Pos[] = []
    for (const r of filter.rows) if (r >= range.r1 && r <= range.r2) for (const c of cols) if (c >= range.c1 && c <= range.c2) out.push({ r, c })
    return out
  }

  useEffect(() => {
    gridRef.current?.querySelector(`[data-cell="${sel.r}:${sel.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sel.r, sel.c])
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      gridRef.current?.focus({ preventScroll: true })
    }
  }, [editing])
  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const cellAt = (p: Pos) => sheet.rows[p.r]?.cells[p.c]
  const textAt = (p: Pos) => rawText(cellAt(p))
  const isLocked = (p: Pos) => !!sheet.rows[p.r]?.locked?.includes(p.c)

  /** Шаг по видимым строкам и колонкам; extend — тянуть выделение */
  const move = (dr: number, dc: number, extend = false) => {
    const pos = Math.max(0, rowPos(sel.r))
    const nr = filter.rows[Math.max(0, Math.min(filter.rows.length - 1, pos + dr))] ?? sel.r
    const ci = Math.max(0, cols.indexOf(sel.c))
    const nc = cols[Math.max(0, Math.min(cols.length - 1, ci + dc))] ?? sel.c
    if (nr >= limit) setLimit(nr + PAGE)
    setSel({ r: nr, c: nc })
    if (!extend) setAnchor({ r: nr, c: nc })
  }
  const moveTo = (p: Pos) => {
    if (p.r >= limit) setLimit(p.r + PAGE)
    setSel(p)
    setAnchor(p)
  }

  const commit = (e: Editing | null, dr = 0, dc = 0) => {
    if (!e) return
    setEditing(null)
    change((all) => {
      const s = all[sheetIdx]
      const row = s.rows[e.r]
      if (!row) return all
      const value = parseInput(e.text, row.cells[e.c], { csv })
      const next = setCell(s, e.r, e.c, value)
      if (next === s) return all
      const copy = all.slice()
      copy[sheetIdx] = next
      return copy
    })
    if (dr || dc) move(dr, dc)
  }

  const startEdit = (p: Pos, text?: string) => {
    if (isLocked(p)) return
    setSel(p)
    setAnchor(p)
    setEditing({ ...p, text: text ?? textAt(p) })
  }

  const clearCells = () =>
    change((all) => {
      let s = all[sheetIdx]
      for (const { r, c } of selectedCells()) s = setCell(s, r, c, null)
      if (s === all[sheetIdx]) return all
      const copy = all.slice()
      copy[sheetIdx] = s
      return copy
    })

  const patch = (p: StylePatch) => {
    change((all) => {
      const s = patchCells(all[sheetIdx], selectedCells(), p)
      if (s === all[sheetIdx]) return all
      const copy = all.slice()
      copy[sheetIdx] = s
      return copy
    })
    refocus.current = true
    gridRef.current?.focus({ preventScroll: true })
  }
  const resetStyle = () => {
    change((all) => {
      const s = resetPatch(all[sheetIdx], selectedCells())
      if (s === all[sheetIdx]) return all
      const copy = all.slice()
      copy[sheetIdx] = s
      return copy
    })
    gridRef.current?.focus({ preventScroll: true })
  }

  const addRow = () => {
    const at = rowCount === 0 ? null : sel.r
    const index = at === null ? rowCount : at + 1
    change((all) => insertRowAt(all, sheetIdx, at).sheets)
    setEditing(null)
    setLimit((l) => Math.max(l, index + PAGE))
    moveTo({ r: index, c: Math.min(sel.c, width - 1) })
  }
  const removeRow = () => {
    if (rowCount === 0) return
    change((all) => deleteRowAt(all, sheetIdx, sel.r))
    setEditing(null)
    moveTo({ r: Math.max(0, Math.min(sel.r, rowCount - 2)), c: sel.c })
  }

  const onGridKey = (ev: React.KeyboardEvent) => {
    if (editRef.current) return
    const mod = ev.ctrlKey || ev.metaKey
    if (mod && (ev.key === 'z' || ev.key === 'я')) {
      ev.preventDefault()
      return ev.shiftKey ? redo() : undo()
    }
    if (mod && (ev.key === 'y' || ev.key === 'н')) {
      ev.preventDefault()
      return redo()
    }
    if (mod && (ev.key === 'b' || ev.key === 'и')) {
      ev.preventDefault()
      return patch({ bold: !styleOf(sheet.rows[sel.r], sel.c).bold })
    }
    if (mod && (ev.key === 'i' || ev.key === 'ш')) {
      ev.preventDefault()
      return patch({ italic: !styleOf(sheet.rows[sel.r], sel.c).italic })
    }
    if (mod && (ev.key === 'a' || ev.key === 'ф')) {
      ev.preventDefault()
      setAnchor({ r: filter.rows[0] ?? 0, c: cols[0] ?? 0 })
      setSel({ r: filter.rows[filter.rows.length - 1] ?? 0, c: cols[cols.length - 1] ?? 0 })
      return
    }
    if (mod || ev.altKey) return
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault()
        return move(1, 0, ev.shiftKey)
      case 'ArrowUp':
        ev.preventDefault()
        return move(-1, 0, ev.shiftKey)
      case 'ArrowLeft':
        ev.preventDefault()
        return move(0, -1, ev.shiftKey)
      case 'ArrowRight':
        ev.preventDefault()
        return move(0, 1, ev.shiftKey)
      case 'Tab':
        ev.preventDefault()
        return move(0, ev.shiftKey ? -1 : 1)
      case 'Enter':
      case 'F2':
        ev.preventDefault()
        return rowCount > 0 ? startEdit(sel) : undefined
      case 'Delete':
      case 'Backspace':
        ev.preventDefault()
        return clearCells()
      default:
        if (ev.key.length === 1 && rowCount > 0) {
          ev.preventDefault()
          startEdit(sel, ev.key)
        }
    }
  }

  const onEditKey = (ev: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    ev.stopPropagation()
    const e = editRef.current
    if (!e) return
    if (ev.key === 'Escape') {
      ev.preventDefault()
      setEditing(null)
    } else if (ev.key === 'Enter' && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault()
      commit(e, 1, 0)
    } else if (ev.key === 'Tab') {
      ev.preventDefault()
      commit(e, 0, ev.shiftKey ? -1 : 1)
    } else if (ev.key === 'Enter' && ev.altKey && ev.currentTarget instanceof HTMLTextAreaElement) {
      ev.preventDefault()
      setEditing({ ...e, text: `${e.text}\n` })
    }
  }

  const barText = editing ? editing.text : rowCount > 0 ? textAt(sel) : ''
  const changedCount = summary.cells + summary.added + summary.removed + summary.styled
  const activeStyle = styleOf(sheet.rows[sel.r], sel.c)
  const hiddenByFilter = sheet.rows.filter((r) => !r.hidden).length - filter.rows.length

  const iconBtn = 'size-9 shrink-0 md:size-8'
  return (
    <>
      {/* одна строка: действия, имя ячейки со строкой значения, оформление, фильтры */}
      <div className="flex flex-wrap items-center gap-1 border-b px-1.5 py-1">
        <Button variant="ghost" size="icon" className={iconBtn} onClick={undo} disabled={!canUndo} aria-label={tr('Отменить последнее действие')} title={tr('Отменить (Ctrl+Z)')}>
          <Undo2 />
        </Button>
        <Button variant="ghost" size="icon" className={iconBtn} onClick={redo} disabled={!canRedo} aria-label={tr('Вернуть отменённое')} title={tr('Вернуть (Ctrl+Y)')}>
          <Redo2 />
        </Button>
        <Button variant="ghost" size="icon" className={iconBtn} onClick={addRow} aria-label={tr('Добавить строку')} title={rowCount === 0 ? tr('Добавить строку') : tr('Добавить строку под выбранной')}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" className={iconBtn} onClick={removeRow} disabled={rowCount === 0} aria-label={tr('Удалить строку {{v1}}', { v1: sel.r + 1 })} title={tr('Удалить выбранную строку')}>
          <Trash2 />
        </Button>
        {!csv && (
          <Button variant="ghost" size="icon" className={`${iconBtn} ${styleBar ? 'bg-accent' : ''}`} aria-pressed={styleBar} onClick={() => setStyleBar((v) => !v)} aria-label={tr('Оформление ячеек')} title={tr('Оформление ячеек')}>
            <Paintbrush />
          </Button>
        )}
        {filter.available && (
          <Button variant="ghost" size="icon" className={`${iconBtn} ${filter.on ? 'bg-accent' : ''}`} aria-pressed={filter.on} onClick={() => filter.setOn(!filter.on)} aria-label={tr('Фильтры')} title={filter.on ? tr('Выключить фильтры') : tr('Включить фильтры в шапке таблицы')}>
            {filter.on ? <Filter /> : <FilterX />}
          </Button>
        )}
        {filter.active > 0 && (
          <button type="button" onClick={filter.clear} className="shrink-0 text-xs text-primary underline underline-offset-2" title={hiddenByFilter > 0 ? tr('Скрыто строк: {{hiddenByFilter}}', { hiddenByFilter }) : undefined}>{tr('Сбросить')}</button>
        )}
        <span className="ident ml-1 w-14 shrink-0 truncate rounded bg-muted px-1 py-1 text-center text-xs tabular-nums text-muted-foreground" title={tr('Выделенная ячейка или диапазон')}>
          {rowCount > 0 ? (range.r1 === range.r2 && range.c1 === range.c2 ? `${colName(sel.c)}${sel.r + 1}` : `${colName(range.c1)}${range.r1 + 1}:${colName(range.c2)}${range.r2 + 1}`) : '—'}
        </span>
        <input
          value={barText}
          disabled={rowCount === 0 || isLocked(sel)}
          aria-label={tr('Значение выбранной ячейки')}
          placeholder={isLocked(sel) ? tr('Объединённая ячейка: правьте верхнюю левую') : tr('Значение или формула (=A1*B1)')}
          onFocus={() => {
            if (!editRef.current && rowCount > 0 && !isLocked(sel)) setEditing({ ...sel, text: textAt(sel), inBar: true })
          }}
          onChange={(e) => (editRef.current ? setEditing({ ...editRef.current, text: e.target.value }) : setEditing({ ...sel, text: e.target.value, inBar: true }))}
          onKeyDown={onEditKey}
          onBlur={() => commit(editRef.current)}
          className="h-9 min-w-0 flex-[1_1_9rem] rounded-md border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:text-sm"
        />
        <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite" title={changedCount === 0 ? undefined : tr('Изменено ячеек {{cells}}, оформлено {{styled}}, добавлено строк {{added}}, удалено {{removed}}', { cells: summary.cells, styled: summary.styled, added: summary.added, removed: summary.removed })}>
          {changedCount === 0 ? '' : tr('Изм.: {{changedCount}}', { changedCount })}
        </span>
      </div>
      {styleBar && !csv && <StyleToolbar style={activeStyle} onPatch={patch} onReset={resetStyle} disabled={rowCount === 0} />}
      <div ref={gridRef} tabIndex={0} role="grid" aria-label={tr('Таблица')} aria-rowcount={rowCount} onKeyDown={onGridKey} className="min-h-0 flex-1 overflow-auto bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50">
        {rowCount === 0 && <p className="p-4 text-sm text-muted-foreground">{tr('Лист пустой. Нажмите «Строка», чтобы добавить первую.')}</p>}
        {rowCount > 0 && (
          <SheetGrid
            sheet={sheet}
            rows={rows}
            valueAt={valueAt}
            selection={selection}
            editing={editing && !editing.inBar ? editing : null}
            cellExtra={filter.extra}
            modified={(r, c) => {
              const row = sheet.rows[r]
              if (!row || row.id < 0) return false
              return !!row.patch?.[c] || (!!row.touched && sig(sheet.orig[row.id]?.[c]) !== sig(row.cells[c]))
            }}
            onCellDown={(r, c, e) => {
              if (e.button !== 0) return
              if (editRef.current && !(editRef.current.r === r && editRef.current.c === c)) commit(editRef.current)
              if (!e.shiftKey) setAnchor({ r, c })
              setSel({ r, c })
              dragging.current = true
            }}
            onCellEnter={(r, c, e) => {
              if (dragging.current && e.buttons === 1) setSel({ r, c })
            }}
            onCellDouble={(r, c) => startEdit({ r, c })}
            onRowHeader={(r, e) => {
              if (e.button !== 0) return
              setAnchor({ r, c: cols[0] ?? 0 })
              setSel({ r, c: cols[cols.length - 1] ?? 0 })
            }}
            onColHeader={(c, e) => {
              if (e.button !== 0) return
              setAnchor({ r: filter.rows[0] ?? 0, c })
              setSel({ r: filter.rows[filter.rows.length - 1] ?? 0, c })
            }}
            renderEditor={(r, c) =>
              editing && (
                <textarea
                  autoFocus
                  rows={Math.max(1, editing.text.split('\n').length)}
                  value={editing.text}
                  aria-label={tr('Ячейка {{v1}}{{v2}}', { v1: colName(c), v2: r + 1 })}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onKeyDown={onEditKey}
                  onBlur={() => commit(editRef.current)}
                  onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                  style={{ minWidth: Math.max(colPx(sheet.layout, c), 160), ...mergeStyleCss(styleOf(sheet.rows[r], c)) }}
                  className="absolute left-0 top-0 z-10 min-h-full resize-none bg-white p-[3px] text-base text-neutral-900 outline outline-2 -outline-offset-2 outline-blue-600 md:text-[13px]"
                />
              )
            }
          />
        )}
        {filter.rows.length > rows.length && (
          <div className="p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>{tr('Показать ещё строки')}</Button>
          </div>
        )}
      </div>
    </>
  )
}

/** Поле ввода в ячейке повторяет шрифт ячейки (кегль не меньше 16 px на телефоне задаёт класс) */
function mergeStyleCss(st: ReturnType<typeof styleOf>): React.CSSProperties {
  return { fontWeight: st.bold ? 700 : undefined, fontStyle: st.italic ? 'italic' : undefined }
}
