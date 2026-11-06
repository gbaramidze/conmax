import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export interface PersonProject {
  project_id: string
  code: string
  name: string
  role: string | null
  title: string | null
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

/** Типовые должности компании: подсказки при регистрации сотрудника (можно ввести и свою). */
export const STANDARD_JOB_TITLES = [
  'Project Manager',
  'Director',
  'Main Architect',
  'Architect',
  'Chief Electrical Engineer',
  'Electrical Engineer',
  'Chief Mechanical Engineer',
  'Mechanical Engineer',
  'Low-current Systems Engineer',
  'Senior Project Coordinator',
  'Project Coordinator',
  'Senior Financial Manager',
  'Financial Manager',
  'Project Owner',
  'Security Manager',
  'Senior Security Manager',
]

/** Должности, которые уже указаны у людей компании: новая должность, введённая один раз, дальше предлагается как подсказка. */
export const usedJobTitlesQuery = queryOptions({
  queryKey: ['used-job-titles'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('users').select('job_title').not('job_title', 'is', null).is('deleted_at', null)
    if (error) throw error
    return [...new Set((data ?? []).map((r) => (r.job_title ?? '').trim()).filter(Boolean))]
  },
})

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
