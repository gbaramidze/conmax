import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { meQuery } from '@/features/auth/api'
import { chatPeopleQuery } from '@/features/chat/api'
import type { BoardData } from '@/features/boards/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

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

/**
 * Участники доски — те, кто видит все её колонки: владелец личной доски; у общей — создатель, добавленные люди
 * и, если включено «Весь проект», все внутренние сотрудники проекта. Остальные, кого позвали в карточку, — гости:
 * видят только колонки и карточки, в которых участвуют.
 */
export function boardMemberIds(data: BoardData, people: Map<string, BoardPerson>, projectIds: Set<string>): Set<string> {
  const ids = new Set<string>()
  if (data.board.kind === 'personal') {
    if (data.board.owner_id) ids.add(data.board.owner_id)
    return ids
  }
  if (data.board.created_by) ids.add(data.board.created_by)
  for (const id of data.member_ids) ids.add(id)
  if (data.board.all_staff) for (const id of projectIds) if (!people.get(id)?.is_external) ids.add(id)
  return ids
}

/** Участник ли доски я сам (при «Весь проект» — любой внутренний, кто видит проект, даже не числясь в его составе). */
export function iAmBoardMember(data: BoardData, people: Map<string, BoardPerson>, projectIds: Set<string>, meId: string | undefined): boolean {
  if (!meId) return false
  if (boardMemberIds(data, people, projectIds).has(meId)) return true
  const me = people.get(meId)
  return data.board.kind === 'shared' && data.board.all_staff && !!me && !me.is_external
}

const byName = (a: BoardPerson, b: BoardPerson) => a.full_name.localeCompare(b.full_name)

/** Кого можно сделать участником карточки без оговорок: участники доски. */
export function cardMemberCandidates(data: BoardData, people: Map<string, BoardPerson>, projectIds: Set<string>, meId: string | undefined): BoardPerson[] {
  const ids = boardMemberIds(data, people, projectIds)
  if (meId && iAmBoardMember(data, people, projectIds, meId)) ids.add(meId)
  return [...ids]
    .map((id) => people.get(id))
    .filter((p): p is BoardPerson => !!p)
    .sort(byName)
}

/**
 * Люди проекта, которых нет на общей доске: их можно позвать в карточку гостем (только участнику доски) — тогда
 * доска станет им видна, но лишь колонки и карточки с их участием. Перед этим интерфейс предупреждает.
 */
export function cardGuestCandidates(data: BoardData, people: Map<string, BoardPerson>, projectIds: Set<string>, meId: string | undefined): BoardPerson[] {
  if (data.board.kind !== 'shared' || !iAmBoardMember(data, people, projectIds, meId)) return []
  const members = boardMemberIds(data, people, projectIds)
  return [...projectIds]
    .filter((id) => !members.has(id) && id !== meId)
    .map((id) => people.get(id))
    .filter((p): p is BoardPerson => !!p)
    .sort(byName)
}

/**
 * Гости для конкретной карточки: кого можно позвать (если я участник доски) плюс уже позванные гости этой карточки —
 * чтобы их было видно отмеченными и можно было убрать.
 */
export function cardGuests(card: { member_ids: string[] }, candidates: BoardPerson[], guests: BoardPerson[], people: Map<string, BoardPerson>): BoardPerson[] {
  const known = new Set([...candidates, ...guests].map((p) => p.id))
  const extra = card.member_ids
    .filter((id) => !known.has(id))
    .map((id) => people.get(id))
    .filter((p): p is BoardPerson => !!p)
  return [...guests, ...extra].sort(byName)
}

/** Предупреждение перед тем, как позвать в карточку человека, которого нет на доске */
export const guestWarning = (name: string) =>
  tr('{{name}} не участник доски. Эта доска будет видна участнику, но он увидит только те колонки и карточки, в которых участвует. Добавить?', { name })
