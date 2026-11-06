import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

export interface SearchOption {
  value: string
  label: string
  /** Вторая строка: организация, должность */
  hint?: string
  /** Слева: фото человека или значок */
  avatar?: ReactNode
}

/**
 * Выбор из списка с поиском вместо обычного выпадающего списка. Строки с фото или значком и подсказкой; поиск по названию и подсказке.
 * Стрелки и Enter работают, на телефоне строки крупные. Пустое значение выбирается строкой `noneLabel` (её же показывает кнопка).
 */
export function SearchSelect({
  value,
  onChange,
  options,
  noneLabel,
  ariaLabel,
  placeholder,
  disabled,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchOption[]
  /** Название «пустого» выбора (например, «Не назначать человека»); без него очистить значение нельзя */
  noneLabel?: string
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => !q || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
  }, [options, query])
  // первая строка — «пусто», если оно разрешено и поиск не задан
  const rows: SearchOption[] = noneLabel && !query.trim() ? [{ value: '', label: noneLabel }, ...shown] : shown

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(Math.max(0, rows.findIndex((r) => r.value === value)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(rows.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[active]) pick(rows[active].value)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn('flex h-11 w-full min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:h-10', className)}
        >
          {current ? (
            <>
              {current.avatar}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{current.label}</span>
                {current.hint && <span className="block truncate text-xs text-muted-foreground">{current.hint}</span>}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{noneLabel ?? placeholder ?? tr('Выберите')}</span>
          )}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-label={tr('Поиск')}
            placeholder={tr('Поиск')}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button type="button" aria-label={tr('Очистить поиск')} onClick={() => setQuery('')} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div ref={list} id={listId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto overscroll-contain py-1">
          {rows.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">{tr('Ничего не найдено')}</p>
          ) : (
            rows.map((o, i) => (
              <button
                key={o.value || '__none'}
                type="button"
                role="option"
                aria-selected={o.value === value}
                data-i={i}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex min-h-12 w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm outline-none', i === active && 'bg-muted')}
              >
                {o.avatar}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', o.value === '' && 'text-muted-foreground')}>{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
