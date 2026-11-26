import { queryOptions } from '@tanstack/react-query'
import { uploadProjectFile } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/** Маршрут заявки по процедуре закупок (PR-01): от площадки через отдел закупок и согласующих до склада. */
export const REQUEST_STATUSES = {
  draft: tr('Черновик'),
  review: tr('У руководителя'),
  submitted: tr('Отправлена в закупки'),
  sourcing: tr('Ищем цены'),
  stock_check: tr('Проверка на складе'),
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
  { key: 'request', label: tr('Заявка'), statuses: ['draft'] },
  { key: 'review', label: tr('Руководитель'), statuses: ['review'] },
  { key: 'sourcing', label: tr('Закупки'), statuses: ['submitted', 'sourcing', 'stock_check'] },
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
  /** сколько уже пришло (частичные поставки) */
  received_qty?: number
  /** фото позиции: какую именно модель купить */
  photo?: LinePhoto | null
}

export interface LinePhoto {
  file_id: string
  name: string
  mime: string
  size: number
  /** пусто, пока фото только что загружено в форме (показывается локальной копией) */
  storage_key: string
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
  /** срок текущего шага (п. 13.1); null — у шага нет срока */
  due_at: string | null
  tier: number | null
  receipt: Receipt | ''
  can_see_prices: boolean
  manager_id: string | null
  manager_name: string | null
  /** заявка ждёт ответа склада, а я кладовщик */
  my_stock: boolean
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
  /** null — цены не показываются этому человеку */
  unit_price: number | null
  /** что именно предлагает поставщик: модель, артикул, ссылка */
  model: string
}
export interface Quote {
  id: string
  supplier: string
  supplier_id: string | null
  supplier_status: 'active' | 'restricted' | null
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
  receipts: ReceiptEntry[]
  files: RequestFile[]
  company: string
  decided_by_name: string | null
  decided_at: string | null
  due_at: string | null
  tier: number | null
  amount_gel: number | null
  manager_name: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  me: {
    is_buyer: boolean
    is_initiator: boolean
    is_owner: boolean
    can_request: boolean
    can_budget: boolean
    can_pick_item: boolean
    can_attach: boolean
    my_approval: boolean
    can_see_prices: boolean
    /** заявка у меня как у руководителя сотрудника */
    is_manager: boolean
    is_storekeeper: boolean
  }
}

export interface ReceiptEntry {
  result: Receipt
  lines: { name: string; unit: string; qty: number }[]
  note: string
  at: string
  by: string | null
}

export interface RequestFile {
  id: string
  file_id: string
  name: string
  mime: string
  size: number
  storage_key: string
  quote_id: string | null
  created_at: string
  by: string | null
  can_delete: boolean
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
        amount_gel: num(d.amount_gel),
        project: { ...d.project, fx_rate: num(d.project.fx_rate) },
        lines: d.lines.map((l) => ({ ...l, qty: Number(l.qty), est_price: num(l.est_price), received_qty: Number(l.received_qty ?? 0) })),
        receipts: (d.receipts ?? []).map((x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, qty: Number(l.qty) })) })),
        rfq: d.rfq && {
          ...d.rfq,
          lines: d.rfq.lines.map((l) => ({ ...l, qty: Number(l.qty) })),
          quotes: d.rfq.quotes.map((q) => ({ ...q, prices: q.prices.map((p) => ({ ...p, model: p.model ?? '', unit_price: p.unit_price === null ? null : Number(p.unit_price) })) })),
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
  r.my_stock ||
  (r.status === 'review' && r.manager_id === me) ||
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
    p_lines: r.lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.qty, price: l.est_price, note: l.note, photo: l.photo?.file_id ?? null })),
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

/** Получение: всё, часть (по позициям: {id позиции: сколько пришло сейчас}) или с замечаниями */
export async function receive(id: string, result: Receipt, note: string, lines?: Record<string, number>): Promise<void> {
  const { error } = await supabase.rpc('material_request_receive', { p_request: id, p_result: result, p_note: note, p_lines: lines ?? undefined })
  if (error) throw error
}

// ---------- поставщики ----------

export interface Supplier {
  id: string
  name: string
  tax_id: string
  country: string
  contact: string
  phone: string
  email: string
  address: string
  category: string
  status: 'active' | 'restricted'
  note: string
  quotes: number
  wins: number
  last_quote: string | null
}

export const suppliersQuery = queryOptions({
  queryKey: ['suppliers'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('suppliers_list')
    if (error) throw error
    return (data ?? []) as unknown as Supplier[]
  },
})

export type SupplierInput = Omit<Supplier, 'id' | 'quotes' | 'wins' | 'last_quote'> & { id?: string }

export async function saveSupplier(s: SupplierInput): Promise<string> {
  const { data, error } = await supabase.rpc('supplier_save', {
    p_id: s.id as string,
    p_name: s.name,
    p_tax_id: s.tax_id,
    p_country: s.country,
    p_contact: s.contact,
    p_phone: s.phone,
    p_email: s.email,
    p_address: s.address,
    p_category: s.category,
    p_status: s.status,
    p_note: s.note,
  })
  if (error) throw error
  return data as string
}

export interface SupplierQuote {
  quote_id: string
  created_at: string
  status: 'received' | 'selected' | 'rejected'
  currency: string
  delivery_days: number | null
  terms: string
  rfq_key: string
  title: string
  project_code: string
  request_id: string | null
  request_key: string | null
  lines: { name: string; unit: string; qty: number; unit_price: number }[]
}

export const supplierHistoryQuery = (id: string) =>
  queryOptions({
    queryKey: ['supplier-history', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('supplier_history', { p_id: id })
      if (error) throw error
      return ((data ?? []) as unknown as SupplierQuote[]).map((q) => ({ ...q, lines: q.lines.map((l) => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price) })) }))
    },
  })

export interface PriceHint {
  unit_price: number
  currency: string
  unit: string
  supplier: string
  at: string
  won: boolean
}

/** Почём брали раньше: по названию позиции (без учёта регистра) — последние 3 цены */
export const priceHintsQuery = (names: string[]) =>
  queryOptions({
    queryKey: ['price-hints', names],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('procurement_price_hints', { p_names: names })
      if (error) throw error
      return (data ?? {}) as unknown as Record<string, PriceHint[]>
    },
  })
export const hintKey = (name: string) => name.trim().toLowerCase()

// ---------- пороги и сроки ----------

export interface ProcurementSettings {
  tier1_limit: number
  tier2_limit: number
  sla_stock: number
  sla_sourcing: number
  sla_approval: number
  sla_committee: number
  sla_confirm: number
  can_edit: boolean
}

export const settingsQuery = queryOptions({
  queryKey: ['procurement-settings'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('procurement_settings_get')
    if (error) throw error
    const d = data as unknown as ProcurementSettings
    return { ...d, tier1_limit: Number(d.tier1_limit), tier2_limit: Number(d.tier2_limit) }
  },
})

export async function saveSettings(s: Omit<ProcurementSettings, 'can_edit'>): Promise<void> {
  const { error } = await supabase.rpc('procurement_settings_save', {
    p_tier1: s.tier1_limit,
    p_tier2: s.tier2_limit,
    p_stock: s.sla_stock,
    p_sourcing: s.sla_sourcing,
    p_approval: s.sla_approval,
    p_committee: s.sla_committee,
    p_confirm: s.sla_confirm,
  })
  if (error) throw error
}

export const TIERS: Record<number, string> = {
  1: tr('Уровень 1: глава закупок и главный инженер или прораб'),
  2: tr('Уровень 2: ещё руководитель проекта и директор'),
  3: tr('Уровень 3: комитет — директор, руководитель проекта, финансы'),
}

export interface Suggestion {
  tier: number | null
  tier1_limit: number
  tier2_limit: number
  suggest: { id: string; name: string; job_title: string | null; role: string }[]
}

export const suggestQuery = (requestId: string, amountGel: number | null) =>
  queryOptions({
    queryKey: ['procurement-suggest', requestId, amountGel],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('procurement_suggest_for', { p_request: requestId, p_amount_gel: amountGel as number })
      if (error) throw error
      const d = data as unknown as Suggestion
      return { ...d, tier1_limit: Number(d.tier1_limit), tier2_limit: Number(d.tier2_limit) }
    },
  })

// ---------- вложения ----------

/** Загружает файлы в проект и прикрепляет к заявке (или к предложению). Возвращает имена файлов, которые не удалось загрузить. */
export async function attachToRequest(r: { id: string; projectId: string; tenantId: string }, files: File[], quoteId?: string): Promise<string[]> {
  const failed: string[] = []
  for (const f of files) {
    try {
      const fileId = await uploadProjectFile(r.projectId, r.tenantId, f)
      const { error } = await supabase.rpc('material_request_attach', { p_request: r.id, p_file: fileId, p_quote: quoteId as string })
      if (error) throw error
    } catch {
      failed.push(f.name)
    }
  }
  return failed
}

export async function detachFile(attachmentId: string): Promise<void> {
  const { error } = await supabase.rpc('material_request_detach', { p_attachment: attachmentId })
  if (error) throw error
}

/** Срок шага по отношению к сегодня: просрочен, сегодня, или сколько осталось */
export function dueState(due: string | null): 'late' | 'today' | 'ok' | null {
  if (!due) return null
  const ms = new Date(due).getTime() - Date.now()
  if (ms < 0) return 'late'
  if (ms < 24 * 3600_000) return 'today'
  return 'ok'
}

export async function saveQuote(
  rfqId: string,
  q: { id?: string; supplier: string; currency: string; deliveryDays: number | null; terms: string; note: string; prices: Record<string, number | null>; models?: Record<string, string> },
): Promise<string> {
  const { data, error } = await supabase.rpc('rfq_quote_save', {
    p_rfq: rfqId,
    p_supplier: q.supplier,
    p_currency: q.currency,
    p_delivery_days: q.deliveryDays ?? undefined,
    p_terms: q.terms,
    p_prices: q.prices,
    p_id: q.id,
    p_note: q.note,
    p_models: q.models ?? {},
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
    if (!p || p.unit_price === null) return null
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
export function nowText(r: Pick<RequestRow, 'status' | 'buyer_name' | 'approvals_total' | 'approvals_done' | 'supplier' | 'requester_name' | 'manager_name'>): string {
  switch (r.status) {
    case 'draft':
      return tr('Черновик: ещё не отправлена в закупки')
    case 'review':
      return r.manager_name ? tr('{{name}} подтверждает, что это действительно нужно', { name: r.manager_name }) : tr('Руководитель подтверждает, что это действительно нужно')
    case 'stock_check':
      return tr('Склад проверяет, есть ли это у нас')
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
      : s === 'approval' || s === 'confirming' || s === 'review' || s === 'stock_check'
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
