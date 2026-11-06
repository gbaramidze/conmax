import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const METHOD_LABELS = {
  manual: tr('Процент и комментарий'),
  quantity: tr('По объёму'),
  zero_hundred: tr('Начата / закончена'),
  fifty_fifty: tr('Начата 50% / закончена'),
} as const
export type ProgressMethod = keyof typeof METHOD_LABELS

export interface ProgressEntry {
  id: string
  activity_id: string
  entry_date: string
  method: ProgressMethod
  percent: number
  quantity: number | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  decided_at: string | null
  decision_note: string | null
  author: { full_name: string } | null
}

export const progressEntriesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['progress', 'entries', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('progress_entries')
        .select('id, activity_id, entry_date, method, percent, quantity, note, status, created_at, decided_at, decision_note, author:users!created_by(full_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return (data as unknown as ProgressEntry[]).map((e) => ({ ...e, percent: Number(e.percent), quantity: e.quantity === null ? null : Number(e.quantity) }))
    },
  })

export interface DailyLog {
  id: string
  log_date: string
  weather: string | null
  temperature_c: number | null
  work_stopped: boolean
  stop_reason: string | null
  manpower: { organization: string; profession: string; count: number }[]
  equipment: { name: string; count: number; hours: number | null }[]
  works: string | null
  events: string | null
  visitors: string | null
  notes: string | null
  status: 'draft' | 'submitted' | 'approved'
  approved_at: string | null
}

export const dailyLogsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['progress', 'logs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_logs')
        .select('id, log_date, weather, temperature_c, work_stopped, stop_reason, manpower, equipment, works, events, visitors, notes, status, approved_at')
        .eq('project_id', projectId)
        .order('log_date', { ascending: false })
        .limit(120)
      if (error) throw error
      return data as unknown as DailyLog[]
    },
  })

export const LOG_STATUS_LABELS = { draft: tr('Черновик'), submitted: tr('Отправлен'), approved: tr('Утверждён') } as const
export const LOG_STATUS_STYLES = {
  draft: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  submitted: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-300',
} as const

export const PROGRESS_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Недостаточно прав для этого действия.'),
  comment_required: tr('Добавьте комментарий: он обязателен при ручном вводе процента и при уменьшении.'),
  bad_value: tr('Проверьте введённое значение.'),
  bad_date: tr('Дата не может быть в будущем.'),
  plan_quantity_required: tr('Для этого метода укажите плановый объём.'),
  activity_not_found: tr('Работа не найдена: суммарные работы факт не принимают.'),
  bad_method: tr('Неизвестный метод ввода.'),
  already_decided: tr('По этой записи решение уже принято.'),
  entry_not_found: tr('Запись не найдена.'),
  log_locked: tr('Журнал уже отправлен: вернуть его в работу может утверждающий.'),
  log_not_found: tr('Журнал не найден.'),
  bad_rows: tr('Не удалось сохранить журнал: проверьте строки таблиц.'),
}
export const progressErrorText = (e: unknown, fallback: string) => {
  const code = (e as { code?: string })?.code
  return (code && PROGRESS_ERROR_TEXT[code]) || fallback
}

export async function reportProgress(v: { activityId: string; date: string; value: number; note: string }): Promise<void> {
  const { error } = await supabase.rpc('report_progress', { p_activity: v.activityId, p_date: v.date, p_value: v.value, p_note: (v.note.trim() || null) as never })
  if (error) failProgress(error)
}
export async function decideProgress(entryId: string, approve: boolean, note: string): Promise<void> {
  const { error } = await supabase.rpc('decide_progress', { p_entry: entryId, p_approve: approve, p_note: (note.trim() || null) as never })
  if (error) failProgress(error)
}
export async function setProgressMethod(activityId: string, method: ProgressMethod, qty: number | null, unit: string): Promise<void> {
  const { error } = await supabase.rpc('set_progress_method', { p_activity: activityId, p_method: method, p_qty: (qty ?? null) as never, p_unit: (unit.trim() || null) as never })
  if (error) failProgress(error)
}
export async function saveDailyLog(projectId: string, date: string, data: Omit<DailyLog, 'id' | 'log_date' | 'status' | 'approved_at'>): Promise<string> {
  const { data: id, error } = await supabase.rpc('save_daily_log', { p_project: projectId, p_date: date, p_data: data as never })
  if (error) failProgress(error)
  return id as string
}
export async function submitDailyLog(id: string) {
  const { error } = await supabase.rpc('submit_daily_log', { p_id: id })
  if (error) failProgress(error)
}
export async function approveDailyLog(id: string) {
  const { error } = await supabase.rpc('approve_daily_log', { p_id: id })
  if (error) failProgress(error)
}
export async function reopenDailyLog(id: string) {
  const { error } = await supabase.rpc('reopen_daily_log', { p_id: id })
  if (error) failProgress(error)
}

class ProgressError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}
function failProgress(error: { code?: string; message?: string }): never {
  const key = Object.keys(PROGRESS_ERROR_TEXT).find((k) => error.message?.startsWith(k)) ?? error.code ?? 'unknown'
  throw new ProgressError(key)
}
