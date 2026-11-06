import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export const REQUEST_STATUSES = {
  draft: tr('Черновик'),
  submitted: tr('На согласовании'),
  approved: tr('Согласована'),
  rejected: tr('Отклонена'),
  ordered: tr('Заказана'),
  delivered: tr('Поставлена'),
  cancelled: tr('Отменена'),
} as const
export type RequestStatus = keyof typeof REQUEST_STATUSES

export interface RequestLine {
  id?: string
  position?: number
  name: string
  unit: string
  qty: number
  est_price: number | null
  note: string
}

export interface MaterialRequest {
  id: string
  number: number
  key: string
  title: string
  cbs_item_id: string | null
  needed_by: string | null
  note: string
  status: RequestStatus
  decision_note: string
  order_ref: string
  over_budget: boolean
  requested_by: string | null
  decided_at: string | null
  created_at: string
  requester: { full_name: string } | null
  decider: { full_name: string } | null
  item: { code: string; name: string } | null
  lines: RequestLine[]
}

export const requestsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['requests', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('material_requests')
        .select(
          'id, number, key, title, cbs_item_id, needed_by, note, status, decision_note, order_ref, over_budget, requested_by, decided_at, created_at, requester:users!requested_by(full_name), decider:users!decided_by(full_name), item:cbs_items(code, name), lines:material_request_lines(id, position, name, unit, qty, est_price, note)',
        )
        .eq('project_id', projectId)
        .order('number', { ascending: false })
        .limit(1000)
      if (error) throw error
      return (data as unknown as MaterialRequest[]).map((r) => ({
        ...r,
        lines: r.lines.map((l) => ({ ...l, qty: Number(l.qty), est_price: l.est_price === null ? null : Number(l.est_price) })).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      }))
    },
  })

export interface BudgetCheck {
  bac: number
  committed: number
  actual: number
  reserved: number
  estimate: number
  remaining: number
}

/** Остаток бюджета статьи для заявки. Только с правом на бюджет; без статьи — null. */
export async function requestBudget(id: string): Promise<BudgetCheck | null> {
  const { data, error } = await supabase.rpc('material_request_budget', { p_request: id })
  if (error) throw error
  if (!data) return null
  const d = data as Record<string, unknown>
  return { bac: Number(d.bac), committed: Number(d.committed), actual: Number(d.actual), reserved: Number(d.reserved), estimate: Number(d.estimate), remaining: Number(d.remaining) }
}

export async function saveRequest(projectId: string, r: { id?: string; title: string; cbsItem: string | null; neededBy: string | null; note: string; lines: RequestLine[] }): Promise<string> {
  const { data, error } = await supabase.rpc('material_request_save', {
    p_project: projectId,
    p_title: r.title,
    p_id: r.id,
    p_cbs_item: r.cbsItem ?? undefined,
    p_needed_by: r.neededBy ?? undefined,
    p_note: r.note,
    p_lines: r.lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.qty, price: l.est_price, note: l.note })),
  })
  if (error) throw error
  return data as string
}

export async function transitionRequest(id: string, to: RequestStatus, note = ''): Promise<void> {
  const { error } = await supabase.rpc('material_request_transition', { p_request: id, p_to: to, p_note: note })
  if (error) throw error
}

export async function setRequestItem(id: string, item: string | null): Promise<void> {
  const { error } = await supabase.rpc('material_request_set_item', { p_request: id, p_item: item as string })
  if (error) throw error
}

export const isActive = (s: RequestStatus) => s === 'draft' || s === 'submitted' || s === 'approved' || s === 'ordered'

export const requestTotal = (r: { lines: RequestLine[] }) => r.lines.reduce((s, l) => s + l.qty * (l.est_price ?? 0), 0)

export const statusClass = (s: RequestStatus): string =>
  s === 'approved' || s === 'ordered' || s === 'delivered'
    ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
    : s === 'rejected' || s === 'cancelled'
      ? 'text-muted-foreground'
      : s === 'submitted'
        ? 'border-amber-500/50 bg-amber-400/15 text-amber-900 dark:text-amber-200'
        : ''
