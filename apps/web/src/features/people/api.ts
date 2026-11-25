import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export interface PersonProject {
  project_id: string
  code: string
  name: string
  /** должность в проекте */
  role: string | null
  discipline: string | null
}

export interface DirectoryPerson {
  id: string
  full_name: string
  email: string
  phone: string | null
  avatar_path: string | null
  job_title: string | null
  is_external: boolean
  status: string
  organization_id: string | null
  organization_name: string | null
  organization_kind: string | null
  projects: PersonProject[]
}

export const ORG_KIND_LABELS =(): Record<string, string> => ({
  own: tr('Наша компания'),
  subcontractor: tr('Подрядчик'),
  supplier: tr('Поставщик'),
  designer: tr('Проектировщик'),
  supervision: tr('Технадзор'),
  client: tr('Заказчик'),
  other: tr('Другое'),
})

/** Все люди, которых я вправе видеть: с организацией, должностью, контактами и проектами (видимость задаёт сервер). */
export const peopleDirectoryQuery = queryOptions({
  queryKey: ['people-directory'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('people_directory')
    if (error) throw error
    return data as unknown as DirectoryPerson[]
  },
})
