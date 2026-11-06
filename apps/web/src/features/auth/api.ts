import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Профиль текущего пользователя (строка public.users). */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, avatar_path, status, is_external, organization:organizations(name), tenant:tenants(name)')
      .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .single()
    if (error) throw error
    return data
  },
})
