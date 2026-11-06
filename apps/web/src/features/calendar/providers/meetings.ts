import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import { addDays, todayIso } from '@/features/calendar/dates'
import { isoToZoned, isoDow, zonedToIso } from '@/features/meetings/time'
import { MEETING_TYPE_LABELS, type MeetingRow, type SeriesRow } from '@/features/meetings/api'
import type { CalendarEvent } from '@/features/calendar/types'
import { supabase } from '@/lib/supabase'

type SeriesInfo = SeriesRow & { type: keyof typeof MEETING_TYPE_LABELS; duration_min: number; place: string | null }

interface MeetingsData {
  meetings: MeetingRow[]
  /** совещания диапазона, где пользователь — участник */
  mineIds: string[]
  series: SeriesInfo[]
}

const plusMinutes = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString()

/**
 * Совещания проекта. Время хранится в UTC и показывается по часовому поясу проекта (features/meetings/time.ts).
 * Встречи серий создаются на 6 недель вперёд; дальше показываем ожидаемые встречи прямо по расписанию серии.
 */
export const meetingsProvider = defineProvider<MeetingsData>({
  id: 'meetings',
  label: tr('Совещания'),
  kinds: ['meeting'],
  permission: 'meeting.view',
  query: (ctx) => ({
    queryKey: ['meetings', ctx.projectId, 'calendar', ctx.range, ctx.timezone, ctx.userId],
    queryFn: async () => {
      const from = zonedToIso(`${ctx.range.from}T00:00`, ctx.timezone)
      const to = zonedToIso(`${addDays(ctx.range.to, 1)}T00:00`, ctx.timezone)
      const [meetings, series] = await Promise.all([
        supabase
          .from('meetings_overview')
          .select('*')
          .eq('project_id', ctx.projectId)
          .gte('scheduled_at', from)
          .lt('scheduled_at', to)
          .order('scheduled_at')
          .limit(1000),
        // серии видят только внутренние участники — внешним придёт пустой список
        supabase
          .from('meeting_series')
          .select('id, title, slots, starts_on, ends_on, active, type, duration_min, place')
          .eq('project_id', ctx.projectId)
          .eq('active', true),
      ])
      if (meetings.error) throw meetings.error
      if (series.error) throw series.error
      const rows = meetings.data as unknown as MeetingRow[]
      let mineIds: string[] = []
      if (rows.length > 0) {
        const mine = await supabase
          .from('meeting_participants')
          .select('meeting_id')
          .eq('user_id', ctx.userId)
          .in('meeting_id', rows.map((m) => m.id))
        if (mine.error) throw mine.error
        mineIds = mine.data.map((r) => r.meeting_id)
      }
      return { meetings: rows, mineIds, series: series.data as unknown as SeriesInfo[] }
    },
  }),
  events: ({ meetings, mineIds, series }, ctx) => {
    const mine = new Set(mineIds)
    const out: CalendarEvent[] = meetings.map((m) => {
      const start = isoToZoned(m.scheduled_at, ctx.timezone)
      return {
        id: `meeting:${m.id}`,
        kind: 'meeting',
        date: start.slice(0, 10),
        time: start.slice(11, 16),
        endTime: isoToZoned(plusMinutes(m.scheduled_at, m.duration_min), ctx.timezone).slice(11, 16),
        title: m.title,
        meta: [m.key, MEETING_TYPE_LABELS[m.type], m.place].filter(Boolean).join(' · '),
        mine: mine.has(m.id) || m.facilitator_id === ctx.userId,
        tone: m.status === 'cancelled' ? 'done' : undefined,
        target: { to: 'meeting', id: m.id },
      }
    })

    // Ожидаемые встречи серий — только за горизонтом, до которого встречи уже созданы (42 дня): ближе пропуск
    // означает отмену или перенос расписания, а не «ещё не создано». Созданные встречи повторно не показываем.
    const horizon = addDays(todayIso(), 42)
    const have = new Set(meetings.filter((m) => m.series_id).map((m) => `${m.series_id}|${new Date(m.original_at ?? m.scheduled_at).getTime()}`))
    const now = Date.now()
    for (const s of series) {
      for (let d = [s.starts_on, ctx.range.from, addDays(horizon, 1)].reduce((a, b) => (a > b ? a : b)); d <= ctx.range.to; d = addDays(d, 1)) {
        if (s.ends_on && d > s.ends_on) break
        for (const slot of s.slots) {
          if (slot.dow !== isoDow(d)) continue
          const at = zonedToIso(`${d}T${slot.time}`, ctx.timezone)
          if (new Date(at).getTime() < now || have.has(`${s.id}|${new Date(at).getTime()}`)) continue
          out.push({
            id: `meeting:series:${s.id}:${at}`,
            kind: 'meeting',
            date: d,
            time: slot.time,
            endTime: isoToZoned(plusMinutes(at, s.duration_min), ctx.timezone).slice(11, 16),
            title: s.title,
            meta: [tr('по расписанию серии'), MEETING_TYPE_LABELS[s.type], s.place].filter(Boolean).join(' · '),
            mine: false,
            tone: 'planned',
            target: { to: 'meetings' },
          })
        }
      }
    }
    return out
  },
})
