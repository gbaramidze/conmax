import { tr } from '@/lib/tr'
import { defineProvider } from '@/features/calendar/providers/define'
import { isOverdue } from '@/features/tasks/api'
import type { CalendarEvent } from '@/features/calendar/types'
import { supabase } from '@/lib/supabase'

interface TaskRow {
  id: string
  key: string
  title: string
  due_date: string | null
  need_by_date: string | null
  status_category: string
  assignee_id: string | null
  assignee: { full_name: string } | null
}

/** Задачи: срок исполнения и «нужно к дате». Какие задачи видны, решает RLS (внутренние задачи внешним не отдаются). */
export const tasksProvider = defineProvider<TaskRow[]>({
  id: 'tasks',
  label: tr('Задачи'),
  kinds: ['task_due', 'task_need'],
  permission: 'task.view',
  query: (ctx) => ({
    // ['tasks', projectId, …] сбрасывается при создании задачи из других мест
    queryKey: ['tasks', ctx.projectId, 'calendar', ctx.range],
    queryFn: async () => {
      const { from, to } = ctx.range
      const { data, error } = await supabase
        .from('tasks')
        .select('id, key, title, due_date, need_by_date, status_category, assignee_id, assignee:users!assignee_id(full_name)')
        .eq('project_id', ctx.projectId)
        .is('deleted_at', null)
        .or(`and(due_date.gte.${from},due_date.lte.${to}),and(need_by_date.gte.${from},need_by_date.lte.${to})`)
        .limit(2000)
      if (error) throw error
      return data as unknown as TaskRow[]
    },
  }),
  events: (rows, ctx) =>
    rows.flatMap((t) => {
      const closed = t.status_category === 'done' || t.status_category === 'cancelled'
      const base = {
        title: t.title,
        mine: t.assignee_id === ctx.userId,
        target: { to: 'task', key: t.key } as const,
      }
      const out: CalendarEvent[] = []
      if (t.due_date)
        out.push({
          ...base,
          id: `task_due:${t.id}`,
          kind: 'task_due',
          date: t.due_date,
          meta: [t.key, t.assignee?.full_name].filter(Boolean).join(' · '),
          tone: closed ? 'done' : isOverdue(t) ? 'overdue' : undefined,
        })
      if (t.need_by_date)
        out.push({
          ...base,
          id: `task_need:${t.id}`,
          kind: 'task_need',
          date: t.need_by_date,
          meta: [t.key, tr('нужно к дате')].join(' · '),
          tone: closed ? 'done' : undefined,
        })
      return out
    }),
})
