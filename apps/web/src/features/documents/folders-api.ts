import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  created_by: string | null
}

export const foldersQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['document-folders', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_folders')
        .select('id, parent_id, name, created_by')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('name')
        .limit(2000)
      if (error) throw error
      return data as unknown as FolderRow[]
    },
  })

export const FOLDER_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Нет права менять папки в этом проекте.'),
  folder_exists: tr('Папка с таким именем уже есть на этом уровне.'),
  '23505': tr('Папка с таким именем уже есть на этом уровне.'),
  name_required: tr('Введите название папки.'),
  cycle_in_hierarchy: tr('Папку нельзя поместить в саму себя или в свою вложенную.'),
  folder_not_found: tr('Папка не найдена: возможно, её уже удалили.'),
  path_too_deep: tr('Слишком много вложенных папок (не больше восьми).'),
}

export class FolderError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function fail(error: { code?: string; message?: string }): never {
  const key = Object.keys(FOLDER_ERROR_TEXT).find((k) => error.message?.startsWith(k)) ?? error.code ?? 'unknown'
  throw new FolderError(key)
}

export const folderErrorText = (e: unknown, fallback: string) => (e instanceof FolderError ? (FOLDER_ERROR_TEXT[e.code] ?? fallback) : fallback)

export async function createFolder(projectId: string, parentId: string | null, name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_folder', { p_project: projectId, p_parent: parentId as never, p_name: name })
  if (error) fail(error)
  return data as string
}

export async function ensureFolderPath(projectId: string, baseId: string | null, path: string[]): Promise<string | null> {
  if (path.length === 0) return baseId
  const { data, error } = await supabase.rpc('ensure_folder_path', { p_project: projectId, p_base: baseId as never, p_path: path })
  if (error) fail(error)
  return data as string
}

export async function renameFolder(folderId: string, name: string) {
  const { error } = await supabase.rpc('rename_folder', { p_folder: folderId, p_name: name })
  if (error) fail(error)
}

export async function moveFolder(folderId: string, parentId: string | null) {
  const { error } = await supabase.rpc('move_folder', { p_folder: folderId, p_parent: parentId as never })
  if (error) fail(error)
}

export async function deleteFolder(folderId: string) {
  const { error } = await supabase.rpc('delete_folder', { p_folder: folderId })
  if (error) fail(error)
}

/** Возвращает, сколько документов действительно перенесено (чужие без права правки пропускаются). */
export async function moveDocuments(documentIds: string[], folderId: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('move_documents', { p_documents: documentIds, p_folder: folderId as never })
  if (error) fail(error)
  return data as number
}

// ---------------------------------------------------------------------------
// Дерево
// ---------------------------------------------------------------------------
export interface FolderNode extends FolderRow {
  depth: number
  children: FolderNode[]
  /** Путь из названий: «Архитектура / Корпус 1» */
  path: string
}

export function buildFolderTree(rows: FolderRow[]): { roots: FolderNode[]; byId: Map<string, FolderNode>; flat: FolderNode[] } {
  const byId = new Map<string, FolderNode>()
  for (const r of rows) byId.set(r.id, { ...r, depth: 0, children: [], path: r.name })
  const roots: FolderNode[] = []
  for (const n of byId.values()) {
    const parent = n.parent_id ? byId.get(n.parent_id) : null
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sort = (list: FolderNode[]) => list.sort((a, b) => a.name.localeCompare(b.name, currentLocale(), { numeric: true }))
  const flat: FolderNode[] = []
  const walk = (list: FolderNode[], depth: number, prefix: string) => {
    for (const n of sort(list)) {
      n.depth = depth
      n.path = prefix ? `${prefix} / ${n.name}` : n.name
      flat.push(n)
      walk(n.children, depth + 1, n.path)
    }
  }
  walk(roots, 0, '')
  return { roots, byId, flat }
}

/** id папки и всех вложенных. */
export function subtreeIds(node: FolderNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)]
}

/** Тип данных, которым строки документов передаются при перетаскивании в папку. */
export const DRAG_TYPE = 'application/x-buildos-documents'
