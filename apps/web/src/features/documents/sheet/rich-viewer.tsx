import { tr } from '@/lib/tr'
import { Filter, FilterX, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { docWords, hasWords, HitBar, useDomHighlight } from '../dom-highlight'
import { readXlsx } from '../edit/xlsx-io'
import { plain, styleOf, type ECell, type EditSheet } from '../edit/sheet-model'
import { SheetGrid, displayText } from './grid'
import { useSheetFilter } from './use-filter'

const PAGE = 500

/** Просмотр книги Excel как в Excel: заливка, шрифты, границы, ширины, объединённые ячейки, рисунки, фильтры в шапке (включаются кнопкой). */
export default function RichSheets({ buffer, fallback, highlight }: { buffer: ArrayBuffer; fallback: ReactNode; highlight?: string }) {
  const [sheets, setSheets] = useState<EditSheet[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const words = docWords(highlight)
  const frame = useRef<HTMLDivElement>(null)
  const h = useDomHighlight(frame, highlight, `${active}:${sheets ? 1 : 0}`)
  // листы, где есть искомые слова
  const hitSheets = useMemo(
    () => (sheets && words.length ? sheets.map((s, i) => (s.rows.some((r) => r.cells.some((v) => hasWords(String(plain(v) ?? ''), words))) ? i : -1)).filter((i) => i >= 0) : []),
    [sheets, words.join(' ')], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // книга открывается на первом листе с совпадением
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current && sheets && hitSheets.length > 0) {
      opened.current = true
      setActive(hitSheets[0]!)
    }
  }, [sheets, hitSheets])
  const go = (d: 1 | -1) => {
    const edge = d === 1 ? h.active === h.count - 1 : h.active === 0
    const at = hitSheets.indexOf(active)
    if (edge && hitSheets.length > 1 && at >= 0) {
      h.startAt.current = d === 1 ? 'first' : 'last'
      setActive(hitSheets[(at + d + hitSheets.length) % hitSheets.length]!)
      return
    }
    h.go(h.active + d)
  }

  useEffect(() => {
    let alive = true
    readXlsx(buffer)
      .then((r) => alive && setSheets(r.sheets))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [buffer])

  if (failed) return <>{fallback}</>
  if (!sheets) return <p className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground">{tr('Открываем таблицу…')}</p>
  const idx = Math.min(active, sheets.length - 1)

  return (
    <div ref={frame} className="relative flex h-full min-h-0 flex-col">
      {h.enabled && <HitBar words={h.words} count={h.count} active={h.active} onGo={go} onClose={h.disable} note={hitSheets.length > 1 ? tr('листов с совпадениями: {{n}}', { n: hitSheets.length }) : undefined} />}
      <SheetView key={sheets[idx].name} sheet={sheets[idx]} highlight={highlight} />
      {sheets.length > 1 && (
        <div role="tablist" aria-label={tr('Листы')} className="flex gap-1 overflow-x-auto border-t bg-muted/40 p-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              role="tab"
              aria-selected={i === idx}
              onClick={() => setActive(i)}
              className={`min-h-9 shrink-0 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${i === idx ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/60'}`}
            >
              {s.name}
              {hitSheets.includes(i) && <span aria-label={tr('есть совпадения')} className="ml-1.5 inline-block size-2 rounded-full bg-yellow-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SheetView({ sheet, highlight }: { sheet: EditSheet; highlight?: string }) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const valueAt = (r: number, c: number): ECell => sheet.rows[r]?.cells[c]
  const textOf = (r: number, c: number) => displayText(valueAt(r, c), styleOf(sheet.rows[r], c))
  const filter = useSheetFilter(sheet, textOf, sheet, true)

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return filter.rows
    return filter.rows.filter((r) => sheet.rows[r].cells.some((v) => String(plain(v) ?? '').toLowerCase().includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.rows, query, sheet])
  const shown = matched.slice(0, limit)
  // строки с совпадениями могут быть далеко внизу: показываем лист до последней из них
  useEffect(() => {
    const ws = docWords(highlight)
    if (!ws.length) return
    let last = -1
    matched.forEach((r, i) => {
      if (sheet.rows[r].cells.some((v) => hasWords(String(plain(v) ?? ''), ws))) last = i
    })
    if (last >= 0) setLimit((l) => Math.max(l, Math.min(5000, last + 20)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, highlight])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            placeholder={tr('Найти в листе')}
            aria-label={tr('Найти в листе')}
            className="h-9 pl-9"
          />
        </div>
        {filter.available && (
          <Button variant="outline" size="sm" className="h-9" aria-pressed={filter.on} onClick={() => filter.setOn(!filter.on)} title={tr('Фильтры в шапке таблицы')}>
            {filter.on ? <Filter /> : <FilterX />} <span className="hidden sm:inline">{tr('Фильтры')}</span>
          </Button>
        )}
        {filter.active > 0 && (
          <button type="button" onClick={filter.clear} className="text-xs text-primary underline underline-offset-2">{tr('Сбросить фильтры')}</button>
        )}
        <span className="text-xs text-muted-foreground">{query || filter.active > 0 ? tr('Найдено строк: {{length}}', { length: matched.length }) : tr('Строк: {{length}}', { length: sheet.rows.length })}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
        {sheet.rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{tr('Лист пустой.')}</p>
        ) : (
          <SheetGrid sheet={sheet} rows={shown} valueAt={valueAt} readOnly cellExtra={filter.extra} />
        )}
        {matched.length > shown.length && (
          <div className="p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>{tr('Показать ещё')}{' '}{Math.min(PAGE, matched.length - shown.length)}{tr('из')}{' '}{matched.length - shown.length}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
