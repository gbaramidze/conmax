import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET, uploadProjectFile } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'
import type { StatusCategory } from '@/features/tasks/api'

export const MEETING_TYPE_LABELS = {
  operational: tr('Оперативное'),
  weekly: tr('Еженедельное'),
  coordination: tr('Координационное'),
  safety: tr('По охране труда'),
  client: tr('С заказчиком'),
  acceptance: tr('Приёмка'),
  other: tr('Другое'),
} as const
export type MeetingType = keyof typeof MEETING_TYPE_LABELS

export const MEETING_STATUS_LABELS = {
  scheduled: tr('Запланировано'),
  in_progress: tr('Идёт'),
  minutes_draft: tr('Протокол в работе'),
  published: tr('Протокол опубликован'),
  cancelled: tr('Отменено'),
} as const
export type MeetingStatus = keyof typeof MEETING_STATUS_LABELS

export const MEETING_STATUS_STYLES: Record<MeetingStatus, string> = {
  scheduled: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  minutes_draft: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  published: 'bg-green-500/10 text-green-700 dark:text-green-300',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

export const ATTENDANCE_LABELS = {
  invited: tr('Приглашён'),
  present: tr('Присутствовал'),
  absent: tr('Не пришёл'),
  excused: tr('Уважительная причина'),
} as const
export type Attendance = keyof typeof ATTENDANCE_LABELS

export interface MeetingRow {
  id: string
  project_id: string
  number: number
  key: string
  type: MeetingType
  title: string
  scheduled_at: string
  duration_min: number
  place: string | null
  visibility: 'internal' | 'external'
  status: MeetingStatus
  facilitator_id: string | null
  published_at: string | null
  participants_count: number
  present_count: number
  decisions_count: number
  actions_count: number
  open_actions_count: number
  series_id: string | null
  /** время по расписанию серии; если оно отличается от scheduled_at, встречу переносили */
  original_at: string | null
}

export interface SeriesSlot {
  dow: number // 1 — понедельник … 7 — воскресенье
  time: string // HH:MM
}

export const WEEKDAY_SHORT = [tr('пн'), tr('вт'), tr('ср'), tr('чт'), tr('пт'), tr('сб'), tr('вс')] as const
export const WEEKDAY_LONG = [tr('Понедельник'), tr('Вторник'), tr('Среда'), tr('Четверг'), tr('Пятница'), tr('Суббота'), tr('Воскресенье')] as const

export const slotsLabel = (slots: SeriesSlot[]) =>
  [...slots]
    .sort((a, b) => a.dow - b.dow || a.time.localeCompare(b.time))
    .map((s) => `${WEEKDAY_SHORT[s.dow - 1]} ${s.time}`)
    .join(', ')

export interface SeriesRow {
  id: string
  title: string
  slots: SeriesSlot[]
  starts_on: string
  ends_on: string | null
  active: boolean
}

export const seriesQuery = (id: string | null) =>
  queryOptions({
    queryKey: ['meeting-series', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('meeting_series').select('id, title, slots, starts_on, ends_on, active').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as unknown as SeriesRow | null
    },
  })

export const meetingsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['meetings', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meetings_overview')
        .select('*')
        .eq('project_id', projectId)
        .order('scheduled_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data as unknown as MeetingRow[]
    },
  })

export interface MeetingDetail extends MeetingRow {
  summary: string | null
  created_by: string | null
  started_at: string | null
  finished_at: string | null
  published_by: string | null
}

export const meetingQuery = (id: string) =>
  queryOptions({
    queryKey: ['meeting', id],
    queryFn: async () => {
      const [{ data: m, error }, { data: o, error: e2 }] = await Promise.all([
        supabase.from('meetings').select('*').eq('id', id).maybeSingle(),
        supabase.from('meetings_overview').select('*').eq('id', id).maybeSingle(),
      ])
      if (error) throw error
      if (e2) throw e2
      if (!m || !o) return null
      return { ...(o as unknown as MeetingRow), ...(m as unknown as Omit<MeetingDetail, keyof MeetingRow>) } as MeetingDetail
    },
  })

export interface ParticipantRow {
  user_id: string
  required: boolean
  attendance: Attendance
  user: { full_name: string; is_external: boolean } | null
}

export const participantsQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ['meeting-participants', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('user_id, required, attendance, user:users(full_name, is_external)')
        .eq('meeting_id', meetingId)
      if (error) throw error
      return (data as unknown as ParticipantRow[]).sort((a, b) => (a.user?.full_name ?? '').localeCompare(b.user?.full_name ?? '', currentLocale()))
    },
  })

export interface AgendaRow {
  id: string
  sort: number
  title: string
  presenter_id: string | null
  duration_min: number | null
  notes: string | null
  presenter: { full_name: string } | null
}

export const agendaQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ['meeting-agenda', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_agenda_items')
        .select('id, sort, title, presenter_id, duration_min, notes, presenter:users!presenter_id(full_name)')
        .eq('meeting_id', meetingId)
        .order('sort')
      if (error) throw error
      return data as unknown as AgendaRow[]
    },
  })

export interface DecisionRow {
  id: string
  number: number
  text: string
  agenda_item_id: string | null
  created_at: string
}

export const decisionsQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ['meeting-decisions', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_decisions')
        .select('id, number, text, agenda_item_id, created_at')
        .eq('meeting_id', meetingId)
        .order('number')
      if (error) throw error
      return data as unknown as DecisionRow[]
    },
  })

export interface ActionRow {
  id: string
  key: string
  title: string
  due_date: string | null
  status_category: StatusCategory
  priority: string
  meeting_id: string
  assignee: { full_name: string } | null
}

const ACTION_SELECT = 'id, key, title, due_date, status_category, priority, meeting_id, assignee:users!assignee_id(full_name)'

export const meetingActionsQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ['meeting-actions', meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(ACTION_SELECT)
        .eq('meeting_id', meetingId)
        .is('deleted_at', null)
        .order('created_at')
      if (error) throw error
      return data as unknown as ActionRow[]
    },
  })

/** Невыполненные поручения прошлых совещаний проекта — их стоит пройти в начале следующего. */
export const openActionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['meeting-open-actions', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(ACTION_SELECT)
        .eq('project_id', projectId)
        .not('meeting_id', 'is', null)
        .is('deleted_at', null)
        .not('status_category', 'in', '(done,cancelled)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(300)
      if (error) throw error
      return data as unknown as ActionRow[]
    },
  })

export interface RegistryDecision extends DecisionRow {
  meeting: { id: string; key: string; title: string; scheduled_at: string } | null
}

/** Реестр решений проекта: что и когда решено. */
export const decisionRegistryQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['meeting-decision-registry', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_decisions')
        .select('id, number, text, agenda_item_id, created_at, meeting:meetings(id, key, title, scheduled_at)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data as unknown as RegistryDecision[]
    },
  })

export interface CreateMeetingInput {
  projectId: string
  title: string
  type: MeetingType
  scheduledAt: string
  durationMin: number
  place: string
  visibility: 'internal' | 'external'
  facilitator: string | null
  participants: string[]
  agenda: string[]
}

export const MEETING_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Нет прав на это действие в совещании.'),
  '22023': tr('Это действие сейчас недоступно: проверьте этап совещания.'),
  '23514': tr('Участник или ведущий не состоит в проекте.'),
  title_required: tr('Укажите тему совещания.'),
  date_required: tr('Укажите дату и время.'),
  meeting_closed: tr('Совещание закрыто: протокол опубликован или встреча отменена.'),
  meeting_not_in_progress: tr('Решения и поручения фиксируются, пока совещание идёт или протокол в работе.'),
  invalid_transition: tr('На этом этапе так сделать нельзя.'),
  visibility_locked: tr('Видимость можно менять только до начала совещания.'),
  slots_required: tr('Добавьте хотя бы один день недели со временем.'),
  slots_invalid: tr('Проверьте дни недели и время начала.'),
  no_occurrences: tr('В выбранный период нет ни одной встречи. Проверьте дату начала и окончания.'),
  not_in_series: tr('Это разовое совещание: переносить можно только его.'),
  recording_not_found: tr('Запись не найдена или недоступна вам.'),
  summary_not_found: tr('Итоги не найдены или недоступны вам.'),
  summary_start_failed: tr('Не удалось запустить обработку записи. Повторите.'),
}

export class MeetingError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

function fail(error: { code?: string; message?: string }): never {
  const known = error.message && MEETING_ERROR_TEXT[error.message] ? error.message : (error.code ?? 'unknown')
  throw new MeetingError(known, error.message)
}

export function meetingErrorText(e: unknown, fallback: string) {
  return e instanceof MeetingError ? (MEETING_ERROR_TEXT[e.code] ?? fallback) : fallback
}

export async function createMeeting(input: CreateMeetingInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_meeting', {
    p_project: input.projectId,
    p_title: input.title,
    p_type: input.type,
    p_scheduled_at: input.scheduledAt,
    p_duration_min: input.durationMin,
    p_place: input.place || undefined,
    p_visibility: input.visibility,
    p_facilitator: input.facilitator ?? undefined,
    p_participants: input.participants,
    p_agenda: input.agenda,
  })
  if (error) fail(error)
  return data as string
}

export interface CreateSeriesInput extends Omit<CreateMeetingInput, 'scheduledAt'> {
  slots: SeriesSlot[]
  startsOn: string
  endsOn: string | null
}

export async function createMeetingSeries(input: CreateSeriesInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_meeting_series', {
    p_project: input.projectId,
    p_title: input.title,
    p_type: input.type,
    p_slots: input.slots as unknown as never,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn ?? undefined,
    p_duration_min: input.durationMin,
    p_place: input.place || undefined,
    p_visibility: input.visibility,
    p_facilitator: input.facilitator ?? undefined,
    p_participants: input.participants,
    p_agenda: input.agenda,
  })
  if (error) fail(error)
  return data as string
}

/** scope: 'this' — только эта встреча; 'following' — эта и все следующие (меняется расписание серии). */
export async function rescheduleMeeting(meetingId: string, newAt: string, scope: 'this' | 'following') {
  const { error } = await supabase.rpc('reschedule_meeting', { p_meeting: meetingId, p_new_at: newAt, p_scope: scope })
  if (error) fail(error)
}

/** Возвращает число убранных будущих встреч. */
export async function endMeetingSeries(seriesId: string): Promise<number> {
  const { data, error } = await supabase.rpc('end_meeting_series', { p_series: seriesId })
  if (error) fail(error)
  return data as number
}

export interface RecordingRow {
  id: string
  created_at: string
  duration_sec: number
  creator: { full_name: string } | null
  file: { id: string; name: string; mime: string; size_bytes: number; storage_key: string } | null
}

export const recordingsQuery = (meetingId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['meeting-recordings', meetingId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_recordings')
        .select('id, created_at, duration_sec, creator:users!created_by(full_name), file:files(id, name, mime, size_bytes, storage_key)')
        .eq('meeting_id', meetingId)
        .order('created_at')
      if (error) throw error
      return data as unknown as RecordingRow[]
    },
  })

/** Загружает запись в закрытое хранилище и привязывает к совещанию. Видна только ведущему и управляющим совещанием. */
export async function saveMeetingRecording(input: { meetingId: string; projectId: string; tenantId: string; blob: Blob; name: string; durationSec: number; sessionId?: string }) {
  const file = new File([input.blob], input.name, { type: input.blob.type })
  const fileId = await uploadProjectFile(input.projectId, input.tenantId, file)
  const { error } = await supabase.rpc('add_meeting_recording', { p_meeting: input.meetingId, p_file: fileId, p_duration: input.durationSec, p_session: input.sessionId ?? undefined })
  if (error) fail(error)
}

/** Расшифрованный кусок записи: текст, смещение от начала и говорящий, если его отметили. */
export interface TranscriptPart {
  seq: number
  offset_sec: number
  speaker: string | null
  text: string
}

export const transcriptPartsQuery = (meetingId: string, enabled: boolean, refetchMs: number | false = false) =>
  queryOptions({
    queryKey: ['meeting-parts', meetingId],
    enabled,
    refetchInterval: refetchMs,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_transcript_parts')
        .select('seq, session_id, offset_sec, speaker, text, created_at')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: true })
        .order('seq', { ascending: true })
        .limit(2000)
      if (error) throw error
      return data as unknown as (TranscriptPart & { session_id: string; created_at: string })[]
    },
  })

/** Отправляет короткий кусок звука на расшифровку; возвращает текст ('' — тишина). */
export async function transcribeChunk(v: { meetingId: string; sessionId: string; seq: number; offsetSec: number; durationSec: number; speaker: string | null; blob: Blob }): Promise<string> {
  const form = new FormData()
  form.append('meeting_id', v.meetingId)
  form.append('session_id', v.sessionId)
  form.append('seq', String(v.seq))
  form.append('offset_sec', String(v.offsetSec))
  form.append('duration_sec', String(v.durationSec))
  if (v.speaker) form.append('speaker', v.speaker)
  form.append('audio', v.blob, `chunk-${v.seq}.${v.blob.type.includes('mp4') ? 'm4a' : v.blob.type.includes('ogg') ? 'ogg' : 'webm'}`)
  const { data, error } = await supabase.functions.invoke('transcribe-chunk', { body: form })
  if (error) throw error
  return String((data as { text?: string } | null)?.text ?? '')
}

export async function deleteMeetingRecording(recordingId: string) {
  const { data, error } = await supabase.rpc('delete_meeting_recording', { p_recording: recordingId })
  if (error) fail(error)
  // файл в хранилище убираем после записи о нём; если не вышло, объект останется без ссылок и недоступным
  if (data) await supabase.storage.from(FILES_BUCKET).remove([data as string])
}

export async function recordingUrl(storageKey: string): Promise<string> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storageKey, 600)
  if (error || !data) throw error ?? new Error('no url')
  return data.signedUrl
}

export async function setMeetingStatus(meetingId: string, to: MeetingStatus) {
  const { error } = await supabase.rpc('set_meeting_status', { p_meeting: meetingId, p_to: to })
  if (error) fail(error)
}

export async function addMeetingAction(input: { meetingId: string; title: string; assignee: string | null; dueDate: string | null; priority: string }) {
  const { error } = await supabase.rpc('add_meeting_action', {
    p_meeting: input.meetingId,
    p_title: input.title,
    p_assignee: input.assignee ?? undefined,
    p_due_date: input.dueDate ?? undefined,
    p_priority: input.priority,
  })
  if (error) fail(error)
}

export async function updateMeeting(id: string, patch: Partial<Pick<MeetingDetail, 'title' | 'type' | 'scheduled_at' | 'duration_min' | 'place' | 'visibility' | 'facilitator_id' | 'summary'>>) {
  const { error } = await supabase.from('meetings').update(patch).eq('id', id)
  if (error) fail(error)
}

export async function addParticipant(meetingId: string, userId: string) {
  // tenant_id и project_id выводит триггер из совещания
  const { error } = await supabase.from('meeting_participants').insert({ meeting_id: meetingId, user_id: userId } as never)
  if (error) fail(error)
}

export async function removeParticipant(meetingId: string, userId: string) {
  const { error } = await supabase.from('meeting_participants').delete().eq('meeting_id', meetingId).eq('user_id', userId)
  if (error) fail(error)
}

export async function setAttendance(meetingId: string, userId: string, attendance: Attendance) {
  const { error } = await supabase.from('meeting_participants').update({ attendance }).eq('meeting_id', meetingId).eq('user_id', userId)
  if (error) fail(error)
}

export async function addAgendaItem(meetingId: string, title: string) {
  const { error } = await supabase.from('meeting_agenda_items').insert({ meeting_id: meetingId, title } as never)
  if (error) fail(error)
}

export async function updateAgendaItem(id: string, patch: { title?: string; notes?: string | null; presenter_id?: string | null; duration_min?: number | null }) {
  const { error } = await supabase.from('meeting_agenda_items').update(patch).eq('id', id)
  if (error) fail(error)
}

export async function removeAgendaItem(id: string) {
  const { error } = await supabase.from('meeting_agenda_items').delete().eq('id', id)
  if (error) fail(error)
}

export async function addDecision(meetingId: string, text: string, agendaItemId: string | null) {
  const { error } = await supabase.from('meeting_decisions').insert({ meeting_id: meetingId, text, agenda_item_id: agendaItemId ?? undefined } as never)
  if (error) fail(error)
}

export async function removeDecision(id: string) {
  const { error } = await supabase.from('meeting_decisions').delete().eq('id', id)
  if (error) fail(error)
}

/** Протокол обычным текстом — чтобы отправить в почту или мессенджер. */
export function minutesText(args: {
  m: MeetingDetail
  projectCode: string
  timezone: string
  participants: ParticipantRow[]
  agenda: AgendaRow[]
  decisions: DecisionRow[]
  actions: ActionRow[]
}): string {
  const { m, participants, agenda, decisions, actions } = args
  const when = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'long', timeStyle: 'short', timeZone: args.timezone }).format(new Date(m.scheduled_at))
  const lines: string[] = [tr('ПРОТОКОЛ {{key}}', { key: m.key }), m.title, `${when}${m.place ? ', ' + m.place : ''}`, '']
  const present = participants.filter((p) => p.attendance === 'present').map((p) => p.user?.full_name ?? '—')
  const absent = participants.filter((p) => p.attendance === 'absent' || p.attendance === 'excused').map((p) => p.user?.full_name ?? '—')
  if (present.length > 0) lines.push(tr('Присутствовали: {{v1}}', { v1: present.join(', ') }))
  if (absent.length > 0) lines.push(tr('Отсутствовали: {{v1}}', { v1: absent.join(', ') }))
  if (m.summary) lines.push('', m.summary)
  if (agenda.length > 0) {
    lines.push('', tr('ПОВЕСТКА И ОБСУЖДЕНИЕ'))
    agenda.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.title}${a.presenter ? ` (${a.presenter.full_name})` : ''}`)
      if (a.notes) lines.push(`   ${a.notes.replace(/\n/g, '\n   ')}`)
    })
  }
  if (decisions.length > 0) {
    lines.push('', tr('РЕШЕНИЯ'))
    for (const d of decisions) lines.push(`${d.number}. ${d.text}`)
  }
  if (actions.length > 0) {
    lines.push('', tr('ПОРУЧЕНИЯ'))
    for (const a of actions) {
      const due = a.due_date ? tr(' — до {{v1}}', { v1: new Date(a.due_date).toLocaleDateString(currentLocale()) }) : ''
      lines.push(`${a.key}: ${a.title} — ${a.assignee?.full_name ?? tr('без исполнителя')}${due}`)
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Итоги по записи: расшифровка и черновик протокола (функция summarize-meeting)
// ---------------------------------------------------------------------------
export type SummaryStatus = 'queued' | 'transcribing' | 'summarizing' | 'ready' | 'failed'

export interface SummaryResult {
  summary: string
  topics: { title: string; points: string[] }[]
  decisions: { text: string }[]
  actions: { title: string; assignee_name: string | null; due_date: string | null; priority: string }[]
  questions: string[]
}

export interface SummaryRow {
  id: string
  recording_id: string
  status: SummaryStatus
  transcript: string
  result: Partial<SummaryResult>
  /** Что из предложенного уже принято в протокол: d0 — решение, a1 — поручение */
  accepted: string[]
  error: string | null
  updated_at: string
  finished_at: string | null
}

export const summaryActive = (s: SummaryStatus) => s === 'queued' || s === 'transcribing' || s === 'summarizing'

export const summariesQuery = (meetingId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['meeting-summaries', meetingId],
    enabled,
    // пока идёт обработка, статус опрашиваем; готово или ошибка — перестаём
    refetchInterval: (query) => ((query.state.data as SummaryRow[] | undefined)?.some((s) => summaryActive(s.status)) ? 4000 : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_summaries')
        .select('id, recording_id, status, transcript, result, accepted, error, updated_at, finished_at')
        .eq('meeting_id', meetingId)
      if (error) throw error
      return data as unknown as SummaryRow[]
    },
  })

/** Запустить расшифровку и итоги по записи; reuse — расшифровка уже есть, переписать только итоги. */
export async function requestSummary(recordingId: string, reuse = false) {
  const { data, error } = await supabase.rpc('meeting_summary_request', { p_recording: recordingId, p_reuse_transcript: reuse })
  if (error) fail(error)
  const { error: invokeError } = await supabase.functions.invoke('summarize-meeting', { body: { summary_id: data as string, reuse } })
  if (invokeError) throw new MeetingError('summary_start_failed', invokeError.message)
}

export async function acceptSummaryItem(summaryId: string, key: string) {
  const { error } = await supabase.rpc('meeting_summary_accept', { p_summary: summaryId, p_key: key })
  if (error) fail(error)
}

export async function deleteSummary(summaryId: string) {
  const { error } = await supabase.rpc('meeting_summary_delete', { p_summary: summaryId })
  if (error) fail(error)
}

/** Понятное объяснение ошибки обработки; код может нести подробность через двоеточие (stt_failed:401). */
export function summaryErrorText(error: string | null): string {
  const [code, detail] = (error ?? 'internal').split(':')
  switch (code) {
    case 'not_configured_stt':
      return tr('Расшифровка пока не подключена: администратору нужно добавить ключ сервиса расшифровки (STT_API_KEY) в секреты сервера.')
    case 'not_configured_llm':
      return tr('Итоги пока не подключены: администратору нужно добавить ключ Claude (ANTHROPIC_API_KEY) в секреты сервера.')
    case 'too_large':
      return tr('Запись слишком большая для расшифровки: допускается до 24 МБ (около двух с половиной часов).')
    case 'empty_audio':
      return tr('В записи нет звука.')
    case 'no_speech':
      return tr('В записи не нашлось разборчивой речи. Проверьте, что микрофон был включён.')
    case 'stt_failed':
      return tr('Сервис расшифровки не принял запись (код {{code}}). Проверьте ключ и баланс сервиса и повторите.', { code: detail ?? '?' })
    case 'llm_billing':
      return tr('На счёте Anthropic закончились средства: пополните баланс и повторите итоги. Расшифровка сохранена.')
    case 'stt_billing':
      return tr('Сервис расшифровки отказал из-за лимита или баланса: проверьте тариф и повторите позже.')
    case 'llm_failed':
      return tr('Не удалось составить итоги (код {{code}}). Расшифровка сохранена: можно повторить только итоги.', { code: detail ?? '?' })
    default:
      return tr('Не удалось обработать запись. Повторите позже.')
  }
}
