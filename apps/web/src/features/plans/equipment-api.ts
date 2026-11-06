import { queryOptions } from '@tanstack/react-query'
import type { ObjectGeometry, ObjectStatus } from '@/features/plans/object-types'
import { supabase } from '@/lib/supabase'

/** Объект со слоёв планов вместе с документом, на котором он стоит — строка реестра оборудования. */
export interface EquipmentRow {
  id: string
  page: number
  type_code: string
  geometry: ObjectGeometry
  label: string
  status: ObjectStatus
  variant: string | null
  notes: string
  color: string | null
  specs: Record<string, string | number> | null
  document_id: string
  /** Помещение, в зону которого попала точка объекта (считает база); у трасс и на типовых планах пусто */
  location_id: string | null
  doc: { id: string; title: string; code: string | null } | null
}

/** Все объекты слоёв по проекту (камеры, щиты, трассы…) с названием плана; права и видимость документов считает RLS. */
export const equipmentQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['equipment', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_objects')
        .select('id, page, type_code, geometry, label, status, variant, notes, color, specs, document_id, location_id, doc:documents!inner(id, title, code, deleted_at)')
        .eq('project_id', projectId)
        .is('doc.deleted_at', null)
        .order('type_code')
        .limit(5000)
      if (error) throw error
      return data as unknown as EquipmentRow[]
    },
  })

/** Объекты, стоящие в указанных помещениях (помещение и всё внутри него): камеры, щиты и другое, что видно на планах. */
export const locationEquipmentQuery = (projectId: string, locationIds: string[]) =>
  queryOptions({
    queryKey: ['equipment', projectId, 'in', [...locationIds].sort().join(',')],
    enabled: locationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_objects')
        .select('id, page, type_code, geometry, label, status, variant, notes, color, specs, document_id, location_id, doc:documents!inner(id, title, code, deleted_at)')
        .eq('project_id', projectId)
        .in('location_id', locationIds)
        .is('doc.deleted_at', null)
        .order('type_code')
        .limit(500)
      if (error) throw error
      return data as unknown as EquipmentRow[]
    },
  })
