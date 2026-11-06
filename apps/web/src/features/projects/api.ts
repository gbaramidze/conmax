import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const PROJECT_STATUS_LABELS = {
  draft: tr('Черновик'),
  active: tr('В работе'),
  on_hold: tr('Приостановлен'),
  completed: tr('Завершён'),
  cancelled: tr('Отменён'),
  archived: tr('В архиве'),
} as const

export const PROJECT_KIND_LABELS = {
  residential: tr('Жилой дом'),
  hotel: tr('Гостиница, отель'),
  office: tr('Офисное здание'),
  commercial: tr('Торговый, коммерческий'),
  mixed: tr('Многофункциональный комплекс'),
  public: tr('Общественное здание'),
  industrial: tr('Промышленный'),
  renovation: tr('Реконструкция'),
  design_only: tr('Только проектирование'),
} as const

export type ProjectKind = keyof typeof PROJECT_KIND_LABELS

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] ?? status
}

export function projectKindLabel(kind: string | null): string {
  return kind ? (PROJECT_KIND_LABELS[kind as ProjectKind] ?? kind) : '—'
}

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, code, name, kind, status, address, planned_start, planned_finish, cover_file_id, cover:files!cover_file_id(storage_key)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
})

export const projectByCodeQuery = (code: string) =>
  queryOptions({
    queryKey: ['projects', code],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, code, name, kind, status, address, planned_start, planned_finish, manager_user_id, settings, timezone, cover_file_id, cover:files!cover_file_id(storage_key)')
        .eq('code', code)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

/** Права текущего пользователя: на уровне тенанта и (если указан) проекта. Только для UI — доступ проверяет RLS. */
export const myPermissionsQuery = (projectId?: string) =>
  queryOptions({
    queryKey: ['my-permissions', projectId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_permissions', projectId ? { p_project: projectId } : {})
      if (error) throw error
      return data
    },
  })

export const projectMembersQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('id, title, user:users(id, full_name, email, avatar_path), role:roles(code, name), organization:organizations(id, name)')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .is('left_at', null)
        .order('created_at')
      if (error) throw error
      return data
    },
  })

export const tenantUsersQuery = queryOptions({
  queryKey: ['tenant-users'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email')
      .is('deleted_at', null)
      .order('full_name')
    if (error) throw error
    return data
  },
})

export const organizationsQuery = queryOptions({
  queryKey: ['organizations'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, kind')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return data
  },
})

/** Роли проекта, при которых пользователь считается внешним и обязан принадлежать организации. */
export const EXTERNAL_PROJECT_ROLE_CODES = ['subcontractor', 'subcontractor_lead', 'client']

export const projectRolesQuery = queryOptions({
  queryKey: ['project-roles'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('roles')
      .select('id, code, name')
      .eq('scope', 'project')
      .is('deleted_at', null)
      .order('name')
    if (error) throw error
    return data
  },
})
