import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import type { CalendarEvent } from '@/features/calendar/types'
import { supabase } from '@/lib/supabase'

interface PersonalEventRow {
  id: string
  title: string
  event_date: string
  start_time: string | null
  end_time: string | null
  place: string | null
}

/**
 * Личные события владельца (features/personal). Время показывается как записано, без часового пояса проекта.
 * Источник не зависит от проекта, поэтому один и тот же запрос питает и рабочие календари (тип «Личное», по умолчанию выключен), и личный календарь.
 */
export const personalProvider = defineProvider<PersonalEventRow[]>({
  id: 'personal',
  label: tr('Личное'),
  kinds: ['personal'],
  query: (ctx) => ({
    queryKey: ['personal', 'calendar', ctx.range, ctx.userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('personal_items')
        .select('id, title, event_date, start_time, end_time, place')
        .eq('kind', 'event')
        .gte('event_date', ctx.range.from)
        .lte('event_date', ctx.range.to)
        .order('event_date')
        .limit(1000)
      if (error) throw error
      return data as unknown as PersonalEventRow[]
    },
  }),
  events: (rows): CalendarEvent[] =>
    rows.map((r) => ({
      id: `personal-${r.id}`,
      kind: 'personal',
      date: r.event_date,
      time: r.start_time?.slice(0, 5),
      endTime: r.end_time?.slice(0, 5),
      title: r.title,
      meta: r.place ?? undefined,
      mine: true,
      target: { to: 'personal', id: r.id },
    })),
})
