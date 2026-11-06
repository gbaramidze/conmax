import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export type RoleScope = 'tenant' | 'project'

export interface RoleRow {
  id: string
  scope: RoleScope
  code: string
  name: string
  is_system: boolean
  is_external: boolean
  permission_count: number
  holder_count: number
}

export interface PermissionDef {
  code: string
  module: string
  sort: number
  label: string
  tenant_only: boolean
  external_ok: boolean
}

export interface RoleHolder {
  user_id: string
  full_name: string
  email: string
  job_title: string | null
  project_code: string | null
}

/** Роли компании и проектов с числом прав и людей (нужно право «Роли и права»). */
export const rolesOverviewQuery = queryOptions({
  queryKey: ['roles-overview'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('roles_overview')
    if (error) throw error
    return data as unknown as RoleRow[]
  },
})

/** Роли компании («Сотрудник», «Директор», «Администратор» и свои): их читает любой участник, выдаёт тот, у кого есть право admin.users. */
export const tenantRolesQuery = queryOptions({
  queryKey: ['tenant-roles'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('roles').select('id, code, name, is_system').eq('scope', 'tenant').is('deleted_at', null).order('name')
    if (error) throw error
    return data
  },
})

/** Каталог прав: общий для всех компаний, названия и группы заданы в базе. */
export const permissionCatalogQuery = queryOptions({
  queryKey: ['permission-catalog'],
  staleTime: 10 * 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('permissions').select('code, module, sort, label, tenant_only, external_ok').order('sort')
    if (error) throw error
    return data as unknown as PermissionDef[]
  },
})

export const rolePermissionsQuery = (roleId: string) =>
  queryOptions({
    queryKey: ['role-permissions', roleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('role_permissions').select('permission').eq('role_id', roleId)
      if (error) throw error
      return (data ?? []).map((r) => r.permission)
    },
  })

export const roleHoldersQuery = (roleId: string) =>
  queryOptions({
    queryKey: ['role-holders', roleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('role_holders', { p_role: roleId })
      if (error) throw error
      return data as unknown as RoleHolder[]
    },
  })

/** Люди компании, которым можно выдать роль компании (внутренние, без внешних). */
export const internalUsersQuery = queryOptions({
  queryKey: ['internal-users'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('users').select('id, full_name, email, job_title').eq('is_external', false).is('deleted_at', null).order('full_name')
    if (error) throw error
    return data
  },
})

export async function createRole(scope: RoleScope, name: string, copyFrom: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('role_create', { p_scope: scope, p_name: name, ...(copyFrom ? { p_copy_from: copyFrom } : {}) })
  if (error) throw error
  return data as string
}

export async function renameRole(roleId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('role_rename', { p_role: roleId, p_name: name })
  if (error) throw error
}

export async function setRolePermissions(roleId: string, permissions: string[]): Promise<void> {
  const { error } = await supabase.rpc('role_set_permissions', { p_role: roleId, p_permissions: permissions })
  if (error) throw error
}

export async function deleteRole(roleId: string): Promise<void> {
  const { error } = await supabase.rpc('role_delete', { p_role: roleId })
  if (error) throw error
}

export async function grantTenantRole(userId: string, roleId: string): Promise<void> {
  const { error } = await supabase.rpc('tenant_role_grant', { p_user: userId, p_role: roleId })
  if (error) throw error
}

export async function revokeTenantRole(userId: string, roleId: string): Promise<void> {
  const { error } = await supabase.rpc('tenant_role_revoke', { p_user: userId, p_role: roleId })
  if (error) throw error
}

/** Понятный текст ошибки по сообщению базы. */
export function roleErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
  const map: Record<string, string> = {
    role_name_taken: tr('Роль с таким названием уже есть.'),
    role_invalid: tr('Название роли — от 1 до 80 знаков.'),
    role_system: tr('Системную роль удалить нельзя.'),
    role_in_use: tr('Роль выдана людям. Сначала уберите её у них.'),
    role_not_found: tr('Роль не найдена. Обновите страницу.'),
    user_not_found: tr('Роль компании можно выдать только внутреннему сотруднику.'),
    permission_unknown: tr('Такого права нет в каталоге.'),
    permission_tenant_only: tr('Это право можно выдать только роли компании.'),
    permission_not_for_external: tr('Внешним ролям такие права не выдаются: внутренние данные стали бы видны наружу.'),
    last_admin: tr('Так нельзя: в компании должен остаться хотя бы один человек с правом «Роли и права».'),
  }
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v
  if (msg.includes('permission denied')) return tr('Недостаточно прав.')
  return tr('Не удалось выполнить. Попробуйте ещё раз.')
}
