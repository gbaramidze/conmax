import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export const CHANGE_REASONS = {
  client_request: tr('Пожелание заказчика'),
  design_error: tr('Ошибка или пробел в проекте'),
  site_condition: tr('Условия на площадке'),
  regulatory: tr('Требование надзора или норм'),
  optimization: tr('Оптимизация'),
  other: tr('Другое'),
} as const
export type ChangeReason = keyof typeof CHANGE_REASONS

export const CHANGE_STATUSES = {
  draft: tr('Черновик'),
  assessment: tr('На оценке'),
  approval: tr('На согласовании'),
  approved: tr('Утверждён'),
  rejected: tr('Отклонён'),
  implemented: tr('Внедрён'),
  cancelled: tr('Отменён'),
} as const
export type ChangeStatus = keyof typeof CHANGE_STATUSES

export interface ChangeRequest {
  id: string
  number: number
  key: string
  title: string
  description: string
  reason: ChangeReason
  initiator_id: string | null
  cost_impact: number | null
  schedule_impact_days: number | null
  assessment_note: string
  decision_note: string
  status: ChangeStatus
  decided_at: string | null
  created_at: string
  initiator: { full_name: string } | null
  decider: { full_name: string } | null
}

export const changesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['changes', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('change_requests')
        .select('id, number, key, title, description, reason, initiator_id, cost_impact, schedule_impact_days, assessment_note, decision_note, status, decided_at, created_at, initiator:users!initiator_id(full_name), decider:users!decided_by(full_name)')
        .eq('project_id', projectId)
        .order('number', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data as unknown as ChangeRequest[]
    },
  })

export async function saveChange(projectId: string, c: { id?: string; title: string; description: string; reason: ChangeReason }): Promise<string> {
  const { data, error } = await supabase.rpc('change_save', { p_project: projectId, p_title: c.title, p_id: c.id, p_description: c.description, p_reason: c.reason })
  if (error) throw error
  return data as string
}

export async function assessChange(id: string, cost: number, days: number, note: string): Promise<void> {
  const { error } = await supabase.rpc('change_assess', { p_change: id, p_cost: cost, p_days: days, p_note: note })
  if (error) throw error
}

export async function transitionChange(id: string, to: ChangeStatus, note = ''): Promise<void> {
  const { error } = await supabase.rpc('change_transition', { p_change: id, p_to: to, p_note: note })
  if (error) throw error
}

/** Ещё не решённые запросы: они требуют чьего-то действия. */
export const isOpen = (s: ChangeStatus) => s === 'draft' || s === 'assessment' || s === 'approval'

/** Цвет значка статуса. */
export const statusClass = (s: ChangeStatus): string =>
  s === 'approved' || s === 'implemented'
    ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
    : s === 'rejected' || s === 'cancelled'
      ? 'text-muted-foreground'
      : s === 'approval'
        ? 'border-amber-500/50 bg-amber-400/15 text-amber-900 dark:text-amber-200'
        : ''
