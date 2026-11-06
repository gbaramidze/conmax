import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface OrgOverview {
  organization_id: string
  name: string
  kind: string
  tax_id: string | null
  members: number
  discipline_ids: string[]
  work_items: number
  open_tasks: number
  overdue_tasks: number
}

/** Организации проекта со сводкой: сотрудники, направления, позиции плана, открытые задачи. Внешнему приходит только его организация. */
export const orgOverviewQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['org-overview', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_orgs_overview', { p_project: projectId })
      if (error) throw error
      return data as unknown as OrgOverview[]
    },
  })

export interface OrgMember {
  id: string
  title: string | null
  discipline_id: string | null
  user: { id: string; full_name: string; email: string; phone: string | null; avatar_path: string | null; organization_id: string | null } | null
  role: { code: string; name: string } | null
}

/** Участники проекта с должностью и направлением; к организации относит `user.organization_id`. */
export const orgMembersQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['org-members', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('id, title, discipline_id, user:users(id, full_name, email, phone, avatar_path, organization_id), role:roles(code, name)')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .is('left_at', null)
        .order('created_at')
      if (error) throw error
      return data as unknown as OrgMember[]
    },
  })

export async function setOrgDisciplines(projectId: string, orgId: string, disciplineIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('org_disciplines_set', { p_project: projectId, p_org: orgId, p_disciplines: disciplineIds })
  if (error) throw error
}

export async function updateOrgMember(memberId: string, title: string, disciplineId: string | null): Promise<void> {
  const { error } = await supabase.rpc('org_member_update', { p_member: memberId, p_title: title, p_discipline: disciplineId ?? (null as never) })
  if (error) throw error
}
