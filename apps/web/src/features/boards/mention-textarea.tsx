import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { UserAvatar } from '@/features/profile/avatar'
import type { BoardPerson } from '@/features/boards/people'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Упоминания на доске — простым текстом «@Имя Фамилия», как в Trello. Сервер находит их по полному имени
// (private.board_mentions) и шлёт упомянутому уведомление: колокольчик, push и письмо.

/** Набираемое упоминание перед кареткой: «@» в начале строки или после пробела и до 40 символов без перевода строки. */
function pendingQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|[\s(])@([^@\n]{0,40})$/.exec(text.slice(0, caret))
  if (!m) return null
  return { start: caret - m[1].length - 1, query: m[1] }
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (v: string) => void
  /** Кого можно упомянуть (кто видит доску, без меня) */
  people: BoardPerson[]
}

/** Поле ввода с подсказкой «@»: стрелки — выбор, Enter или Tab — вставить, Esc — закрыть подсказку. */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onValueChange, people, onKeyDown, onBlur, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inner.current!)
  const [pending, setPending] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)

  const matches = useMemo(() => {
    if (!pending) return []
    const q = pending.query.toLowerCase()
    return people.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 6)
  }, [pending, people])
  // После пробела без совпадений человек уже пишет дальше — подсказку не держим
  const open = !!pending && people.length > 0 && (matches.length > 0 || !pending.query.includes(' '))

  const sync = (el: HTMLTextAreaElement) => {
    const next = pendingQuery(el.value, el.selectionStart ?? el.value.length)
    setPending(next)
    if (next?.query !== pending?.query) setActive(0)
  }

  const pick = (p: BoardPerson) => {
    const el = inner.current
    if (!el || !pending) return
    const caret = el.selectionStart ?? value.length
    const insert = `@${p.full_name} `
    const next = value.slice(0, pending.start) + insert + value.slice(caret)
    onValueChange(next)
    setPending(null)
    const pos = pending.start + insert.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={inner}
        value={value}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          onValueChange(e.target.value)
          sync(e.target)
        }}
        onClick={(e) => sync(e.currentTarget)}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
              return
            }
            if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
              e.preventDefault()
              pick(matches[Math.min(active, matches.length - 1)])
              return
            }
          }
          if (open && e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setPending(null)
            return
          }
          onKeyDown?.(e)
        }}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') sync(e.currentTarget)
        }}
        onBlur={(e) => {
          setPending(null)
          onBlur?.(e)
        }}
      />
      {open && (
        <div role="listbox" aria-label={tr('Кого упомянуть')} className="absolute left-0 top-full z-50 mt-1 w-72 max-w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{tr('Никого не нашли')}</p>
          ) : (
            matches.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === active}
                // mousedown, а не click: иначе поле теряет фокус раньше выбора
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(p)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm', i === active && 'bg-accent')}
              >
                <UserAvatar name={p.full_name} path={p.avatar_path} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.full_name}</span>
                  {p.hint && <span className="block truncate text-xs text-muted-foreground">{p.hint}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
})

/** Текст с подсвеченными «@Имя Фамилия» известных людей. */
export function MentionText({ text, people }: { text: string; people: BoardPerson[] }): ReactNode {
  const re = useMemo(() => {
    const names = [...new Set(people.map((p) => p.full_name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
    if (!names.length) return null
    return new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))(?![\\p{L}\\p{N}_])`, 'gu')
  }, [people])
  if (!re || !text.includes('@')) return text
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="rounded bg-primary/15 px-0.5 font-medium text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  )
}
