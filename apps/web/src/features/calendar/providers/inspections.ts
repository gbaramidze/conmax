import { tr } from '@/lib/tr'
import { todayIso } from '@/features/calendar/dates'
import { defineProvider } from '@/features/calendar/providers/define'
import { fetchSchedules, INSPECTION_STATUSES, type InspectionSchedule, type ItemStatus } from '@/features/inspections/api'
import { occurrences } from '@/features/inspections/stats'
import { supabase } from '@/lib/supabase'

interface ReportBrief {
  id: string
  key: string
  title: string
  inspection_date: string
  status: 'draft' | 'issued'
  result: ItemStatus | null
  created_by: string | null
  location: { name: string } | null
  contractor: { name: string } | null
}

interface InspectionsData {
  reports: ReportBrief[]
  schedules: InspectionSchedule[]
}

/**
 * Инспекции: проведённые и начатые отчёты в день инспекции и сроки повторных инспекций по расписанию
 * (ближайший срок и последующие с шагом периода; просроченный — красным, будущие — «ожидается»).
 */
export const inspectionsProvider = defineProvider<InspectionsData>({
  id: 'inspections',
  label: tr('Инспекции'),
  kinds: ['inspection', 'inspection_due'],
  permission: 'inspection.view',
  query: (ctx) => ({
    queryKey: ['inspections', 'calendar', ctx.projectId, ctx.range],
    queryFn: async () => {
      const [reports, schedules] = await Promise.all([
        supabase
          .from('inspection_reports')
          .select('id, key, title, inspection_date, status, result, created_by, location:locations!location_id(name), contractor:organizations!contractor_org_id(name)')
          .eq('project_id', ctx.projectId)
          .gte('inspection_date', ctx.range.from)
          .lte('inspection_date', ctx.range.to)
          .order('inspection_date')
          .limit(2000),
        fetchSchedules(ctx.projectId),
      ])
      if (reports.error) throw reports.error
      return { reports: reports.data as unknown as ReportBrief[], schedules }
    },
  }),
  events: ({ reports, schedules }, ctx) => {
    const today = todayIso()
    const done = reports.map((r) => ({
      id: `inspection:${r.id}`,
      kind: 'inspection' as const,
      date: r.inspection_date,
      title: r.title ? `${r.key} · ${r.title}` : r.key,
      meta: [r.status === 'issued' ? (r.result ? INSPECTION_STATUSES[r.result] : tr('Выдан')) : tr('Черновик'), r.contractor?.name, r.location?.name].filter(Boolean).join(' · '),
      mine: r.created_by === ctx.userId,
      tone: r.status === 'issued' && r.result === 'R' ? ('overdue' as const) : undefined,
      target: { to: 'inspection' as const, id: r.id },
    }))
    const due = schedules
      .filter((s) => s.active)
      .flatMap((s) =>
        occurrences(s, ctx.range.from, ctx.range.to).map((date) => ({
          id: `inspection_due:${s.id}:${date}`,
          kind: 'inspection_due' as const,
          date,
          title: s.title || s.location?.name || tr('Инспекция'),
          meta: [tr('каждые {{n}} дн.', { n: s.period_days }), s.contractor?.name].filter(Boolean).join(' · '),
          mine: s.inspector_id === ctx.userId,
          tone: date < today ? ('overdue' as const) : ('planned' as const),
          target: { to: 'inspection_schedule' as const },
        })),
      )
    return [...done, ...due]
  },
})
