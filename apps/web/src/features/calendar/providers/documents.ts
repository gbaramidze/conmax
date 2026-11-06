import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import { addDays, todayIso } from '@/features/calendar/dates'
import { isoToZoned, zonedToIso } from '@/features/meetings/time'
import type { CalendarEvent } from '@/features/calendar/types'
import { supabase } from '@/lib/supabase'

interface DocRow {
  id: string
  code: string | null
  title: string
  published_at: string
  current_revision: string | null
  ack_pending: boolean
}

/**
 * Документы: дата выпуска действующей версии и ожидание ознакомления (для текущего пользователя).
 * Срока у ознакомления нет, поэтому оно стоит на дне выпуска, а давнее — на сегодняшнем дне.
 * Реестр сам скрывает документы, которых пользователь видеть не вправе.
 */
export const documentsProvider = defineProvider<DocRow[]>({
  id: 'documents',
  label: tr('Документы'),
  kinds: ['doc_ack', 'doc_issued'],
  query: (ctx) => ({
    queryKey: ['documents', ctx.projectId, 'calendar', ctx.range, ctx.timezone],
    queryFn: async () => {
      const from = zonedToIso(`${ctx.range.from}T00:00`, ctx.timezone)
      const to = zonedToIso(`${addDays(ctx.range.to, 1)}T00:00`, ctx.timezone)
      const { data, error } = await supabase
        .from('documents_overview')
        .select('id, code, title, published_at, current_revision, ack_pending')
        .eq('project_id', ctx.projectId)
        .not('published_at', 'is', null)
        .or(`and(published_at.gte.${from},published_at.lt.${to}),ack_pending.eq.true`)
        .order('published_at')
        .limit(1000)
      if (error) throw error
      return data as unknown as DocRow[]
    },
  }),
  events: (rows, ctx) => {
    const today = todayIso()
    return rows.flatMap((d) => {
      const at = isoToZoned(d.published_at, ctx.timezone)
      const ref = [d.code, d.current_revision ? tr('ред. {{current_revision}}', { current_revision: d.current_revision }) : null].filter(Boolean).join(' · ')
      const out: CalendarEvent[] = [
        { id: `doc_issued:${d.id}`, kind: 'doc_issued', date: at.slice(0, 10), time: at.slice(11, 16), title: d.title, meta: ref ? tr('выпущен · {{ref}}', { ref }) : tr('выпущен'), mine: false, target: { to: 'document', id: d.id } },
      ]
      if (d.ack_pending) {
        const date = at.slice(0, 10) < ctx.range.from && today >= ctx.range.from && today <= ctx.range.to ? today : at.slice(0, 10)
        out.push({ id: `doc_ack:${d.id}`, kind: 'doc_ack', date, title: tr('Ознакомиться: {{title}}', { title: d.title }), meta: ref, mine: true, tone: 'overdue', target: { to: 'document', id: d.id } })
      }
      return out
    })
  },
})
