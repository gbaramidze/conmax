import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/** Отметка мебели, поставленная вручную на лист плана комнаты (когда в PDF нет текста с кодами). */
export interface FurnitureMark {
  id: string
  page: number
  item_id: string
  x: number
  y: number
  /** У зоны — противоположный угол прямоугольника; у точки пусто */
  x2: number | null
  y2: number | null
}

export const planMarksQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['plan-furniture-marks', documentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_furniture_marks').select('id, page, item_id, x, y, x2, y2').eq('document_id', documentId).order('created_at')
      if (error) throw error
      type Raw = Omit<FurnitureMark, 'x' | 'y' | 'x2' | 'y2'> & { x: number | string; y: number | string; x2: number | string | null; y2: number | string | null }
      return (data as unknown as Raw[]).map((m) => ({ ...m, x: Number(m.x), y: Number(m.y), x2: m.x2 === null ? null : Number(m.x2), y2: m.y2 === null ? null : Number(m.y2) }))
    },
  })

export async function addFurnitureMark(projectId: string, documentId: string, page: number, itemId: string, spot: { x: number; y: number; x2?: number; y2?: number }): Promise<void> {
  const { error } = await supabase.rpc('plan_furniture_mark_add', { p_project: projectId, p_document: documentId, p_page: page, p_item: itemId, p_x: spot.x, p_y: spot.y, p_x2: spot.x2 ?? (null as never), p_y2: spot.y2 ?? (null as never) })
  if (error) throw error
}

export async function deleteFurnitureMark(markId: string): Promise<void> {
  const { error } = await supabase.rpc('plan_furniture_mark_delete', { p_mark: markId })
  if (error) throw error
}

export function marksError(e: unknown): string {
  const m = e as { message?: string; code?: string }
  if (m.message?.startsWith('too_many_marks')) return tr('На плане уже 500 отметок: больше поставить нельзя.')
  if (m.code === '42501') return tr('Недостаточно прав: отметки ставят руководитель проекта, ГИП и ПТО.')
  return tr('Не удалось сохранить отметку. Попробуйте ещё раз.')
}
