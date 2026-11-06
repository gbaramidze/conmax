import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import { todayIso } from '@/features/calendar/dates'
import { activitiesQuery, type Activity } from '@/features/schedule/api'
import type { CalendarEvent, KindId } from '@/features/calendar/types'

/**
 * Работы и вехи графика. Данные те же, что у Ганта (общий кэш): пересчёт графика обновит и календарь.
 * Группы (summary) в календарь не попадают. Рядовые старты и окончания по умолчанию скрыты — их много.
 */
export const scheduleProvider = defineProvider<Activity[]>({
  id: 'schedule',
  label: tr('График'),
  kinds: ['milestone', 'activity_critical', 'activity_start', 'activity_finish'],
  permission: 'schedule.view',
  query: (ctx) => activitiesQuery(ctx.projectId),
  events: (rows, ctx) => {
    const today = todayIso()
    const out: CalendarEvent[] = []
    for (const a of rows) {
      if (a.kind === 'summary') continue
      const complete = a.percent_complete >= 100 || !!a.actual_finish
      const base = { title: a.name, mine: a.responsible_id === ctx.userId, target: { to: 'schedule' } as const }
      if (a.kind === 'milestone') {
        const date = a.start_date ?? a.finish_date
        if (date)
          out.push({
            ...base,
            id: `milestone:${a.id}`,
            kind: 'milestone',
            date,
            meta: a.is_critical ? tr('веха · критический путь') : tr('веха'),
            tone: complete ? 'done' : date < today ? 'overdue' : undefined,
          })
        continue
      }
      const kind: (suffix: 'start' | 'finish') => KindId = (suffix) => (a.is_critical ? 'activity_critical' : suffix === 'start' ? 'activity_start' : 'activity_finish')
      const crit = a.is_critical ? tr(' · критический путь') : ''
      if (a.start_date && a.start_date === a.finish_date) {
        out.push({ ...base, id: `activity:${a.id}:one`, kind: kind('start'), date: a.start_date, meta: tr('старт и окончание{{crit}}', { crit }), tone: complete ? 'done' : undefined })
        continue
      }
      if (a.start_date)
        out.push({ ...base, id: `activity:${a.id}:start`, kind: kind('start'), date: a.start_date, meta: tr('старт{{crit}}', { crit }), tone: complete || a.actual_start ? 'done' : undefined })
      if (a.finish_date)
        out.push({
          ...base,
          id: `activity:${a.id}:finish`,
          kind: kind('finish'),
          date: a.finish_date,
          meta: tr('окончание{{crit}}', { crit }),
          tone: complete ? 'done' : a.finish_date < today ? 'overdue' : undefined,
        })
    }
    return out
  },
})
