import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LOCATION_KIND_LABELS, locationLabel, orderKey, type LocationRow } from '@/features/locations/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const short = (r: LocationRow) => r.name.replace(/^(номер|помещение|квартира|room)\s*/i, '').toLowerCase()

/** Поиск места по номеру, названию, коду или пути: точное совпадение номера («301») выше начала и вхождения. */
export function searchLocations(rows: LocationRow[], query: string, limit = 8): LocationRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { r: LocationRow; score: number }[] = []
  for (const r of rows) {
    const s = short(r)
    const name = r.name.toLowerCase()
    const code = r.code.toLowerCase()
    let score = 0
    if (s === q || code === q) score = 100
    else if (s.startsWith(q) || code.startsWith(q)) score = 80
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 60
    else if (name.includes(q) || r.path.toLowerCase().includes(q)) score = 40
    if (score > 0) scored.push({ r, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.r.path.split('.').length - b.r.path.split('.').length || orderKey(a.r) - orderKey(b.r) || a.r.path.localeCompare(b.r.path, undefined, { numeric: true })).slice(0, limit).map((x) => x.r)
}

/**
 * Быстрый переход к месту: вводите «301», «F05», «паркинг» — Enter открывает первое совпадение, стрелки вверх и вниз выбирают другое.
 * Клавиша «/» ставит фокус в поле, когда оно доступно (`hotkey`).
 */
export function LocationJump({
  code,
  rows,
  hotkey = true,
  className,
  compact,
  autoFocus,
  focusKey,
  block,
}: {
  code: string
  rows: LocationRow[]
  hotkey?: boolean
  className?: string
  compact?: boolean
  /** Ставить курсор в поле сразу: `true` — всегда, `'fine'` — только там, где есть мышь (на телефоне клавиатура сама не выезжает) */
  autoFocus?: boolean | 'fine'
  /** Меняется — курсор снова встаёт в поле (например, после перехода к другому месту) */
  focusKey?: string
  /** Во всю ширину, крупнее, список под полем; курсор встаёт в поле при появлении (его показывают по нажатию на значок поиска) */
  block?: boolean
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const results = useMemo(() => searchLocations(rows, q), [rows, q])

  useEffect(() => setActive(0), [q])
  // курсор в поле: можно сразу набирать «301» или «F05»; с задержкой, чтобы окно места успело забрать фокус и отдать его нам
  useEffect(() => {
    if (!autoFocus) return
    if (autoFocus === 'fine' && window.matchMedia('(pointer: coarse)').matches) return
    const id = window.setTimeout(() => input.current?.focus(), 150)
    return () => window.clearTimeout(id)
  }, [autoFocus, focusKey])
  useEffect(() => {
    if (!hotkey) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hotkey])

  const go = (r: LocationRow) => {
    setQ('')
    input.current?.blur()
    // из карточки места (поле в шапке) переход заменяет запись истории: «Назад» ведёт к структуре, а не по просмотренным номерам
    void navigate({ to: '/projects/$code/locations/$path', params: { code, path: r.path }, replace: !!compact })
  }
  const open = focused && q.trim() !== ''

  return (
    <div className={cn('relative', className)}>
      <Search className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', block ? 'left-3.5 size-4' : 'left-2.5 size-3.5')} aria-hidden />
      <input
        ref={input}
        autoFocus={block}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            go(results[active]!)
          } else if (e.key === 'Escape') {
            setQ('')
            input.current?.blur()
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={tr('Перейти к месту')}
        placeholder={compact ? tr('Номер, этаж…') : tr('Перейти: номер, этаж, код (/)')}
        autoComplete="off"
        enterKeyHint="go"
        className={cn('h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring', compact && !block && 'w-36 sm:w-44', block && 'h-11 rounded-xl pl-10 text-base')}
      />
      {open && (
        <ul id={listId} role="listbox" className={cn('absolute right-0 top-9 z-30 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border bg-popover py-1 text-sm shadow-lg', block && 'left-0 top-12 w-auto max-w-none rounded-xl')}>
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{tr('Ничего не нашли')}</li>
          ) : (
            results.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex w-full flex-col items-start px-3 py-1.5 text-left outline-none', block && 'min-h-12 justify-center', i === active && 'bg-muted')}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{LOCATION_KIND_LABELS[r.kind]}</span>
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">{locationLabel(r.path, rows)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
