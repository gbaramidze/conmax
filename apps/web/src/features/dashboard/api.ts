import { currentLocale } from '@/lib/i18n'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Ответ функции project_dashboard: взвешенный прогресс, план/факт, срезы и «внимание» (ADR-014). */
export interface DashboardData {
  totals: {
    items: number
    items_done: number
    percent: number | null
    reported: number | null
    verified: number | null
    verified_share: number | null
    weights_set: boolean
    states: { verified: number; accepted: number; disputed: number; unchecked: number }
  }
  plan: { coverage: number | null; plan: number | null; fact: number | null }
  series: { date: string; fact: number | null; plan: number | null }[]
  forecast: { rate_per_week: number; finish_date: string | null } | null
  by_location: { path: string; name: string; kind: string; depth: number; items: number; percent: number | null; reported: number | null }[]
  by_discipline: {
    discipline_id: string
    parent_id: string | null
    code: string
    name: string
    color: string | null
    sort_key: number
    items: number
    percent: number | null
  }[]
  by_contractor: { org_id: string | null; name: string; items: number; percent: number | null }[]
  /** null — для внешних участников (подрядчиков, заказчика) блок не отдаётся */
  attention: {
    discrepancies: { minor: number; major: number }
    walks_pending: number
    last_walk_at: string | null
    stale_days: number
    stale: { path: string; name: string; kind: string; last_walk: string | null; days: number | null }[]
    blocked: { code: string; name: string; count: number }[]
  } | null
}

export const dashboardQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['dashboard', projectId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_dashboard', { p_project: projectId })
      if (error) throw error
      return data as unknown as DashboardData
    },
  })

export interface ProjectProgress {
  project_id: string
  items: number
  percent: number | null
  reported: number | null
  open_discrepancies: number
}

export const projectsProgressQuery = queryOptions({
  queryKey: ['dashboard', 'projects-progress'],
  staleTime: 30_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('projects_progress')
    if (error) throw error
    return new Map((data as unknown as ProjectProgress[]).map((r) => [r.project_id, r]))
  },
})

const pct = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 })
export const fmtPercent = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${pct.format(Number(n))}%`)

const shortDate = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
const longDate = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
export const fmtShortDate = (iso: string) => shortDate.format(new Date(iso))
export const fmtLongDate = (iso: string) => longDate.format(new Date(iso))

/** Один этаж «разреза здания». Расхождения и обходы — только для внутренних участников (иначе null). */
export interface FloorCell {
  path: string
  code: string
  name: string
  sort: number
  building: string
  section: string | null
  items: number
  percent: number | null
  reported: number | null
  open_tasks: number
  overdue: number
  punch: number
  blocked: number
  discrepancies: number | null
  last_walk: string | null
}

export const buildingSectionQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['dashboard', 'building-section', projectId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('building_section', { p_project: projectId })
      if (error) throw error
      return data as unknown as FloorCell[]
    },
  })
