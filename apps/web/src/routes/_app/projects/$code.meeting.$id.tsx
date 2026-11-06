import { BackButton } from '@/components/app-shell/back-button'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Ban, CalendarClock, CheckCircle2, ChevronLeft, ClipboardCopy, MapPin, Pencil, Play, Plus, Repeat, Send, Trash2, Undo2, X } from 'lucide-react'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { activityLoader } from '@/features/activity/loader'
import { useAuth } from '@/features/auth/auth-provider'
import {
  addAgendaItem,
  addDecision,
  addMeetingAction,
  addParticipant,
  agendaQuery,
  ATTENDANCE_LABELS,
  decisionsQuery,
  endMeetingSeries,
  meetingActionsQuery,
  meetingErrorText,
  meetingQuery,
  MEETING_STATUS_LABELS,
  MEETING_STATUS_STYLES,
  MEETING_TYPE_LABELS,
  minutesText,
  openActionsQuery,
  participantsQuery,
  removeAgendaItem,
  removeDecision,
  removeParticipant,
  rescheduleMeeting,
  seriesQuery,
  setAttendance,
  setMeetingStatus,
  slotsLabel,
  updateAgendaItem,
  updateMeeting,
  WEEKDAY_LONG,
  type AgendaRow,
  type Attendance,
  type MeetingDetail,
  type MeetingStatus,
  type MeetingType,
  type ParticipantRow,
} from '@/features/meetings/api'
import { myPermissionsQuery, projectByCodeQuery, projectMembersQuery } from '@/features/projects/api'
import { CATEGORY_STYLES, DEFAULT_TASK_SEARCH, PRIORITY_LABELS, TASK_TYPE_LABELS } from '@/features/tasks/api'
import { MeetingRecorder } from '@/features/meetings/recorder'
import { MeetingSummaries } from '@/features/meetings/summary'
import { formatIn, isoDow, isoToZoned, zonedToIso } from '@/features/meetings/time'
import { copyText } from '@/lib/utils'

// Паттерн «Detail / Record»: совещание — состав, повестка, решения, поручения, протокол и обсуждение
export const Route = createFileRoute('/_app/projects/$code/meeting/$id')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    const meeting = await queryClient.ensureQueryData(meetingQuery(params.id))
    if (!meeting) throw notFound()
    await Promise.all([
      queryClient.ensureQueryData(participantsQuery(meeting.id)),
      queryClient.ensureQueryData(agendaQuery(meeting.id)),
      queryClient.ensureQueryData(decisionsQuery(meeting.id)),
      queryClient.ensureQueryData(meetingActionsQuery(meeting.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      activityLoader(queryClient, { type: 'meeting', id: meeting.id }),
    ])
  },
  notFoundComponent: () => (
    <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
      <p className="font-medium">{tr('Совещание не найдено')}</p>
      <p className="text-sm text-muted-foreground">{tr('Возможно, оно отменено или у вас нет к нему доступа.')}</p>
    </div>
  ),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем совещание…')}</p>,
  component: MeetingPage,
})

const whenOpts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
const NONE = '__none__'
const LIVE: MeetingStatus[] = ['in_progress', 'minutes_draft']

/** Любое изменение совещания обновляет всё, что на нём построено. */
function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      ['meeting', 'meetings', 'meeting-participants', 'meeting-agenda', 'meeting-decisions', 'meeting-actions', 'meeting-open-actions', 'meeting-decision-registry', 'activity', 'tasks'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

function MeetingPage() {
  const { code, id } = Route.useParams()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const refresh = useRefresh()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const tz = p.timezone
  const { data: meeting } = useSuspenseQuery(meetingQuery(id))
  const m = meeting!
  const { data: participants } = useSuspenseQuery(participantsQuery(id))
  const { data: agenda } = useSuspenseQuery(agendaQuery(id))
  const { data: decisions } = useSuspenseQuery(decisionsQuery(id))
  const { data: actions } = useSuspenseQuery(meetingActionsQuery(id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))

  const uid = session!.user.id
  const isFacilitator = m.facilitator_id === uid
  const canConduct = permissions.includes('meeting.conduct') || isFacilitator
  const canManage = m.created_by === uid || isFacilitator || permissions.includes('meeting.manage')
  const canPublish = permissions.includes('meeting.minutes.publish') || (canConduct && isFacilitator)
  const closed = m.status === 'published' || m.status === 'cancelled'
  const live = LIVE.includes(m.status)
  const facilitator = participants.find((x) => x.user_id === m.facilitator_id)?.user?.full_name
  const [editing, setEditing] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const { data: series } = useQuery(seriesQuery(m.series_id))
  const moved = m.original_at !== null && new Date(m.original_at).getTime() !== new Date(m.scheduled_at).getTime()

  const endSeries = useMutation({
    mutationFn: () => endMeetingSeries(m.series_id!),
    onSuccess: async (removed) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['meeting-series'] })])
      setConfirmEnd(false)
      toast.success(removed > 0 ? tr('Серия закончена. Убрано будущих встреч: {{removed}}', { removed }) : tr('Серия закончена'))
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось закончить серию.'))),
  })

  const transition = useMutation({
    mutationFn: (to: MeetingStatus) => setMeetingStatus(m.id, to),
    onSuccess: async (_, to) => {
      await refresh()
      toast.success(
        to === 'in_progress' ? tr('Совещание началось') : to === 'minutes_draft' ? tr('Совещание завершено. Проверьте протокол') : to === 'published' ? tr('Протокол опубликован, участники уведомлены') : tr('Совещание отменено'),
      )
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось сменить этап. Обновите страницу и повторите.'))),
  })
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function copyMinutes() {
    const text = minutesText({ m, projectCode: p.code, timezone: tz, participants, agenda, decisions, actions })
    if (await copyText(text)) toast.success(tr('Протокол скопирован'))
    else toast.error(tr('Не удалось скопировать. Выделите текст и скопируйте вручную.'))
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackButton fallback={
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$code/meetings" params={{ code }} search={{}}>
            <ChevronLeft />{tr('Все совещания')}</Link>
        </Button>
} />
      </div>

      <header className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="ident">{m.key}</span>
              <span>· {MEETING_TYPE_LABELS[m.type]}</span>
              {m.visibility === 'external' && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{tr('с внешними участниками')}</span>}
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_STYLES[m.status]}`}>{MEETING_STATUS_LABELS[m.status]}</span>
            </div>
            <h1 className="text-xl font-semibold leading-snug">{m.title}</h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>
                {formatIn(m.scheduled_at, tz, whenOpts)}, {m.duration_min}{tr('мин')}</span>
              {m.place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden /> {m.place}
                </span>
              )}
              {facilitator && <span>{tr('Ведёт:')}{' '}{facilitator}</span>}
            </p>
            {m.series_id && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <Repeat className="size-3.5" aria-hidden />
                {series ? <span>{tr('Регулярное:')}{' '}{slotsLabel(series.slots)}{!series.active && tr(' · серия закончена')}</span> : <span>{tr('Регулярное совещание')}</span>}
                {moved && m.original_at && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">{tr('перенесено с')}{' '}{formatIn(m.original_at, tz, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
              </p>
            )}
          </div>
          {canManage && !closed && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil />{tr('Изменить')}</Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {m.status === 'scheduled' && canConduct && (
            <Button disabled={transition.isPending} onClick={() => transition.mutate('in_progress')}>
              <Play />{tr('Начать совещание')}</Button>
          )}
          {m.status === 'in_progress' && canConduct && (
            <Button disabled={transition.isPending} onClick={() => transition.mutate('minutes_draft')}>
              <CheckCircle2 />{tr('Завершить и перейти к протоколу')}</Button>
          )}
          {m.status === 'minutes_draft' && canConduct && (
            <Button variant="outline" disabled={transition.isPending} onClick={() => transition.mutate('in_progress')}>
              <Undo2 />{tr('Вернуться к совещанию')}</Button>
          )}
          {m.status === 'minutes_draft' && canPublish && (
            <Button disabled={transition.isPending} onClick={() => transition.mutate('published')}>
              <Send />{tr('Опубликовать протокол')}</Button>
          )}
          {(m.status === 'minutes_draft' || m.status === 'published') && (
            <Button variant="outline" onClick={() => void copyMinutes()}>
              <ClipboardCopy />{tr('Скопировать протокол')}</Button>
          )}
          {canManage && m.status === 'scheduled' && (
            <Button variant="outline" onClick={() => setRescheduling(true)}>
              <CalendarClock />{tr('Перенести')}</Button>
          )}
          {canManage && (m.status === 'scheduled' || m.status === 'in_progress') &&
            (confirmCancel ? (
              <>
                <Button variant="destructive" disabled={transition.isPending} onClick={() => transition.mutate('cancelled')}>
                  {m.series_id ? tr('Отменить только эту встречу') : tr('Отменить совещание')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmCancel(false)}>{tr('Не отменять')}</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                <Ban /> {m.series_id ? tr('Отменить встречу') : tr('Отменить')}
              </Button>
            ))}
          {canManage && series?.active &&
            (confirmEnd ? (
              <>
                <Button variant="destructive" disabled={endSeries.isPending} onClick={() => endSeries.mutate()}>{tr('Закончить серию')}</Button>
                <Button variant="ghost" onClick={() => setConfirmEnd(false)}>{tr('Не заканчивать')}</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmEnd(true)}>
                <Repeat />{tr('Закончить серию')}</Button>
            ))}
          {confirmEnd && <span className="basis-full text-sm text-muted-foreground">{tr('Будущие встречи, которые вы не переносили, будут убраны. Прошедшие и перенесённые вручную останутся.')}</span>}
          {m.status === 'minutes_draft' && !canPublish && <span className="text-sm text-muted-foreground">{tr('Протокол опубликует руководитель проекта или ведущий.')}</span>}
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          <MeetingRecorder m={m} projectId={p.id} timezone={tz} canRecord={canConduct || canManage} />
          {(canConduct || canManage) && <MeetingSummaries m={m} timezone={tz} participants={participants} canConduct={canConduct} canRun={canConduct || canManage} onChanged={refresh} />}
          <AgendaSection m={m} agenda={agenda} canEdit={(canManage || canConduct) && !closed} canNotes={canConduct && live} onChanged={refresh} />
          <DecisionsSection m={m} agenda={agenda} decisions={decisions} canEdit={canConduct && live} onChanged={refresh} />
          <ActionsSection m={m} actions={actions} projectId={p.id} code={code} canEdit={canConduct && live} onChanged={refresh} />
          <SummarySection m={m} canEdit={canConduct && live} onChanged={refresh} />

          <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем обсуждение…')}</p>}>
            <ActivityFeed entity={{ type: 'meeting', id: m.id }} projectId={p.id} title={tr('Обсуждение и история')} placeholder={tr('Вопрос к повестке или комментарий. @ — упомянуть коллегу')} />
          </Suspense>
        </div>

        <aside className="flex flex-col gap-5" aria-label={tr('Участники и хвосты')}>
          <ParticipantsSection m={m} participants={participants} projectId={p.id} canManage={canManage && !closed} canMark={canConduct && !closed} onChanged={refresh} />
          {!closed && canConduct && (
            <Suspense fallback={null}>
              <CarryOver projectId={p.id} code={code} meetingId={m.id} />
            </Suspense>
          )}
        </aside>
      </div>

      {editing && <EditDialog m={m} participants={participants} onClose={() => setEditing(false)} onSaved={refresh} />}
      {rescheduling && <RescheduleDialog m={m} tz={tz} inSeries={!!m.series_id} onClose={() => setRescheduling(false)} onSaved={async () => { await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['meeting-series'] })]) }} />}
    </div>
  )
}

function Section({ title, count, children, hint }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={title}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && count > 0 && <span className="text-xs text-muted-foreground">{count}</span>}
      </div>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  )
}

function useRun(onChanged: () => Promise<unknown>) {
  return async (job: Promise<unknown>, fallback: string) => {
    try {
      await job
      await onChanged()
      return true
    } catch (e) {
      toast.error(meetingErrorText(e, fallback))
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// Повестка и заметки по пунктам
// ---------------------------------------------------------------------------
function AgendaSection({ m, agenda, canEdit, canNotes, onChanged }: { m: MeetingDetail; agenda: AgendaRow[]; canEdit: boolean; canNotes: boolean; onChanged: () => Promise<unknown> }) {
  const run = useRun(onChanged)
  const [title, setTitle] = useState('')

  return (
    <Section title={tr('Повестка')} count={agenda.length} hint={canNotes ? tr('Записывайте ход обсуждения по пунктам — это попадёт в протокол.') : undefined}>
      {agenda.length === 0 && <p className="text-sm text-muted-foreground">{canEdit ? tr('Пока ни одного пункта. Добавьте первый ниже.') : tr('Повестка не заполнена.')}</p>}
      <ol className="flex flex-col gap-3">
        {agenda.map((a, i) => (
          <AgendaItem key={a.id} index={i + 1} item={a} canEdit={canEdit} canNotes={canNotes} onChanged={onChanged} />
        ))}
      </ol>
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!title.trim()) return
            if (await run(addAgendaItem(m.id, title.trim()), tr('Не удалось добавить пункт.'))) setTitle('')
          }}
        >
          <Input aria-label={tr('Новый пункт повестки')} placeholder={tr('Новый пункт повестки')} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!title.trim()}>
            <Plus />{tr('Добавить')}</Button>
        </form>
      )}
    </Section>
  )
}

function AgendaItem({ index, item, canEdit, canNotes, onChanged }: { index: number; item: AgendaRow; canEdit: boolean; canNotes: boolean; onChanged: () => Promise<unknown> }) {
  const run = useRun(onChanged)
  const [notes, setNotes] = useState(item.notes ?? '')

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border bg-background p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-5 shrink-0 text-sm text-muted-foreground tabular-nums">{index}.</span>
        <span className="min-w-0 flex-1 text-sm font-medium">{item.title}</span>
        {item.presenter && <span className="shrink-0 text-xs text-muted-foreground">{item.presenter.full_name}</span>}
        {canEdit && (
          <Button size="icon" variant="ghost" className="-my-1 size-8" aria-label={tr('Убрать пункт «{{title}}»', { title: item.title })} onClick={() => void run(removeAgendaItem(item.id), tr('Не удалось убрать пункт.'))}>
            <Trash2 />
          </Button>
        )}
      </div>
      {canNotes ? (
        <Textarea
          aria-label={tr('Заметки по пункту «{{title}}»', { title: item.title })}
          rows={2}
          maxLength={10000}
          placeholder={tr('Что обсудили')}
          className="ml-7 w-[calc(100%-1.75rem)]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if ((item.notes ?? '') !== notes.trim()) void run(updateAgendaItem(item.id, { notes: notes.trim() || null }), tr('Не удалось сохранить заметки.'))
          }}
        />
      ) : (
        item.notes && <p className="ml-7 whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Решения
// ---------------------------------------------------------------------------
function DecisionsSection({
  m,
  agenda,
  decisions,
  canEdit,
  onChanged,
}: {
  m: MeetingDetail
  agenda: AgendaRow[]
  decisions: { id: string; number: number; text: string; agenda_item_id: string | null }[]
  canEdit: boolean
  onChanged: () => Promise<unknown>
}) {
  const run = useRun(onChanged)
  const [text, setText] = useState('')
  const [item, setItem] = useState(NONE)

  return (
    <Section title={tr('Решения')} count={decisions.length} hint={canEdit ? tr('Коротко и однозначно: что решили. Кто и к какому сроку делает — отдельным поручением.') : undefined}>
      {decisions.length === 0 && <p className="text-sm text-muted-foreground">{canEdit ? tr('Решений пока нет.') : tr('Решения не зафиксированы.')}</p>}
      <ul className="flex flex-col gap-2">
        {decisions.map((d) => {
          const a = d.agenda_item_id ? agenda.find((x) => x.id === d.agenda_item_id) : null
          return (
            <li key={d.id} className="flex items-start gap-2 rounded-lg border bg-background p-3">
              <span className="ident mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">{tr('Р-')}{d.number}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{d.text}</p>
                {a && <p className="mt-0.5 text-xs text-muted-foreground">{tr('По пункту:')}{' '}{a.title}</p>}
              </div>
              {canEdit && (
                <Button size="icon" variant="ghost" className="-my-1 size-8" aria-label={tr('Убрать решение {{number}}', { number: d.number })} onClick={() => void run(removeDecision(d.id), tr('Не удалось убрать решение.'))}>
                  <Trash2 />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {canEdit && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!text.trim()) return
            if (await run(addDecision(m.id, text.trim(), item === NONE ? null : item), tr('Не удалось записать решение.'))) {
              setText('')
              setItem(NONE)
            }
          }}
        >
          <Textarea aria-label={tr('Текст решения')} rows={2} maxLength={2000} placeholder={tr('Например, бетонирование F05 переносим на четверг')} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {agenda.length > 0 && (
              <Select value={item} onValueChange={setItem}>
                <SelectTrigger size="sm" aria-label={tr('Пункт повестки')} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{tr('Без привязки к пункту')}</SelectItem>
                  {agenda.map((a, i) => (
                    <SelectItem key={a.id} value={a.id}>
                      {i + 1}. {a.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button type="submit" variant="secondary" disabled={!text.trim()}>
              <Plus />{tr('Записать решение')}</Button>
          </div>
        </form>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Поручения (задачи)
// ---------------------------------------------------------------------------
function ActionsSection({
  m,
  actions,
  projectId,
  code,
  canEdit,
  onChanged,
}: {
  m: MeetingDetail
  actions: { id: string; key: string; title: string; due_date: string | null; status_category: keyof typeof CATEGORY_STYLES; assignee: { full_name: string } | null }[]
  projectId: string
  code: string
  canEdit: boolean
  onChanged: () => Promise<unknown>
}) {
  const run = useRun(onChanged)
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(NONE)
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('normal')
  const today = new Date().toLocaleDateString('sv')

  return (
    <Section title={tr('Поручения')} count={actions.length} hint={canEdit ? tr('Каждое поручение — задача с исполнителем и сроком. Исполнитель получит уведомление сразу.') : undefined}>
      {actions.length === 0 && <p className="text-sm text-muted-foreground">{canEdit ? tr('Поручений пока нет.') : tr('Поручения не выданы.')}</p>}
      <ul className="flex flex-col gap-2">
        {actions.map((a) => {
          const late = a.due_date !== null && a.due_date < today && a.status_category !== 'done' && a.status_category !== 'cancelled'
          return (
            <li key={a.id}>
              <Link
                to="/projects/$code/tasks/$key"
                params={{ code, key: a.key }}
                search={DEFAULT_TASK_SEARCH}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background p-3 hover:bg-muted/40"
              >
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
      {canEdit && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!title.trim()) return
            const ok = await run(
              addMeetingAction({ meetingId: m.id, title: title.trim(), assignee: assignee === NONE ? null : assignee, dueDate: due || null, priority }),
              tr('Не удалось выдать поручение. Проверьте, что исполнитель состоит в проекте.'),
            )
            if (ok) {
              setTitle('')
              setAssignee(NONE)
              setDue('')
              setPriority('normal')
              toast.success(tr('Поручение выдано'))
            }
          }}
        >
          <Input aria-label={tr('Что нужно сделать')} placeholder={tr('Что нужно сделать')} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger size="sm" aria-label={tr('Исполнитель')} className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tr('Без исполнителя')}</SelectItem>
                {(members ?? []).map((x) => (x.user ? <SelectItem key={x.user.id} value={x.user.id}>{x.user.full_name}</SelectItem> : null))}
              </SelectContent>
            </Select>
            <DatePicker aria-label={tr('Срок')} className="h-8 w-full sm:w-40" value={due} onChange={(v) => setDue(v)} />
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger size="sm" aria-label={tr('Приоритет')} className="w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary" disabled={!title.trim()}>
              <Plus />{tr('Выдать поручение')}</Button>
          </div>
        </form>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Итоги
// ---------------------------------------------------------------------------
function SummarySection({ m, canEdit, onChanged }: { m: MeetingDetail; canEdit: boolean; onChanged: () => Promise<unknown> }) {
  const run = useRun(onChanged)
  const [text, setText] = useState(m.summary ?? '')
  if (!canEdit && !m.summary) return null

  return (
    <Section title={tr('Итоги')} hint={canEdit ? tr('Короткое резюме для тех, кто не был на совещании.') : undefined}>
      {canEdit ? (
        <Textarea
          aria-label={tr('Итоги совещания')}
          rows={3}
          maxLength={20000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if ((m.summary ?? '') !== text.trim()) void run(updateMeeting(m.id, { summary: text.trim() || null }), tr('Не удалось сохранить итоги.'))
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm">{m.summary}</p>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Участники и присутствие
// ---------------------------------------------------------------------------
function ParticipantsSection({
  m,
  participants,
  projectId,
  canManage,
  canMark,
  onChanged,
}: {
  m: MeetingDetail
  participants: ParticipantRow[]
  projectId: string
  canManage: boolean
  canMark: boolean
  onChanged: () => Promise<unknown>
}) {
  const run = useRun(onChanged)
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const invited = new Set(participants.map((x) => x.user_id))
  const free = (members ?? []).filter((x) => x.user && !invited.has(x.user.id))
  const present = participants.filter((x) => x.attendance === 'present').length

  return (
    <Section title={tr('Участники')} count={participants.length} hint={m.status !== 'scheduled' && participants.length > 0 ? tr('Присутствуют: {{present}} из {{length}}', { present, length: participants.length }) : undefined}>
      <ul className="flex flex-col divide-y rounded-lg border bg-background">
        {participants.map((x) => (
          <li key={x.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 text-sm">
              {x.user?.full_name ?? '—'}
              {x.user_id === m.facilitator_id && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tr('ведёт')}</span>}
              {x.user?.is_external && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tr('внешний')}</span>}
            </span>
            {canMark ? (
              <Select value={x.attendance} onValueChange={(v) => void run(setAttendance(m.id, x.user_id, v as Attendance), tr('Не удалось отметить присутствие.'))}>
                <SelectTrigger size="sm" aria-label={tr('Присутствие: {{v1}}', { v1: x.user?.full_name ?? '' })} className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ATTENDANCE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              m.status !== 'scheduled' && <span className="text-xs text-muted-foreground">{ATTENDANCE_LABELS[x.attendance]}</span>
            )}
            {canManage && x.user_id !== m.facilitator_id && x.user_id !== m.created_by && (
              <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать из состава: {{v1}}', { v1: x.user?.full_name ?? '' })} onClick={() => void run(removeParticipant(m.id, x.user_id), tr('Не удалось убрать участника.'))}>
                <X />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && free.length > 0 && (
        <Select value="" onValueChange={(v) => void run(addParticipant(m.id, v), tr('Не удалось пригласить.'))}>
          <SelectTrigger size="sm" aria-label={tr('Пригласить участника')} className="w-full">
            <SelectValue placeholder={tr('Пригласить участника проекта')} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {free.map((x) => (
              <SelectItem key={x.user!.id} value={x.user!.id}>
                {x.user!.full_name} <span className="text-muted-foreground">· {x.role?.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Section>
  )
}

/** Невыполненные поручения прошлых совещаний — пройти в начале этого. */
function CarryOver({ projectId, code, meetingId }: { projectId: string; code: string; meetingId: string }) {
  const { data } = useSuspenseQuery(openActionsQuery(projectId))
  const rows = data.filter((a) => a.meeting_id !== meetingId)
  const today = new Date().toLocaleDateString('sv')
  if (rows.length === 0) return null

  return (
    <Section title={tr('Не выполнено с прошлых совещаний')} count={rows.length} hint={tr('Пройдите в начале: что закрыто, что переносится.')}>
      <ul className="flex flex-col divide-y rounded-lg border bg-background">
        {rows.slice(0, 12).map((a) => {
          const late = a.due_date !== null && a.due_date < today
          return (
            <li key={a.id}>
              <Link to="/projects/$code/tasks/$key" params={{ code, key: a.key }} search={DEFAULT_TASK_SEARCH} className="flex flex-col gap-0.5 px-3 py-2 hover:bg-muted/40">
                <span className="text-sm">{a.title}</span>
                <span className="text-xs text-muted-foreground">
                  <span className="ident">{a.key}</span> · {a.assignee?.full_name ?? tr('без исполнителя')}
                  {a.due_date && <span className={late ? ' font-medium text-red-700 dark:text-red-300' : ''}> · {late ? tr('просрочено ') : tr('до ')}{dateFmt.format(new Date(a.due_date))}</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {rows.length > 12 && (
        <Link to="/projects/$code/meetings" params={{ code }} search={{ tab: 'actions' }} className="text-sm text-muted-foreground underline underline-offset-2">{tr('Все невыполненные поручения:')}{' '}{rows.length}
        </Link>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Изменение параметров
// ---------------------------------------------------------------------------
function RescheduleDialog({ m, tz, inSeries, onClose, onSaved }: { m: MeetingDetail; tz: string; inSeries: boolean; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [when, setWhen] = useState(isoToZoned(m.scheduled_at, tz))
  const [scope, setScope] = useState<'this' | 'following'>('this')
  const changed = when !== isoToZoned(m.scheduled_at, tz)

  const move = useMutation({
    mutationFn: () => rescheduleMeeting(m.id, zonedToIso(when, tz), scope),
    onSuccess: async () => {
      await onSaved()
      toast.success(scope === 'following' ? tr('Расписание серии изменено, участники уведомлены') : tr('Встреча перенесена, участники уведомлены'))
      onClose()
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось перенести. Попробуйте ещё раз.'))),
  })

  const slotText = when.length < 16 ? '' : `${WEEKDAY_LONG[isoDow(when) - 1].toLowerCase()}, ${when.slice(11, 16)}`

  return (
    <Dialog open onOpenChange={(o) => !o && !move.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Перенести совещание')}</DialogTitle>
          <DialogDescription>{tr('Время по часовому поясу проекта (')}{tz}{tr('). Участники получат уведомление.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (changed && when && !move.isPending) move.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-when">{tr('Новое время')}</Label>
            <Input id="r-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} autoFocus />
          </div>
          {inSeries && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{tr('Что перенести')}</legend>
              <label className="flex min-h-9 items-start gap-2 text-sm">
                <input type="radio" name="scope" className="mt-0.5 size-4" checked={scope === 'this'} onChange={() => setScope('this')} />
                <span>{tr('Только эту встречу')}<span className="block text-xs text-muted-foreground">{tr('Остальные встречи серии остаются по расписанию.')}</span>
                </span>
              </label>
              <label className="flex min-h-9 items-start gap-2 text-sm">
                <input type="radio" name="scope" className="mt-0.5 size-4" checked={scope === 'following'} onChange={() => setScope('following')} />
                <span>{tr('Эту и все следующие')}<span className="block text-xs text-muted-foreground">{tr('Меняется расписание серии')}{slotText ? tr(': такие встречи будут проходить так — {{slotText}}', { slotText }) : ''}{tr('. Уже прошедшие остаются как были.')}</span>
                </span>
              </label>
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={move.isPending} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!changed || !when || move.isPending}>
              {move.isPending ? tr('Переносим…') : tr('Перенести')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ m, participants, onClose, onSaved }: { m: MeetingDetail; participants: ParticipantRow[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [title, setTitle] = useState(m.title)
  const [type, setType] = useState<MeetingType>(m.type)
  const [duration, setDuration] = useState(String(m.duration_min))
  const [place, setPlace] = useState(m.place ?? '')
  const [external, setExternal] = useState(m.visibility === 'external')
  const [facilitator, setFacilitator] = useState(m.facilitator_id ?? NONE)

  const save = useMutation({
    mutationFn: () =>
      updateMeeting(m.id, {
        title: title.trim(),
        type,
        duration_min: Math.max(5, Number(duration) || 60),
        place: place.trim() || null,
        ...(m.status === 'scheduled' ? { visibility: external ? 'external' : 'internal' } : {}),
        ...(facilitator !== NONE ? { facilitator_id: facilitator } : {}),
      }),
    onSuccess: async () => {
      await onSaved()
      toast.success(tr('Изменения сохранены'))
      onClose()
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось сохранить. Попробуйте ещё раз.'))),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Параметры совещания')}</DialogTitle>
          <DialogDescription>{tr('Время меняется кнопкой «Перенести» — так участники получают уведомление.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && !save.isPending) save.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-title">{tr('Тема')}</Label>
            <Input id="e-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="e-type">{tr('Вид')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as MeetingType)}>
                <SelectTrigger id="e-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="e-dur">{tr('Длительность, мин')}</Label>
              <Input id="e-dur" type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="e-place">{tr('Место или ссылка')}</Label>
              <Input id="e-place" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-fac">{tr('Ведущий')}</Label>
            <Select value={facilitator} onValueChange={setFacilitator}>
              <SelectTrigger id="e-fac" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {participants
                  .filter((x) => !x.user?.is_external)
                  .map((x) => (
                    <SelectItem key={x.user_id} value={x.user_id}>
                      {x.user?.full_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {m.status === 'scheduled' && (
            <label className="flex min-h-9 items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={external} onChange={(e) => setExternal(e.target.checked)} />
              <span>{tr('Совещание с внешними участниками')}</span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!title.trim() || save.isPending}>
              {save.isPending ? tr('Сохраняем…') : tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
