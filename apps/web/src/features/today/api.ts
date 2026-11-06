import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface TodayTask {
  id: string
  key: string
  title: string
  due_date: string | null
  priority: 'low' | 'normal' | 'high' | 'critical'
  status_category: string
  project: { code: string; name: string } | null
  status: { name: string } | null
}

const TASK_COLUMNS = 'id, key, title, due_date, priority, status_category, project:projects(code, name), status:workflow_statuses!status_id(name)'

/** Мои открытые задачи во всех проектах: сначала со сроком, по возрастанию срока. */
export const myOpenTasksQuery = (userId: string) =>
  queryOptions({
    queryKey: ['today', 'tasks', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('assignee_id', userId)
        .is('deleted_at', null)
        .not('status_category', 'in', '(done,cancelled)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(300)
      if (error) throw error
      return data as unknown as TodayTask[]
    },
  })

/** Задачи, которые я поставил и которые исполнитель передал мне на проверку. */
export const awaitingMyReviewQuery = (userId: string) =>
  queryOptions({
    queryKey: ['today', 'review', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('reporter_id', userId)
        .eq('status_category', 'review')
        .is('deleted_at', null)
        .limit(50)
      if (error) throw error
      return data as unknown as TodayTask[]
    },
  })

export interface AckDoc {
  id: string
  title: string
  code: string | null
  project_id: string
  current_revision: string | null
}

export const docsToAckQuery = queryOptions({
  queryKey: ['today', 'ack-docs'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('documents_overview')
      .select('id, title, code, project_id, current_revision')
      .eq('ack_pending', true)
      .limit(50)
    if (error) throw error
    return data as unknown as AckDoc[]
  },
})

export interface DraftWalk {
  id: string
  kind: 'report' | 'check'
  location_path: string
  started_at: string
  project: { code: string } | null
}

export const myDraftWalksAllQuery = (userId: string) =>
  queryOptions({
    queryKey: ['today', 'draft-walks', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_walks')
        .select('id, kind, location_path, started_at, project:projects(code)')
        .eq('author_id', userId)
        .eq('status', 'draft')
        .order('started_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as unknown as DraftWalk[]
    },
  })

export const todayISO = () => new Date().toLocaleDateString('sv')

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('sv')
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T12:00:00`).getTime() - new Date(`${fromIso}T12:00:00`).getTime()) / 86_400_000)
}
