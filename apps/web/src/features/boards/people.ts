import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { meQuery } from '@/features/auth/api'
import { chatPeopleQuery } from '@/features/chat/api'
import type { BoardData } from '@/features/boards/api'
import { supabase } from '@/lib/supabase'

export interface BoardPerson {
  id: string
  full_name: string
  avatar_path: string | null
  is_external: boolean
  hint: string | null
}

/** Участники проекта (действующие): из них выбираются участники общей доски и карточек. */
const projectPeopleQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['board-project-people', projectId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('user:users(id, full_name, avatar_path, is_external, status), role:roles(name), organization:organizations(name)')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .is('left_at', null)
      if (error) throw error
      type Row = {
        user: { id: string; full_name: string; avatar_path: string | null; is_external: boolean; status: string } | null
        role: { name: string } | null
        organization: { name: string } | null
      }
      return ((data ?? []) as unknown as Row[])
        .filter((r) => r.user && r.user.status !== 'blocked')
        .map((r) => ({
          id: r.user!.id,
          full_name: r.user!.full_name,
          avatar_path: r.user!.avatar_path,
          is_external: r.user!.is_external,
          hint: [r.role?.name, r.organization?.name].filter(Boolean).join(' · ') || null,
        })) as BoardPerson[]
    },
  })

/**
 * Люди для доски: `people` — все, кого можно показать по имени (участники проекта, круг чата и я сам),
 * `projectIds` — действующие участники проекта.
 */
export function usePeople(projectId: string): { people: Map<string, BoardPerson>; projectIds: Set<string>; meId: string | undefined } {
  const { data: me } = useQuery(meQuery)
  const { data: others } = useQuery(chatPeopleQuery)
  const { data: members } = useQuery(projectPeopleQuery(projectId))
  return useMemo(() => {
    const people = new Map<string, BoardPerson>()
    for (const p of others ?? []) {
      people.set(p.id, { id: p.id, full_name: p.full_name, avatar_path: p.avatar_path, is_external: p.is_external, hint: p.job_title ?? p.organization_name })
    }
    for (const p of members ?? []) people.set(p.id, p)
    if (me) people.set(me.id, { id: me.id, full_name: me.full_name, avatar_path: me.avatar_path, is_external: me.is_external, hint: people.get(me.id)?.hint ?? null })
    return { people, projectIds: new Set((members ?? []).map((p) => p.id)), meId: me?.id }
  }, [me, others, members])
}

/** Кого можно сделать участником карточки: на личной доске — только владельца; на общей — участников доски (и весь проект, если включено). */
export function cardMemberCandidates(data: BoardData, people: Map<string, BoardPerson>, projectIds: Set<string>, meId: string | undefined): BoardPerson[] {
  const ids = new Set<string>()
  if (data.board.kind === 'personal') {
    if (meId) ids.add(meId)
  } else {
    for (const id of data.member_ids) ids.add(id)
    if (data.board.all_staff) for (const id of projectIds) if (!people.get(id)?.is_external) ids.add(id)
    if (meId) ids.add(meId)
  }
  return [...ids]
    .map((id) => people.get(id))
    .filter((p): p is BoardPerson => !!p)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}
