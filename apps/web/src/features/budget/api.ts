import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { toDisplay } from '@/features/projects/display-currency'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const COST_TYPE_LABELS = {
  labor: tr('Труд'),
  materials: tr('Материалы'),
  equipment: tr('Механизмы'),
  subcontract: tr('Субподряд'),
  overhead: tr('Накладные'),
  contingency: tr('Резерв'),
  other: tr('Прочее'),
} as const
export type CostType = keyof typeof COST_TYPE_LABELS

export const DOC_TYPE_LABELS = {
  act: tr('Акт КС-2'),
  invoice: tr('Счёт'),
  writeoff: tr('Списание'),
  payroll: tr('Зарплата'),
  other: tr('Прочее'),
} as const
export type ActualDocType = keyof typeof DOC_TYPE_LABELS

export interface CbsItem {
  id: string
  parent_id: string | null
  code: string
  name: string
  cost_type: CostType
  sort: number
}
export interface BudgetVersion {
  id: string
  number: number
  name: string
  note: string | null
  status: 'draft' | 'approved' | 'superseded'
  created_at: string
  approved_at: string | null
}
export interface BudgetAmount {
  version_id: string
  item_id: string
  amount: number
}
export interface BudgetCommitment {
  id: string
  item_id: string
  title: string
  counterparty: string | null
  doc_number: string | null
  signed_on: string | null
  amount: number
  /** Валюта, в которой договор введён, если не основная; тогда orig_amount — сумма в ней. */
  currency: string | null
  orig_amount: number | null
  status: 'active' | 'cancelled'
  note: string | null
}
export interface BudgetActual {
  id: string
  item_id: string
  commitment_id: string | null
  activity_id: string | null
  doc_type: ActualDocType
  doc_number: string | null
  doc_date: string
  amount: number
  currency: string | null
  orig_amount: number | null
  counterparty: string | null
  note: string | null
}
export interface BudgetEtc {
  item_id: string
  etc_amount: number
  note: string | null
}
export interface ActivityBudget {
  activity_id: string
  item_id: string
  amount: number
}

/** PostgREST отдаёт numeric числом или строкой — приводим к числу. */
function num<T>(rows: T[], keys: (keyof T)[]): T[] {
  return rows.map((r) => {
    const out = { ...r } as Record<string, unknown>
    for (const k of keys) out[k as string] = Number(r[k])
    return out as T
  })
}

export const cbsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'items', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cbs_items')
        .select('id, parent_id, code, name, cost_type, sort')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .limit(5000)
      if (error) throw error
      return data as unknown as CbsItem[]
    },
  })

export const budgetVersionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'versions', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_versions')
        .select('id, number, name, note, status, created_at, approved_at')
        .eq('project_id', projectId)
        .order('number', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as unknown as BudgetVersion[]
    },
  })

export const budgetAmountsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'amounts', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_amounts').select('version_id, item_id, amount').eq('project_id', projectId).limit(50000)
      if (error) throw error
      return num(data as unknown as BudgetAmount[], ['amount'])
    },
  })

export const commitmentsBudgetQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'commitments', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_commitments')
        .select('id, item_id, title, counterparty, doc_number, signed_on, amount, currency, orig_amount, status, note')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('signed_on', { ascending: false, nullsFirst: false })
        .limit(10000)
      if (error) throw error
      return num(data as unknown as BudgetCommitment[], ['amount']).map((c) => ({ ...c, orig_amount: c.orig_amount === null ? null : Number(c.orig_amount) }))
    },
  })

export const actualsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'actuals', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_actuals')
        .select('id, item_id, commitment_id, activity_id, doc_type, doc_number, doc_date, amount, currency, orig_amount, counterparty, note')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('doc_date', { ascending: false })
        .limit(20000)
      if (error) throw error
      return num(data as unknown as BudgetActual[], ['amount']).map((a) => ({ ...a, orig_amount: a.orig_amount === null ? null : Number(a.orig_amount) }))
    },
  })

export const etcQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'etc', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_etc').select('item_id, etc_amount, note').eq('project_id', projectId).limit(5000)
      if (error) throw error
      return num(data as unknown as BudgetEtc[], ['etc_amount'])
    },
  })

export const activityBudgetsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['budget', 'activity-budgets', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_budgets').select('activity_id, item_id, amount').eq('project_id', projectId).limit(10000)
      if (error) throw error
      return num(data as unknown as ActivityBudget[], ['amount'])
    },
  })

// ---------------------------------------------------------------------------
// Ошибки и операции
// ---------------------------------------------------------------------------
export const BUDGET_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Недостаточно прав для этого действия.'),
  code_exists: tr('Статья с таким кодом уже есть.'),
  '23505': tr('Такая запись уже есть (код статьи или черновик версии).'),
  draft_exists: tr('Черновик уже создан: продолжите его или отмените.'),
  title_required: tr('Заполните код и название.'),
  item_not_found: tr('Статья не найдена: возможно, её уже удалили.'),
  item_in_use: tr('Статью нельзя удалить: есть вложенные статьи, договоры, факт или суммы утверждённых версий.'),
  cycle_in_hierarchy: tr('Статью нельзя поместить в саму себя или в свою вложенную.'),
  version_not_found: tr('Версия бюджета не найдена.'),
  version_locked: tr('Утверждённую версию менять нельзя — создайте черновик.'),
  budget_empty: tr('В бюджете нет ни одной суммы.'),
  bad_amount: tr('Проверьте сумму.'),
  rate_required: tr('Чтобы вводить суммы в другой валюте, укажите курс в карточке проекта.'),
  currency_invalid: tr('Эта валюта не поддерживается: доступны лари и доллар.'),
  bad_rows: tr('Не удалось разобрать строки файла.'),
  commitment_not_found: tr('Договор не найден.'),
  actual_not_found: tr('Запись факта не найдена.'),
  activity_not_found: tr('Выберите работы графика (суммарные работы не подходят).'),
}

export class BudgetError extends Error {
  code: string
  detail: string
  constructor(code: string, detail = '') {
    super(code)
    this.code = code
    this.detail = detail
  }
}

function fail(error: { code?: string; message?: string }): never {
  const msg = error.message ?? ''
  const row = msg.match(/^row_invalid:(\d+)/)
  if (row) throw new BudgetError('row_invalid', row[1])
  const key = Object.keys(BUDGET_ERROR_TEXT).find((k) => msg.startsWith(k)) ?? error.code ?? 'unknown'
  throw new BudgetError(key)
}

export const budgetErrorText = (e: unknown, fallback: string) => {
  if (!(e instanceof BudgetError)) return fallback
  if (e.code === 'row_invalid') return tr('Не удалось загрузить: проверьте строку {{detail}} файла (код статьи, сумма).', { detail: e.detail })
  return BUDGET_ERROR_TEXT[e.code] ?? fallback
}

export async function upsertItem(v: { projectId: string; id: string | null; parentId: string | null; code: string; name: string; costType: CostType }): Promise<string> {
  const { data, error } = await supabase.rpc('budget_upsert_item', {
    p_project: v.projectId,
    p_id: (v.id ?? null) as never,
    p_parent: (v.parentId ?? null) as never,
    p_code: v.code,
    p_name: v.name,
    p_cost_type: v.costType,
  })
  if (error) fail(error)
  return data as string
}
export async function deleteItem(id: string) {
  const { error } = await supabase.rpc('budget_delete_item', { p_item: id })
  if (error) fail(error)
}
export async function createDraft(projectId: string, name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_budget_draft', { p_project: projectId, p_name: (name ?? null) as never })
  if (error) fail(error)
  return data as string
}
export async function setAmount(versionId: string, itemId: string, amount: number) {
  const { error } = await supabase.rpc('set_budget_amount', { p_version: versionId, p_item: itemId, p_amount: amount })
  if (error) fail(error)
}
export async function discardDraft(versionId: string) {
  const { error } = await supabase.rpc('discard_budget_draft', { p_version: versionId })
  if (error) fail(error)
}
export async function approveVersion(versionId: string, note: string) {
  const { error } = await supabase.rpc('approve_budget_version', { p_version: versionId, p_note: (note.trim() || null) as never })
  if (error) fail(error)
}
export async function importBudget(versionId: string, rows: { code: string; name: string; amount: number; cost_type?: string }[]): Promise<{ rows: number; created: number; updated: number }> {
  const { data, error } = await supabase.rpc('import_budget', { p_version: versionId, p_rows: rows })
  if (error) fail(error)
  return data as unknown as { rows: number; created: number; updated: number }
}
export async function saveCommitment(v: { projectId: string; id: string | null; itemId: string; title: string; counterparty: string; docNumber: string; signedOn: string | null; amount: number; currency?: string | null; status: 'active' | 'cancelled'; note: string }) {
  const { error } = await supabase.rpc('budget_save_commitment', {
    p_project: v.projectId,
    p_id: (v.id ?? null) as never,
    p_item: v.itemId,
    p_title: v.title,
    p_counterparty: v.counterparty,
    p_doc_number: v.docNumber,
    p_signed_on: (v.signedOn ?? null) as never,
    p_amount: v.amount,
    p_status: v.status,
    p_note: v.note,
    p_currency: v.currency ?? undefined,
  })
  if (error) fail(error)
}
export async function deleteCommitment(id: string) {
  const { error } = await supabase.rpc('budget_delete_commitment', { p_id: id })
  if (error) fail(error)
}
export async function saveActual(v: { projectId: string; id: string | null; itemId: string; docType: ActualDocType; docNumber: string; docDate: string; amount: number; currency?: string | null; counterparty: string; commitmentId: string | null; note: string }) {
  const { error } = await supabase.rpc('budget_save_actual', {
    p_project: v.projectId,
    p_id: (v.id ?? null) as never,
    p_item: v.itemId,
    p_doc_type: v.docType,
    p_doc_number: v.docNumber,
    p_doc_date: v.docDate,
    p_amount: v.amount,
    p_counterparty: v.counterparty,
    p_commitment: (v.commitmentId ?? null) as never,
    p_note: v.note,
    p_currency: v.currency ?? undefined,
  })
  if (error) fail(error)
}
export async function deleteActual(id: string) {
  const { error } = await supabase.rpc('budget_delete_actual', { p_id: id })
  if (error) fail(error)
}
export async function importCommitments(projectId: string, rows: Record<string, unknown>[]): Promise<number> {
  const { data, error } = await supabase.rpc('import_budget_commitments', { p_project: projectId, p_rows: rows as never })
  if (error) fail(error)
  return data as number
}
export async function importActuals(projectId: string, rows: Record<string, unknown>[]): Promise<number> {
  const { data, error } = await supabase.rpc('import_budget_actuals', { p_project: projectId, p_rows: rows as never })
  if (error) fail(error)
  return data as number
}
export async function setEtc(itemId: string, amount: number | null, note: string) {
  const { error } = await supabase.rpc('set_budget_etc', { p_item: itemId, p_amount: (amount ?? null) as never, p_note: note })
  if (error) fail(error)
}
export async function allocateBudget(itemId: string, activityIds: string[], basis: 'duration' | 'equal'): Promise<number> {
  const { data, error } = await supabase.rpc('allocate_budget', { p_item: itemId, p_activities: activityIds, p_basis: basis })
  if (error) fail(error)
  return Number(data)
}

// ---------------------------------------------------------------------------
// Расчёт таблицы «бюджет / обязательства / факт / прогноз / отклонение»
// ---------------------------------------------------------------------------
export type Light = 'green' | 'yellow' | 'red' | 'none'

export interface BudgetRow extends CbsItem {
  depth: number
  hasChildren: boolean
  /** Исходный бюджет (первая утверждённая версия), изменения, текущий BAC */
  initial: number
  changes: number
  bac: number
  commitments: number
  actual: number
  etc: number
  /** Прогноз при завершении: факт + остаток */
  eac: number
  /** BAC − EAC: отрицательное — перерасход */
  variance: number
  light: Light
  /** Обязательства больше бюджета */
  overCommitted: boolean
  /** ETC введён вручную (на самой статье) */
  manualEtc: boolean
}

export interface ReserveInfo {
  initial: number
  current: number
  /** Ожидаемый перерасход по статьям, кроме самого резерва */
  overrun: number
  remaining: number
}

export interface BudgetModel {
  rows: BudgetRow[]
  total: BudgetRow
  reserve: ReserveInfo
  /** Версия, по которой считается BAC: действующая или (если ещё нет утверждённых) черновик */
  basis: BudgetVersion | null
}

export const fmtMoney = (n: number) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(Math.round(toDisplay(n)))

export function lightOf(bac: number, eac: number): Light {
  if (bac === 0 && eac === 0) return 'none'
  if (eac <= bac) return 'green'
  if (bac > 0 && eac <= bac * 1.05) return 'yellow'
  return 'red'
}

export function buildBudget(input: {
  items: CbsItem[]
  versions: BudgetVersion[]
  amounts: BudgetAmount[]
  commitments: BudgetCommitment[]
  actuals: BudgetActual[]
  etc: BudgetEtc[]
}): BudgetModel {
  const { items, versions, amounts, commitments, actuals, etc } = input
  const approved = versions.find((v) => v.status === 'approved') ?? null
  const draft = versions.find((v) => v.status === 'draft') ?? null
  const basis = approved ?? draft
  const locked = versions.filter((v) => v.status !== 'draft').sort((a, b) => a.number - b.number)
  const first = locked[0] ?? null

  const own = (versionId: string | undefined) => {
    const map = new Map<string, number>()
    if (versionId) for (const a of amounts) if (a.version_id === versionId) map.set(a.item_id, a.amount)
    return map
  }
  const bacOwn = own(basis?.id)
  const initialOwn = own(first?.id ?? basis?.id)
  const commitOwn = new Map<string, number>()
  for (const c of commitments) if (c.status === 'active') commitOwn.set(c.item_id, (commitOwn.get(c.item_id) ?? 0) + c.amount)
  const actualOwn = new Map<string, number>()
  for (const a of actuals) actualOwn.set(a.item_id, (actualOwn.get(a.item_id) ?? 0) + a.amount)
  const etcManual = new Map(etc.map((e) => [e.item_id, e.etc_amount]))

  // собственные значения статьи; ETC — введённый вручную или «большее из бюджета и договоров минус факт»; резерв не считается потраченным
  type Own = { initial: number; bac: number; commitments: number; actual: number; etc: number; manual: boolean }
  const typeOf = new Map(items.map((i) => [i.id, i.cost_type]))
  const ownOf = (id: string): Own => {
    const bac = bacOwn.get(id) ?? 0
    const commitments = commitOwn.get(id) ?? 0
    const actual = actualOwn.get(id) ?? 0
    const manual = etcManual.has(id)
    return { initial: initialOwn.get(id) ?? 0, bac, commitments, actual, manual, etc: manual ? etcManual.get(id)! : typeOf.get(id) === 'contingency' ? 0 : Math.max(Math.max(bac, commitments) - actual, 0) }
  }

  const children = new Map<string | null, CbsItem[]>()
  for (const it of items) children.set(it.parent_id, [...(children.get(it.parent_id) ?? []), it])
  const sortKids = (list: CbsItem[]) => list.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code, currentLocale(), { numeric: true }))

  const rows: BudgetRow[] = []
  const empty = (): Own => ({ initial: 0, bac: 0, commitments: 0, actual: 0, etc: 0, manual: false })
  const sum = (a: Own, b: Own): Own => ({ initial: a.initial + b.initial, bac: a.bac + b.bac, commitments: a.commitments + b.commitments, actual: a.actual + b.actual, etc: a.etc + b.etc, manual: a.manual })
  const rowOf = (it: CbsItem, depth: number, hasChildren: boolean, t: Own, manual: boolean): BudgetRow => {
    const eac = t.actual + t.etc
    return {
      ...it,
      depth,
      hasChildren,
      initial: t.initial,
      changes: t.bac - t.initial,
      bac: t.bac,
      commitments: t.commitments,
      actual: t.actual,
      etc: t.etc,
      eac,
      variance: t.bac - eac,
      light: lightOf(t.bac, eac),
      overCommitted: t.commitments > t.bac + 0.005,
      manualEtc: manual,
    }
  }
  const walk = (parent: string | null, depth: number): Own => {
    let acc = empty()
    for (const it of sortKids([...(children.get(parent) ?? [])])) {
      const index = rows.length
      rows.push(undefined as unknown as BudgetRow)
      const kids = walk(it.id, depth + 1)
      const mine = ownOf(it.id)
      const t = sum(mine, kids)
      rows[index] = rowOf(it, depth, (children.get(it.id) ?? []).length > 0, t, mine.manual)
      acc = sum(acc, t)
    }
    return acc
  }
  const grand = walk(null, 0)
  const total = rowOf({ id: 'total', parent_id: null, code: '', name: tr('Итого по проекту'), cost_type: 'other', sort: 0 }, 0, false, grand, false)

  // резерв: статьи типа «Резерв» против ожидаемого перерасхода по остальным статьям (по их собственным значениям)
  let reserveCurrent = 0
  let reserveInitial = 0
  let overrun = 0
  for (const it of items) {
    const o = ownOf(it.id)
    if (it.cost_type === 'contingency') {
      reserveCurrent += o.bac
      reserveInitial += o.initial
    } else {
      overrun += Math.max(o.actual + o.etc - o.bac, 0)
    }
  }
  return { rows, total, reserve: { initial: reserveInitial, current: reserveCurrent, overrun, remaining: reserveCurrent - overrun }, basis }
}

/** Сравнение двух версий: изменённые статьи с суммами по ним (с вложенными). */
export function diffVersions(items: CbsItem[], amounts: BudgetAmount[], fromId: string, toId: string) {
  const val = (vid: string) => {
    const m = new Map<string, number>()
    for (const a of amounts) if (a.version_id === vid) m.set(a.item_id, a.amount)
    return m
  }
  const a = val(fromId)
  const b = val(toId)
  const byParent = new Map<string | null, CbsItem[]>()
  for (const it of items) byParent.set(it.parent_id, [...(byParent.get(it.parent_id) ?? []), it])
  const rows: { item: CbsItem; depth: number; from: number; to: number }[] = []
  const walk = (parent: string | null, depth: number): [number, number] => {
    let sa = 0
    let sb = 0
    for (const it of (byParent.get(parent) ?? []).sort((x, y) => x.sort - y.sort || x.code.localeCompare(y.code, currentLocale(), { numeric: true }))) {
      const idx = rows.length
      rows.push(undefined as never)
      const [ka, kb] = walk(it.id, depth + 1)
      const fa = (a.get(it.id) ?? 0) + ka
      const fb = (b.get(it.id) ?? 0) + kb
      rows[idx] = { item: it, depth, from: fa, to: fb }
      sa += fa
      sb += fb
    }
    return [sa, sb]
  }
  const [from, to] = walk(null, 0)
  return { rows: rows.filter((r) => Math.abs(r.to - r.from) > 0.004), from, to }
}
