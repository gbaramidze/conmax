import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET, uploadProjectFile } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'

export type ImageEntity = { type: 'location' | 'room_type'; id: string }

export interface EntityImage {
  id: string
  entity_type: ImageEntity['type']
  entity_id: string
  caption: string | null
  is_cover: boolean
  /** Отмечено как схема: такие изображения подставляются в отчёты об инспекции */
  is_plan: boolean
  sort: number
  created_at: string
  /** Папка внутри места: «Спальня» или «Спальня/Ночь»; пусто — в корне */
  folder: string
  /** Текущая версия изображения и сколько их всего */
  file_id: string
  versions: number
  file: { storage_key: string; name: string }
}

/** Изображения места или типа номера: обложка первой, дальше по порядку добавления. */
export const entityImagesQuery = (projectId: string, entity: ImageEntity) =>
  queryOptions({
    queryKey: ['renders', 'list', projectId, entity.type, entity.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_images')
        .select('id, entity_type, entity_id, caption, is_cover, is_plan, sort, created_at, folder, file_id, file:files(storage_key, name), versions:entity_image_versions(count)')
        .eq('project_id', projectId)
        .eq('entity_type', entity.type)
        .eq('entity_id', entity.id)
        .order('is_cover', { ascending: false })
        .order('sort')
      if (error) throw error
      return (data as unknown as (Omit<EntityImage, 'versions'> & { versions: { count: number }[] })[]).map((r) => ({ ...r, versions: r.versions[0]?.count ?? 1 }))
    },
  })

/** Временные ссылки на файлы пачкой (час); ключ кэша — набор ключей. */
export const imageUrlsQuery = (keys: string[]) =>
  queryOptions({
    queryKey: ['renders', 'urls', ...keys],
    enabled: keys.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrls(keys, 3600)
      if (error) throw error
      return new Map((data ?? []).flatMap((r): [string, string][] => (r.signedUrl ? [[r.path ?? '', r.signedUrl]] : [])))
    },
  })

/** Обложки мест проекта: для миниатюр в дереве структуры. */
export const locationCoversQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['renders', 'covers', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_images')
        .select('entity_id, file:files(storage_key)')
        .eq('project_id', projectId)
        .eq('entity_type', 'location')
        .eq('is_cover', true)
        .limit(1000)
      if (error) throw error
      return new Map((data as unknown as { entity_id: string; file: { storage_key: string } }[]).map((r) => [r.entity_id, r.file.storage_key]))
    },
  })

export interface BoardRoom {
  id: string
  path: string
  code: string
  name: string
  purpose: string | null
  type_id: string | null
  type_name: string | null
  area: number | null
  ffe_total: number
  ffe_installed: number
  tasks_open: number
  tasks_overdue: number
  cover_key: string | null
}

/** Помещения этажа для плиток: тип, площадь, мебель, задачи, обложка — одним запросом. */
export const floorBoardQuery = (floorId: string) =>
  queryOptions({
    queryKey: ['floor-board', floorId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('floor_board', { p_floor: floorId })
      if (error) throw error
      return data as unknown as BoardRoom[]
    },
  })

/** Загружает изображение (оно сжимается как фото) и привязывает к месту или типу номера, при необходимости в папку. */
export async function addImage(projectId: string, tenantId: string, entity: ImageEntity, file: File, folder = ''): Promise<string> {
  const fileId = await uploadProjectFile(projectId, tenantId, file)
  const { data, error } = await supabase.rpc('entity_image_add', { p_project: projectId, p_type: entity.type, p_entity: entity.id, p_file: fileId, p_folder: folder })
  if (error) throw error
  return data as string
}

/** Загружает новую версию изображения: она становится текущей, прежние остаются в истории. */
export async function addImageVersion(projectId: string, tenantId: string, imageId: string, file: File, note = ''): Promise<void> {
  const fileId = await uploadProjectFile(projectId, tenantId, file)
  const { error } = await supabase.rpc('entity_image_add_version', { p_image: imageId, p_file: fileId, p_note: note })
  if (error) throw error
}

export async function moveImage(imageId: string, folder: string): Promise<void> {
  const { error } = await supabase.rpc('entity_image_move', { p_image: imageId, p_folder: folder })
  if (error) throw error
}

export interface ImageVersion {
  id: string
  version_no: number
  note: string | null
  created_at: string
  file: { id: string; storage_key: string; name: string }
  creator: { full_name: string } | null
}

/** История версий изображения: новые сверху. */
export const imageVersionsQuery = (imageId: string) =>
  queryOptions({
    queryKey: ['renders', 'versions', imageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_image_versions')
        .select('id, version_no, note, created_at, file:files(id, storage_key, name), creator:users!created_by(full_name)')
        .eq('image_id', imageId)
        .order('version_no', { ascending: false })
      if (error) throw error
      return data as unknown as ImageVersion[]
    },
  })

export async function restoreImageVersion(imageId: string, versionNo: number): Promise<void> {
  const { error } = await supabase.rpc('entity_image_restore', { p_image: imageId, p_version: versionNo })
  if (error) throw error
}

/** Удаляет прежнюю версию вместе с файлом в хранилище. */
export async function deleteImageVersion(imageId: string, versionNo: number): Promise<void> {
  const { data, error } = await supabase.rpc('entity_image_version_delete', { p_image: imageId, p_version: versionNo })
  if (error) throw error
  if (data) await supabase.storage.from(FILES_BUCKET).remove([data as string])
}

export interface ProjectImage {
  id: string
  entity_type: ImageEntity['type']
  entity_id: string
  folder: string
  file: { name: string }
}

/** Все изображения проекта (без файлов): чтобы при загрузке папки узнать, какие картинки уже есть и стали бы версиями. */
export const projectImagesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['renders', 'all', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('entity_images').select('id, entity_type, entity_id, folder, file:files(name)').eq('project_id', projectId).limit(5000)
      if (error) throw error
      return data as unknown as ProjectImage[]
    },
  })

/** Отмечает изображение как схему (планировку) места или снимает отметку. */
export async function setImagePlan(imageId: string, plan: boolean): Promise<void> {
  const { error } = await supabase.rpc('entity_image_set_plan', { p_image: imageId, p_plan: plan })
  if (error) throw error
}

export async function setImage(imageId: string, caption: string, cover: boolean): Promise<void> {
  const { error } = await supabase.rpc('entity_image_set', { p_image: imageId, p_caption: caption, p_cover: cover })
  if (error) throw error
}

/** Убирает изображение со всеми версиями; файлы удаляются из хранилища следом (если не получится — остаются без ссылки и недоступны). */
export async function deleteImage(imageId: string): Promise<void> {
  const { data, error } = await supabase.rpc('entity_image_delete', { p_image: imageId })
  if (error) throw error
  const keys = (data as string[] | null) ?? []
  if (keys.length > 0) await supabase.storage.from(FILES_BUCKET).remove(keys)
}

/** Обложки типов номеров: номер без своего изображения показывает обложку своего типа (в дереве структуры, на плитках). */
export const typeCoversQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['renders', 'type-covers', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_images')
        .select('entity_id, file:files(storage_key)')
        .eq('project_id', projectId)
        .eq('entity_type', 'room_type')
        .eq('is_cover', true)
        .limit(1000)
      if (error) throw error
      return new Map((data as unknown as { entity_id: string; file: { storage_key: string } }[]).map((r) => [r.entity_id, r.file.storage_key]))
    },
  })

/** Переименовать папку или перенести её (с подпапками) в другую папку, место или тип номера. Возвращает число перенесённых изображений. */
export async function moveFolder(projectId: string, entity: ImageEntity, folder: string, to: { entity?: ImageEntity; folder: string }): Promise<number> {
  const { data, error } = await supabase.rpc('entity_image_folder_move', {
    p_project: projectId,
    p_type: entity.type,
    p_entity: entity.id,
    p_folder: folder,
    p_to_type: to.entity?.type,
    p_to_entity: to.entity?.id,
    p_to_folder: to.folder,
  })
  if (error) throw error
  return data as number
}

/** Удалить папку со всеми подпапками, изображениями и версиями; файлы удаляются из хранилища следом. */
export async function deleteFolder(projectId: string, entity: ImageEntity, folder: string): Promise<void> {
  const { data, error } = await supabase.rpc('entity_image_folder_delete', { p_project: projectId, p_type: entity.type, p_entity: entity.id, p_folder: folder })
  if (error) throw error
  const keys = (data as string[] | null) ?? []
  if (keys.length > 0) await supabase.storage.from(FILES_BUCKET).remove(keys)
}

/** Свести ревизии: папки от старой к новой, одноимённые файлы становятся версиями (новейшая — текущая), всё в папку `target`. Возвращает число версий. */
export async function mergeFolders(projectId: string, entity: ImageEntity, folders: string[], target: string): Promise<number> {
  const { data, error } = await supabase.rpc('entity_image_folders_merge', { p_project: projectId, p_type: entity.type, p_entity: entity.id, p_folders: folders, p_target: target })
  if (error) throw error
  return data as number
}
