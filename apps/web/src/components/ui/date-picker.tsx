import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { currentLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { tr } from '@/lib/tr'

/** Дата хранится строкой ГГГГ-ММ-ДД (как в базе) или пустой строкой. Все расчёты — в UTC, чтобы часовой пояс не сдвигал день. */
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))
const fromIso = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null
}
const fmt = (loc: string, opts: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(loc, { ...opts, timeZone: 'UTC' }).format(d)
const todayIso = () => {
  const n = new Date()
  return iso(n.getFullYear(), n.getMonth(), n.getDate())
}
const addDaysIso = (s: string, n: number) => {
  const p = fromIso(s)!
  const d = utc(p.y, p.m, p.d + n)
  return iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

interface Props {
  value: string
  onChange: (value: string) => void
  id?: string
  min?: string
  max?: string
  disabled?: boolean
  /** Можно ли очистить дату (по умолчанию да) */
  clearable?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}

/**
 * Выбор даты: кнопка с датой и календарь во всплывающем окне. Одинаково работает на компьютере и на телефоне
 * (вместо системного поля type="date", которое выглядит по-разному в каждом браузере).
 * Стрелки двигают день, PageUp/PageDown — месяц, Enter выбирает.
 */
export function DatePicker({ value, onChange, id, min, max, disabled, clearable = true, placeholder, className, ...aria }: Props) {
  const loc = currentLocale()
  const [open, setOpen] = useState(false)
  const parsed = fromIso(value)
  const [focus, setFocus] = useState(value || todayIso())
  const gridRef = useRef<HTMLDivElement>(null)

  // при открытии календарь встаёт на выбранную дату (или на сегодня)
  useEffect(() => {
    if (open) setFocus(value || min || todayIso())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const f = fromIso(focus) ?? fromIso(todayIso())!
  const inRange = (s: string) => (!min || s >= min) && (!max || s <= max)
  const move = (s: string) => setFocus(s)

  const weekdays = useMemo(() => {
    // неделя с понедельника: 2024-01-01 — понедельник
    return Array.from({ length: 7 }, (_, i) => fmt(loc, { weekday: 'short' }, utc(2024, 0, 1 + i)))
  }, [loc])
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => fmt(loc, { month: 'long' }, utc(2024, i, 1))), [loc])

  const cells = useMemo(() => {
    const first = utc(f.y, f.m, 1)
    const lead = (first.getUTCDay() + 6) % 7
    const days = new Date(Date.UTC(f.y, f.m + 1, 0)).getUTCDate()
    const out: { iso: string; day: number; outside: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = utc(f.y, f.m, 1 - lead + i)
      out.push({ iso: iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day: d.getUTCDate(), outside: i < lead || i >= lead + days })
    }
    // последнюю неделю, целиком из чужого месяца, не показываем
    return out.slice(0, out[35].outside ? 35 : 42)
  }, [f.y, f.m])

  const years = useMemo(() => {
    const base = new Date().getFullYear()
    const lo = Math.min(base - 5, f.y, parsed?.y ?? f.y)
    const hi = Math.max(base + 10, f.y, parsed?.y ?? f.y)
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  }, [f.y, parsed?.y])

  const pick = (s: string) => {
    if (!inRange(s)) return
    onChange(s)
    setOpen(false)
  }

  const label = parsed ? fmt(loc, { day: '2-digit', month: '2-digit', year: 'numeric' }, utc(parsed.y, parsed.m, parsed.d)) : ''

  const onKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (e.key in step) {
      e.preventDefault()
      move(addDaysIso(focus, step[e.key]))
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const d = utc(f.y, f.m + (e.key === 'PageUp' ? -1 : 1), Math.min(f.d, 28))
      move(iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      move(addDaysIso(focus, e.key === 'Home' ? -(((utc(f.y, f.m, f.d).getUTCDay() + 6) % 7)) : 6 - ((utc(f.y, f.m, f.d).getUTCDay() + 6) % 7)))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(focus)
    }
  }

  // фокус следует за выбранным днём, пока календарь открыт
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>('button[data-focus="true"]')?.focus(), 0)
    return () => clearTimeout(t)
  }, [open, focus])

  const shiftMonth = (n: number) => {
    const d = utc(f.y, f.m + n, 1)
    move(iso(d.getUTCFullYear(), d.getUTCMonth(), Math.min(f.d, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())))
  }

  const today = todayIso()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={aria['aria-label']}
          aria-invalid={aria['aria-invalid']}
          aria-haspopup="dialog"
          className={cn(
            'flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 py-1 text-left text-base transition-colors outline-none md:h-9 md:text-sm',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30',
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate tabular-nums', !label && 'text-muted-foreground')}>{label || placeholder || tr('Выберите дату')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[19.5rem] max-w-[calc(100vw-1rem)] p-3" role="dialog" aria-label={tr('Выбор даты')} onKeyDown={onKey}>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label={tr('Предыдущий месяц')} onClick={() => shiftMonth(-1)}>
            <ChevronLeft />
          </Button>
          <select
            aria-label={tr('Месяц')}
            value={f.m}
            onChange={(e) => move(iso(f.y, +e.target.value, Math.min(f.d, new Date(Date.UTC(f.y, +e.target.value + 1, 0)).getUTCDate())))}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium capitalize hover:bg-muted focus-visible:border-ring focus-visible:outline-none"
          >
            {months.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label={tr('Год')}
            value={f.y}
            onChange={(e) => move(iso(+e.target.value, f.m, Math.min(f.d, new Date(Date.UTC(+e.target.value, f.m + 1, 0)).getUTCDate())))}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-9 w-[4.5rem] rounded-md border border-transparent bg-transparent px-1 text-sm font-medium tabular-nums hover:bg-muted focus-visible:border-ring focus-visible:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label={tr('Следующий месяц')} onClick={() => shiftMonth(1)}>
            <ChevronRight />
          </Button>
        </div>

        <div ref={gridRef} className="mt-2 grid grid-cols-7 gap-y-0.5">
          {weekdays.map((w, i) => (
            <span key={i} aria-hidden className="flex h-8 items-center justify-center text-xs font-medium text-muted-foreground">
              {w}
            </span>
          ))}
          {cells.map((c) => {
            const selected = c.iso === value
            const disabledDay = !inRange(c.iso)
            return (
              <button
                key={c.iso}
                type="button"
                tabIndex={c.iso === focus ? 0 : -1}
                data-focus={c.iso === focus}
                aria-pressed={selected}
                aria-current={c.iso === today ? 'date' : undefined}
                disabled={disabledDay}
                onClick={() => pick(c.iso)}
                className={cn(
                  'mx-auto flex size-10 items-center justify-center rounded-lg text-sm tabular-nums outline-none md:size-9',
                  'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30',
                  c.outside && !selected && 'text-muted-foreground/60',
                  c.iso === today && !selected && 'font-semibold text-primary ring-1 ring-primary/40',
                  selected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
                )}
              >
                {c.day}
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <Button type="button" variant="ghost" size="sm" disabled={!inRange(today)} onClick={() => pick(today)}>
            {tr('Сегодня')}
          </Button>
          {clearable && value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              <X />
              {tr('Очистить')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
