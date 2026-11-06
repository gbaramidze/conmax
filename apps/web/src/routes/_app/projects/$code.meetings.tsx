import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarClock, Plus, Repeat, Search } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExportButton } from '@/features/export/export-button'
import { formatIn } from '@/features/meetings/time'
import { CreateMeetingDialog } from '@/features/meetings/create-dialog'
import {
  decisionRegistryQuery,
  MEETING_STATUS_LABELS,
  MEETING_STATUS_STYLES,
  MEETING_TYPE_LABELS,
  meetingsQuery,
  openActionsQuery,
  type MeetingRow,
} from '@/features/meetings/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { CATEGORY_STYLES, DEFAULT_TASK_SEARCH, TASK_TYPE_LABELS } from '@/features/tasks/api'

// Паттерн «Список / Index»: совещания проекта; рядом — реестр решений и невыполненные поручения
export const Route = createFileRoute('/_app/projects/$code/meetings')({
  validateSearch: z.object({
    tab: z.enum(['meetings', 'decisions', 'actions']).optional(),
    create: z.enum(['meeting']).optional().catch(undefined), // из «Создать» в верхней панели
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(meetingsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем совещания…')}</p>,
  component: MeetingsPage,
})

const dateTimeOpts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })

const isMoved = (m: MeetingRow) => m.original_at !== null && new Date(m.original_at).getTime() !== new Date(m.scheduled_at).getTime()

const TABS = [
  ['meetings', tr('Совещания')],
  ['decisions', tr('Решения')],
  ['actions', tr('Поручения')],
] as const

function StatusBadge({ status }: { status: MeetingRow['status'] }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_STYLES[status]}`}>{MEETING_STATUS_LABELS[status]}</span>
}

function MeetingsPage() {
  const { code } = Route.useParams()
  const { tab = 'meetings', create } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: meetings } = useSuspenseQuery(meetingsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canCreate = permissions.includes('meeting.create')
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (create === 'meeting' && canCreate) setCreating(true)
    if (create) void navigate({ search: (prev) => ({ ...prev, create: undefined }), replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create])

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="meetings" title={tr('Что здесь можно делать')}>
        <p>{tr('Совещание перестаёт быть разговором, после которого ничего не остаётся. В карточке совещания записываются решения и поручения: поручение сразу становится задачей с исполнителем и сроком, а исполнитель получает уведомление.')}</p>
        <p>{tr('Вкладка «Решения» — общий реестр принятых решений проекта, «Поручения» — всё, что выдано на совещаниях и ещё не выполнено. Совещание можно записать на звук: система расшифрует запись и предложит черновик протокола.')}</p>
      </PageHelp>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Планёрки и встречи с повесткой, решениями и поручениями. Поручения становятся обычными задачами со сроком и исполнителем.')}</p>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus />{tr('Новое совещание')}</Button>
        )}
      </div>

      <nav aria-label={tr('Разделы')} className="flex gap-1 border-b">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            to="/projects/$code/meetings"
            params={{ code }}
            search={{ tab: value }}
            aria-current={tab === value ? 'page' : undefined}
            className={`-mb-px min-h-11 content-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'meetings' && <MeetingList code={code} projectCode={p.code} timezone={p.timezone} meetings={meetings} canCreate={canCreate} onCreate={() => setCreating(true)} />}
      <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}>
        {tab === 'decisions' && <DecisionRegistry code={code} projectId={p.id} />}
        {tab === 'actions' && <OpenActions code={code} projectId={p.id} />}
      </Suspense>

      {creating && <CreateMeetingDialog projectId={p.id} code={code} timezone={p.timezone} onClose={() => setCreating(false)} />}
    </div>
  )
}

function MeetingList({
  code,
  projectCode,
  timezone,
  meetings,
  canCreate,
  onCreate,
}: {
  code: string
  projectCode: string
  timezone: string
  meetings: MeetingRow[]
  canCreate: boolean
  onCreate: () => void
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return meetings.filter((m) => !q || m.title.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
  }, [meetings, query])

  // ближайшие — по возрастанию даты, прошедшие — свежие сверху
  const { upcoming, past } = useMemo(() => {
    const open = (m: MeetingRow) => m.status === 'scheduled' || m.status === 'in_progress'
    return {
      upcoming: visible.filter(open).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      past: visible.filter((m) => !open(m)),
    }
  }, [visible])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label={tr('Поиск по теме совещания')} placeholder={tr('Тема или номер')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">{tr('Совещаний:')}{' '}{visible.length}</span>
        <div className="ml-auto">
          <ExportButton
            fileName={tr('Совещания {{projectCode}}', { projectCode })}
            disabled={visible.length === 0}
            build={() => ({
              name: tr('Совещания'),
              headers: [tr('Номер'), tr('Тема'), tr('Вид'), tr('Дата'), tr('Место'), tr('Статус'), tr('Участников'), tr('Присутствовало'), tr('Решений'), tr('Поручений'), tr('Открыто')],
              rows: visible.map((m) => [
                m.key,
                m.title,
                MEETING_TYPE_LABELS[m.type],
                formatIn(m.scheduled_at, timezone, { dateStyle: 'short', timeStyle: 'short' }),
                m.place ?? '',
                MEETING_STATUS_LABELS[m.status],
                m.participants_count,
                m.present_count,
                m.decisions_count,
                m.actions_count,
                m.open_actions_count,
              ]),
            })}
          />
        </div>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {canCreate ? (
            <>{tr('Совещаний пока нет. Назначьте первое — участники получат приглашение, а решения и поручения сохранятся в проекте.')}{' '}
              <button type="button" onClick={onCreate} className="font-medium text-foreground underline underline-offset-2">{tr('Назначить совещание')}</button>
            </>
          ) : (
            tr('Совещаний пока нет.')
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{tr('По этому запросу ничего нет.')}</div>
      ) : (
        <>
          {upcoming.length > 0 && <MeetingGroup title={tr('Предстоящие и идущие')} code={code} timezone={timezone} rows={upcoming} />}
          {past.length > 0 && <MeetingGroup title={tr('Прошедшие')} code={code} timezone={timezone} rows={past} />}
        </>
      )}
    </div>
  )
}

function MeetingGroup({ title, code, timezone, rows }: { title: string; code: string; timezone: string; rows: MeetingRow[] }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((m) => (
          <li key={m.id}>
            <Link to="/projects/$code/meeting/$id" params={{ code, id: m.id }} className="flex flex-col gap-2 rounded-lg border bg-card p-3.5 shadow-soft active:bg-muted">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-medium">{m.title}</span>
                <StatusBadge status={m.status} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="ident">{m.key}</span>
                <span>{formatIn(m.scheduled_at, timezone, dateTimeOpts)}</span>
                {isMoved(m) && <span className="text-amber-800 dark:text-amber-300">{tr('перенесено')}</span>}
                {m.series_id && <span className="inline-flex items-center gap-1"><Repeat className="size-3" aria-hidden />{tr('регулярное')}</span>}
                <span>{MEETING_TYPE_LABELS[m.type]}</span>
                <span>{tr('Участников:')}{' '}{m.participants_count}</span>
                {m.open_actions_count > 0 && <span>{tr('Открытых поручений:')}{' '}{m.open_actions_count}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border bg-card shadow-soft md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>{tr('Совещание')}</TableHead>
              <TableHead className="w-44">{tr('Когда')}</TableHead>
              <TableHead className="w-40">{tr('Статус')}</TableHead>
              <TableHead className="w-24 text-right">{tr('Людей')}</TableHead>
              <TableHead className="w-24 text-right">{tr('Решений')}</TableHead>
              <TableHead className="w-32 text-right">{tr('Поручений')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id} className="relative">
                <TableCell className="whitespace-normal">
                  <Link
                    to="/projects/$code/meeting/$id"
                    params={{ code, id: m.id }}
                    className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-offset-[-2px]"
                  >
                    {m.title}
                  </Link>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    <span className="ident">{m.key}</span> · {MEETING_TYPE_LABELS[m.type]}
                    {m.visibility === 'external' && tr(' · с внешними')}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatIn(m.scheduled_at, timezone, dateTimeOpts)}
                  {isMoved(m) && <span className="block text-xs text-amber-800 dark:text-amber-300">{tr('перенесено')}</span>}
                  {m.series_id && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs">
                      <Repeat className="size-3" aria-hidden />{tr('регулярное')}</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.participants_count}</TableCell>
                <TableCell className="text-right tabular-nums">{m.decisions_count || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.actions_count === 0 ? '—' : m.open_actions_count > 0 ? tr('{{open_actions_count}} из {{actions_count}} открыто', { open_actions_count: m.open_actions_count, actions_count: m.actions_count }) : tr('{{actions_count}} · все закрыты', { actions_count: m.actions_count })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function DecisionRegistry({ code, projectId }: { code: string; projectId: string }) {
  const { data: decisions } = useSuspenseQuery(decisionRegistryQuery(projectId))
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = decisions.filter((d) => !q || d.text.toLowerCase().includes(q) || (d.meeting?.title ?? '').toLowerCase().includes(q))

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label={tr('Поиск по решениям')} placeholder={tr('Текст решения или совещание')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {visible.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {decisions.length === 0 ? tr('Решений пока нет. Их фиксирует ведущий во время совещания.') : tr('По этому запросу решений нет.')}
        </div>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {visible.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 px-4 py-3">
              <p className="text-sm">{d.text}</p>
              {d.meeting && (
                <Link to="/projects/$code/meeting/$id" params={{ code, id: d.meeting.id }} className="w-fit text-xs text-muted-foreground hover:underline">
                  <span className="ident">{d.meeting.key}</span> · {d.meeting.title} · {dateFmt.format(new Date(d.meeting.scheduled_at))}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OpenActions({ code, projectId }: { code: string; projectId: string }) {
  const { data: actions } = useSuspenseQuery(openActionsQuery(projectId))
  const today = new Date().toLocaleDateString('sv')

  return actions.length === 0 ? (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{tr('Невыполненных поручений с совещаний нет.')}</div>
  ) : (
    <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
      {actions.map((a) => {
        const late = a.due_date !== null && a.due_date < today
        return (
          <li key={a.id}>
            <Link to="/projects/$code/tasks/$key" params={{ code, key: a.key }} search={DEFAULT_TASK_SEARCH} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40">
              <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-sm font-medium">{a.title}</span>
              <span className="ident text-xs text-muted-foreground">{a.key}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${CATEGORY_STYLES[a.status_category]}`}>{TASK_TYPE_LABELS.action_item}</span>
              <span className="text-xs text-muted-foreground">{a.assignee?.full_name ?? tr('без исполнителя')}</span>
              {a.due_date && <span className={`text-xs ${late ? 'font-medium text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>{late ? tr('просрочено · ') : tr('до ')}{dateFmt.format(new Date(a.due_date))}</span>}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
