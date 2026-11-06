import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// План объёмов
// ---------------------------------------------------------------------------
export interface WorkItemRow {
  id: string
  project_id: string
  location_id: string
  location_path: string
  discipline_id: string | null
  contractor_org_id: string | null
  name: string
  unit: string
  planned_qty: number
  weight: number | null
  status: 'active' | 'cancelled'
  done_qty: number
  pending_qty: number
  verified_qty: number
  /** Состояние доверия к факту: см. ADR-014 */
  verification: Verification
  checked_at: string | null
}

export type Verification = 'unchecked' | 'verified' | 'disputed' | 'accepted'
export type Verdict = 'match' | 'minor' | 'major'

const ITEM_COLUMNS =
  'id, project_id, location_id, location_path, discipline_id, contractor_org_id, name, unit, planned_qty, weight, status, done_qty, pending_qty, verified_qty, verification, checked_at'

function toWorkItem(r: WorkItemRow): WorkItemRow {
  return {
    ...r,
    planned_qty: Number(r.planned_qty),
    weight: r.weight === null ? null : Number(r.weight),
    done_qty: Number(r.done_qty),
    pending_qty: Number(r.pending_qty),
    verified_qty: Number(r.verified_qty),
  }
}

export const workItemsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['work-items', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_items_progress')
        .select(ITEM_COLUMNS)
        .eq('project_id', projectId)
        .order('location_path')
        .order('name')
        .limit(3000)
      if (error) throw error
      return (data as unknown as WorkItemRow[]).map(toWorkItem)
    },
  })

export const organizationsListQuery = queryOptions({
  queryKey: ['organizations-all'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('organizations').select('id, name, kind').is('deleted_at', null).eq('is_active', true).order('name')
    if (error) throw error
    return data
  },
})

export function percent(done: number, planned: number): number {
  return planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0
}

/** «30 из 150 м²» */
export function formatQty(n: number): string {
  return new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 }).format(n)
}

export async function createWorkItem(input: {
  projectId: string
  locationId: string
  disciplineId: string | null
  contractorId: string | null
  name: string
  unit: string
  plannedQty: number
  weight: number | null
  plannedStart?: string | null
  plannedFinish?: string | null
}): Promise<void> {
  const { error } = await supabase.from('work_items').insert({
    project_id: input.projectId,
    location_id: input.locationId,
    discipline_id: input.disciplineId,
    contractor_org_id: input.contractorId,
    name: input.name,
    unit: input.unit,
    planned_qty: input.plannedQty,
    weight: input.weight,
    planned_start: input.plannedStart || null,
    planned_finish: input.plannedFinish || null,
  } as never) // tenant_id и location_path проставляет триггер БД
  if (error) throw error
}

export async function cancelWorkItem(id: string): Promise<void> {
  const { error } = await supabase.from('work_items').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Импорт из Excel / CSV
// ---------------------------------------------------------------------------
export interface ImportRow {
  location: string
  discipline: string
  contractor: string
  name: string
  unit: string
  qty: string
  weight: string
  start: string
  finish: string
}

export interface ImportReport {
  total: number
  valid: number
  errors: { row: number; message: string }[]
  created: number
}

const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  location: ['место', 'локация', 'этаж', 'location'],
  discipline: ['направление', 'дисциплина', 'discipline'],
  contractor: ['подрядчик', 'организация', 'contractor'],
  name: ['работа', 'вид работ', 'название', 'name'],
  unit: ['ед', 'ед.', 'ед. изм.', 'единица', 'единица измерения', 'unit'],
  qty: ['объём', 'объем', 'план', 'количество', 'qty'],
  weight: ['вес', 'стоимость', 'трудоёмкость', 'трудоемкость', 'weight'],
  start: ['начало', 'дата начала', 'старт', 'start', 'start date'],
  finish: ['окончание', 'конец', 'дата окончания', 'финиш', 'finish', 'end', 'end date'],
}

export const IMPORT_TEMPLATE_HEADER = ['Место', 'Направление', 'Подрядчик', 'Работа', 'Ед. изм.', 'Объём', 'Вес', 'Начало', 'Окончание']

/** Дата из таблицы: ячейка-дата Excel, «25.10.2026» или «2026-10-25» → «2026-10-25»; непонятное остаётся как есть (сервер сообщит об ошибке). */
export function normDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  const t = String(v ?? '').trim()
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return t
}

/** Разбор строк таблицы по заголовкам (русские и английские названия). Первая непустая строка — заголовок. */
export function rowsFromTable(table: unknown[][]): { rows: ImportRow[]; missing: string[] } {
  const [header, ...body] = table.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (!header) return { rows: [], missing: ['заголовок'] }
  const index = new Map<keyof ImportRow, number>()
  header.forEach((h, i) => {
    const key = String(h ?? '').trim().toLowerCase()
    for (const field of Object.keys(HEADER_ALIASES) as (keyof ImportRow)[]) {
      if (HEADER_ALIASES[field].includes(key) && !index.has(field)) index.set(field, i)
    }
  })
  const required: (keyof ImportRow)[] = ['location', 'name', 'unit', 'qty']
  const missing = required.filter((f) => !index.has(f)).map((f) => HEADER_ALIASES[f][0])
  const cell = (r: unknown[], f: keyof ImportRow) => {
    if (!index.has(f)) return ''
    const v = r[index.get(f)!]
    if (f === 'start' || f === 'finish') return normDate(v)
    return String(v ?? '').trim()
  }
  const rows = body.map((r) => ({
    location: cell(r, 'location'),
    discipline: cell(r, 'discipline'),
    contractor: cell(r, 'contractor'),
    name: cell(r, 'name'),
    unit: cell(r, 'unit'),
    // «1 250,5» → «1250,5»: пробелы-разделители тысяч сервер не разбирает
    qty: cell(r, 'qty').replace(/[\s ]/g, ''),
    weight: cell(r, 'weight').replace(/[\s ]/g, ''),
    start: cell(r, 'start'),
    finish: cell(r, 'finish'),
  }))
  return { rows, missing }
}

/** Простой разбор CSV (разделитель запятая или точка с запятой, кавычки). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const delimiter = (clean.split('\n')[0].match(/;/g)?.length ?? 0) >= (clean.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

export async function readTable(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text())
  const { readSheet } = await import('read-excel-file/browser')
  return (await readSheet(file)) as unknown[][]
}

export function templateCsv(): string {
  const example = ['K1.S1.F05', 'KR', tr('МонолитСтрой'), tr('Монтаж стеклопакетов'), tr('м²'), '150', '900', '2026-11-02', '2026-11-20']
  return '﻿' + [IMPORT_TEMPLATE_HEADER, example].map((r) => r.join(';')).join('\r\n') + '\r\n'
}

export async function importWorkItems(projectId: string, rows: ImportRow[], dryRun: boolean): Promise<ImportReport> {
  const { data, error } = await supabase.rpc('import_work_items', { p_project: projectId, p_rows: rows as never, p_dry_run: dryRun })
  if (error) throw error
  return data as unknown as ImportReport
}

// ---------------------------------------------------------------------------
// Обходы
// ---------------------------------------------------------------------------
export interface WalkRow {
  id: string
  project_id: string
  location_id: string
  location_path: string
  author_id: string
  kind: WalkKind
  status: 'draft' | 'submitted' | 'approved'
  started_at: string
  submitted_at: string | null
}

/** Отчёт — внести факт; проверка — независимо измерить, сколько сделано (ADR-014). */
export type WalkKind = 'report' | 'check'

/** progress/no_work — отчёт; observed — итог на месте в проверке; blocked — в обоих видах. */
export type WalkResultKind = 'progress' | 'no_work' | 'blocked' | 'observed'

export interface WalkResultRow {
  work_item_id: string
  result: WalkResultKind
  qty: number | null
  reason_code: string | null
  comment: string | null
}

export const walkQuery = (id: string) =>
  queryOptions({
    queryKey: ['walk', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_walks')
        .select('id, project_id, location_id, location_path, author_id, kind, status, started_at, submitted_at')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as WalkRow | null
    },
  })

export const walkResultsQuery = (walkId: string) =>
  queryOptions({
    queryKey: ['walk-results', walkId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_walk_results')
        .select('work_item_id, result, qty, reason_code, comment')
        .eq('walk_id', walkId)
      if (error) throw error
      return (data as unknown as WalkResultRow[]).map((r) => ({ ...r, qty: r.qty === null ? null : Number(r.qty) }))
    },
  })

/**
 * Ожидаемые в обходе позиции (тот же отбор, что и на сервере): для отчёта — незавершённые,
 * для проверки — всё, по чему уже что-то заявлено, в том числе выполненное на 100 %.
 */
export const expectedItemsQuery = (projectId: string, locationPath: string, kind: WalkKind = 'report') =>
  queryOptions({
    queryKey: ['walk-expected', projectId, locationPath, kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_items_progress')
        .select(ITEM_COLUMNS)
        .eq('project_id', projectId)
        .eq('status', 'active')
        .or(`location_path.eq.${locationPath},location_path.like.${locationPath}.*`)
        .order('location_path')
        .order('name')
      if (error) throw error
      return (data as unknown as WorkItemRow[])
        .map(toWorkItem)
        .filter((r) => (kind === 'check' ? r.done_qty + r.pending_qty > 0 : r.done_qty + r.pending_qty < r.planned_qty))
    },
  })

export const myDraftWalksQuery = (userId: string, projectId: string) =>
  queryOptions({
    queryKey: ['walks', 'drafts', projectId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_walks')
        .select('id, location_path, kind, started_at')
        .eq('project_id', projectId)
        .eq('author_id', userId)
        .eq('status', 'draft')
        .order('started_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

export const walksToApproveQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['walks', 'to-approve', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_walks')
        .select('id, location_path, submitted_at, author:users!author_id(full_name)')
        .eq('project_id', projectId)
        .eq('status', 'submitted')
        .eq('kind', 'report')
        .order('submitted_at', { ascending: false })
      if (error) throw error
      return data as unknown as { id: string; location_path: string; submitted_at: string; author: { full_name: string } | null }[]
    },
  })

export async function startWalk(projectId: string, locationId: string, kind: WalkKind = 'report'): Promise<string> {
  const { data, error } = await supabase.rpc('start_walk', { p_project: projectId, p_location: locationId, p_kind: kind })
  if (error) throw toWalkError(error)
  return data.id
}

export class WalkError extends Error {
  code: string
  hint?: string
  constructor(code: string, hint?: string) {
    super(code)
    this.code = code
    this.hint = hint
  }
}

export const WALK_ERROR_TEXT: Record<string, string> = {
  walk_incomplete: tr('Заполните все позиции обхода, потом завершайте.'),
  qty_required: tr('Укажите объём больше нуля.'),
  reason_required: tr('Выберите причину.'),
  comment_required: tr('Добавьте комментарий.'),
  item_not_expected: tr('Эта позиция уже не входит в обход. Обновите страницу.'),
  walk_closed: tr('Обход уже завершён.'),
  forbidden: tr('У вас нет права на это действие.'),
  invalid_result: tr('Такой исход нельзя указать в этом виде обхода.'),
  already_resolved: tr('Расхождение уже закрыто. Обновите страницу.'),
  invalid_resolution: tr('Выберите решение.'),
}

function toWalkError(error: { code?: string; message: string; hint?: string | null }): WalkError {
  return new WalkError(error.code === '42501' ? 'forbidden' : error.message, error.hint ?? undefined)
}

export async function saveWalkResult(input: {
  walkId: string
  itemId: string
  result: WalkResultKind
  qty?: number
  reasonCode?: string
  comment?: string
}): Promise<void> {
  const { error } = await supabase.rpc('save_walk_result', {
    p_walk: input.walkId,
    p_item: input.itemId,
    p_result: input.result,
    p_qty: input.qty ?? undefined,
    p_reason_code: input.reasonCode ?? undefined,
    p_comment: input.comment ?? undefined,
  })
  if (error) throw toWalkError(error)
}

export async function clearWalkResult(walkId: string, itemId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_walk_result', { p_walk: walkId, p_item: itemId })
  if (error) throw toWalkError(error)
}

export async function submitWalk(walkId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_walk', { p_walk: walkId })
  if (error) throw toWalkError(error)
}

export async function approveWalk(walkId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_walk', { p_walk: walkId })
  if (error) throw toWalkError(error)
}

// ---------------------------------------------------------------------------
// Независимая проверка и расхождения (ADR-014)
// ---------------------------------------------------------------------------
export interface Tolerance {
  ok: number
  major: number
}
export const DEFAULT_TOLERANCE: Tolerance = { ok: 10, major: 25 }

export function toleranceOf(settings: unknown): Tolerance {
  const t = (settings as { check_tolerance?: Partial<Tolerance> } | null)?.check_tolerance
  return { ok: Number(t?.ok ?? DEFAULT_TOLERANCE.ok), major: Number(t?.major ?? DEFAULT_TOLERANCE.major) }
}

/** Предварительный вердикт для подсказки в форме; окончательное решение принимает сервер (private.check_verdict). */
export function checkVerdict(planned: number, reported: number, observed: number, tol: Tolerance = DEFAULT_TOLERANCE): Verdict {
  const delta = Math.abs(observed - reported)
  if (delta === 0 || delta <= planned * 0.005) return 'match'
  const rel = (delta / Math.max(reported, observed)) * 100
  return rel <= tol.ok ? 'match' : rel <= tol.major ? 'minor' : 'major'
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  match: tr('Совпало'),
  minor: tr('Расхождение'),
  major: tr('Серьёзное расхождение'),
}

export type Resolution = 'accept_reported' | 'accept_observed' | 'superseded'

export const RESOLUTION_TEXT: Record<Resolution, string> = {
  accept_reported: tr('Принято заявленное'),
  accept_observed: tr('Принято проверенное'),
  superseded: tr('Заменено новой проверкой'),
}

export interface CheckRow {
  id: string
  work_item_id: string
  walk_id: string
  checked_at: string
  observed_qty: number
  reported_qty: number
  delta: number
  verdict: Verdict
  independent: boolean
  resolution: Resolution | null
  resolved_at: string | null
  resolution_note: string | null
  item: { name: string; unit: string; location_path: string; contractor_org_id: string | null; planned_qty: number } | null
  checker: { full_name: string } | null
  resolver: { full_name: string } | null
}

const CHECK_COLUMNS =
  'id, work_item_id, walk_id, checked_at, observed_qty, reported_qty, delta, verdict, independent, resolution, resolved_at, resolution_note,' +
  ' item:work_items!work_item_id(name, unit, location_path, contractor_org_id, planned_qty),' +
  ' checker:users!checked_by(full_name), resolver:users!resolved_by(full_name)'

function toCheck(r: CheckRow): CheckRow {
  return { ...r, observed_qty: Number(r.observed_qty), reported_qty: Number(r.reported_qty), delta: Number(r.delta) }
}

export const checksQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['checks', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_checks')
        .select(CHECK_COLUMNS)
        .eq('project_id', projectId)
        .order('checked_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data as unknown as CheckRow[]).map(toCheck)
    },
  })

export const walkChecksQuery = (walkId: string) =>
  queryOptions({
    queryKey: ['checks', 'walk', walkId],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_checks').select(CHECK_COLUMNS).eq('walk_id', walkId)
      if (error) throw error
      return (data as unknown as CheckRow[]).map(toCheck)
    },
  })

export async function resolveDiscrepancy(checkId: string, resolution: 'accept_reported' | 'accept_observed', note: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_discrepancy', { p_check: checkId, p_resolution: resolution, p_note: note.trim() || undefined })
  if (error) throw toWalkError(error)
}

export async function setProgressApproval(projectId: string, current: Record<string, unknown>, on: boolean): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ settings: { ...current, progress_approval: on } })
    .eq('id', projectId)
  if (error) throw error
}

/** Позиция на много мест сразу: одинаковые название, объём и сроки для каждого выбранного места. Возвращает число созданных. */
export async function createWorkItemsBulk(input: {
  projectId: string
  locationIds: string[]
  disciplineId: string | null
  contractorId: string | null
  name: string
  unit: string
  plannedQty: number
  weight: number | null
  plannedStart: string | null
  plannedFinish: string | null
}): Promise<number> {
  let created = 0
  for (let i = 0; i < input.locationIds.length; i += 300) {
    const rows = input.locationIds.slice(i, i + 300).map((locationId) => ({
      project_id: input.projectId,
      location_id: locationId,
      discipline_id: input.disciplineId,
      contractor_org_id: input.contractorId,
      name: input.name,
      unit: input.unit,
      planned_qty: input.plannedQty,
      weight: input.weight,
      planned_start: input.plannedStart || null,
      planned_finish: input.plannedFinish || null,
    }))
    const { error } = await supabase.from('work_items').insert(rows as never)
    if (error) throw error
    created += rows.length
  }
  return created
}

/** Места, где позиция с таким названием уже есть (повторное массовое добавление их пропускает). */
export async function locationsWithItem(projectId: string, name: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('work_items').select('location_id').eq('project_id', projectId).eq('status', 'active').is('deleted_at', null).ilike('name', name.trim()).limit(5000)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.location_id))
}

/** Новая организация (подрядчик, поставщик…). Если такое название уже есть, возвращается существующая. */
export async function createOrganization(projectId: string, name: string, kind: string, taxId: string): Promise<string> {
  const { data, error } = await supabase.rpc('organization_create', { p_project: projectId, p_name: name, p_kind: kind, p_tax_id: taxId || (null as never) })
  if (error) throw error
  return data as string
}

/** Сроки позиции: в представлении прогресса их нет, поэтому окно правки читает их отдельно. */
export async function workItemDates(id: string): Promise<{ start: string; finish: string }> {
  const { data, error } = await supabase.from('work_items').select('planned_start, planned_finish').eq('id', id).single()
  if (error) throw error
  return { start: data.planned_start ?? '', finish: data.planned_finish ?? '' }
}

/** Правка позиции. Место не меняется: чтобы перенести работу, создайте позицию в новом месте и уберите старую. */
export async function updateWorkItem(
  id: string,
  patch: { disciplineId: string | null; contractorId: string | null; name: string; unit: string; plannedQty: number; weight: number | null; plannedStart: string | null; plannedFinish: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('work_items')
    .update({
      discipline_id: patch.disciplineId,
      contractor_org_id: patch.contractorId,
      name: patch.name,
      unit: patch.unit,
      planned_qty: patch.plannedQty,
      weight: patch.weight,
      planned_start: patch.plannedStart || null,
      planned_finish: patch.plannedFinish || null,
    } as never)
    .eq('id', id)
  if (error) throw error
}
