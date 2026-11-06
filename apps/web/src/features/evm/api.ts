import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { toDisplay } from '@/features/projects/display-currency'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Evm {
  date: string
  bac: number
  pv: number
  ev: number
  ac: number
  sv: number
  cv: number
  spi: number | null
  cpi: number | null
  spit: number | null
  eac1: number | null
  eac2: number | null
  eac3: number | null
  tcpi: number | null
  vac: number
  start: string | null
  finish: string | null
  planned_days: number | null
  elapsed_days: number | null
  es_days: number | null
  forecast_days: number | null
  forecast_finish: string | null
  coverage: number | null
  total_budget: number
  works: number
  baseline: boolean
  by_item: { item_id: string; code: string; name: string; bac: number; pv: number; ev: number; ac: number }[]
  lagging: { id: string; name: string; bac: number; percent: number; planned_percent: number; gap: number }[]
  ppc4: number | null
  open_tasks: number
  overdue_tasks: number
  open_constraints: number
  pending_progress: number
}

export interface SnapshotRow {
  id: string
  status_date: string
  kind: 'weekly' | 'manual'
  note: string | null
  metrics: Evm
}

const nums = (e: Evm): Evm => e

export const evmQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['evm', 'live', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('evm_calc', { p_project: projectId, p_date: new Date().toLocaleDateString('sv') })
      if (error) throw error
      return nums(data as unknown as Evm)
    },
  })

export const evmSeriesQuery = (projectId: string, from: string | null, to: string | null) =>
  queryOptions({
    queryKey: ['evm', 'series', projectId, from, to],
    enabled: !!from && !!to,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('evm_series', { p_project: projectId, p_from: from!, p_to: to!, p_step: 7 })
      if (error) throw error
      return (data as unknown as { day: string; pv: number }[]).map((r) => ({ day: r.day, pv: Number(r.pv) }))
    },
  })

export const snapshotsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['evm', 'snapshots', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('snapshots')
        .select('id, status_date, kind, note, metrics')
        .eq('project_id', projectId)
        .order('status_date', { ascending: true })
        .limit(300)
      if (error) throw error
      return data as unknown as SnapshotRow[]
    },
  })

export async function createSnapshot(projectId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('create_snapshot', { p_project: projectId, p_note: (note.trim() || null) as never })
  if (error) throw error
}

export type Light = 'green' | 'yellow' | 'red' | 'none'
export const indexLight = (v: number | null, green: number, yellow: number): Light => (v === null ? 'none' : v >= green ? 'green' : v >= yellow ? 'yellow' : 'red')
export const eacLight = (bac: number, eac: number | null): Light => {
  if (eac === null || bac <= 0) return 'none'
  const over = (eac - bac) / bac
  return over <= 0.02 ? 'green' : over <= 0.05 ? 'yellow' : 'red'
}
export const LIGHT_STYLES: Record<Light, string> = {
  green: 'text-green-700 dark:text-green-300',
  yellow: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
  none: '',
}
export const LIGHT_DOT: Record<Light, string> = { green: 'bg-green-500', yellow: 'bg-amber-500', red: 'bg-red-500', none: 'bg-muted-foreground/30' }
export const LIGHT_LABEL: Record<Light, string> = { green: tr('в допуске'), yellow: tr('внимание'), red: tr('вне допуска'), none: tr('нет данных') }

export const fmtMoney = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(Math.round(toDisplay(n))))
export const fmtIndex = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2).replace('.', ','))
