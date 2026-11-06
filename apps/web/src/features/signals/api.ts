import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Severity = 'info' | 'warning' | 'high' | 'critical'
export const SEVERITY_LABELS: Record<Severity, string> = { info: tr('К сведению'), warning: tr('Внимание'), high: tr('Важно'), critical: tr('Критично') }
export const SEVERITY_STYLES: Record<Severity, string> = {
  info: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  high: 'bg-orange-500/15 text-orange-800 dark:text-orange-300',
  critical: 'bg-red-500/15 text-red-700 dark:text-red-300',
}
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, warning: 2, info: 3 }

export type SignalStatus = 'open' | 'resolved' | 'dismissed'
export const STATUS_LABELS: Record<SignalStatus, string> = { open: tr('Открыт'), resolved: tr('Закрыт системой'), dismissed: tr('Отклонён') }

export interface Signal {
  id: string
  rule: string
  dedup_key: string
  severity: Severity
  status: SignalStatus
  title: string
  facts: { label: string; value: string | number }[]
  evidence: { type: string; key?: string; id?: string; title?: string }[]
  rule_text: string | null
  actions: { type: string; title?: string }[]
  severity_history: { at: string; from: Severity; to: Severity }[]
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  auto_resolved: boolean
  assignee_id: string | null
  task_id: string | null
  agenda_meeting_id: string | null
  dismiss_reason: string | null
  dismiss_until: string | null
  useful: boolean | null
}

export const GROUPS = {
  schedule: { label: tr('Сроки и график'), rules: ['task_blocked', 'critical_activity_overdue', 'negative_float', 'schedule_stale', 'milestone_slip', 'baseline_missing', 'spi_low_sustained', 'forecast_divergence'] },
  plan: { label: tr('Планирование'), rules: ['ppc_low', 'recurring_reason', 'constraint_overdue', 'lookahead_not_ready', 'commitment_unready', 'period_not_closed'] },
  tasks: { label: tr('Задачи и совещания'), rules: ['overdue_cluster', 'unassigned_tasks', 'minutes_late', 'rfi_sla_breach'] },
  cost: { label: tr('Стоимость'), rules: ['cpi_low_sustained', 'eac_over_budget', 'line_overcommitted', 'tcpi_unrealistic', 'costs_not_recorded', 'activity_without_budget'] },
  data: { label: tr('Дисциплина данных'), rules: ['daily_log_missing'] },
} as const
export type GroupKey = keyof typeof GROUPS
export const groupOf = (rule: string): GroupKey => ((Object.keys(GROUPS) as GroupKey[]).find((g) => (GROUPS[g].rules as readonly string[]).includes(rule)) ?? 'data')

export const RULE_LABELS: Record<string, string> = {
  task_blocked: tr('Заблокированные задачи'),
  critical_activity_overdue: tr('Просрочен критический путь'),
  negative_float: tr('Отрицательный резерв'),
  schedule_stale: tr('Нет свежего факта'),
  milestone_slip: tr('Сдвиг вех'),
  baseline_missing: tr('Нет базового плана'),
  spi_low_sustained: tr('Низкий SPI'),
  forecast_divergence: tr('Расхождение прогнозов'),
  ppc_low: tr('Низкий PPC'),
  recurring_reason: tr('Системная причина срывов'),
  constraint_overdue: tr('Просроченные ограничения'),
  lookahead_not_ready: tr('Мало готовых работ'),
  commitment_unready: tr('Неготовые обязательства'),
  period_not_closed: tr('Неделя не закрыта'),
  overdue_cluster: tr('Просрочки у исполнителя'),
  unassigned_tasks: tr('Задачи без исполнителя'),
  minutes_late: tr('Протокол не опубликован'),
  rfi_sla_breach: tr('RFI без ответа'),
  cpi_low_sustained: tr('Низкий CPI'),
  eac_over_budget: tr('Прогноз выше бюджета'),
  line_overcommitted: tr('Обязательства сверх бюджета'),
  tcpi_unrealistic: tr('Нереалистичный TCPI'),
  costs_not_recorded: tr('Нет факта затрат'),
  daily_log_missing: tr('Нет журнала дня'),
  activity_without_budget: tr('Бюджет не распределён'),
}

const COLUMNS =
  'id, rule, dedup_key, severity, status, title, facts, evidence, rule_text, actions, severity_history, first_seen_at, last_seen_at, resolved_at, auto_resolved, assignee_id, task_id, agenda_meeting_id, dismiss_reason, dismiss_until, useful'

export const signalsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['signals', 'list', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('signals').select(COLUMNS).eq('project_id', projectId).order('last_seen_at', { ascending: false }).limit(400)
      if (error) throw error
      return data as unknown as Signal[]
    },
  })

export interface Health {
  score: number
  color: 'green' | 'yellow' | 'red'
  computed_at: string
  components: { key: string; label: string; weight: number; score: number; value: string }[]
}

export const healthQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['signals', 'health', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('project_health').select('score, color, components, computed_at').eq('project_id', projectId).maybeSingle()
      if (error) throw error
      return (data as unknown as Health | null) ?? null
    },
  })

/** Индекс здоровья и число важных сигналов по всем проектам, которые видит пользователь. */
export const portfolioHealthQuery = queryOptions({
  queryKey: ['signals', 'portfolio'],
  queryFn: async () => {
    const [h, s] = await Promise.all([
      supabase.from('project_health').select('project_id, score, color').limit(500),
      supabase.from('signals').select('project_id, severity').eq('status', 'open').in('severity', ['high', 'critical']).limit(5000),
    ])
    if (h.error) throw h.error
    if (s.error) throw s.error
    const map = new Map<string, { score: number; color: Health['color']; important: number; critical: number }>()
    for (const r of h.data as unknown as { project_id: string; score: number; color: Health['color'] }[]) map.set(r.project_id, { score: r.score, color: r.color, important: 0, critical: 0 })
    for (const r of s.data as unknown as { project_id: string; severity: Severity }[]) {
      const e = map.get(r.project_id)
      if (e) {
        e.important++
        if (r.severity === 'critical') e.critical++
      }
    }
    return map
  },
})

export const HEALTH_STYLES: Record<Health['color'], { text: string; bg: string; label: string }> = {
  green: { text: 'text-green-700 dark:text-green-300', bg: 'bg-green-500', label: tr('Хорошо') },
  yellow: { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500', label: tr('Есть риски') },
  red: { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-500', label: tr('Плохо') },
}

export const SIGNAL_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Недостаточно прав для этого действия.'),
  signal_not_found: tr('Сигнал не найден.'),
  title_required: tr('Введите название задачи.'),
  user_not_found: tr('Этот человек не входит в проект.'),
  meeting_closed: tr('Совещание уже закрыто: выберите другое.'),
  bad_reason: tr('Выберите причину отклонения.'),
}
export const signalErrorText = (e: unknown, fallback: string) => {
  const m = (e as { message?: string; code?: string }) ?? {}
  const key = Object.keys(SIGNAL_ERROR_TEXT).find((k) => m.message?.startsWith(k)) ?? m.code
  return (key && SIGNAL_ERROR_TEXT[key]) || fallback
}

export async function evaluateSignals(projectId: string): Promise<{ open: number; resolved: number; health: number }> {
  const { data, error } = await supabase.rpc('evaluate_signals', { p_project: projectId })
  if (error) throw error
  return data as unknown as { open: number; resolved: number; health: number }
}
export async function createTaskFromSignal(v: { signalId: string; title: string; assigneeId: string | null; dueDate: string | null }): Promise<void> {
  const { error } = await supabase.rpc('signal_create_task', { p_signal: v.signalId, p_title: v.title, p_assignee: (v.assigneeId ?? null) as never, p_due: (v.dueDate ?? null) as never })
  if (error) throw error
}
export async function assignSignal(signalId: string, userId: string | null): Promise<void> {
  const { error } = await supabase.rpc('signal_assign', { p_signal: signalId, p_user: (userId ?? null) as never })
  if (error) throw error
}
export async function signalToAgenda(signalId: string, meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('signal_to_agenda', { p_signal: signalId, p_meeting: meetingId })
  if (error) throw error
}
export async function dismissSignal(signalId: string, reason: string, days: number): Promise<void> {
  const { error } = await supabase.rpc('signal_dismiss', { p_signal: signalId, p_reason: reason, p_days: days })
  if (error) throw error
}
export async function signalFeedback(signalId: string, useful: boolean): Promise<void> {
  const { error } = await supabase.rpc('signal_feedback', { p_signal: signalId, p_useful: useful })
  if (error) throw error
}

export interface RuleSetting {
  rule: string
  enabled: boolean
  params: Record<string, { value: number; default: number; min: number; max: number }>
}

/** Правила проекта с порогами: текущее значение, значение по умолчанию и допустимые границы. */
export const signalRulesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['signal-rules', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('signal_rules', { p_project: projectId })
      if (error) throw error
      return data as unknown as RuleSetting[]
    },
  })

/** Включить или выключить правило и задать пороги; сервер проверяет границы и пересчитывает сигналы проекта. */
export async function setSignalRule(projectId: string, rule: string, enabled: boolean, params: Record<string, number>): Promise<void> {
  const { error } = await supabase.rpc('signal_rule_set', { p_project: projectId, p_rule: rule, p_enabled: enabled, p_params: params })
  if (error) throw error
}

export async function resetSignalRule(projectId: string, rule: string): Promise<void> {
  const { error } = await supabase.rpc('signal_rule_reset', { p_project: projectId, p_rule: rule })
  if (error) throw error
}
