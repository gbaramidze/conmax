import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { CbsItem } from './api'
import { itemLabel } from './lookahead-model'

interface Extra {
  value: string
  label: string
}

/**
 * Выбор статьи бюджета деревом с поиском. Разделы раскрываются, поиск — по коду (в том числе коду из файла) и названию
 * на любом языке; найденные статьи показываются вместе с их разделами. Клавиши: ↑ ↓ — по строкам, → ← — раскрыть или
 * свернуть раздел, Enter — выбрать, Esc — закрыть.
 */
export function CbsPicker({
  items,
  value,
  onChange,
  id,
  placeholder,
  extras = [],
  disabled,
  className,
}: {
  items: CbsItem[]
  value: string
  onChange: (v: string) => void
  id?: string
  placeholder?: string
  /** Особые варианты сверху списка: «Все статьи», «Не выбрана» и т. п. */
  extras?: Extra[]
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // -1 — курсор ещё не двигали: стоит на первом совпадении поиска (или на первой строке)
  const [rawCursor, setCursor] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const kids = useMemo(() => {
    const m = new Map<string | null, CbsItem[]>()
    for (const it of items) {
      const p = it.parent_id && byId.has(it.parent_id) ? it.parent_id : null
      m.set(p, [...(m.get(p) ?? []), it])
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code, currentLocale(), { numeric: true }))
    return m
  }, [items, byId])


  // строки списка: при поиске — найденные и их разделы, иначе — дерево по раскрытым разделам
  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const out: { item: CbsItem; depth: number; hasKids: boolean; match: boolean }[] = []
    let show: Set<string> | null = null
    let matched = new Set<string>()
    if (q) {
      matched = new Set(
        items
          .filter((i) => {
            const hay = `${i.code} ${i.source_code ?? ''} ${i.name} ${i.alt_name ?? ''}`.toLowerCase()
            return hay.includes(q) || i.code.toLowerCase().startsWith(q)
          })
          .map((i) => i.id),
      )
      show = new Set(matched)
      for (const m of matched) for (const a of ancestorsOf(byId, m)) show.add(a)
    }
    const walk = (parent: string | null, depth: number) => {
      for (const it of kids.get(parent) ?? []) {
        if (show && !show.has(it.id)) continue
        const hasKids = (kids.get(it.id) ?? []).length > 0
        out.push({ item: it, depth, hasKids, match: matched.has(it.id) })
        if (hasKids && (show ? true : expanded.has(it.id))) walk(it.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [q, kids, expanded, items, byId])

  const options = [...(q ? [] : extras.map((e) => ({ kind: 'extra' as const, value: e.value, e }))), ...rows.map((r) => ({ kind: 'item' as const, value: r.item.id, r }))]

  const firstMatch = q ? options.findIndex((o) => o.kind === 'item' && o.r.match) : 0
  const cursor = rawCursor < 0 ? Math.max(firstMatch, 0) : rawCursor

  const selected = byId.get(value)
  const selectedExtra = extras.find((e) => e.value === value)
  const label = selected ? itemLabel(selected, selected) : null

  const openPicker = (o: boolean) => {
    setOpen(o)
    if (o) {
      setQuery('')
      // путь к выбранной статье раскрыт
      setExpanded(new Set(selected ? ancestorsOf(byId, selected.id) : []))
      setCursor(-1)
    }
  }
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }
  const toggle = (id2: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id2)) n.delete(id2)
      else n.add(id2)
      return n
    })
  const moveTo = (i: number) => {
    const n = Math.max(0, Math.min(options.length - 1, i))
    setCursor(n)
    listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const onKey = (e: React.KeyboardEvent) => {
    const cur = options[cursor]
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveTo(cursor + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(cursor - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (cur) pick(cur.value)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !q && cur?.kind === 'item' && cur.r.hasKids) {
      const isOpen = expanded.has(cur.value)
      if ((e.key === 'ArrowRight') !== isOpen) {
        e.preventDefault()
        toggle(cur.value)
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={openPicker}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={tr('Статья бюджета')}
          className={cn(
            'flex min-h-10 w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
        >
          <span className="min-w-0 flex-1">
            {label ? (
              <>
                <span className="block truncate">
                  <span className="ident mr-1.5 text-muted-foreground">{selected!.code}</span>
                  {label.main}
                </span>
                {label.sub && <span className="block truncate text-xs text-muted-foreground">{label.sub}</span>}
              </>
            ) : (
              <span className={selectedExtra ? '' : 'text-muted-foreground'}>{selectedExtra?.label ?? placeholder ?? tr('Выберите статью')}</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(var(--radix-popover-trigger-width),24rem)] max-w-[calc(100vw-2rem)] p-0" onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(-1)
            }}
            placeholder={tr('Поиск по коду или названию')}
            aria-label={tr('Поиск статьи')}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} role="listbox" aria-label={tr('Статьи бюджета')} className="max-h-80 overflow-y-auto py-1">
          {options.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{tr('Ничего не найдено')}</p>}
          {options.map((o, i) => {
            const active = i === cursor
            if (o.kind === 'extra')
              return (
                <button
                  key={`x-${o.value}`}
                  type="button"
                  role="option"
                  aria-selected={value === o.value}
                  data-index={i}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => pick(o.value)}
                  className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', active && 'bg-muted')}
                >
                  <Check className={cn('size-4 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-muted-foreground">{o.e.label}</span>
                </button>
              )
            const { item, depth, hasKids, match } = o.r
            const l = itemLabel(item, item)
            const isOpen = q ? true : expanded.has(item.id)
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={value === item.id}
                data-index={i}
                onMouseMove={() => setCursor(i)}
                className={cn('flex items-start gap-1 pr-3 text-sm', active && 'bg-muted')}
                style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
              >
                {hasKids ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isOpen ? tr('Свернуть') : tr('Развернуть')}
                    disabled={!!q}
                    onClick={() => toggle(item.id)}
                    className="mt-1.5 inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-background disabled:opacity-40"
                  >
                    {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                ) : (
                  <span className="inline-block size-5 shrink-0" />
                )}
                <button type="button" onClick={() => pick(item.id)} className="flex min-w-0 flex-1 items-start gap-2 py-1.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className={cn('block', depth === 0 && 'font-medium', q && !match && 'text-muted-foreground')}>
                      <span className="ident mr-1.5 text-muted-foreground">{item.code}</span>
                      <Highlight text={l.main} q={q} />
                    </span>
                    {l.sub && (
                      <span className="block truncate text-xs text-muted-foreground">
                        <Highlight text={l.sub} q={q} />
                      </span>
                    )}
                  </span>
                  <Check className={cn('mt-0.5 size-4 shrink-0', value === item.id ? 'opacity-100' : 'opacity-0')} />
                </button>
              </div>
            )
          })}
        </div>
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{tr('↑ ↓ — выбор строки, → ← — раскрыть раздел, Enter — выбрать')}</p>
      </PopoverContent>
    </Popover>
  )
}

/** Разделы над статьёй, от ближнего к верхнему */
function ancestorsOf(byId: Map<string, CbsItem>, id: string): string[] {
  const out: string[] = []
  let p = byId.get(id)?.parent_id ?? null
  while (p && byId.has(p)) {
    out.push(p)
    p = byId.get(p)?.parent_id ?? null
  }
  return out
}

/** Подсветка найденного фрагмента */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-700/60">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}
