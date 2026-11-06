import { tr } from '@/lib/tr'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { KINDS, OVERDUE_CHIP } from '@/features/calendar/kinds'
import type { CalendarEvent } from '@/features/calendar/types'

/** Ссылка на источник события. Новый вариант `EventTarget` добавляет сюда свою ветку. */
export function EventLink({ event, code, className, children }: { event: CalendarEvent; code: string; className?: string; children: ReactNode }) {
  const t = event.target
  const title = tooltip(event)
  switch (t.to) {
    case 'task':
      return (
        <Link to="/projects/$code/task/$key" params={{ code, key: t.key }} title={title} className={className}>
          {children}
        </Link>
      )
    case 'meeting':
      return (
        <Link to="/projects/$code/meeting/$id" params={{ code, id: t.id }} title={title} className={className}>
          {children}
        </Link>
      )
    case 'meetings':
      return (
        <Link to="/projects/$code/meetings" params={{ code }} search={{}} title={title} className={className}>
          {children}
        </Link>
      )
    case 'schedule':
      return (
        <Link to="/projects/$code/schedule" params={{ code }} search={{}} title={title} className={className}>
          {children}
        </Link>
      )
    case 'week':
      return (
        <Link to="/projects/$code/week" params={{ code }} search={{ w: t.w }} title={title} className={className}>
          {children}
        </Link>
      )
    case 'personal':
      return (
        <Link to="/personal" search={{ tab: 'calendar', item: t.id, d: event.date }} title={title} className={className}>
          {children}
        </Link>
      )
    case 'inspection':
      return (
        <Link to="/projects/$code/inspection/$id" params={{ code, id: t.id }} title={title} className={className}>
          {children}
        </Link>
      )
    case 'inspection_schedule':
      return (
        <Link to="/projects/$code/inspections" params={{ code }} search={{ tab: 'schedule' }} title={title} className={className}>
          {children}
        </Link>
      )
    case 'document':
      return (
        <Link to="/projects/$code/document/$id" params={{ code, id: t.id }} search={{}} title={title} className={className}>
          {children}
        </Link>
      )
  }
}

function tooltip(e: CalendarEvent): string {
  const when = e.time ? `${e.time}${e.endTime ? `–${e.endTime}` : ''} · ` : ''
  const flag = e.tone === 'overdue' ? tr(' · просрочено') : e.tone === 'planned' ? tr(' · ожидается') : e.tone === 'done' ? tr(' · завершено') : ''
  return `${KINDS[e.kind].label} · ${when}${e.title}${e.meta ? ` · ${e.meta}` : ''}${flag}`
}

function toneClasses(e: CalendarEvent): string {
  const base = e.tone === 'overdue' ? OVERDUE_CHIP : KINDS[e.kind].chip
  if (e.tone === 'done') return `${base} opacity-60`
  if (e.tone === 'planned') return `${base} outline outline-1 -outline-offset-1 outline-dashed outline-foreground/30`
  return base
}

/** Компактная плашка для ячеек сетки. */
export function EventChip({ event, code }: { event: CalendarEvent; code: string }) {
  const Icon = KINDS[event.kind].icon
  return (
    <EventLink
      event={event}
      code={code}
      className={`flex min-h-6 min-w-0 items-center gap-1 rounded border-l-[3px] px-1.5 py-0.5 text-xs leading-tight outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring ${toneClasses(event)}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {event.time && <span className="shrink-0 tabular-nums">{event.time}</span>}
      <span className={`truncate ${event.tone === 'done' ? 'line-through' : ''}`}>{event.title}</span>
    </EventLink>
  )
}

/** Строка повестки: время, значок, название и пояснение. Зона нажатия не меньше 44 px. */
export function EventRow({ event, code }: { event: CalendarEvent; code: string }) {
  const kind = KINDS[event.kind]
  const Icon = kind.icon
  return (
    <EventLink
      event={event}
      code={code}
      className={`flex min-h-11 items-center gap-3 rounded-md border-l-4 px-3 py-2 outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring ${toneClasses(event)}`}
    >
      <span className="w-16 shrink-0 text-xs tabular-nums">{event.time ?? tr('весь день')}</span>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm font-medium ${event.tone === 'done' ? 'line-through' : ''}`}>{event.title}</span>
        <span className="truncate text-xs opacity-80">
          {kind.label}
          {event.tone === 'overdue' && tr(' · просрочено')}
          {event.tone === 'planned' && tr(' · ожидается')}
          {event.meta ? ` · ${event.meta}` : ''}
        </span>
      </span>
    </EventLink>
  )
}
