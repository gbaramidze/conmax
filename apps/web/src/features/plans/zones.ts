import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export type Point = [number, number]

export interface PlanZone {
  id: string
  page: number
  location_id: string
  path: string
  code: string
  name: string
  kind: string
  points: Point[]
  type_name: string | null
  ffe_total: number
  ffe_installed: number
  tasks_open: number
  tasks_overdue: number
  /** Назначение помещения (квартира, машино-место…) */
  purpose: string | null
  /** У зоны типа номера (kind = 'room_type'): сколько номеров этого типа в проекте */
  rooms?: number
}

/** Зона типа номера на плане этажа: «тут номер типа ONE BEDROOM». Не привязана к помещению. */
export interface TypeZoneRow {
  id: string
  page: number
  type_id: string
  type_name: string
  points: Point[]
  rooms: number
  pieces: number
}

export const planTypeZonesQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['plan-type-zones', documentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('plan_type_zones', { p_document: documentId })
      if (error) throw error
      return data as unknown as TypeZoneRow[]
    },
  })

/** Обвести зону типа (zoneId пусто) или перерисовать и сменить тип у готовой. */
export async function setTypeZone(projectId: string, documentId: string, page: number, typeId: string, points: Point[], zoneId?: string): Promise<void> {
  const { error } = await supabase.rpc('plan_type_zone_set', { p_project: projectId, p_document: documentId, p_page: page, p_type: typeId, p_points: points, p_zone: zoneId ?? (null as never) })
  if (error) throw error
}

export async function deleteTypeZone(zoneId: string): Promise<void> {
  const { error } = await supabase.rpc('plan_type_zone_delete', { p_zone: zoneId })
  if (error) throw error
}

/** Зона типа в виде обычной зоны плана: рисуется и нажимается так же, цвет — по типу. */
export const typeZoneToPlanZone = (z: TypeZoneRow): PlanZone => ({
  id: z.id,
  page: z.page,
  location_id: z.type_id,
  path: '',
  code: '',
  name: z.type_name,
  kind: 'room_type',
  points: z.points,
  type_name: z.type_name,
  ffe_total: z.pieces,
  ffe_installed: 0,
  tasks_open: 0,
  tasks_overdue: 0,
  purpose: null,
  rooms: z.rooms,
})

/** Зоны документа с данными места: мебель и открытые задачи внутри (для этажа и выше — сумма по помещениям). */
export const planZonesQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['plan-zones', documentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('plan_zones', { p_document: documentId })
      if (error) throw error
      return data as unknown as PlanZone[]
    },
  })

export async function setZone(projectId: string, documentId: string, page: number, locationId: string, points: Point[]): Promise<void> {
  const { error } = await supabase.rpc('plan_zone_set', { p_project: projectId, p_document: documentId, p_page: page, p_location: locationId, p_points: points })
  if (error) throw error
}

/** Один контур сразу для нескольких мест (типовой план на группу этажей); возвращает число созданных или обновлённых зон. */
export async function setZonesMany(projectId: string, documentId: string, page: number, locationIds: string[], points: Point[]): Promise<number> {
  const { data, error } = await supabase.rpc('plan_zone_set_many', { p_project: projectId, p_document: documentId, p_page: page, p_locations: locationIds, p_points: points })
  if (error) throw error
  return data as number
}

export async function deleteZone(zoneId: string): Promise<void> {
  const { error } = await supabase.rpc('plan_zone_delete', { p_zone: zoneId })
  if (error) throw error
}

export type ZoneColorMode = 'ffe' | 'tasks' | 'type' | 'purpose' | 'none'

export const ZONE_MODE_LABELS: Record<ZoneColorMode, string> = {
  ffe: tr('Готовность мебели'),
  tasks: tr('Замечания и задачи'),
  type: tr('Тип номера'),
  purpose: tr('Назначение'),
  none: tr('Без раскраски'),
}

const GRAY = '#94a3b8'
const AMBER = '#f59e0b'
const GREEN = '#16a34a'
const RED = '#dc2626'

/** Цвета назначений помещений для раскраски и легенды. */
export const PURPOSE_COLORS: Record<string, string> = {
  apartment: '#2563eb',
  hotel_room: '#7c3aed',
  office: '#0d9488',
  commercial: '#d97706',
  common: '#64748b',
  technical: '#dc2626',
  parking: '#475569',
  storage: '#a16207',
  other: '#94a3b8',
}

/** Цвет зоны по выбранной раскраске; для «типа номера» цвет типа передаёт вызывающий. */
export function zoneColor(z: PlanZone, mode: ZoneColorMode, typeColor: (name: string | null) => string): string {
  if (mode === 'none') return '#475569'
  if (z.kind === 'room_type') return typeColor(z.type_name)
  if (mode === 'type') return typeColor(z.type_name)
  if (mode === 'purpose') return PURPOSE_COLORS[z.purpose ?? 'other'] ?? GRAY
  if (mode === 'tasks') return z.tasks_overdue > 0 ? RED : z.tasks_open > 0 ? AMBER : GRAY
  if (z.ffe_total === 0) return GRAY
  return z.ffe_installed >= z.ffe_total ? GREEN : z.ffe_installed > 0 ? AMBER : GRAY
}

export const zoneShortName = (z: Pick<PlanZone, 'name'>) => z.name.replace(/^(номер|помещение|квартира|room)\s*/i, '') || z.name

export const rectPoints = (x: number, y: number, x2: number, y2: number): Point[] => [
  [x, y],
  [x2, y],
  [x2, y2],
  [x, y2],
]

/** Площадь многоугольника в долях листа (формула шнуровки). */
export function polygonArea(points: Point[]): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

/** Центр масс многоугольника — сюда ставится подпись; для вырожденного берётся среднее вершин. */
export function centroid(points: Point[]): Point {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    const f = x1 * y2 - x2 * y1
    a += f
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  if (Math.abs(a) < 1e-9) return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
  return [cx / (3 * a), cy / (3 * a)]
}

/** Точка внутри многоугольника (луч вправо). */
export function pointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!
    const [xj, yj] = points[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Зона под точкой; при вложенных зонах (этаж и помещения в нём) — самая маленькая. */
export function hitZone(zones: PlanZone[], x: number, y: number): PlanZone | null {
  let best: PlanZone | null = null
  let bestArea = Infinity
  for (const z of zones) {
    if (!pointInPolygon(x, y, z.points)) continue
    const a = polygonArea(z.points)
    if (a < bestArea) {
      best = z
      bestArea = a
    }
  }
  return best
}
