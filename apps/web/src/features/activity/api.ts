import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { compressImage } from '@/features/activity/image'
import { supabase } from '@/lib/supabase'
import { uuid } from '@/lib/utils'

export type EntityRef = { type: string; id: string }

export const FILES_BUCKET = 'files'
export const MAX_FILE_BYTES = 150 * 1024 * 1024 // совпадает с ограничением хранилища (supabase/config.toml, бакет files)

export const commentsQuery = (entity: EntityRef) =>
  queryOptions({
    queryKey: ['activity', 'comments', entity.type, entity.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select(
          'id, created_at, edited_at, visibility, body, author:users(id, full_name, avatar_path), attachments(id, file:files(id, name, mime, size_bytes, storage_key))',
        )
        .eq('entity_type', entity.type)
        .eq('entity_id', entity.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
  })

export const eventsQuery = (entity: EntityRef) =>
  queryOptions({
    queryKey: ['activity', 'events', entity.type, entity.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_events')
        .select('id, occurred_at, event_type, changes, actor:users(id, full_name)')
        .eq('entity_type', entity.type)
        .eq('entity_id', entity.id)
        .neq('event_type', 'commented') // комментарии показываются сами
        .order('occurred_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
  })

export interface NewComment {
  entity: EntityRef
  projectId: string
  tenantId: string
  body: unknown
  visibility: 'internal' | 'external'
  files: File[]
}

/** Публикует комментарий и загружает файлы. Возвращает имена файлов, которые не удалось прикрепить, и id загруженных. */
export async function postComment(c: NewComment): Promise<{ failedFiles: string[]; commentId: string; fileIds: string[] }> {
  const { data: comment, error } = await supabase
    .from('comments')
    // tenant_id / author_id / project_id проставляет триггер БД, а доступ к этим колонкам у клиента закрыт GRANT-ами;
    // сгенерированные типы Insert этого не знают, поэтому приводим явно
    .insert({ entity_type: c.entity.type, entity_id: c.entity.id, body: c.body, visibility: c.visibility } as never)
    .select('id')
    .single()
  if (error) throw error

  const failedFiles: string[] = []
  const fileIds: string[] = []
  for (const original of c.files) {
    try {
      const fileId = await uploadProjectFile(c.projectId, c.tenantId, original)
      const { error: attachError } = await supabase
        .from('attachments')
        .insert({ entity_type: c.entity.type, entity_id: c.entity.id, file_id: fileId, comment_id: comment.id } as never)
      if (attachError) throw attachError
      fileIds.push(fileId)
    } catch {
      failedFiles.push(original.name)
    }
  }
  return { failedFiles, commentId: comment.id, fileIds }
}

/** Сжимает фото, кладёт файл в Storage и заводит запись `files`. Возвращает id файла. */
export async function uploadProjectFile(projectId: string, tenantId: string, original: File): Promise<string> {
  const file = await compressImage(original)
  // В ключе только ASCII: Storage отвергает кириллицу; настоящее имя хранится в files.name
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(file.name)?.[0] ?? ''
  const storageKey = `${tenantId}/${projectId}/${uuid()}${ext.toLowerCase()}`

  const upload = await supabase.storage.from(FILES_BUCKET).upload(storageKey, file, { contentType: file.type || undefined })
  if (upload.error) throw upload.error

  const { data: fileRow, error: fileError } = await supabase
    .from('files')
    .insert({
      project_id: projectId,
      storage_key: storageKey,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size_bytes: file.size,
    } as never)
    .select('id')
    .single()
  if (fileError) throw fileError
  return fileRow.id
}

/** Прикрепляет файлы прямо к сущности (не к комментарию). Возвращает имена файлов, которые не удалось загрузить. */
export async function attachFiles(input: { entity: EntityRef; projectId: string; tenantId: string; files: File[] }): Promise<string[]> {
  const failed: string[] = []
  for (const original of input.files) {
    try {
      const fileId = await uploadProjectFile(input.projectId, input.tenantId, original)
      const { error } = await supabase
        .from('attachments')
        .insert({ entity_type: input.entity.type, entity_id: input.entity.id, file_id: fileId } as never)
      if (error) throw error
    } catch {
      failed.push(original.name)
    }
  }
  return failed
}

export const entityAttachmentsQuery = (entity: EntityRef) =>
  queryOptions({
    queryKey: ['attachments', entity.type, entity.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attachments')
        .select('id, created_at, comment_id, created_by, file:files(id, name, mime, size_bytes, storage_key), creator:users!created_by(full_name)')
        .eq('entity_type', entity.type)
        .eq('entity_id', entity.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as {
        id: string
        created_at: string
        comment_id: string | null
        created_by: string | null
        file: { id: string; name: string; mime: string; size_bytes: number; storage_key: string } | null
        creator: { full_name: string } | null
      }[]
    },
  })

export async function deleteAttachment(id: string): Promise<void> {
  const { data, error } = await supabase.from('attachments').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('forbidden')
}

/** Копия заметки в другую сущность (например, в задачу): тот же текст, те же уже загруженные файлы — без повторной загрузки. */
export async function copyNoteToEntity(input: {
  entity: EntityRef
  body: unknown
  fileIds: string[]
  visibility: 'internal' | 'external'
}): Promise<void> {
  const { data: comment, error } = await supabase
    .from('comments')
    .insert({ entity_type: input.entity.type, entity_id: input.entity.id, body: input.body, visibility: input.visibility } as never)
    .select('id')
    .single()
  if (error) throw error
  for (const fileId of input.fileIds) {
    const { error: attachError } = await supabase
      .from('attachments')
      .insert({ entity_type: input.entity.type, entity_id: input.entity.id, file_id: fileId, comment_id: comment.id } as never)
    if (attachError) throw attachError
  }
}

/** Ссылка для показа файла (миниатюры, просмотр). Кэшируется: ссылка действует час. */
export const signedUrlQuery = (storageKey: string) =>
  queryOptions({
    queryKey: ['signed-url', storageKey],
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storageKey, 3600)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })

export async function openFile(storageKey: string): Promise<void> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storageKey, 60)
  if (error || !data) throw error ?? new Error('no url')
  window.open(data.signedUrl, '_blank', 'noopener')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return tr('{{bytes}} Б', { bytes })
  if (bytes < 1024 * 1024) return tr('{{v1}} КБ', { v1: Math.round(bytes / 1024) })
  return tr('{{v1}} МБ', { v1: (bytes / 1024 / 1024).toFixed(1) })
}
