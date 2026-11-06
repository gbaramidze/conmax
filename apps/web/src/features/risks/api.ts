import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export const RISK_CATEGORIES = {
  design: tr('Проектирование'),
  procurement: tr('Закупки и поставки'),
  contractor: tr('Подрядчики'),
  site: tr('Площадка и работы'),
  regulatory: tr('Согласования и надзор'),
  financial: tr('Финансы'),
  safety: tr('Безопасность'),
  weather: tr('Погода'),
  other: tr('Другое'),
} as const
export type RiskCategory = keyof typeof RISK_CATEGORIES

export const RISK_RESPONSES = {
  avoid: tr('Избежать'),
  mitigate: tr('Снизить'),
  transfer: tr('Передать'),
  accept: tr('Принять'),
} as const
export type RiskResponse = keyof typeof RISK_RESPONSES

export const RISK_STATUSES = {
  open: tr('Открыт'),
  monitoring: tr('Наблюдаем'),
  occurred: tr('Наступил'),
  closed: tr('Закрыт'),
} as const
export type RiskStatus = keyof typeof RISK_STATUSES

export const PROBABILITY_LABELS = [tr('Почти невозможно'), tr('Маловероятно'), tr('Возможно'), tr('Вероятно'), tr('Почти наверняка')]
export const IMPACT_LABELS = [tr('Незначительное'), tr('Небольшое'), tr('Заметное'), tr('Серьёзное'), tr('Критическое')]

export interface Risk {
  id: string
  number: number
  key: string
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  score: number
  cost_impact: number | null
  schedule_impact_days: number | null
  owner_id: string | null
  response: RiskResponse | null
  mitigation: string
  trigger_text: string
  status: RiskStatus
  review_date: string | null
  owner: { full_name: string } | null
}

export const risksQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['risks', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('risks')
        .select('id, number, key, title, description, category, probability, impact, score, cost_impact, schedule_impact_days, owner_id, response, mitigation, trigger_text, status, review_date, owner:users!owner_id(full_name)')
        .eq('project_id', projectId)
        .order('score', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data as unknown as Risk[]
    },
  })

export interface RiskInput {
  id?: string
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  cost_impact: number | null
  schedule_impact_days: number | null
  owner_id: string | null
  response: RiskResponse | null
  mitigation: string
  trigger_text: string
  status: RiskStatus
  review_date: string | null
}

export async function saveRisk(projectId: string, r: RiskInput): Promise<string> {
  const { data, error } = await supabase.rpc('risk_save', {
    p_project: projectId,
    p_title: r.title,
    p_id: r.id,
    p_description: r.description,
    p_category: r.category,
    p_probability: r.probability,
    p_impact: r.impact,
    p_cost_impact: r.cost_impact ?? undefined,
    p_schedule_days: r.schedule_impact_days ?? undefined,
    p_owner: r.owner_id ?? undefined,
    p_response: r.response ?? undefined,
    p_mitigation: r.mitigation,
    p_trigger: r.trigger_text,
    p_status: r.status,
    p_review_date: r.review_date ?? undefined,
  })
  if (error) throw error
  return data as string
}

export async function deleteRisk(id: string): Promise<void> {
  const { error } = await supabase.rpc('risk_delete', { p_risk: id })
  if (error) throw error
}

/** Уровень по оценке (вероятность × влияние): низкий до 4, средний 5–9, высокий 10–14, критический от 15. */
export function riskLevel(score: number): { label: string; className: string; cell: string } {
  if (score >= 15) return { label: tr('критический'), className: 'bg-red-600 text-white', cell: 'bg-red-500/25 hover:bg-red-500/35' }
  if (score >= 10) return { label: tr('высокий'), className: 'bg-orange-500 text-white', cell: 'bg-orange-400/25 hover:bg-orange-400/35' }
  if (score >= 5) return { label: tr('средний'), className: 'bg-amber-400 text-amber-950', cell: 'bg-amber-300/25 hover:bg-amber-300/35' }
  return { label: tr('низкий'), className: 'bg-emerald-600 text-white', cell: 'bg-emerald-500/20 hover:bg-emerald-500/30' }
}

export const isActive = (s: RiskStatus) => s !== 'closed'
