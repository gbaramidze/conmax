import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { fetchAll } from '@/lib/fetch-all'
import { supabase } from '@/lib/supabase'

export const LOCATION_KIND_LABELS = {
  site: tr('Площадка'),
  building: tr('Корпус'),
  section: tr('Секция'),
  floor: tr('Этаж'),
  zone: tr('Зона'),
  room: tr('Помещение'),
  other: tr('Другое'),
} as const
export type LocationKind = keyof typeof LOCATION_KIND_LABELS

/** Какой вид узла обычно создаётся внутри данного. */
export const NEXT_KIND: Record<LocationKind, LocationKind> = {
  site: 'building',
  building: 'section',
  section: 'floor',
  floor: 'zone',
  zone: 'room',
  room: 'other',
  other: 'other',
}

export const PURPOSES = ['apartment', 'hotel_room', 'office', 'commercial', 'common', 'technical', 'parking', 'storage', 'other'] as const
export type LocationPurpose = (typeof PURPOSES)[number]

export const PURPOSE_LABELS: Record<LocationPurpose, string> = {
  apartment: tr('Квартира'),
  hotel_room: tr('Гостиничный номер'),
  office: tr('Офис'),
  commercial: tr('Коммерческое помещение'),
  common: tr('МОП (места общего пользования)'),
  technical: tr('Техническое помещение'),
  parking: tr('Машино-место'),
  storage: tr('Кладовая'),
  other: tr('Другое'),
}

/** Короткие подписи для сводки «6 ном. · 2 комм.». */
export const PURPOSE_SHORT: Record<LocationPurpose, string> = {
  apartment: tr('кв.'),
  hotel_room: tr('ном.'),
  office: tr('оф.'),
  commercial: tr('комм.'),
  common: tr('МОП'),
  technical: tr('тех.'),
  parking: tr('м/м'),
  storage: tr('клад.'),
  other: tr('проч.'),
}

export interface LocationRow {
  id: string
  parent_id: string | null
  kind: LocationKind
  code: string
  name: string
  path: string
  sort: number
  /** Позиция среди соседей (дробная): ставит узел между номерами этажей; пусто — порядок по `sort` */
  position: number | null
  purpose: LocationPurpose | null
}

/** Ключ порядка показа: у этажа — номер, у остальных узлов позиция (если задана) или `sort`. */
export const orderKey = (r: { sort: number; position: number | null }): number => (r.position === null || r.position === undefined ? r.sort : Number(r.position))

export const locationsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['locations', projectId],
    queryFn: () =>
      fetchAll<LocationRow>((from, to) =>
        supabase
          .from('locations')
          .select('id, parent_id, kind, code, name, path, sort, position, purpose')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('path')
          .range(from, to),
      ),
  })

export interface LocationNode extends LocationRow {
  depth: number
  hasChildren: boolean
}

/** Плоский список в порядке обхода дерева: дети сортируются по `sort`, затем по коду. */
export function flattenTree(rows: LocationRow[]): LocationNode[] {
  const byParent = new Map<string | null, LocationRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.parent_id) ?? []
    list.push(r)
    byParent.set(r.parent_id, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code))

  const out: LocationNode[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push({ ...r, depth, hasChildren: byParent.has(r.id) })
      walk(r.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** «Корпус 1 › Секция 2 › Этаж 3» по пути вида K1.S2.F03. */
export function locationLabel(path: string | null | undefined, rows: LocationRow[]): string {
  if (!path) return tr('Без локации')
  const byPath = new Map(rows.map((r) => [r.path, r.name]))
  const parts = path.split('.')
  return parts.map((_, i) => byPath.get(parts.slice(0, i + 1).join('.')) ?? parts[i]).join(' › ')
}

export async function generateBuilding(input: {
  projectId: string
  code: string
  name: string
  sections: number
  floorFrom: number
  floorTo: number
}): Promise<number> {
  const { data, error } = await supabase.rpc('generate_building', {
    p_project: input.projectId,
    p_code: input.code,
    p_name: input.name,
    p_sections: input.sections,
    p_floor_from: input.floorFrom,
    p_floor_to: input.floorTo,
  })
  if (error) throw error
  return data
}

/** Помещения на этажах поддерева (все или с … по …): по этажам (501, 502 …) или сквозная нумерация. Возвращает число созданных. */
export async function generateRooms(input: {
  projectId: string
  parentId: string
  perFloor: number
  scheme: 'floor' | 'sequential'
  purpose: LocationPurpose
  floorFrom?: number | null
  floorTo?: number | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('generate_rooms', {
    p_project: input.projectId,
    p_parent: input.parentId,
    p_per_floor: input.perFloor,
    p_scheme: input.scheme,
    p_purpose: input.purpose,
    p_floor_from: (input.floorFrom ?? undefined) as never,
    p_floor_to: (input.floorTo ?? undefined) as never,
  })
  if (error) throw error
  return data
}

export async function createLocation(input: {
  projectId: string
  parentId: string | null
  kind: LocationKind
  code: string
  name: string
  sort: number
}): Promise<string> {
  const { data, error } = await supabase
    .from('locations')
    .insert({
      project_id: input.projectId,
      parent_id: input.parentId,
      kind: input.kind,
      code: input.code,
      name: input.name,
      sort: input.sort,
    } as never) // tenant_id и path проставляет триггер БД
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** Название и порядок узла. У этажа порядок — это номер этажа (−1 подвал, 3, 12…), на нём держатся диапазоны «с … по …». */
export async function updateLocation(id: string, patch: { name?: string; sort?: number }): Promise<void> {
  const { error } = await supabase.from('locations').update(patch as never).eq('id', id)
  if (error) throw error
}

/** Соседи узла (с тем же родителем) в порядке показа: по `sort`, затем по коду. */
export function siblingsOf(rows: LocationRow[], parentId: string | null): LocationRow[] {
  return rows.filter((r) => r.parent_id === parentId).sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code))
}

/** Задать порядок всех соседей одного родителя. Этажи остаются по номерам, остальные узлы встают между ними. */
export async function reorderLocations(projectId: string, parentId: string | null, ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('locations_reorder', { p_project: projectId, p_parent: parentId ?? (null as never), p_ids: ids })
  if (error) throw error
}

export async function archiveLocation(id: string): Promise<void> {
  const { error } = await supabase.from('locations').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function setLocationPurpose(projectId: string, ids: string[], purpose: LocationPurpose): Promise<number> {
  const { data, error } = await supabase.rpc('set_location_purpose', { p_project: projectId, p_ids: ids, p_purpose: purpose })
  if (error) throw error
  return data
}

/** Этажи внутри узла (или сам этаж), по порядку номеров. */
export function floorsUnder(rows: LocationRow[], node: { id: string; path: string }): LocationRow[] {
  return rows.filter((r) => r.kind === 'floor' && (r.id === node.id || r.path.startsWith(node.path + '.'))).sort((a, b) => a.sort - b.sort)
}

/** Идентификаторы этажей узла с номерами от … до … включительно. */
export function floorIdsInRange(rows: LocationRow[], node: { id: string; path: string }, from: number, to: number): string[] {
  return floorsUnder(rows, node).filter((f) => f.sort >= from && f.sort <= to).map((f) => f.id)
}

export type RoomCounts = Partial<Record<LocationPurpose, number>>

/** Сколько помещений каждого назначения лежит внутри каждого узла (по пути). */
export function roomSummary(rows: LocationRow[]): Map<string, RoomCounts> {
  const out = new Map<string, RoomCounts>()
  for (const r of rows) {
    if (r.kind !== 'room') continue
    const purpose = r.purpose ?? 'other'
    const parts = r.path.split('.')
    for (let i = 1; i < parts.length; i++) {
      const key = parts.slice(0, i).join('.')
      const c = out.get(key) ?? {}
      c[purpose] = (c[purpose] ?? 0) + 1
      out.set(key, c)
    }
  }
  return out
}

/** «6 ном. · 2 комм.» */
export function summaryText(c: RoomCounts | undefined): string {
  if (!c) return ''
  return PURPOSES.filter((p) => c[p]).map((p) => `${c[p]} ${PURPOSE_SHORT[p]}`).join(' · ')
}

/** Сменить тип узла (секция, этаж, зона). Этажу нужен номер. Код и путь не меняются. */
export async function setLocationKind(projectId: string, id: string, kind: LocationKind, floorNo: number | null): Promise<void> {
  const { error } = await supabase.rpc('location_set_kind', { p_project: projectId, p_id: id, p_kind: kind, p_floor_no: floorNo ?? (null as never) })
  if (error) throw error
}
