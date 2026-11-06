import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarDays, CheckCheck, ClipboardCheck, LayoutDashboard, ListChecks, Plus, Repeat, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-provider'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { dayMonthShort, todayIso } from '@/features/calendar/dates'
import { inspectionsQuery, schedulesQuery, taskStatsQuery, type InspectionRow, type ItemStatus, type TaskStats } from '@/features/inspections/api'
import { ReportStatusBadge, ResultBadge } from '@/features/inspections/badges'
import { NewInspectionDialog } from '@/features/inspections/new-dialog'
import { InspectionOverview } from '@/features/inspections/overview'
import { SchedulesTab } from '@/features/inspections/schedules'
import { monthRangeOf, RangeReport } from '@/features/inspections/range-report'
import { computePlaces, type DateRange } from '@/features/inspections/stats'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { organizationsListQuery } from '@/features/volumes/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const TABS = ['overview', 'calendar', 'list', 'schedule'] as const
type Tab = (typeof TABS)[number]

// Паттерн «Дашборд + список»: обзор инспекций (охват мест, итоги, устранение, динамика), календарь, список отчётов и расписание повторов.
// Вкладка и вид календаря живут в адресе: ссылкой на нужную вкладку можно поделиться.
export const Route = createFileRoute('/_app/projects/$code/inspections')({
  validateSearch: z.object({
    tab: z.enum(TABS).optional().catch(undefined),
    view: z.enum(['month', 'week', 'day', 'agenda']).optional().catch(undefined),
    d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
    types: z.string().optional().catch(undefined),
    mine: z.boolean().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(inspectionsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(organizationsListQuery),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем инспекции…')}</p>,
  component: InspectionsPage,
})

function InspectionsPage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { session } = useAuth()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: reports } = useSuspenseQuery(inspectionsQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const canConduct = perms.includes('inspection.conduct')
  const { data: stats } = useQuery(taskStatsQuery(p.id))
  const { data: schedules = [] } = useQuery(schedulesQuery(p.id))

  const tab: Tab = search.tab ?? 'overview'
  const setTab = (t: Tab) => void navigate({ search: (prev) => ({ ...prev, tab: t === 'overview' ? undefined : t }), replace: true })

  const [state, setState] = useState<'all' | 'draft' | 'issued' | 'check'>('all')
  const [creating, setCreating] = useState<{ date?: string } | null>(null)

  const today = todayIso()
  const [range, setRange] = useState<DateRange>(() => monthRangeOf(todayIso()))
  const places = useMemo(() => computePlaces(locations, reports, schedules, today), [locations, reports, schedules, today])
  const overdueSchedules = schedules.filter((s) => s.active && s.next_due < today).length

  const tabs: { id: Tab; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { id: 'overview', label: tr('Обзор'), icon: LayoutDashboard },
    { id: 'calendar', label: tr('Календарь'), icon: CalendarDays },
    { id: 'list', label: tr('Отчёты'), icon: ListChecks, count: reports.length },
    { id: 'schedule', label: tr('Расписание'), icon: Repeat, count: overdueSchedules > 0 ? overdueSchedules : undefined },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="inspections" title={tr('Что такое инспекция работ')}>
        <p>{tr('Выберите место, пройдите по разделам и отметьте замечания на схеме и фото. Статус каждого замечания: A — принято, C — принято с замечаниями, R — не принято; итог берётся по худшему. Готовый отчёт подписывают и выгружают в PDF.')}</p>
        <p>{tr('Вкладка «Обзор» показывает, сколько мест принято и не проверено, как устраняются замечания и когда инспекция была в последний раз. В «Расписании» задаётся период, по которому отчёт создаётся заново.')}</p>
      </PageHelp>

      <div className="flex flex-wrap items-end gap-2">
        <div role="tablist" aria-label={tr('Разделы инспекций')} className="-mx-4 flex min-w-0 flex-1 gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const on = t.id === tab
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`insp-tab-${t.id}`}
                aria-selected={on}
                aria-controls="insp-tabpanel"
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const i = TABS.indexOf(tab)
                  const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length] : null
                  if (next) {
                    e.preventDefault()
                    setTab(next)
                    requestAnimationFrame(() => document.getElementById(`insp-tab-${next}`)?.focus())
                  }
                }}
                className={cn(
                  'relative flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  on ? 'font-semibold text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-signal' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
                {t.count !== undefined && (
                  <span className={cn('rounded-full px-1.5 text-xs tabular-nums', t.id === 'schedule' ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground')}>{t.count}</span>
                )}
              </button>
            )
          })}
        </div>
        {canConduct && (
          <Button className="order-first h-12 w-full text-base sm:order-last sm:h-9 sm:w-auto sm:text-sm" onClick={() => setCreating({})}>
            <Plus /> {tr('Новая инспекция')}
          </Button>
        )}
      </div>

      <div role="tabpanel" id="insp-tabpanel" aria-labelledby={`insp-tab-${tab}`} className="flex flex-col gap-4">
        {tab === 'overview' && (
          <InspectionOverview
            code={p.code}
            reports={reports}
            places={places}
            locations={locations}
            stats={stats}
            schedules={schedules}
            today={today}
            onTab={setTab}
            onShowReady={() => {
              setState('check')
              setTab('list')
            }}
          />
        )}

        {tab === 'calendar' && (
          <RangeReport
            code={p.code}
            today={today}
            range={range}
            reports={reports}
            locations={locations}
            onRange={(r) => {
              setRange(r)
              // календарь переходит к началу выбранного периода
              if (r.from) void navigate({ search: (prev) => ({ ...prev, d: r.from ?? undefined }), replace: true })
            }}
          />
        )}

        {tab === 'calendar' && (
          <CalendarPage
            project={{ id: p.id, code: p.code, timezone: p.timezone }}
            only={['inspections']}
            label={tr('Календарь инспекций')}
            userId={session!.user.id}
            permissions={perms}
            search={search}
            setSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
            actions={
              canConduct
                ? (anchor) => (
                    <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => setCreating({ date: anchor })}>
                      <Plus /> {tr('Инспекция на')} {dayMonthShort(anchor)}
                    </Button>
                  )
                : undefined
            }
          />
        )}

        {tab === 'list' && <ReportList code={p.code} projectId={p.id} reports={reports} stats={stats} state={state} setState={setState} canConduct={canConduct} />}

        {tab === 'schedule' && <SchedulesTab projectId={p.id} code={p.code} schedules={schedules} places={places} locations={locations} canConduct={canConduct} today={today} />}
      </div>

      {creating && <NewInspectionDialog projectId={p.id} code={p.code} initialDate={creating.date} onClose={() => setCreating(null)} />}
    </div>
  )
}

function ReportList({
  code,
  projectId,
  reports,
  stats,
  state,
  setState,
  canConduct,
}: {
  code: string
  projectId: string
  reports: InspectionRow[]
  stats: Map<string, TaskStats> | undefined
  state: 'all' | 'draft' | 'issued' | 'check'
  setState: (s: 'all' | 'draft' | 'issued' | 'check') => void
  canConduct: boolean
}) {
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<ItemStatus | ''>('')
  const [placeId, setPlaceId] = useState<string | null>(null)

  const placePath = placeId ? (locations.find((l) => l.id === placeId)?.path ?? null) : null

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return reports.filter(
      (r) =>
        (state === 'all' || (state === 'check' ? !!stats?.get(r.id)?.ready : r.status === state)) &&
        (!result || r.result === result) &&
        (!placePath || r.location?.path === placePath || r.location?.path.startsWith(`${placePath}.`)) &&
        (!q || [r.key, r.title, r.contractor?.name, r.location ? locationLabel(r.location.path, locations) : ''].some((s) => s?.toLowerCase().includes(q))),
    )
  }, [reports, state, result, placePath, query, locations, stats])
  const waiting = reports.filter((r) => stats?.get(r.id)?.ready).length

  const filtered = !!query || state !== 'all' || !!result || !!placeId

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={tr('Найти отчёт')}
            placeholder={tr('Номер, место, подрядчик')}
            className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select aria-label={tr('Состояние отчёта')} value={state} onChange={(e) => setState(e.target.value as typeof state)} className="h-11 min-w-0 rounded-md border bg-background px-2 text-sm sm:h-10 sm:shrink-0">
            <option value="all">{tr('Любое состояние')}</option>
            <option value="draft">{tr('Черновики')}</option>
            <option value="issued">{tr('Выданные')}</option>
            <option value="check">{tr('Ждут проверки')}</option>
          </select>
          <select aria-label={tr('Итог')} value={result} onChange={(e) => setResult(e.target.value as ItemStatus | '')} className="h-11 min-w-0 rounded-md border bg-background px-2 text-sm sm:h-10 sm:shrink-0">
            <option value="">{tr('Любой итог')}</option>
            <option value="A">{tr('A · принято')}</option>
            <option value="C">{tr('C · с замечаниями')}</option>
            <option value="R">{tr('R · не принято')}</option>
          </select>
        </div>
        <div className="flex items-center gap-1 sm:shrink-0">
          <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
            <LocationPicker projectId={projectId} value={placeId} onChange={setPlaceId} placeholder={tr('Любое место')} />
          </div>
          {placeId && (
            <Button type="button" variant="ghost" size="icon" aria-label={tr('Сбросить место')} onClick={() => setPlaceId(null)}>
              <X />
            </Button>
          )}
        </div>
      </div>

      {waiting > 0 && state !== 'check' && (
        <button
          type="button"
          onClick={() => setState('check')}
          className="flex min-h-12 items-center gap-3 rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-4 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CheckCheck className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
          <span className="flex-1 font-medium">{tr('Задачи выполнены, ждут проверки: {{n}}', { n: waiting })}</span>
          <span className="text-muted-foreground">{tr('Показать')}</span>
        </button>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          <ClipboardCheck className="size-5" aria-hidden />
          {reports.length === 0
            ? canConduct
              ? tr('Инспекций пока нет. Создайте первую: выберите место и пройдите по разделам.')
              : tr('Инспекций пока нет.')
            : filtered
              ? tr('По этим условиям отчётов нет. Ослабьте фильтры.')
              : ''}
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {shown.map((r) => (
            <li key={r.id}>
              <ReportRow r={r} code={code} labels={locations} stat={stats?.get(r.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ReportRow({ r, code, labels, stat }: { r: InspectionRow; code: string; labels: Parameters<typeof locationLabel>[1]; stat?: TaskStats }) {
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <Link
      to="/projects/$code/inspection/$id"
      params={{ code, id: r.id }}
      className="flex flex-wrap items-start gap-x-4 gap-y-1.5 p-3 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="ident text-xs text-muted-foreground">{r.key}</span>
          <span className="font-medium">{r.title}</span>
          {r.schedule_id && <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] text-muted-foreground"><Repeat className="size-3" aria-hidden />{tr('по расписанию')}</span>}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {r.location && <span>{locationLabel(r.location.path, labels)}</span>}
          {r.contractor && <span>{r.contractor.name}</span>}
          <span>{dateFmt.format(new Date(`${r.inspection_date}T12:00:00`))}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">
        {r.cnt_r > 0 && <span className="text-red-700 dark:text-red-300">{tr('не принято: {{n}}', { n: r.cnt_r })}</span>}
        {r.cnt_c > 0 && <span>{tr('с замечаниями: {{n}}', { n: r.cnt_c })}</span>}
        {r.cnt_open > 0 && <span>{tr('без статуса: {{n}}', { n: r.cnt_open })}</span>}
      </span>
      <span className="flex items-center gap-2">
        {(r.result || r.status === 'issued') && <ResultBadge result={r.result} />}
        <ReportStatusBadge status={r.status} />
      </span>
      {stat && <TaskLine s={stat} />}
    </Link>
  )
}

/** Строка задач в списке: сколько создано, в работе и выполнено, полоса прогресса; когда всё выполнено, заметная плашка «зайдите проверить». */
function TaskLine({ s }: { s: TaskStats }) {
  const doneAll = s.resolved >= s.remarks
  const pct = (n: number) => `${Math.round((n / s.remarks) * 100)}%`
  const inWork = s.active + s.review
  return (
    <span className="flex basis-full flex-col gap-2">
      {s.ready && (
        <span className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-500/15 px-3 text-sm font-medium">
          <CheckCheck className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
          {tr('Всё выполнено: зайдите проверить')}
        </span>
      )}
      {doneAll && !s.ready && (
        <span className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCheck className="size-4" aria-hidden /> {tr('Всё устранено')}
        </span>
      )}
      <span className="flex flex-col gap-1.5">
        <span role="progressbar" aria-valuenow={s.resolved} aria-valuemin={0} aria-valuemax={s.remarks} aria-label={tr('Устранено {{n}} из {{total}}', { n: s.resolved, total: s.remarks })} className="flex h-2 overflow-hidden rounded-full bg-muted">
          <span className="h-full bg-emerald-600" style={{ width: pct(s.resolved) }} />
          <span className="h-full bg-emerald-600/35" style={{ width: pct(Math.max(0, s.done - s.resolved)) }} />
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <span>{tr('Задач: {{n}} из {{total}}', { n: s.with_task, total: s.remarks })}</span>
          {inWork > 0 && <span>{tr('в работе: {{n}}', { n: inWork })}</span>}
          {s.done > 0 && <span>{tr('выполнено: {{n}}', { n: s.done })}</span>}
          {s.resolved > 0 && <span>{tr('устранено: {{n}}', { n: s.resolved })}</span>}
          {s.overdue > 0 && <span className="font-semibold text-red-700 dark:text-red-300">{tr('просрочено: {{n}}', { n: s.overdue })}</span>}
        </span>
      </span>
    </span>
  )
}
