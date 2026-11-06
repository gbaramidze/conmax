import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface DisciplineRow {
  id: string
  parent_id: string | null
  code: string
  name: string
  color: string | null
  lead_user_id: string | null
  sort: number
  lead: { id: string; full_name: string } | null
}

/** Направления проекта (дерево). Архивные не возвращаются. */
export const disciplinesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['disciplines', projectId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('disciplines')
        .select('id, parent_id, code, name, color, lead_user_id, sort, lead:users!lead_user_id(id, full_name)')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('sort')
        .order('code')
      if (error) throw error
      return data as unknown as DisciplineRow[]
    },
  })

export interface DisciplineNode extends DisciplineRow {
  depth: number
  hasChildren: boolean
}

/** Плоский список в порядке обхода дерева. */
export function flattenDisciplines(rows: DisciplineRow[]): DisciplineNode[] {
  const byParent = new Map<string | null, DisciplineRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.parent_id) ?? []
    list.push(r)
    byParent.set(r.parent_id, list)
  }
  const out: DisciplineNode[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push({ ...r, depth, hasChildren: byParent.has(r.id) })
      walk(r.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** id направления и всех его потомков — для фильтра «КР включает Монолит и Кладку». */
export function disciplineSubtreeIds(rows: DisciplineRow[], id: string): string[] {
  const ids = [id]
  for (let i = 0; i < ids.length; i++) {
    for (const r of rows) if (r.parent_id === ids[i]) ids.push(r.id)
  }
  return ids
}

export const DISCIPLINE_COLORS = ['sky', 'amber', 'teal', 'blue', 'orange', 'violet'] as const

export async function createDiscipline(input: {
  projectId: string
  parentId: string | null
  code: string
  name: string
  color: string | null
  leadUserId: string | null
  sort: number
}): Promise<void> {
  const { error } = await supabase.from('disciplines').insert({
    project_id: input.projectId,
    parent_id: input.parentId,
    code: input.code,
    name: input.name,
    color: input.color,
    lead_user_id: input.leadUserId,
    sort: input.sort,
  } as never) // tenant_id проставляет триггер БД
  if (error) throw error
}

export async function updateDiscipline(
  id: string,
  patch: Partial<{ name: string; color: string | null; lead_user_id: string | null; parent_id: string | null }>,
): Promise<void> {
  const { error } = await supabase.from('disciplines').update(patch).eq('id', id)
  if (error) throw error
}

export async function archiveDiscipline(id: string): Promise<void> {
  const { error } = await supabase.from('disciplines').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
