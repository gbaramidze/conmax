import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET } from '@/features/activity/api'
import type { DocumentRow, VersionRow } from '@/features/documents/api'
import type { StatusCategory } from '@/features/tasks/api'
import { supabase } from '@/lib/supabase'

export interface PinTask {
  id: string
  key: string
  title: string
  type: string
  status_category: StatusCategory
  priority: string
  due_date: string | null
  assignee: { full_name: string } | null
}

export interface PinRow {
  id: string
  task_id: string
  document_id: string
  version_id: string | null
  /** Номер булавки в этом документе (1, 2, 3…): у каждого документа свой, не переиспользуется */
  doc_no: number
  page: number
  x: number
  y: number
  /** Правый нижний угол области; у точки — null */
  x2: number | null
  y2: number | null
  task: PinTask | null
}

/** Все булавки проекта: их мало, а для списка планов нужны счётчики по документам. */
export const pinsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['plan-pins', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_pins')
        .select(
          'id, task_id, document_id, version_id, doc_no, page, x, y, x2, y2, task:tasks(id, key, title, type, status_category, priority, due_date, assignee:users!assignee_id(full_name))',
        )
        .eq('project_id', projectId)
        .limit(5000)
      if (error) throw error
      return (data as unknown as PinRow[]).filter((p) => p.task)
    },
  })

/** Что можно показать как план: PDF и картинки. DWG и прочее — только скачать. */
export const isViewable = (mime: string | null | undefined) => !!mime && (mime === 'application/pdf' || mime.startsWith('image/'))
/** Что показывать на плане: сам файл, а если он не открывается (DWG) — приложенный к версии PDF для просмотра. */
export function viewSource(d: DocumentRow): { key: string; mime: string; viaPreview: boolean } | null {
  if (d.storage_key && isViewable(d.file_mime)) return { key: d.storage_key, mime: d.file_mime!, viaPreview: false }
  if (d.preview_storage_key && isViewable(d.preview_mime)) return { key: d.preview_storage_key, mime: d.preview_mime!, viaPreview: true }
  return null
}
/** То же для конкретной версии документа: её файл или приложенный PDF для просмотра. */
export function versionSource(v: VersionRow): { key: string; mime: string; viaPreview: boolean } | null {
  if (v.file && isViewable(v.file.mime)) return { key: v.file.storage_key, mime: v.file.mime, viaPreview: false }
  if (v.preview && isViewable(v.preview.mime)) return { key: v.preview.storage_key, mime: v.preview.mime, viaPreview: true }
  return null
}
const isPlanType = (d: DocumentRow) => (d.doc_type === 'plan' || d.doc_type === 'drawing') && !!d.current_version_id
export const isPlanDocument = (d: DocumentRow) => isPlanType(d) && viewSource(d) !== null
/** План или чертёж, который нельзя показать: нужен PDF для просмотра. */
export const needsPreview = (d: DocumentRow) => isPlanType(d) && viewSource(d) === null

export const planUrlQuery = (storageKey: string | null | undefined) =>
  queryOptions({
    queryKey: ['plan-url', storageKey],
    enabled: !!storageKey,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storageKey!, 3600)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })

/** Скачать файл с исходным именем (ссылка действует минуту). */
export async function downloadFile(storageKey: string, filename: string | null): Promise<void> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storageKey, 60, { download: filename ?? true })
  if (error || !data) throw error ?? new Error('no url')
  const a = document.createElement('a')
  a.href = data.signedUrl
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const PIN_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Нет права менять эту задачу.'),
  position_invalid: tr('Точка вне плана.'),
  document_not_found: tr('План не найден или у вас нет к нему доступа.'),
  location_required: tr('Выберите место: этаж, секцию или помещение.'),
  task_not_found: tr('Задача не найдена.'),
}

function message(error: { code?: string; message?: string }, fallback: string) {
  const key = Object.keys(PIN_ERROR_TEXT).find((k) => error.message?.startsWith(k)) ?? error.code ?? ''
  return PIN_ERROR_TEXT[key] ?? fallback
}

export async function pinTask(input: { taskId: string; documentId: string; page: number; x: number; y: number; x2?: number; y2?: number }) {
  const { error } = await supabase.rpc('pin_task', { p_task: input.taskId, p_document: input.documentId, p_page: input.page, p_x: input.x, p_y: input.y, p_x2: input.x2, p_y2: input.y2 })
  if (error) throw new Error(message(error, tr('Не удалось поставить отметку.')))
}

export async function unpinTask(taskId: string, documentId: string) {
  const { error } = await supabase.rpc('unpin_task', { p_task: taskId, p_document: documentId })
  if (error) throw new Error(message(error, tr('Не удалось убрать отметку.')))
}

export async function createTaskOnPlan(input: {
  projectId: string
  documentId: string
  page: number
  x: number
  y: number
  x2?: number
  y2?: number
  title: string
  type: string
  assignee: string | null
  dueDate: string | null
  priority: string
  locationId?: string | null
}) {
  const { data, error } = await supabase.rpc('create_task_on_plan', {
    p_project: input.projectId,
    p_document: input.documentId,
    p_page: input.page,
    p_x: input.x,
    p_y: input.y,
    p_x2: input.x2,
    p_y2: input.y2,
    p_title: input.title,
    p_type: input.type,
    p_assignee: input.assignee ?? undefined,
    p_due_date: input.dueDate ?? undefined,
    p_priority: input.priority,
    p_location: (input.locationId ?? undefined) as never,
  })
  if (error) throw new Error(message(error, tr('Не удалось создать замечание.')))
  return data as unknown as { id: string; key: string }
}

/** Номер из ключа задачи для надписи на булавке: ZK7-P-12 → 12 */
/** Номер на метке: номер булавки в документе. */
export const pinNumber = (p: Pick<PinRow, 'doc_no'>) => String(p.doc_no)
