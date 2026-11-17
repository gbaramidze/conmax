import { AlignLeft, Archive, CheckSquare, Clock, MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { UserAvatar } from '@/features/profile/avatar'
import { dueState, LABEL_STYLE, labelColorName, type BoardCard, type BoardLabel, type DueState } from '@/features/boards/api'
import type { BoardPerson } from '@/features/boards/people'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Метки на карточках: как в Trello — по умолчанию узкие цветные полоски, щелчок по любой раскрывает названия на всех досках
// ---------------------------------------------------------------------------
const EXPANDED_KEY = 'boards.labels-expanded'
const listeners = new Set<(v: boolean) => void>()
function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}
export function useLabelsExpanded(): [boolean, () => void] {
  const [expanded, setExpanded] = useState(readExpanded)
  useEffect(() => {
    listeners.add(setExpanded)
    return () => void listeners.delete(setExpanded)
  }, [])
  const toggle = () => {
    const next = !readExpanded()
    try {
      localStorage.setItem(EXPANDED_KEY, next ? '1' : '0')
    } catch {
      /* без хранилища — только до перезагрузки */
    }
    for (const l of listeners) l(next)
  }
  return [expanded, toggle]
}

export function LabelPill({ label, expanded = true, className }: { label: BoardLabel; expanded?: boolean; className?: string }) {
  const s = LABEL_STYLE[label.color]
  const title = label.name || labelColorName(label.color)
  if (!expanded) {
    return <span title={title} className={cn('block h-2 w-10 rounded-full', className)} style={{ background: s.bg }} />
  }
  return (
    <span
      title={title}
      className={cn('inline-flex h-6 min-w-12 max-w-full items-center truncate rounded px-2 text-xs font-semibold', className)}
      style={{ background: s.bg, color: s.fg }}
    >
      {label.name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Срок
// ---------------------------------------------------------------------------
export function formatDue(iso: string, withYear = false): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(currentLocale(), {
    day: 'numeric',
    month: 'short',
    year: withYear || !sameYear ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`))
}

export const DUE_CLASS: Record<DueState, string> = {
  done: 'bg-[#1f845a] text-white',
  overdue: 'bg-[#c9372c] text-white',
  soon: 'bg-[#f5cd47] text-[#533f04]',
  later: 'text-muted-foreground',
}
export const dueTitle = (s: DueState): string =>
  ({ done: tr('Выполнено'), overdue: tr('Срок прошёл'), soon: tr('Срок меньше чем через сутки'), later: tr('Срок') })[s]

// ---------------------------------------------------------------------------
// Лицевая сторона карточки на доске
// ---------------------------------------------------------------------------
export function CardFace({
  card,
  labels,
  people,
  labelsExpanded,
  onToggleLabels,
  dragging,
}: {
  card: BoardCard
  labels: Map<string, BoardLabel>
  people: Map<string, BoardPerson>
  labelsExpanded: boolean
  onToggleLabels?: () => void
  dragging?: boolean
}) {
  const cardLabels = card.label_ids.map((id) => labels.get(id)).filter((l): l is BoardLabel => !!l).sort((a, b) => a.position - b.position)
  const due = dueState(card)
  const checklistComplete = card.checklist_total > 0 && card.checklist_done === card.checklist_total
  const hasBadges = !!due || !!card.start_date || card.has_description || card.comment_count > 0 || card.checklist_total > 0 || !!card.archived_at

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg bg-card text-left text-card-foreground shadow-[0_1px_1px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)] ring-inset group-hover/card:ring-2 group-hover/card:ring-primary/60',
        dragging && 'rotate-3 shadow-xl ring-2 ring-primary/40',
      )}
    >
      {card.cover && <div className="h-8" style={{ background: LABEL_STYLE[card.cover].bg }} aria-hidden />}
      <div className="flex flex-col gap-1 px-3 pb-2 pt-2">
        {cardLabels.length > 0 && (
          <div
            className="mb-0.5 flex flex-wrap gap-1"
            onClick={(e) => {
              if (!onToggleLabels) return
              e.stopPropagation()
              onToggleLabels()
            }}
          >
            {cardLabels.map((l) => (
              <LabelPill key={l.id} label={l} expanded={labelsExpanded} />
            ))}
          </div>
        )}
        <span className="break-words text-sm leading-5">{card.title}</span>
        {(hasBadges || card.member_ids.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            {card.archived_at && (
              <span className="inline-flex h-6 items-center gap-1 rounded bg-muted px-1.5">
                <Archive className="size-3.5" aria-hidden /> {tr('В архиве')}
              </span>
            )}
            {due && (
              <span title={dueTitle(due)} className={cn('inline-flex h-6 items-center gap-1 rounded px-1.5', DUE_CLASS[due])}>
                <Clock className="size-3.5" aria-hidden />
                {card.start_date && `${formatDay(card.start_date)} – `}
                {formatDue(card.due_at!)}
              </span>
            )}
            {!due && card.start_date && (
              <span title={tr('Начало')} className="inline-flex h-6 items-center gap-1 rounded px-1.5">
                <Clock className="size-3.5" aria-hidden /> {tr('С {{d}}', { d: formatDay(card.start_date) })}
              </span>
            )}
            {card.has_description && (
              <span title={tr('У карточки есть описание')} className="inline-flex h-6 items-center px-1">
                <AlignLeft className="size-3.5" aria-label={tr('Описание')} />
              </span>
            )}
            {card.comment_count > 0 && (
              <span title={tr('Комментарии')} className="inline-flex h-6 items-center gap-1 px-1">
                <MessageSquare className="size-3.5" aria-hidden /> {card.comment_count}
              </span>
            )}
            {card.checklist_total > 0 && (
              <span
                title={tr('Пункты чек-листа')}
                className={cn('inline-flex h-6 items-center gap-1 rounded px-1.5', checklistComplete && 'bg-[#1f845a] text-white')}
              >
                <CheckSquare className="size-3.5" aria-hidden /> {card.checklist_done}/{card.checklist_total}
              </span>
            )}
            {card.member_ids.length > 0 && (
              <span className="ml-auto flex -space-x-1.5">
                {card.member_ids.slice(0, 5).map((id) => {
                  const p = people.get(id)
                  return (
                    <span key={id} title={p?.full_name} className="rounded-full ring-2 ring-card">
                      <UserAvatar name={p?.full_name ?? '?'} path={p?.avatar_path} className="size-6 text-[10px]" />
                    </span>
                  )
                })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
