import { queryOptions } from '@tanstack/react-query'
import type { ObjectGeometry, ObjectStatus } from '@/features/plans/object-types'
import type { Point } from '@/features/plans/zones'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export interface PlanObject {
  id: string
  page: number
  type_code: string
  geometry: ObjectGeometry
  points: Point[]
  label: string
  status: ObjectStatus
  notes: string
  /** Подтип внутри типа (dome, bullet…) */
  variant: string | null
  /** Направление в градусах по часовой стрелке от «вверх» */
  rotation: number
  /** Множитель размера метки */
  size: number
  /** Свой цвет #rrggbb; пусто — цвет типа */
  color: string | null
  /** Характеристики (мегапиксели, объектив, мощность…): ключи описаны в каталоге типов */
  specs: Record<string, string | number>
}

/** Объекты документа (все страницы): отдельный запрос, права смотрит RLS. */
export const planObjectsQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['plan-objects', documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_objects')
        .select('id, page, type_code, geometry, points, label, status, notes, variant, rotation, size, color, specs')
        .eq('document_id', documentId)
        .order('created_at')
      if (error) throw error
      // numeric приходит числом, но на всякий случай приводим
      return (data as unknown as PlanObject[]).map((o) => ({ ...o, rotation: Number(o.rotation), size: Number(o.size), specs: o.specs ?? {} }))
    },
  })

export interface ObjectInput {
  projectId: string
  documentId: string
  page: number
  type: string
  geometry: ObjectGeometry
  points: Point[]
  label?: string
  status?: ObjectStatus
  notes?: string
  id?: string
  variant?: string | null
  rotation?: number
  size?: number
  color?: string | null
  specs?: Record<string, string | number>
}

export async function saveObject(i: ObjectInput): Promise<string> {
  const { data, error } = await supabase.rpc('plan_object_set', {
    p_project: i.projectId,
    p_document: i.documentId,
    p_page: i.page,
    p_type: i.type,
    p_geometry: i.geometry,
    p_points: i.points,
    p_label: i.label ?? '',
    p_status: i.status ?? 'installed',
    p_notes: i.notes ?? '',
    p_id: i.id ?? undefined,
    p_variant: i.variant ?? undefined,
    p_rotation: i.rotation ?? 0,
    p_size: i.size ?? 1,
    p_color: i.color ?? undefined,
    p_specs: i.specs ?? {},
  })
  if (error) throw error
  return data as string
}

export async function deleteObject(id: string): Promise<void> {
  const { error } = await supabase.rpc('plan_object_delete', { p_object: id })
  if (error) throw error
}

/** Масштаб листов документа: страница → метров в полной ширине листа. */
export const planScalesQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['plan-scales', documentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_scales').select('page, meters_per_width').eq('document_id', documentId)
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.page, Number(r.meters_per_width)]))
    },
  })

export async function setPlanScale(projectId: string, documentId: string, page: number, metersPerWidth: number | null): Promise<void> {
  const { error } = await supabase.rpc('plan_scale_set', { p_project: projectId, p_document: documentId, p_page: page, p_meters_per_width: metersPerWidth as number })
  if (error) throw error
}

/**
 * Длина ломаной в долях ширины листа. Доли по вертикали считаются от высоты листа, поэтому ось Y приводится к ширине через
 * пропорции листа (`aspect` = высота / ширина). Умножьте на метры в ширине листа — получите метры.
 */
export function pathWidths(points: Point[], aspect: number): number {
  let s = 0
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i]![0] - points[i - 1]![0], (points[i]![1] - points[i - 1]![1]) * aspect)
  return s
}

/** Площадь многоугольника в квадратных «ширинах листа» (шнуровка с поправкой на пропорции). */
export function areaWidths(points: Point[], aspect: number): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    s += x1 * y2 * aspect - x2 * y1 * aspect
  }
  return Math.abs(s) / 2
}

/** «23,4 м» / «1 240 м» — округляем разумно: до десятых для коротких, до целых для длинных. */
export function formatMeters(m: number): string {
  return tr('{{n}} м', { n: new Intl.NumberFormat(undefined, { maximumFractionDigits: m < 100 ? 1 : 0 }).format(m) })
}

export function formatSquareMeters(m2: number): string {
  return tr('{{n}} м²', { n: new Intl.NumberFormat(undefined, { maximumFractionDigits: m2 < 100 ? 1 : 0 }).format(m2) })
}

/** Расстояние от точки до отрезка (в тех же единицах, что и входные числа). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Линия под точкой нажатия: координаты в долях листа переводятся в пиксели листа (w × h),
 * допуск — `tolerancePx` пикселей экрана при масштабе z. Из нескольких берётся ближайшая.
 */
export function hitLine(objects: PlanObject[], fx: number, fy: number, w: number, h: number, z: number, tolerancePx = 10): PlanObject | null {
  let best: PlanObject | null = null
  let bestD = tolerancePx / z
  for (const o of objects) {
    if (o.geometry !== 'line') continue
    for (let i = 0; i < o.points.length - 1; i++) {
      const [ax, ay] = o.points[i]!
      const [bx, by] = o.points[i + 1]!
      const d = distToSegment(fx * w, fy * h, ax * w, ay * h, bx * w, by * h)
      if (d < bestD) {
        best = o
        bestD = d
      }
    }
  }
  return best
}
