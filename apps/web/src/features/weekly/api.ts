import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type PeriodStatus = 'planned' | 'active' | 'closed'
export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = { planned: tr('Планируется'), active: tr('Идёт'), closed: tr('Закрыта') }
export const PERIOD_STATUS_STYLES: Record<PeriodStatus, string> = {
  planned: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  active: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  closed: 'bg-green-500/10 text-green-700 dark:text-green-300',
}

/** Причины невыполнения (reason_code). «Не указана» ставит только принудительное закрытие. */
export const REASON_LABELS = {
  design: tr('Нет документации / чертежей'),
  materials: tr('Материалы не привезли'),
  labor: tr('Не хватило людей'),
  equipment: tr('Техника / инструмент'),
  predecessor: tr('Не закончили предыдущую работу'),
  access: tr('Фронт работ не освобождён'),
  client_decision: tr('Ждали решения заказчика'),
  finance: tr('Оплата / финансирование'),
  weather: tr('Погода'),
  safety: tr('Требования безопасности'),
  rework: tr('Переделка замечаний'),
  planning: tr('Неверная оценка объёма'),
  other: tr('Другое'),
  not_specified: tr('Причина не указана'),
} as const
export type Reason = keyof typeof REASON_LABELS
export const SELECTABLE_REASONS = (Object.keys(REASON_LABELS) as Reason[]).filter((r) => r !== 'not_specified')

export interface PeriodRow {
  id: string
  starts_on: string
  ends_on: string
  status: PeriodStatus
  force_closed: boolean
  note: string | null
  started_at: string | null
  closed_at: string | null
}

export interface CommitmentRow {
  id: string
  period_id: string
  activity_id: string | null
  title: string
  note: string | null
  location_id: string | null
  organization_id: string | null
  responsible_id: string | null
  was_ready: boolean
  added_late: boolean
  result: 'completed' | 'not_completed' | null
  reason: Reason | null
  reason_note: string | null
  created_at: string
}

export const periodsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['weekly', 'periods', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('planning_periods')
        .select('id, starts_on, ends_on, status, force_closed, note, started_at, closed_at')
        .eq('project_id', projectId)
        .order('starts_on', { ascending: false })
        .limit(104)
      if (error) throw error
      return data as unknown as PeriodRow[]
    },
  })

export const commitmentsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['weekly', 'commitments', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('period_commitments')
        .select('id, period_id, activity_id, title, note, location_id, organization_id, responsible_id, was_ready, added_late, result, reason, reason_note, created_at')
        .eq('project_id', projectId)
        .order('created_at')
        .limit(5000)
      if (error) throw error
      return data as unknown as CommitmentRow[]
    },
  })

// ---------------------------------------------------------------------------
// Ошибки и операции
// ---------------------------------------------------------------------------
export const WEEKLY_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Недостаточно прав для этого действия.'),
  period_exists: tr('План на эту неделю уже создан.'),
  period_not_found: tr('Неделя не найдена.'),
  period_closed: tr('Неделя закрыта — менять её уже нельзя.'),
  period_started: tr('Неделя уже началась: обязательство нельзя убрать, отметьте его невыполненным с причиной.'),
  period_not_active: tr('Итоги можно отмечать только на начатой неделе.'),
  no_commitments: tr('Добавьте в план хотя бы одно обязательство.'),
  already_planned: tr('Эта работа уже есть в плане недели.'),
  activity_not_found: tr('Работа не найдена (суммарные работы в план не берутся).'),
  title_required: tr('Введите название обязательства.'),
  reason_required: tr('Для невыполненного обязательства укажите причину.'),
  unresolved_commitments: tr('Не по всем обязательствам отмечен итог.'),
  commitment_not_found: tr('Обязательство не найдено: возможно, его уже удалили.'),
  bad_kind: tr('Неизвестный вид ограничения.'),
  bad_dates: tr('Проверьте даты: конец не раньше начала, спринт не длиннее шести недель.'),
  discipline_not_found: tr('Направление не найдено.'),
  no_tasks: tr('Добавьте в спринт хотя бы одну задачу.'),
  reasons_required: tr('Укажите причину для каждой невыполненной задачи.'),
}

export class WeeklyError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export function fail(error: { code?: string; message?: string }): never {
  const key = Object.keys(WEEKLY_ERROR_TEXT).find((k) => error.message?.startsWith(k)) ?? error.code ?? 'unknown'
  throw new WeeklyError(key)
}

export const weeklyErrorText = (e: unknown, fallback: string) => (e instanceof WeeklyError ? (WEEKLY_ERROR_TEXT[e.code] ?? fallback) : fallback)

export async function createPeriod(projectId: string, weekStart: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_planning_period', { p_project: projectId, p_week: weekStart })
  if (error) fail(error)
  return data as string
}

export interface CommitmentInput {
  activityId?: string | null
  title?: string | null
  note?: string | null
  locationId?: string | null
  organizationId?: string | null
  responsibleId?: string | null
}

export async function addCommitment(periodId: string, v: CommitmentInput): Promise<string> {
  const { data, error } = await supabase.rpc('add_commitment', {
    p_period: periodId,
    p_activity: (v.activityId ?? null) as never,
    p_title: (v.title ?? null) as never,
    p_note: (v.note ?? null) as never,
    p_location: (v.locationId ?? null) as never,
    p_org: (v.organizationId ?? null) as never,
    p_responsible: (v.responsibleId ?? null) as never,
  })
  if (error) fail(error)
  return data as string
}

export async function updateCommitment(id: string, v: Required<Omit<CommitmentInput, 'activityId'>>) {
  const { error } = await supabase.rpc('update_commitment', {
    p_commitment: id,
    p_title: v.title as never,
    p_note: v.note as never,
    p_location: v.locationId as never,
    p_org: v.organizationId as never,
    p_responsible: v.responsibleId as never,
  })
  if (error) fail(error)
}

export async function deleteCommitment(id: string) {
  const { error } = await supabase.rpc('delete_commitment', { p_commitment: id })
  if (error) fail(error)
}

export async function startPeriod(periodId: string) {
  const { error } = await supabase.rpc('start_planning_period', { p_period: periodId })
  if (error) fail(error)
}

export async function setResult(id: string, result: 'completed' | 'not_completed' | null, reason?: Reason, reasonNote?: string) {
  const { error } = await supabase.rpc('set_commitment_result', {
    p_commitment: id,
    p_result: result as never,
    p_reason: (reason ?? null) as never,
    p_reason_note: (reasonNote?.trim() || null) as never,
  })
  if (error) fail(error)
}

export async function closePeriod(periodId: string, force: boolean) {
  const { error } = await supabase.rpc('close_planning_period', { p_period: periodId, p_force: force })
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Показатели. PPC = выполненные / все обязательства на старте недели (добавленные позже в счёт не идут).
// ---------------------------------------------------------------------------
export interface Ppc {
  total: number
  done: number
  /** null — нечего считать (нет обязательств или неделя ещё идёт без итогов) */
  ppc: number | null
  late: number
  notReady: number
}

export function ppcOf(list: CommitmentRow[]): Ppc {
  const base = list.filter((c) => !c.added_late)
  const done = base.filter((c) => c.result === 'completed').length
  return {
    total: base.length,
    done,
    ppc: base.length > 0 ? Math.round((done / base.length) * 100) : null,
    late: list.length - base.length,
    notReady: base.filter((c) => !c.was_ready).length,
  }
}

/** Понедельник недели, в которую попадает дата (строка YYYY-MM-DD). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dow)
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

const dm = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
export function weekLabel(startsOn: string): string {
  const from = new Date(`${startsOn}T00:00:00Z`)
  const to = new Date(`${addDays(startsOn, 6)}T00:00:00Z`)
  return `${dm.format(from)} – ${dm.format(to)} ${to.getUTCFullYear()}`
}
