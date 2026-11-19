import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import { isOverdue } from '@/features/tasks/api'
import type { CalendarEvent } from '@/features/calendar/types'
import { supabase } from '@/lib/supabase'

interface MyTaskRow {
  id: string
  key: string
  title: string
  due_date: string
  need_by_date: string | null
  status_category: string
  project: { code: string } | null
}

/**
 * Мои задачи во всех проектах (я исполнитель) — по сроку. Только для личного календаря (`personalOnly`):
 * в календаре проекта задачи показывает свой источник `tasks`.
 */
export const myTasksProvider = defineProvider<MyTaskRow[]>({
  id: 'my_tasks',
  label: tr('Задачи'),
  kinds: ['my_task'],
  personalOnly: true,
  query: (ctx) => ({
    queryKey: ['tasks', 'mine', 'calendar', ctx.range, ctx.userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, key, title, due_date, need_by_date, status_category, project:projects(code)')
        .eq('assignee_id', ctx.userId)
        .is('deleted_at', null)
        .gte('due_date', ctx.range.from)
        .lte('due_date', ctx.range.to)
        .neq('status_category', 'cancelled')
        .limit(1000)
      if (error) throw error
      return data as unknown as MyTaskRow[]
    },
  }),
  events: (rows): CalendarEvent[] =>
    rows
      .filter((t) => t.project?.code)
      .map((t) => ({
        id: `my_task:${t.id}`,
        kind: 'my_task',
        date: t.due_date,
        title: t.title,
        meta: `${t.project!.code} · ${t.key}`,
        mine: true,
        tone: t.status_category === 'done' ? 'done' : isOverdue(t) ? 'overdue' : undefined,
        target: { to: 'task', key: t.key, code: t.project!.code },
      })),
})
