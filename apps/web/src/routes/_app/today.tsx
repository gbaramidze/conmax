import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AlertTriangle, BellRing, CalendarCheck, ChevronRight, ClipboardCheck, FileText, Footprints, ShieldCheck, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '@/features/auth/auth-provider'
import { notificationsQuery } from '@/features/notifications/api'
import { projectsQuery } from '@/features/projects/api'
import { DEFAULT_TASK_SEARCH, PRIORITY_LABELS } from '@/features/tasks/api'
import {
  addDaysISO,
  awaitingMyReviewQuery,
  daysBetween,
  docsToAckQuery,
  myDraftWalksAllQuery,
  myOpenTasksQuery,
  todayISO,
  type TodayTask,
} from '@/features/today/api'
import { meQuery } from '@/features/auth/api'

// Паттерн «Dashboard / Overview»: что мне делать сегодня — по всем проектам
export const Route = createFileRoute('/_app/today')({
  loader: async ({ context: { queryClient, auth } }) => {
    const uid = auth.session!.user.id
    await Promise.all([
      queryClient.ensureQueryData(meQuery),
      queryClient.ensureQueryData(projectsQuery),
      queryClient.ensureQueryData(myOpenTasksQuery(uid)),
      queryClient.ensureQueryData(awaitingMyReviewQuery(uid)),
      queryClient.ensureQueryData(docsToAckQuery),
      queryClient.ensureQueryData(myDraftWalksAllQuery(uid)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Собираем ваш день…')}</p>,
  component: TodayPage,
})

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? tr('Доброй ночи') : h < 12 ? tr('Доброе утро') : h < 18 ? tr('Добрый день') : tr('Добрый вечер')
}

function TaskRow({ t, overdueDays }: { t: TodayTask; overdueDays?: number }) {
  if (!t.project) return null
  return (
    <li>
      <Link
        to="/projects/$code/task/$key"
        params={{ code: t.project.code, key: t.key }}
        className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="ident">{t.key}</span>
            {t.status && <span>{t.status.name}</span>}
            {(t.priority === 'high' || t.priority === 'critical') && (
              <span className="font-medium text-red-700 dark:text-red-300">{PRIORITY_LABELS[t.priority]}</span>
            )}
          </span>
        </span>
        {overdueDays !== undefined && overdueDays > 0 ? (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
            <AlertTriangle className="size-3.5" aria-hidden /> {overdueDays}{tr('дн.')}</span>
        ) : (
          t.due_date && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{shortDate.format(new Date(`${t.due_date}T12:00:00`))}</span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  )
}

function Section({ title, count, tone, children }: { title: string; count: number; tone?: 'danger'; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {title}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone === 'danger' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}>{count}</span>
      </h2>
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">{children}</ul>
    </section>
  )
}

function TodayPage() {
  const { session } = useAuth()
  const uid = session!.user.id
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: tasks } = useSuspenseQuery(myOpenTasksQuery(uid))
  const { data: review } = useSuspenseQuery(awaitingMyReviewQuery(uid))
  const { data: ackDocs } = useSuspenseQuery(docsToAckQuery)
  const { data: walks } = useSuspenseQuery(myDraftWalksAllQuery(uid))
  const { data: unread } = useQuery({ ...notificationsQuery('all'), select: (rows) => rows.filter((n) => !n.read_at) })

  const today = todayISO()
  const weekEnd = addDaysISO(today, 7)
  const buckets = useMemo(() => {
    const overdue = tasks.filter((t) => t.due_date && t.due_date < today)
    const dueToday = tasks.filter((t) => t.due_date === today)
    const week = tasks.filter((t) => t.due_date && t.due_date > today && t.due_date <= weekEnd)
    const later = tasks.filter((t) => t.due_date && t.due_date > weekEnd)
    const noDue = tasks.filter((t) => !t.due_date)
    return { overdue, dueToday, week, later, noDue }
  }, [tasks, today, weekEnd])

  const projectById = new Map(projects.map((p) => [p.id, p]))
  const attention = ackDocs.length + review.length + walks.length + (unread?.length ?? 0)
  const nothing = tasks.length === 0 && attention === 0
  const firstName = me.full_name.split(/\s+/)[0]

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{dateFmt.format(new Date())}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tasks.length === 0
            ? tr('Открытых задач на вас нет.')
            : tr('Открытых задач: {{total}}{{late}}{{today}}.', { total: tasks.length, late: buckets.overdue.length ? tr(', просрочено: {{length}}', { length: buckets.overdue.length }) : '', today: buckets.dueToday.length ? tr(', на сегодня: {{length}}', { length: buckets.dueToday.length }) : '' })}
        </p>
      </header>

      {nothing && (
        <div className="flex items-start gap-3 rounded-lg border bg-card p-5 shadow-soft">
          <Sparkles className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">{tr('На сегодня всё чисто')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tr('Задач, ознакомлений и незавершённых обходов нет. Откройте проект, чтобы увидеть общую картину.')}</p>
            <Link to="/projects" className="mt-2 inline-block text-sm font-medium underline underline-offset-4">{tr('К проектам')}</Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Section title={tr('Просрочено')} count={buckets.overdue.length} tone="danger">
            {buckets.overdue.map((t) => (
              <TaskRow key={t.id} t={t} overdueDays={daysBetween(t.due_date!, today)} />
            ))}
          </Section>
          <Section title={tr('Сегодня')} count={buckets.dueToday.length}>
            {buckets.dueToday.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </Section>
          <Section title={tr('На этой неделе')} count={buckets.week.length}>
            {buckets.week.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </Section>
          {buckets.later.length + buckets.noDue.length > 0 && (
            <p className="text-sm text-muted-foreground">{tr('Дальше и без срока:')}{' '}{buckets.later.length + buckets.noDue.length}
              {projects[0] && (
                <>
                  {' · '}
                  <Link to="/projects/$code/tasks" params={{ code: projects[0].code }} search={{ ...DEFAULT_TASK_SEARCH, filter: 'mine' }} className="underline underline-offset-4">{tr('все мои задачи')}</Link>
                </>
              )}
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label={tr('Требует вашего внимания')}>
          {unread && unread.length > 0 && (
            <Card icon={<BellRing className="size-4" aria-hidden />} title={tr('Непрочитанные уведомления')} count={unread.length}>
              {unread.slice(0, 4).map((n) => (
                <li key={n.id} className="px-4 py-2.5 text-sm">
                  <span className="block truncate font-medium">{n.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                </li>
              ))}
              <li>
                <Link to="/inbox" search={{ tab: 'all' }} className="flex min-h-11 items-center justify-between px-4 text-sm font-medium hover:bg-muted/40">{tr('Открыть все')}{' '}<ChevronRight className="size-4" aria-hidden />
                </Link>
              </li>
            </Card>
          )}

          {ackDocs.length > 0 && (
            <Card icon={<FileText className="size-4" aria-hidden />} title={tr('Ознакомьтесь с документами')} count={ackDocs.length}>
              {ackDocs.slice(0, 5).map((d) => {
                const p = projectById.get(d.project_id)
                if (!p) return null
                return (
                  <li key={d.id}>
                    <Link to="/projects/$code/document/$id" params={{ code: p.code, id: d.id }} className="flex min-h-12 flex-col justify-center px-4 py-1.5 hover:bg-muted/40">
                      <span className="truncate text-sm font-medium">{d.title}</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="ident">{p.code}</span>
                        {d.current_revision ? tr(' · ревизия {{current_revision}}', { current_revision: d.current_revision }) : ''}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </Card>
          )}

          {review.length > 0 && (
            <Card icon={<ClipboardCheck className="size-4" aria-hidden />} title={tr('Ждут вашей проверки')} count={review.length}>
              {review.slice(0, 5).map((t) => (
                <TaskRow key={t.id} t={t} />
              ))}
            </Card>
          )}

          {walks.length > 0 && (
            <Card icon={<Footprints className="size-4" aria-hidden />} title={tr('Незавершённые обходы')} count={walks.length}>
              {walks.map((w) =>
                w.project ? (
                  <li key={w.id}>
                    <Link to="/projects/$code/walk/$id" params={{ code: w.project.code, id: w.id }} className="flex min-h-12 items-center gap-2 px-4 hover:bg-muted/40">
                      {w.kind === 'check' ? <ShieldCheck className="size-4 text-muted-foreground" aria-hidden /> : <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />}
                      <span className="ident text-xs text-muted-foreground">{w.project.code}</span>
                      <span className="ident text-sm">{w.location_path}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{w.kind === 'check' ? tr('проверка') : tr('отчёт')}</span>
                    </Link>
                  </li>
                ) : null,
              )}
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}

function Card({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-soft" aria-label={title}>
      <h2 className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
        {icon} {title}
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
      </h2>
      <ul className="flex flex-col divide-y">{children}</ul>
    </section>
  )
}
