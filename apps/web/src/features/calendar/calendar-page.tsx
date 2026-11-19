import { tr } from '@/lib/tr'
import { CalendarPlus, ChevronLeft, ChevronRight, ListChecks, ListFilter, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NewTaskDialog } from '@/features/tasks/new-task-dialog'
import { addDays, daysBetween, dayMonthShort, dayMonthYear, monthRange, periodTitle, shiftAnchor, todayIso, weekRange, type CalendarView } from '@/features/calendar/dates'
import { KINDS } from '@/features/calendar/kinds'
import type { CalendarContext, KindId } from '@/features/calendar/types'
import { DEFAULT_KINDS, groupByDay, useCalendarEvents, useMediaQuery } from '@/features/calendar/use-calendar'
import { AgendaView, DayView, MonthView, WeekView } from '@/features/calendar/views'
import { MobileCalendar, toMobileView } from '@/features/calendar/mobile'
import { CreateMeetingDialog } from '@/features/meetings/create-dialog'

export interface CalendarSearch {
  view?: CalendarView
  d?: string
  /** включённые типы через запятую; без параметра — набор по умолчанию */
  types?: string
  mine?: boolean
}

const VIEWS: [CalendarView, string][] = [
  ['month', tr('Месяц')],
  ['week', tr('Неделя')],
  ['day', tr('День')],
  ['agenda', tr('Повестка')],
]

interface Props {
  /** Проект календаря; без него это личный календарь (только источники из `only`) */
  project?: { id: string; code: string; timezone: string }
  /** Только эти источники, и все их типы включены по умолчанию (личный календарь) */
  only?: string[]
  /** Кнопка «Событие на дату» — для личного календаря */
  onCreateOwn?: (date: string) => void
  /** Свои действия рядом с видами (вместо «Создать на дату» с совещанием и задачей): календарь внутри другого раздела */
  actions?: (anchor: string) => ReactNode
  /** Название региона для чтения с экрана, если календарь встроен в раздел */
  label?: string
  /** Свои названия типов в меню телефона (личный календарь: «Задачи», «Встречи», «Напоминания») */
  kindLabels?: Partial<Record<KindId, string>>
  userId: string
  permissions: string[]
  search: CalendarSearch
  setSearch: (patch: Partial<CalendarSearch>) => void
}

/**
 * Календарь проекта: события из всех подключённых источников (features/calendar/providers).
 * Состояние — в адресе страницы: ссылкой на вид, дату и фильтры можно поделиться.
 */
export function CalendarPage({ project, only, onCreateOwn, actions, label, kindLabels, userId, permissions, search, setSearch }: Props) {
  const desktop = useMediaQuery('(min-width: 768px)')
  const today = todayIso()
  const anchor = search.d ?? today
  // на телефоне — свой календарь во весь экран (как в самом телефоне), если календарь не встроен в другой раздел
  const phone = !desktop && !actions
  const requested: CalendarView = search.view ?? (desktop || phone ? 'month' : 'agenda')
  // «3 дня» есть только на телефоне; на компьютере это неделя
  const view: CalendarView = desktop && requested === '3day' ? 'week' : requested

  // сетка зависит только от месяца: внутри месяца листание дней и недель не перезапрашивает данные
  const month = anchor.slice(0, 7)
  const threeDayEnd = view === '3day' ? addDays(anchor, 2) : ''
  const range = useMemo(() => {
    const r = monthRange(`${month}-01`)
    // три дня в конце месяца заходят за сетку месяца
    return threeDayEnd > r.to ? { ...r, to: threeDayEnd } : r
  }, [month, threeDayEnd])
  const ctx: CalendarContext = useMemo(
    () => ({ projectId: project?.id ?? '', code: project?.code ?? '', timezone: project?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, userId, permissions, range }),
    [project?.id, project?.code, project?.timezone, userId, permissions, range],
  )
  const { providers, events, loading, failed, refetch, refetchAll } = useCalendarEvents(ctx, only)

  const availableKinds = useMemo(() => [...new Set(providers.flatMap((p) => p.kinds))], [providers])
  const enabled = useMemo(() => {
    const picked = search.types ? search.types.split(',').filter((k): k is KindId => k in KINDS) : only ? availableKinds : DEFAULT_KINDS
    return new Set(picked.filter((k) => availableKinds.includes(k)))
  }, [search.types, availableKinds, only])
  const toggleKind = (k: KindId) => {
    const next = new Set(enabled)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    const list = availableKinds.filter((x) => next.has(x))
    const defaults = only ? availableKinds : DEFAULT_KINDS
    const isDefault = list.length === defaults.filter((x) => availableKinds.includes(x)).length && list.every((x) => defaults.includes(x))
    setSearch({ types: isDefault ? undefined : list.join(',') || 'none' })
  }

  const visible = useMemo(() => events.filter((e) => enabled.has(e.kind) && (!search.mine || e.mine)), [events, enabled, search.mine])
  const byDay = useMemo(() => groupByDay(visible), [visible])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [creating, setCreating] = useState<'meeting' | 'task' | null>(null)
  const canMeeting = !!project && permissions.includes('meeting.create')
  const canTask = !!project && permissions.includes('task.create')

  const days = view === 'week' ? daysBetween(weekRange(anchor).from, weekRange(anchor).to) : daysBetween(range.from, range.to)
  const viewProps = {
    anchor,
    today,
    byDay,
    code: project?.code ?? '',
    onSelect: (iso: string) => setSearch({ d: iso === today ? undefined : iso }),
    onOpenDay: (iso: string) => setSearch({ d: iso, view: 'day' }),
  }
  const filteredToZero = events.length > 0 && visible.length === 0

  const dialogs = (
    <>
      {project && creating === 'meeting' && <CreateMeetingDialog projectId={project.id} code={project.code} timezone={project.timezone} initialDate={anchor} onClose={() => setCreating(null)} />}
      {project && creating === 'task' && <NewTaskDialog projectId={project.id} defaultDue={anchor} canAssign={permissions.includes('task.assign')} onClose={() => setCreating(null)} />}
    </>
  )

  if (phone) {
    const fabClass =
      'fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
    const fab = onCreateOwn ? (
      <button type="button" onClick={() => onCreateOwn(anchor)} aria-label={`${tr('Событие на')} ${dayMonthShort(anchor)}`} className={fabClass}>
        <Plus className="size-7" />
      </button>
    ) : canMeeting || canTask ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${tr('Создать на')} ${dayMonthShort(anchor)}`} className={fabClass}>
            <Plus className="size-7" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr('На')}{' '}{dayMonthYear(anchor)}</DropdownMenuLabel>
          {canMeeting && (
            <DropdownMenuItem onSelect={() => setCreating('meeting')}>
              <CalendarPlus />{tr('Совещание')}</DropdownMenuItem>
          )}
          {canTask && (
            <DropdownMenuItem onSelect={() => setCreating('task')}>
              <ListChecks />{tr('Задача со сроком')}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null
    const notice = (failed.length > 0 || filteredToZero) && (
      <div className="mb-2 flex flex-col gap-2">
        {failed.length > 0 && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm">{tr('Не удалось загрузить:')}{' '}{failed.join(', ')}<Button type="button" size="sm" variant="outline" onClick={refetch}>{tr('Повторить')}</Button>
          </p>
        )}
        {filteredToZero && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 text-sm text-muted-foreground">{tr('События этого периода скрыты фильтрами.')}<Button type="button" size="sm" variant="outline" onClick={() => setSearch({ types: undefined, mine: undefined })}>{tr('Сбросить фильтры')}</Button>
          </p>
        )}
      </div>
    )
    const mobileView = toMobileView(view)
    return (
      <section aria-label={label ?? (project ? tr('Календарь проекта') : tr('Личный календарь'))}>
        <MobileCalendar
          view={mobileView}
          anchor={anchor}
          today={today}
          byDay={byDay}
          code={project?.code ?? ''}
          loading={loading}
          notice={notice || undefined}
          fab={fab}
          kinds={availableKinds}
          enabled={enabled}
          toggleKind={toggleKind}
          kindLabels={kindLabels}
          mine={only ? undefined : { on: !!search.mine, set: (on) => setSearch({ mine: on || undefined }) }}
          setView={(v) => setSearch({ view: v === 'month' ? undefined : v })}
          setAnchor={(iso) => setSearch({ d: iso === today ? undefined : iso })}
          shift={(dir) => {
            const next = shiftAnchor(mobileView, anchor, dir)
            setSearch({ d: next === today ? undefined : next })
          }}
          onRefresh={refetchAll}
        />
        {dialogs}
      </section>
    )
  }

  return (
    <section aria-label={label ?? (project ? tr('Календарь проекта') : tr('Личный календарь'))} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold" aria-live="polite">
          {periodTitle(view, anchor)}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label={tr('Назад')} title={tr('Назад')} onClick={() => setSearch({ d: shiftAnchor(view, anchor, -1) })}>
            <ChevronLeft />
          </Button>
          <Button type="button" variant="outline" onClick={() => setSearch({ d: undefined })}>{tr('Сегодня')}</Button>
          <Button type="button" variant="outline" size="icon" aria-label={tr('Вперёд')} title={tr('Вперёд')} onClick={() => setSearch({ d: shiftAnchor(view, anchor, 1) })}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={tr('Вид календаря')} className="flex w-full overflow-hidden rounded-lg border bg-card sm:w-auto">
          {VIEWS.map(([v, label], i) => (
            <Button
              key={v}
              type="button"
              variant={view === v ? 'secondary' : 'ghost'}
              aria-pressed={view === v}
              className={`min-h-11 flex-1 rounded-none px-3 sm:min-h-9 sm:flex-none ${i > 0 ? 'border-l' : ''}`}
              onClick={() => setSearch({ view: v })}
            >
              {label}
            </Button>
          ))}
        </div>

        {!only && <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:min-h-9">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!search.mine} onChange={(e) => setSearch({ mine: e.target.checked || undefined })} />{tr('Только мои')}</label>}
        {!only && <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" aria-expanded={filtersOpen} aria-controls="calendar-kinds" onClick={() => setFiltersOpen((o) => !o)}>
          <ListFilter />{tr('Типы событий')}<span className="text-muted-foreground">
            {enabled.size}{tr('из')}{' '}{availableKinds.length}
          </span>
        </Button>}

        {onCreateOwn && (
          <Button type="button" className="ml-auto min-h-11 sm:min-h-9" onClick={() => onCreateOwn(anchor)}>
            <Plus />{tr('Событие на')}{' '}{dayMonthShort(anchor)}
          </Button>
        )}

        {actions && <div className="ml-auto">{actions(anchor)}</div>}

        {!actions && (canMeeting || canTask) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" className="ml-auto min-h-11 sm:min-h-9">
                <Plus />{tr('Создать на')}{' '}{dayMonthShort(anchor)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr('На')}{' '}{dayMonthYear(anchor)}</DropdownMenuLabel>
              {canMeeting && (
                <DropdownMenuItem onSelect={() => setCreating('meeting')}>
                  <CalendarPlus />{tr('Совещание')}</DropdownMenuItem>
              )}
              {canTask && (
                <DropdownMenuItem onSelect={() => setCreating('task')}>
                  <ListChecks />{tr('Задача со сроком')}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {filtersOpen && (
        <div id="calendar-kinds" className="flex flex-col gap-3 rounded-lg border bg-card p-3">
          {providers.map((p) => (
            <fieldset key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="sr-only">{p.label}</legend>
              <span className="w-full text-xs font-medium text-muted-foreground sm:w-28">{p.label}</span>
              {p.kinds.map((k) => {
                const Icon = KINDS[k].icon
                return (
                  <label key={k} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm has-[:focus-visible]:rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:min-h-8">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={enabled.has(k)} onChange={() => toggleKind(k)} />
                    <span className={`size-2.5 shrink-0 rounded-full ${KINDS[k].dot}`} aria-hidden />
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {KINDS[k].label}
                  </label>
                )
              })}
            </fieldset>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{tr('Не удалось загрузить:')}{' '}{failed.join(', ')}{tr('. Остальные источники показаны.')}<Button type="button" size="sm" variant="outline" onClick={refetch}>{tr('Повторить')}</Button>
        </p>
      )}
      {loading && <p className="text-sm text-muted-foreground">{tr('Загружаем события…')}</p>}
      {filteredToZero && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm text-muted-foreground">{tr('События этого периода скрыты фильтрами.')}<Button type="button" size="sm" variant="outline" onClick={() => setSearch({ types: undefined, mine: undefined })}>{tr('Сбросить фильтры')}</Button>
        </p>
      )}

      {view === 'month' && <MonthView {...viewProps} days={days} desktop={desktop} />}
      {view === 'week' && <WeekView {...viewProps} days={days} desktop={desktop} />}
      {view === 'day' && <DayView {...viewProps} />}
      {view === 'agenda' && <AgendaView {...viewProps} days={days} />}

      {dialogs}
    </section>
  )
}
