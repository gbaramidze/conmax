import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import { PERIOD_STATUS_LABELS, weekLabel, type PeriodRow } from '@/features/weekly/api'
import { supabase } from '@/lib/supabase'

interface WeeklyData {
  periods: PeriodRow[]
  commitments: { period_id: string; responsible_id: string | null; result: 'completed' | 'not_completed' | null }[]
}

/** Недельные планы (planning_periods) — отметкой на понедельнике недели: сколько обязательств и сколько выполнено. */
export const weeklyProvider = defineProvider<WeeklyData>({
  id: 'weekly',
  label: tr('Недельные планы'),
  kinds: ['week_plan'],
  permission: 'schedule.view',
  query: (ctx) => ({
    queryKey: ['weekly', 'calendar', ctx.projectId, ctx.range],
    queryFn: async () => {
      const periods = await supabase
        .from('planning_periods')
        .select('id, starts_on, ends_on, status, force_closed, note, started_at, closed_at')
        .eq('project_id', ctx.projectId)
        .gte('starts_on', ctx.range.from)
        .lte('starts_on', ctx.range.to)
        .limit(20)
      if (periods.error) throw periods.error
      const rows = periods.data as unknown as PeriodRow[]
      if (rows.length === 0) return { periods: [], commitments: [] }
      const commitments = await supabase
        .from('period_commitments')
        .select('period_id, responsible_id, result')
        .in('period_id', rows.map((p) => p.id))
        .limit(5000)
      if (commitments.error) throw commitments.error
      return { periods: rows, commitments: commitments.data as unknown as WeeklyData['commitments'] }
    },
  }),
  events: ({ periods, commitments }, ctx) =>
    periods.map((p) => {
      const list = commitments.filter((c) => c.period_id === p.id)
      const done = list.filter((c) => c.result === 'completed').length
      const counts = list.length === 0 ? tr('обязательств нет') : p.status === 'planned' ? tr('обязательств: {{length}}', { length: list.length }) : tr('выполнено {{done}} из {{length}}', { done, length: list.length })
      return {
        id: `week_plan:${p.id}`,
        kind: 'week_plan' as const,
        date: p.starts_on,
        title: tr('План недели {{v1}}', { v1: weekLabel(p.starts_on).replace(/ \d{4}$/, '') }),
        meta: `${PERIOD_STATUS_LABELS[p.status]} · ${counts}`,
        mine: list.some((c) => c.responsible_id === ctx.userId),
        target: { to: 'week' as const, w: p.starts_on },
      }
    }),
})
