import { queryOptions } from '@tanstack/react-query'
import { fetchAll } from '@/lib/fetch-all'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export const FFE_STATUSES = ['planned', 'ordered', 'delivered', 'installed'] as const
export type FfeStatus = (typeof FFE_STATUSES)[number]

export const FFE_STATUS_LABELS: Record<FfeStatus, string> = {
  planned: tr('Запланировано'),
  ordered: tr('Заказано'),
  delivered: tr('Поставлено'),
  installed: tr('Установлено'),
}

export const FFE_STATUS_DOT: Record<FfeStatus, string> = {
  planned: 'bg-muted-foreground/40',
  ordered: 'bg-amber-500',
  delivered: 'bg-blue-500',
  installed: 'bg-green-500',
}

export interface FfeItem {
  id: string
  code: string
  name: string
  category: string | null
  unit: string
  note: string | null
}

/** Файл, привязанный к позиции каталога (чертёж, каталожный лист, фото). */
export interface FfeDoc {
  id: string
  code: string | null
  title: string
  // для миниатюры файла (первая страница PDF, как в реестре документов)
  thumb_file_id: string | null
  thumb_source_key: string | null
  thumb_source_mime: string | null
  has_thumb: boolean
  file_name: string | null
  file_mime: string | null
}

export interface RoomType {
  id: string
  name: string
  area: number | null
  specs: string | null
}

export interface RoomTypeItem {
  type_id: string
  item_id: string
  qty: number
}

export interface RoomSpec {
  location_id: string
  type_id: string | null
  area: number | null
  specs: string | null
}

export interface RoomFfe {
  id: string
  location_id: string
  item_id: string
  qty: number
  source: 'type' | 'manual'
  status: FfeStatus
}

export const ffeItemsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'items', projectId],
    queryFn: () =>
      fetchAll<FfeItem>((from, to) =>
        supabase
          .from('ffe_items')
          .select('id, code, name, category, unit, note')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('code')
          .range(from, to),
      ),
  })

/** Файлы всех позиций каталога: позиция → список документов. */
export const ffeDocsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'docs', projectId],
    queryFn: async () => {
      const links = await fetchAll<{ document_id: string; entity_id: string }>((from, to) =>
        supabase.from('document_links').select('document_id, entity_id').eq('project_id', projectId).eq('entity_type', 'ffe_item' as never).order('id').range(from, to),
      )
      const ids = [...new Set(links.map((l) => l.document_id))]
      const docs = new Map<string, FfeDoc>()
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase.from('documents_overview').select('id, code, title, thumb_file_id, thumb_source_key, thumb_source_mime, has_thumb, file_name, file_mime').in('id', ids.slice(i, i + 100))
        if (error) throw error
        for (const d of data as unknown as FfeDoc[]) docs.set(d.id, d)
      }
      const out = new Map<string, FfeDoc[]>()
      for (const l of links) {
        const d = docs.get(l.document_id)
        if (d) out.set(l.entity_id, [...(out.get(l.entity_id) ?? []), d])
      }
      return out
    },
  })

export const roomTypesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'types', projectId],
    queryFn: async () => {
      const [types, items] = await Promise.all([
        supabase.from('room_types').select('id, name, area, specs').eq('project_id', projectId).is('deleted_at', null).order('name'),
        fetchAll<RoomTypeItem>((from, to) => supabase.from('room_type_items').select('type_id, item_id, qty').eq('project_id', projectId).order('type_id').order('item_id').range(from, to)),
      ])
      if (types.error) throw types.error
      return { types: types.data as unknown as RoomType[], items }
    },
  })

export const roomSpecsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'specs', projectId],
    queryFn: () =>
      fetchAll<RoomSpec>((from, to) => supabase.from('room_specs').select('location_id, type_id, area, specs').eq('project_id', projectId).order('location_id').range(from, to)),
  })

export const roomFfeQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'rows', projectId],
    queryFn: () =>
      fetchAll<RoomFfe>((from, to) => supabase.from('room_ffe').select('id, location_id, item_id, qty, source, status').eq('project_id', projectId).order('id').range(from, to)),
  })

/** Сводка по мебели: штуки по статусам и по типам номеров (без выгрузки всех строк). */
export const ffeOverviewQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'overview', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ffe_overview', { p_project: projectId })
      if (error) throw error
      return data as unknown as { by_status: Partial<Record<FfeStatus, number>>; by_type: Record<string, number> }
    },
  })

/** Мебель одного номера: страница номера не должна тянуть весь проект. */
export const roomLinesQuery = (projectId: string, locationId: string) =>
  queryOptions({
    queryKey: ['ffe', 'room-lines', projectId, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from('room_ffe').select('id, location_id, item_id, qty, source, status').eq('project_id', projectId).eq('location_id', locationId).order('id')
      if (error) throw error
      return data as unknown as RoomFfe[]
    },
  })

/** Ключи кэша, которые нужно обновить после любой правки мебели. */
export const FFE_KEYS = [['ffe'], ['locations']] as const

export function ffeError(e: unknown): string {
  const m = e as { message?: string; code?: string }
  if (m.message?.startsWith('code_exists')) return tr('Позиция с таким кодом уже есть.')
  if (m.message?.startsWith('name_exists')) return tr('Тип с таким названием уже есть.')
  if (m.message?.startsWith('in_use')) return tr('Нельзя удалить: это используется в номерах или типах. Сначала уберите его оттуда.')
  if (m.message?.startsWith('title_required')) return tr('Заполните код и название.')
  if (m.code === '42501') return tr('Недостаточно прав: мебель правят руководитель проекта, ГИП и ПТО.')
  return tr('Не удалось сохранить. Попробуйте ещё раз.')
}

export async function upsertItem(v: { projectId: string; id: string | null; code: string; name: string; category: string; unit: string; note: string }): Promise<string> {
  const { data, error } = await supabase.rpc('ffe_upsert_item', {
    p_project: v.projectId,
    p_id: v.id as never,
    p_code: v.code,
    p_name: v.name,
    p_category: v.category || undefined,
    p_unit: v.unit || 'шт',
    p_note: v.note || undefined,
  })
  if (error) throw error
  return data
}

export async function deleteItem(projectId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('ffe_delete_item', { p_project: projectId, p_id: id })
  if (error) throw error
}

export interface ImportItemRow {
  code: string
  name: string
  category: string
  unit: string
  document_code: string
}

export async function importItems(projectId: string, rows: ImportItemRow[]): Promise<{ created: number; updated: number; unknown_documents: number }> {
  const { data, error } = await supabase.rpc('ffe_import_items', { p_project: projectId, p_rows: rows as never })
  if (error) throw error
  return data as unknown as { created: number; updated: number; unknown_documents: number }
}

export async function upsertRoomType(v: { projectId: string; id: string | null; name: string; area: number | null; specs: string }): Promise<string> {
  const { data, error } = await supabase.rpc('room_type_upsert', {
    p_project: v.projectId,
    p_id: v.id as never,
    p_name: v.name,
    p_area: (v.area ?? undefined) as never,
    p_specs: v.specs || undefined,
  })
  if (error) throw error
  return data
}

export async function deleteRoomType(projectId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('room_type_delete', { p_project: projectId, p_id: id })
  if (error) throw error
}

export async function setTypeItem(projectId: string, typeId: string, itemId: string, qty: number): Promise<number> {
  const { data, error } = await supabase.rpc('room_type_set_item', { p_project: projectId, p_type: typeId, p_item: itemId, p_qty: qty })
  if (error) throw error
  return data
}

export async function applyRoomType(projectId: string, locationIds: string[], typeId: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('apply_room_type', { p_project: projectId, p_locations: locationIds, p_type: (typeId ?? undefined) as never })
  if (error) throw error
  return data
}

export async function setRoomSpecs(v: { projectId: string; locationId: string; name: string | null; area: number | null; specs: string }): Promise<void> {
  const { error } = await supabase.rpc('room_set_specs', {
    p_project: v.projectId,
    p_location: v.locationId,
    p_name: (v.name ?? undefined) as never,
    p_area: (v.area ?? undefined) as never,
    p_specs: (v.specs || undefined) as never,
  })
  if (error) throw error
}

export async function setRoomItem(projectId: string, locationId: string, itemId: string, qty: number): Promise<void> {
  const { error } = await supabase.rpc('room_ffe_set', { p_project: projectId, p_location: locationId, p_item: itemId, p_qty: qty })
  if (error) throw error
}

export async function setItemStatus(projectId: string, ids: string[], status: FfeStatus): Promise<number> {
  const { data, error } = await supabase.rpc('room_ffe_set_status', { p_project: projectId, p_ids: ids, p_status: status })
  if (error) throw error
  return data
}

/** Сводка по статусам в штуках. */
export function statusTotals(rows: { qty: number; status: FfeStatus }[]): Record<FfeStatus, number> & { total: number } {
  const out = { planned: 0, ordered: 0, delivered: 0, installed: 0, total: 0 }
  for (const r of rows) {
    out[r.status] += r.qty
    out.total += r.qty
  }
  return out
}

export const IMPORT_ITEM_HEADER = ['Код', 'Название', 'Категория', 'Ед. изм.', 'Чертёж (шифр документа)']

const ITEM_ALIASES: Record<keyof ImportItemRow, string[]> = {
  code: ['код', 'артикул', 'шифр', 'code', 'sku'],
  name: ['название', 'наименование', 'позиция', 'name'],
  category: ['категория', 'группа', 'тип', 'category'],
  unit: ['ед', 'ед.', 'ед. изм.', 'единица', 'unit'],
  document_code: ['чертёж', 'чертеж', 'чертёж (шифр документа)', 'шифр чертежа', 'документ', 'drawing', 'document'],
}

/** Разбор таблицы каталога по заголовкам; первая непустая строка — заголовок. */
export function itemsFromTable(table: unknown[][]): { rows: ImportItemRow[]; missing: string[] } {
  const [header, ...body] = table.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (!header) return { rows: [], missing: ['код', 'название'] }
  const index = new Map<keyof ImportItemRow, number>()
  header.forEach((h, i) => {
    const key = String(h ?? '').trim().toLowerCase()
    for (const field of Object.keys(ITEM_ALIASES) as (keyof ImportItemRow)[]) {
      if (ITEM_ALIASES[field].includes(key) && !index.has(field)) index.set(field, i)
    }
  })
  const missing = (['code', 'name'] as const).filter((f) => !index.has(f)).map((f) => ITEM_ALIASES[f][0])
  const cell = (r: unknown[], f: keyof ImportItemRow) => (index.has(f) ? String(r[index.get(f)!] ?? '').trim() : '')
  const rows = body
    .map((r) => ({ code: cell(r, 'code'), name: cell(r, 'name'), category: cell(r, 'category'), unit: cell(r, 'unit'), document_code: cell(r, 'document_code') }))
    .filter((r) => r.code || r.name)
  return { rows, missing }
}

// ---------------------------------------------------------------------------
// Договоры на мебель
// ---------------------------------------------------------------------------
export const CONTRACT_STATUSES = ['draft', 'signed', 'terminated'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: tr('Черновик'),
  signed: tr('Подписан'),
  terminated: tr('Расторгнут'),
}

export const CONTRACT_STATUS_STYLES: Record<ContractStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  signed: 'bg-green-500/15 text-green-800 dark:text-green-300',
  terminated: 'bg-red-500/10 text-red-700 dark:text-red-300',
}

export interface FfeContract {
  id: string
  title: string
  number: string | null
  organization_id: string | null
  contractor_name: string | null
  signed_on: string | null
  signed_by_user: string | null
  contractor_signatory: string | null
  status: ContractStatus
  cbs_item_id: string | null
  commitment_id: string | null
  note: string | null
  organization: { name: string } | null
  signer: { full_name: string } | null
}

export const contractorName = (c: FfeContract) => c.organization?.name ?? c.contractor_name ?? '—'

export const ffeContractsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'contracts', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ffe_contracts')
        .select('id, title, number, organization_id, contractor_name, signed_on, signed_by_user, contractor_signatory, status, cbs_item_id, commitment_id, note, organization:organizations(name), signer:users!signed_by_user(full_name)')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at')
      if (error) throw error
      return data as unknown as FfeContract[]
    },
  })

export const ffeScopesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'scopes', projectId],
    queryFn: () => fetchAll<{ contract_id: string; location_id: string }>((from, to) => supabase.from('ffe_contract_scopes').select('contract_id, location_id').eq('project_id', projectId).order('location_id').range(from, to)),
  })

export const ffePricesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['ffe', 'prices', projectId],
    queryFn: () => fetchAll<{ contract_id: string; item_id: string; unit_price: number }>((from, to) => supabase.from('ffe_contract_prices').select('contract_id, item_id, unit_price').eq('project_id', projectId).order('contract_id').order('item_id').range(from, to)),
  })

export function contractError(e: unknown): string {
  const m = e as { message?: string; code?: string }
  if (m.message?.startsWith('scope_taken')) return tr('Это место уже закреплено за другим договором.')
  if (m.message?.startsWith('contractor_required')) return tr('Укажите подрядчика.')
  if (m.message?.startsWith('title_required')) return tr('Укажите название договора.')
  if (m.message?.startsWith('signer_not_member')) return tr('Подписант должен быть участником проекта.')
  if (m.message?.includes('budget.edit')) return tr('Чтобы связать договор со статьёй бюджета, нужны права на бюджет.')
  if (m.message?.includes('budget.view')) return tr('Цены могут менять и видеть только те, у кого есть доступ к бюджету.')
  if (m.code === '42501') return tr('Недостаточно прав: договоры правят руководитель проекта, ГИП и ПТО.')
  return tr('Не удалось сохранить. Попробуйте ещё раз.')
}

export interface ContractInput {
  projectId: string
  id: string | null
  title: string
  number: string
  organizationId: string | null
  contractorName: string
  signedOn: string
  signedBy: string | null
  contractorSignatory: string
  status: ContractStatus
  cbsItemId: string | null
  note: string
}

export async function upsertContract(v: ContractInput): Promise<string> {
  const { data, error } = await supabase.rpc('ffe_contract_upsert', {
    p_project: v.projectId,
    p_id: v.id as never,
    p_title: v.title,
    p_number: v.number as never,
    p_organization: v.organizationId as never,
    p_contractor_name: v.contractorName as never,
    p_signed_on: (v.signedOn || null) as never,
    p_signed_by: v.signedBy as never,
    p_contractor_signatory: v.contractorSignatory as never,
    p_status: v.status,
    p_cbs_item: v.cbsItemId as never,
    p_note: v.note as never,
  })
  if (error) throw error
  return data
}

export async function deleteContract(projectId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('ffe_contract_delete', { p_project: projectId, p_id: id })
  if (error) throw error
}

export async function addScope(projectId: string, contractId: string, locationIds: string[], move = false): Promise<number> {
  const { data, error } = await supabase.rpc('ffe_contract_add_scope', { p_project: projectId, p_contract: contractId, p_locations: locationIds, p_move: move })
  if (error) throw error
  return data
}

export async function removeScope(projectId: string, contractId: string, locationIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('ffe_contract_remove_scope', { p_project: projectId, p_contract: contractId, p_locations: locationIds })
  if (error) throw error
  return data
}

export async function setPrice(projectId: string, contractId: string, itemId: string, price: number | null): Promise<void> {
  const { error } = await supabase.rpc('ffe_contract_set_price', { p_project: projectId, p_contract: contractId, p_item: itemId, p_price: price as never })
  if (error) throw error
}

export async function resyncContracts(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('ffe_contracts_resync', { p_project: projectId })
  if (error) throw error
  return data
}
