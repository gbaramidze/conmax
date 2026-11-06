import { tr } from '@/lib/tr'
import { EventChip, EventRow } from '@/features/calendar/event-link'
import { KINDS } from '@/features/calendar/kinds'
import { dayShort, dayTitle, inMonth, WEEKDAYS } from '@/features/calendar/dates'
import type { CalendarEvent } from '@/features/calendar/types'

type ByDay = Map<string, CalendarEvent[]>

interface ViewProps {
  anchor: string
  today: string
  byDay: ByDay
  code: string
  onSelect: (iso: string) => void
  onOpenDay: (iso: string) => void
}

const noEvents = (byDay: ByDay, iso: string) => (byDay.get(iso) ?? []).length === 0

function DayNumber({ iso, today, selected, onClick, className = '' }: { iso: string; today: string; selected: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dayTitle(iso)}
      aria-pressed={selected}
      className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        iso === today ? 'bg-primary font-semibold text-primary-foreground' : selected ? 'bg-muted font-semibold ring-1 ring-primary' : 'hover:bg-muted'
      } ${className}`}
    >
      {Number(iso.slice(8))}
    </button>
  )
}

/** Список событий одного дня — общий для «дня», «повестки» и телефонной сетки. */
function DayList({ iso, byDay, code }: { iso: string; byDay: ByDay; code: string }) {
  const list = byDay.get(iso) ?? []
  return (
    <div className="flex flex-col gap-1">
      {list.map((e) => (
        <EventRow key={e.id} event={e} code={code} />
      ))}
    </div>
  )
}

/** Месяц: на десктопе сетка с плашками, на телефоне — компактная сетка с точками и список выбранного дня под ней. */
export function MonthView({ anchor, days, desktop, ...p }: ViewProps & { days: string[]; desktop: boolean }) {
  const { today, byDay, code, onSelect, onOpenDay } = p

  if (!desktop) {
    return (
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((iso) => {
              const list = byDay.get(iso) ?? []
              const kinds = [...new Set(list.map((e) => e.kind))].slice(0, 4)
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => onSelect(iso)}
                  aria-label={`${dayTitle(iso)}${list.length ? tr(', событий: {{length}}', { length: list.length }) : ''}`}
                  aria-pressed={iso === anchor}
                  className={`flex min-h-12 flex-col items-center gap-1 border-b border-r px-0.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    inMonth(iso, anchor) ? '' : 'bg-muted/30 text-muted-foreground'
                  } ${iso === anchor ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''}`}
                >
                  <span className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${iso === today ? 'bg-primary font-semibold text-primary-foreground' : ''}`}>
                    {Number(iso.slice(8))}
                  </span>
                  <span className="flex h-1.5 gap-0.5" aria-hidden>
                    {kinds.map((k) => (
                      <span key={k} className={`size-1.5 rounded-full ${KINDS[k].dot}`} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <section aria-label={tr('События: {{v1}}', { v1: dayTitle(anchor) })} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{dayTitle(anchor)}{anchor === today ? tr(' · сегодня') : ''}</h3>
          {noEvents(byDay, anchor) ? <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">{tr('На этот день событий нет.')}</p> : <DayList iso={anchor} byDay={byDay} code={code} />}
        </section>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((iso) => {
          const list = byDay.get(iso) ?? []
          return (
            <div
              key={iso}
              className={`flex min-h-28 min-w-0 flex-col gap-1 border-b border-r p-1.5 ${inMonth(iso, anchor) ? '' : 'bg-muted/30 text-muted-foreground'} ${iso === anchor ? 'bg-primary/5 ring-2 ring-inset ring-primary/60' : ''}`}
            >
              <DayNumber iso={iso} today={today} selected={iso === anchor} onClick={() => onSelect(iso)} />
              {list.slice(0, 3).map((e) => (
                <EventChip key={e.id} event={e} code={code} />
              ))}
              {list.length > 3 && (
                <button type="button" onClick={() => onOpenDay(iso)} className="rounded px-1.5 text-left text-xs text-muted-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">{tr('ещё')}{' '}{list.length - 3}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Неделя: на десктопе семь колонок, на телефоне — дни друг под другом. */
export function WeekView({ days, desktop, ...p }: ViewProps & { days: string[]; desktop: boolean }) {
  const { today, byDay, code, anchor, onSelect, onOpenDay } = p
  if (desktop) {
    return (
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border bg-card shadow-soft">
        {days.map((iso) => (
          <div key={iso} className={`flex min-h-72 min-w-0 flex-col gap-1 border-r p-1.5 last:border-r-0 ${iso === anchor ? 'bg-primary/5' : ''}`}>
            <button
              type="button"
              onClick={() => onOpenDay(iso)}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${iso === today ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <span className={`flex size-6 items-center justify-center rounded-full tabular-nums ${iso === today ? 'bg-primary text-primary-foreground' : ''}`}>{Number(iso.slice(8))}</span>
              {dayShort(iso).split(' ')[0]}
            </button>
            {(byDay.get(iso) ?? []).map((e) => (
              <EventChip key={e.id} event={e} code={code} />
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {days.map((iso) => (
        <section key={iso} aria-label={dayTitle(iso)} className="flex flex-col gap-1.5">
          <h3 className={`text-sm font-medium ${iso === today ? 'text-foreground' : 'text-muted-foreground'}`}>
            <button type="button" onClick={() => onSelect(iso)} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {dayTitle(iso)}
            </button>
            {iso === today ? tr(' · сегодня') : ''}
          </h3>
          {noEvents(byDay, iso) ? <p className="pl-1 text-xs text-muted-foreground">{tr('Событий нет')}</p> : <DayList iso={iso} byDay={byDay} code={code} />}
        </section>
      ))}
    </div>
  )
}

export function DayView({ anchor, today, byDay, code }: ViewProps) {
  return (
    <section aria-label={dayTitle(anchor)} className="flex flex-col gap-2">
      {anchor === today && <p className="text-sm text-muted-foreground">{tr('Сегодня')}</p>}
      {noEvents(byDay, anchor) ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{tr('На этот день событий нет. Создайте совещание или задачу кнопкой «Создать».')}</p>
      ) : (
        <DayList iso={anchor} byDay={byDay} code={code} />
      )}
    </section>
  )
}

/** Повестка: только дни месяца, в которых что-то есть. */
export function AgendaView({ anchor, today, byDay, code, days }: ViewProps & { days: string[] }) {
  const filled = days.filter((iso) => inMonth(iso, anchor) && !noEvents(byDay, iso))
  if (filled.length === 0) return <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{tr('В этом месяце событий нет.')}</p>
  return (
    <div className="flex flex-col gap-4">
      {filled.map((iso) => (
        <section key={iso} aria-label={dayTitle(iso)} className="flex flex-col gap-1.5">
          <h3 className={`text-sm font-medium ${iso === today ? 'text-foreground' : 'text-muted-foreground'}`}>
            {dayTitle(iso)}
            {iso === today ? tr(' · сегодня') : ''}
          </h3>
          <DayList iso={iso} byDay={byDay} code={code} />
        </section>
      ))}
    </div>
  )
}
