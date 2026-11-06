import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { uploadProjectFile } from '@/features/activity/api'
import { moveDocuments } from '@/features/documents/folders-api'
import { supabase } from '@/lib/supabase'

export const DOC_TYPE_LABELS = {
  plan: tr('План'),
  drawing: tr('Чертёж'),
  spec: tr('Спецификация'),
  contract: tr('Договор'),
  report: tr('Отчёт'),
  photo: tr('Фото'),
  other: tr('Другое'),
} as const
export type DocType = keyof typeof DOC_TYPE_LABELS

export type VersionStatus = 'draft' | 'published' | 'superseded'
export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: tr('Черновик'),
  published: tr('Действует'),
  superseded: tr('Заменена'),
}

export interface DocumentRow {
  id: string
  project_id: string
  code: string | null
  title: string
  doc_type: DocType
  discipline_id: string | null
  visibility: 'internal' | 'external'
  requires_ack: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  current_version_id: string | null
  current_revision: string | null
  current_version_no: number | null
  published_at: string | null
  latest_version_id: string | null
  latest_status: VersionStatus | null
  latest_revision: string | null
  file_name: string | null
  file_mime: string | null
  file_size: number | null
  storage_key: string | null
  /** PDF/изображение для просмотра у версии, исходник которой (например, DWG) на экране не открыть */
  preview_name: string | null
  preview_mime: string | null
  preview_storage_key: string | null
  folder_id: string | null
  /** Файл, от которого рисуется миниатюра (просмотр версии или сам файл), и есть ли она уже */
  thumb_file_id: string | null
  thumb_source_key: string | null
  thumb_source_mime: string | null
  has_thumb: boolean
  versions: number
  location_paths: string[]
  task_links: number
  ack_pending: boolean
}

const OVERVIEW = '*'

export const documentsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['documents', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents_overview')
        .select(OVERVIEW)
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
        .limit(2000)
      if (error) throw error
      return data as unknown as DocumentRow[]
    },
  })

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ['document', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('documents_overview').select(OVERVIEW).eq('id', id).maybeSingle()
      if (error) throw error
      return data as unknown as DocumentRow | null
    },
  })

export interface VersionRow {
  id: string
  version_no: number
  revision: string
  note: string | null
  status: VersionStatus
  created_at: string
  published_at: string | null
  file: { id: string; name: string; mime: string; size_bytes: number; storage_key: string } | null
  preview: { id: string; name: string; mime: string; size_bytes: number; storage_key: string } | null
  creator: { full_name: string } | null
  publisher: { full_name: string } | null
}

export const versionsQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['document-versions', documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_versions')
        .select(
          'id, version_no, revision, note, status, created_at, published_at, file:files!file_id(id, name, mime, size_bytes, storage_key), preview:files!preview_file_id(id, name, mime, size_bytes, storage_key), creator:users!created_by(full_name), publisher:users!published_by(full_name)',
        )
        .eq('document_id', documentId)
        .order('version_no', { ascending: false })
      if (error) throw error
      return data as unknown as VersionRow[]
    },
  })

export interface AckRow {
  user_id: string
  notified_at: string
  acked_at: string | null
  user: { full_name: string } | null
}

export const acksQuery = (versionId: string) =>
  queryOptions({
    queryKey: ['document-acks', versionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_acks')
        .select('user_id, notified_at, acked_at, user:users!user_id(full_name)')
        .eq('version_id', versionId)
        .order('acked_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as unknown as AckRow[]
    },
  })

export interface LinkRow {
  id: string
  entity_type: 'location' | 'task' | 'ffe_item' | 'room_type'
  entity_id: string
}

export const linksQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['document-links', documentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('document_links').select('id, entity_type, entity_id').eq('document_id', documentId)
      if (error) throw error
      return data as unknown as LinkRow[]
    },
  })

export const documentOrgsQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['document-orgs', documentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('document_orgs').select('organization_id').eq('document_id', documentId)
      if (error) throw error
      return data.map((r) => r.organization_id)
    },
  })

/** Документы, привязанные к любому из указанных объектов (например, к этажу и его корпусу). */
export const entityDocumentsQuery = (entities: { type: 'location' | 'task' | 'ffe_item' | 'room_type'; id: string }[]) =>
  queryOptions({
    queryKey: ['entity-documents', entities.map((e) => `${e.type}:${e.id}`).sort().join(',')],
    enabled: entities.length > 0,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from('document_links')
        .select('id, document_id, entity_type, entity_id')
        .or(entities.map((e) => `and(entity_type.eq.${e.type},entity_id.eq.${e.id})`).join(','))
      if (error) throw error
      const ids = [...new Set(links.map((l) => l.document_id))]
      if (ids.length === 0) return { links, docs: [] as DocumentRow[] }
      const { data: docs, error: docsError } = await supabase.from('documents_overview').select(OVERVIEW).in('id', ids)
      if (docsError) throw docsError
      return { links, docs: docs as unknown as DocumentRow[] }
    },
  })

export interface SearchHit {
  document_id: string
  version_id: string
  revision: string | null
  rank: number
  snippet: string
}

/** Поиск по содержимому документов (после извлечения текста воркером). */
export const searchDocumentsQuery = (projectId: string, text: string) =>
  queryOptions({
    queryKey: ['documents', 'search', projectId, text],
    enabled: text.trim().length >= 3,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_documents', { p_project: projectId, p_query: text.trim() })
      if (error) throw error
      return data as unknown as SearchHit[]
    },
  })

export type TextStatus = 'pending' | 'processing' | 'done' | 'unsupported' | 'failed'

export const fileTextStatusQuery = (fileId: string) =>
  queryOptions({
    queryKey: ['file-text-status', fileId],
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'pending' || q.state.data.status === 'processing') ? 8000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.from('file_texts').select('status, method').eq('file_id', fileId).maybeSingle()
      if (error) throw error
      return data as { status: TextStatus; method: string | null } | null
    },
  })

/** Извлечённый текст файла (для чтения и поиска внутри документа). */
export const fileTextQuery = (fileId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['file-text', fileId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('file_texts').select('text, method, status').eq('file_id', fileId).maybeSingle()
      if (error) throw error
      return data as { text: string | null; method: string | null; status: TextStatus } | null
    },
  })

export const DOC_ERROR_TEXT: Record<string, string> = {
  code_taken: tr('Документ с таким шифром уже есть в проекте.'),
  title_required: tr('Укажите название документа.'),
  file_not_found: tr('Файл не загрузился. Выберите его и попробуйте ещё раз.'),
  forbidden: tr('У вас нет права на это действие.'),
  version_not_draft: tr('Эта версия уже выпущена.'),
  document_not_found: tr('Документ не найден или у вас нет к нему доступа.'),
}

export class DocumentError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function toError(error: { code?: string; message: string }): DocumentError {
  return new DocumentError(error.code === '42501' ? 'forbidden' : error.message)
}

export interface NewDocument {
  projectId: string
  tenantId: string
  file: File
  title: string
  code: string
  docType: DocType
  disciplineId: string | null
  visibility: 'internal' | 'external'
  requiresAck: boolean
  revision: string
  note: string
  locationIds: string[]
  orgIds: string[]
  publish: boolean
  /** Дополнительно привязать к задаче */
  taskId?: string | null
  /** Дополнительно привязать к позиции каталога мебели */
  ffeItemId?: string | null
  /** Дополнительно привязать к типу номера (технический план типа) */
  roomTypeId?: string | null
  /** PDF для просмотра, если сам файл (DWG и др.) на экране не открывается */
  preview?: File | null
  /** Положить сразу в папку */
  folderId?: string | null
}

export async function createDocument(input: NewDocument): Promise<string> {
  const fileId = await uploadProjectFile(input.projectId, input.tenantId, input.file)
  const { data, error } = await supabase.rpc('create_document', {
    p_project: input.projectId,
    p_title: input.title,
    p_code: input.code,
    p_doc_type: input.docType,
    p_discipline: (input.disciplineId ?? null) as never, // null допустим: документ без направления
    p_visibility: input.visibility,
    p_requires_ack: input.requiresAck,
    p_file: fileId,
    p_revision: input.revision,
    p_note: input.note,
    p_locations: input.locationIds,
    p_orgs: input.visibility === 'external' ? input.orgIds : [],
    p_publish: input.publish,
  })
  if (error) throw toError(error)
  if (input.folderId) await moveDocuments([data], input.folderId).catch(() => undefined) // документ создан, даже если папка недоступна
  if (input.preview) {
    const { data: ver, error: verError } = await supabase.from('document_versions').select('id').eq('document_id', data).order('version_no', { ascending: false }).limit(1).single()
    if (verError) throw toError(verError)
    await setVersionPreview({ versionId: ver.id, projectId: input.projectId, tenantId: input.tenantId, file: input.preview })
  }
  if (input.taskId) {
    const { error: linkError } = await supabase.from('document_links').insert({ document_id: data, entity_type: 'task', entity_id: input.taskId } as never)
    if (linkError) throw toError(linkError)
  }
  if (input.ffeItemId) {
    const { error: linkError } = await supabase.from('document_links').insert({ document_id: data, entity_type: 'ffe_item', entity_id: input.ffeItemId } as never)
    if (linkError) throw toError(linkError)
  }
  if (input.roomTypeId) {
    const { error: linkError } = await supabase.from('document_links').insert({ document_id: data, entity_type: 'room_type', entity_id: input.roomTypeId } as never)
    if (linkError) throw toError(linkError)
  }
  return data
}

/** Следующая ревизия по подсказке: A → B, 0 → 1; иначе пусто. */
export function nextRevision(rev: string | null | undefined): string {
  if (!rev) return ''
  if (/^\d+$/.test(rev)) return String(Number(rev) + 1)
  if (/^[A-Za-zА-Яа-я]$/.test(rev)) return String.fromCharCode(rev.charCodeAt(0) + 1)
  return ''
}

export async function addVersion(input: {
  documentId: string
  projectId: string
  tenantId: string
  file: File
  revision: string
  note: string
  publish: boolean
  preview?: File | null
}): Promise<string> {
  const fileId = await uploadProjectFile(input.projectId, input.tenantId, input.file)
  const { data, error } = await supabase.rpc('add_document_version', {
    p_document: input.documentId,
    p_file: fileId,
    p_revision: input.revision,
    p_note: input.note,
    p_publish: input.publish,
  })
  if (error) throw toError(error)
  if (input.preview) await setVersionPreview({ versionId: data, projectId: input.projectId, tenantId: input.tenantId, file: input.preview })
  return data
}

/** Приложить, заменить (file) или убрать (null) PDF для просмотра у версии. */
export async function setVersionPreview(input: { versionId: string; projectId: string; tenantId: string; file: File | null }): Promise<void> {
  const fileId = input.file ? await uploadProjectFile(input.projectId, input.tenantId, input.file) : null
  const { error } = await supabase.rpc('set_version_preview', { p_version: input.versionId, p_file: fileId as never })
  if (error) throw toError(error)
}

/** Открывается ли файл на экране (PDF, картинка) — по типу или расширению. */
export const isViewableFile = (name: string | null | undefined, mime: string | null | undefined) =>
  mime === 'application/pdf' || !!mime?.startsWith('image/') || /\.(pdf|png|jpe?g|webp|gif)$/i.test(name ?? '')

export async function publishVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_document_version', { p_version: versionId })
  if (error) throw toError(error)
}

export async function ackVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('ack_document', { p_version: versionId })
  if (error) throw toError(error)
}

export type DocumentPatch = Partial<{
  title: string
  code: string | null
  doc_type: DocType
  discipline_id: string | null
  visibility: 'internal' | 'external'
  requires_ack: boolean
  deleted_at: string
}>

export async function updateDocument(id: string, patch: DocumentPatch): Promise<void> {
  const { data, error } = await supabase.from('documents').update(patch as never).eq('id', id).select('id')
  if (error) throw error.code === '23505' ? new DocumentError('code_taken') : toError(error)
  if (!data || data.length === 0) throw new DocumentError('forbidden')
}

export async function addLink(documentId: string, type: 'location' | 'task' | 'ffe_item' | 'room_type', entityId: string): Promise<void> {
  const { error } = await supabase.from('document_links').insert({ document_id: documentId, entity_type: type, entity_id: entityId } as never)
  if (error && error.code !== '23505') throw toError(error)
}

export async function removeLink(linkId: string): Promise<void> {
  const { error } = await supabase.from('document_links').delete().eq('id', linkId)
  if (error) throw toError(error)
}

export async function setOrgs(documentId: string, orgIds: string[], current: string[]): Promise<void> {
  const remove = current.filter((o) => !orgIds.includes(o))
  const add = orgIds.filter((o) => !current.includes(o))
  if (remove.length > 0) {
    const { error } = await supabase.from('document_orgs').delete().eq('document_id', documentId).in('organization_id', remove)
    if (error) throw toError(error)
  }
  if (add.length > 0) {
    const { error } = await supabase.from('document_orgs').insert(add.map((organization_id) => ({ document_id: documentId, organization_id })) as never)
    if (error) throw toError(error)
  }
}

/** Названия по умолчанию: «План_5_этажа_A.pdf» → «План 5 этажа A» */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
}
