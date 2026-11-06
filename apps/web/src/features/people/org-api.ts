import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Ключи контактов организации; других база не принимает. */
export const ORG_CONTACT_KEYS = ['phone', 'email', 'website', 'address', 'note'] as const
export type OrgContactKey = (typeof ORG_CONTACT_KEYS)[number]

export interface Organization {
  id: string
  name: string
  short_name: string | null
  tax_id: string | null
  kind: string
  contacts: Partial<Record<OrgContactKey, string>>
  is_active: boolean
}

export const organizationQuery = (id: string) =>
  queryOptions({
    queryKey: ['organization', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('id, name, short_name, tax_id, kind, contacts, is_active').eq('id', id).is('deleted_at', null).maybeSingle()
      if (error) throw error
      return data as unknown as Organization | null
    },
  })

/** Административные права компании у меня (admin.reference_data и др.): по ним показывается кнопка «Изменить». */
export const myTenantPermissionsQuery = queryOptions({
  queryKey: ['my-tenant-permissions'],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('my_tenant_permissions')
    if (error) throw error
    return (data ?? []) as string[]
  },
})

export async function updateOrganization(o: Organization): Promise<void> {
  const { error } = await supabase.rpc('organization_update', {
    p_org: o.id,
    p_name: o.name,
    p_short_name: o.short_name ?? '',
    p_tax_id: o.tax_id ?? '',
    p_kind: o.kind,
    p_contacts: o.contacts,
    p_is_active: o.is_active,
  })
  if (error) throw error
}

/** Адрес сайта со схемой: «example.com» → «https://example.com». Другие схемы (javascript:) не пропускаются. */
export function websiteHref(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  return /^https?:\/\//i.test(url) ? url : null
}
