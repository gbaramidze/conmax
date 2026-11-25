import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/** Маршрут заявки по процедуре закупок (PR-01): от площадки через отдел закупок и согласующих до склада. */
export const REQUEST_STATUSES = {
  draft: tr('Черновик'),
  submitted: tr('Отправлена в закупки'),
  sourcing: tr('Ищем цены'),
  approval: tr('На согласовании'),
  confirming: tr('Ждёт подтверждения инициатора'),
  confirmed: tr('Подтверждена, оформляем заказ'),
  ordered: tr('Заказано'),
  shipped: tr('В пути'),
  delivered: tr('Получено'),
  rejected: tr('Отклонена'),
  cancelled: tr('Отменена'),
} as const
export type RequestStatus = keyof typeof REQUEST_STATUSES

/** Шаги полосы прогресса (как их видит инициатор) */
export const STEPS: { key: string; label: string; statuses: RequestStatus[] }[] = [
  { key: 'request', label: tr('Заявка'), statuses: ['draft', 'submitted'] },
  { key: 'sourcing', label: tr('Поиск цен'), statuses: ['sourcing'] },
  { key: 'approval', label: tr('Согласование'), statuses: ['approval'] },
  { key: 'confirm', label: tr('Подтверждение'), statuses: ['confirming', 'confirmed'] },
  { key: 'order', label: tr('Заказ'), statuses: ['ordered'] },
  { key: 'transit', label: tr('В пути'), statuses: ['shipped'] },
  { key: 'done', label: tr('Получено'), statuses: ['delivered'] },
]

export const STOCK_STATUSES = {
  unchecked: tr('Склад не проверен'),
  none: tr('На складе нет'),
  partial: tr('На складе есть частично'),
  available: tr('Есть на складе'),
} as const
export type StockStatus = keyof typeof STOCK_STATUSES

export const TRANSPORTS = {
  road: tr('Авто'),
  air: tr('Авиа'),
  sea: tr('Море'),
  rail: tr('Ж/д'),
  courier: tr('Курьер'),
  pickup: tr('Самовывоз'),
} as const
export type Transport = keyof typeof TRANSPORTS

export const RECEIPTS = {
  full: tr('Получено полностью'),
  partial: tr('Получено частично'),
  issues: tr('Получено с замечаниями'),
} as const
export type Receipt = keyof typeof RECEIPTS

export interface RequestLine {
  id?: string
  position?: number
  name: string
  unit: string
  qty: number
  est_price: number | null
  note: string
}

/** Строка списка заявок (своих, проекта или всей компании для отдела закупок) */
export interface RequestRow {
  id: string
  key: string
  title: string
  status: RequestStatus
  urgent: boolean
  needed_by: string | null
  created_at: string
  updated_at: string
  project_id: string
  project_code: string
  project_name: string
  requested_by: string | null
  requester_name: string | null
  buyer_id: string | null
  buyer_name: string | null
  supplier: string
  amount: number | null
  currency: string | null
  estimate: number | null
  lines_count: number
  expected_at: string | null
  over_budget: boolean
  stock_status: StockStatus
  approvals_total: number
  approvals_done: number
  my_approval: boolean
}

export const requestsQuery = (projectId?: string) =>
  queryOptions({
    queryKey: ['requests', projectId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('procurement_requests', projectId ? { p_project: projectId } : {})
      if (error) throw error
      return ((data ?? []) as unknown as RequestRow[]).map((r) => ({
        ...r,
        amount: r.amount === null ? null : Number(r.amount),
        estimate: r.estimate === null ? null : Number(r.estimate),
      }))
    },
  })

export interface QuotePrice {
  line_id: string
  unit_price: number
}
export interface Quote {
  id: string
  supplier: string
  currency: 'GEL' | 'USD'
  delivery_days: number | null
  terms: string
  note: string
  status: 'received' | 'selected' | 'rejected'
  prices: QuotePrice[]
}
export interface RfqLine {
  id: string
  position: number
  name: string
  unit: string
  qty: number
}
export interface Approval {
  user_id: string
  name: string
  job_title: string | null
  round: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  note: string
  decided_at: string | null
}
export interface HistoryItem {
  at: string
  event: 'request_status' | 'request_eta'
  actor: string | null
  changes: { from?: string | null; to?: string | null; note?: string }
}

/** Карточка заявки целиком: позиции, предложения, согласующие, поставка, история и что можно мне */
export interface RequestDetail {
  id: string
  key: string
  title: string
  status: RequestStatus
  urgent: boolean
  needed_by: string | null
  note: string
  created_at: string
  requested_by: string | null
  requester_name: string | null
  buyer_id: string | null
  buyer_name: string | null
  cbs_item_id: string | null
  item: { code: string; name: string } | null
  stock_status: StockStatus
  stock_note: string
  decision_note: string
  quote_id: string | null
  supplier: string
  amount: number | null
  currency: string | null
  amount_base: number | null
  over_budget: boolean
  single_source_reason: string
  approval_note: string
  approval_round: number
  order_ref: string
  ordered_at: string | null
  expected_at: string | null
  shipped_at: string | null
  transport: Transport | ''
  forwarder: string
  tracking: string
  delivery_note: string
  delivered_at: string | null
  receipt: Receipt | ''
  receipt_note: string
  received_by_name: string | null
  project: { id: string; code: string; name: string; currency: string; fx_rate: number | null }
  lines: RequestLine[]
  rfq: { id: string; key: string; status: string; lines: RfqLine[]; quotes: Quote[] } | null
  approvals: Approval[]
  history: HistoryItem[]
  me: { is_buyer: boolean; is_initiator: boolean; is_owner: boolean; can_request: boolean; can_budget: boolean; can_pick_item: boolean; my_approval: boolean }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export const requestQuery = (id: string) =>
  queryOptions({
    queryKey: ['request', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('procurement_request', { p_id: id })
      if (error) throw error
      const d = data as unknown as RequestDetail
      return {
        ...d,
        amount: num(d.amount),
        amount_base: num(d.amount_base),
        project: { ...d.project, fx_rate: num(d.project.fx_rate) },
        lines: d.lines.map((l) => ({ ...l, qty: Number(l.qty), est_price: num(l.est_price) })),
        rfq: d.rfq && {
          ...d.rfq,
          lines: d.rfq.lines.map((l) => ({ ...l, qty: Number(l.qty) })),
          quotes: d.rfq.quotes.map((q) => ({ ...q, prices: q.prices.map((p) => ({ ...p, unit_price: Number(p.unit_price) })) })),
        },
      } as RequestDetail
    },
  })

export interface Person {
  id: string
  name: string
  job_title: string | null
}
export const procurementPeopleQuery = queryOptions({
  queryKey: ['procurement-people'],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('procurement_people')
    if (error) throw error
    return (data ?? []) as unknown as Person[]
  },
})

/** Ждёт ли заявка моего шага: решения согласующего, подтверждения или черновика инициатора, работы закупщика */
export const waitsForMe = (r: RequestRow, me: string | undefined, isBuyer: boolean) =>
  r.my_approval ||
  (r.status === 'confirming' && r.requested_by === me) ||
  (r.status === 'draft' && r.requested_by === me) ||
  (isBuyer && r.status === 'submitted') ||
  (r.buyer_id === me && ['sourcing', 'confirmed', 'ordered', 'shipped'].includes(r.status))

export interface BudgetCheck {
  bac: number
  committed: number
  actual: number
  reserved: number
  estimate: number
  remaining: number
}

/** Остаток бюджета статьи для заявки. Только с правом на бюджет или закупщику; без статьи — null. */
export async function requestBudget(id: string): Promise<BudgetCheck | null> {
  const { data, error } = await supabase.rpc('material_request_budget', { p_request: id })
  if (error) throw error
  if (!data) return null
  const d = data as Record<string, unknown>
  return { bac: Number(d.bac), committed: Number(d.committed), actual: Number(d.actual), reserved: Number(d.reserved), estimate: Number(d.estimate), remaining: Number(d.remaining) }
}

export async function saveRequest(projectId: string, r: { id?: string; title: string; cbsItem: string | null; neededBy: string | null; note: string; urgent: boolean; lines: RequestLine[] }): Promise<string> {
  const { data, error } = await supabase.rpc('material_request_save', {
    p_project: projectId,
    p_title: r.title,
    p_id: r.id,
    p_cbs_item: r.cbsItem ?? undefined,
    p_needed_by: r.neededBy ?? undefined,
    p_note: r.note,
    p_urgent: r.urgent,
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

export async function setStock(id: string, status: Exclude<StockStatus, 'unchecked'>, note: string): Promise<void> {
  const { error } = await supabase.rpc('material_request_stock', { p_request: id, p_status: status, p_note: note })
  if (error) throw error
}

export async function sendToApproval(id: string, v: { quoteId: string; approvers: string[]; reason: string; note: string }): Promise<void> {
  const { error } = await supabase.rpc('material_request_send_approval', { p_request: id, p_quote: v.quoteId, p_approvers: v.approvers, p_reason: v.reason, p_note: v.note })
  if (error) throw error
}

export async function decide(id: string, approve: boolean, note: string): Promise<void> {
  const { error } = await supabase.rpc('material_request_decide', { p_request: id, p_approve: approve, p_note: note })
  if (error) throw error
}

export async function placeOrder(id: string, v: { orderRef: string; expected: string | null; cbsItem: string | null }): Promise<void> {
  const { error } = await supabase.rpc('material_request_order', { p_request: id, p_order_ref: v.orderRef, p_expected: v.expected ?? undefined, p_cbs_item: v.cbsItem ?? undefined })
  if (error) throw error
}

export async function updateDelivery(id: string, v: { inTransit: boolean; expected: string | null; transport: Transport | ''; forwarder: string; tracking: string; note: string }): Promise<void> {
  const { error } = await supabase.rpc('material_request_delivery', {
    p_request: id,
    p_in_transit: v.inTransit,
    p_expected: v.expected ?? undefined,
    p_transport: v.transport,
    p_forwarder: v.forwarder,
    p_tracking: v.tracking,
    p_note: v.note,
  })
  if (error) throw error
}

export async function receive(id: string, result: Receipt, note: string): Promise<void> {
  const { error } = await supabase.rpc('material_request_receive', { p_request: id, p_result: result, p_note: note })
  if (error) throw error
}

export async function saveQuote(rfqId: string, q: { id?: string; supplier: string; currency: string; deliveryDays: number | null; terms: string; note: string; prices: Record<string, number | null> }): Promise<string> {
  const { data, error } = await supabase.rpc('rfq_quote_save', {
    p_rfq: rfqId,
    p_supplier: q.supplier,
    p_currency: q.currency,
    p_delivery_days: q.deliveryDays ?? undefined,
    p_terms: q.terms,
    p_prices: q.prices,
    p_id: q.id,
    p_note: q.note,
  })
  if (error) throw error
  return data as string
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.rpc('rfq_quote_delete', { p_quote: id })
  if (error) throw error
}

export const isActive = (s: RequestStatus) => s !== 'delivered' && s !== 'rejected' && s !== 'cancelled'

/** Сумма предложения в его валюте; null, если цены указаны не по всем позициям. */
export function quoteTotal(lines: RfqLine[], q: Quote): number | null {
  let sum = 0
  for (const l of lines) {
    const p = q.prices.find((x) => x.line_id === l.id)
    if (!p) return null
    sum += l.qty * p.unit_price
  }
  return sum
}

/** Сумма в основной валюте проекта по курсу (лари за 1 доллар); null, если пересчитать нельзя. */
export function inBase(total: number, currency: string, base: string, rate: number | null): number | null {
  if (currency === base) return total
  if (!rate) return null
  return base === 'GEL' ? total * rate : total / rate
}

/** Что сейчас происходит с заявкой, одной фразой, и кто должен сделать следующий шаг */
export function nowText(r: Pick<RequestRow, 'status' | 'buyer_name' | 'approvals_total' | 'approvals_done' | 'supplier' | 'requester_name'>): string {
  switch (r.status) {
    case 'draft':
      return tr('Черновик: ещё не отправлена в закупки')
    case 'submitted':
      return tr('Ждёт, пока отдел закупок возьмёт в работу')
    case 'sourcing':
      return r.buyer_name ? tr('{{name}} собирает предложения поставщиков', { name: r.buyer_name }) : tr('Отдел закупок собирает предложения')
    case 'approval':
      return tr('Согласующие решают: одобрили {{done}} из {{total}}', { done: r.approvals_done, total: r.approvals_total })
    case 'confirming':
      return r.requester_name ? tr('Ждём, что {{name}} подтвердит выбор', { name: r.requester_name }) : tr('Ждём подтверждения инициатора')
    case 'confirmed':
      return tr('Подтверждено: оформляем заказ у {{supplier}}', { supplier: r.supplier })
    case 'ordered':
      return tr('Заказано у {{supplier}}', { supplier: r.supplier })
    case 'shipped':
      return tr('Груз в пути от {{supplier}}', { supplier: r.supplier })
    case 'delivered':
      return tr('Получено')
    case 'rejected':
      return tr('Отклонена')
    case 'cancelled':
      return tr('Отменена')
  }
}

export const statusClass = (s: RequestStatus): string =>
  s === 'delivered'
    ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
    : s === 'rejected' || s === 'cancelled'
      ? 'text-muted-foreground'
      : s === 'approval' || s === 'confirming'
        ? 'border-amber-500/50 bg-amber-400/15 text-amber-900 dark:text-amber-200'
        : s === 'ordered' || s === 'shipped' || s === 'confirmed'
          ? 'border-sky-600/40 bg-sky-500/10 text-sky-900 dark:text-sky-200'
          : s === 'draft'
            ? ''
            : 'border-primary/30 bg-primary/5'

/** Понятный текст ошибки сервера */
export function requestErrorText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? ''
  const code = (e as { code?: string })?.code
  if (m.includes('reason_required')) return tr('Предложений меньше трёх: напишите, почему (единственный поставщик, срочность).')
  if (m.includes('approvers_required')) return tr('Выберите хотя бы одного согласующего.')
  if (m.includes('approver_invalid')) return tr('Согласующим может быть только сотрудник компании.')
  if (m.includes('quote_incomplete')) return tr('В предложении цены указаны не по всем позициям.')
  if (m.includes('note_required')) return tr('Напишите причину.')
  if (m.includes('lines_required')) return tr('Добавьте хотя бы одну позицию.')
  if (m.includes('stock_not_available')) return tr('Сначала отметьте, что всё есть на складе.')
  if (m.includes('rate_required')) return tr('Предложение в другой валюте: укажите курс в карточке проекта.')
  if (m.includes('request_locked')) return tr('На этом шаге заявку уже не изменить.')
  if (m.includes('transition_invalid')) return tr('Заявка уже на другом шаге. Обновите страницу.')
  if (code === '42501') return tr('Этот шаг делает другой участник.')
  return tr('Не удалось выполнить шаг. Обновите страницу и повторите.')
}
