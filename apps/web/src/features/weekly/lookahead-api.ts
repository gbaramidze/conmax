import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fail } from './api'

/** Виды проверок look-ahead: полное название, короткая подпись в шапке матрицы. */
export const CONSTRAINT_KINDS = {
  design: { label: tr('Документация'), short: tr('Док.') },
  rfi: { label: tr('Ответ на RFI'), short: 'RFI' },
  materials: { label: tr('Материалы'), short: tr('Мат.') },
  labor: { label: tr('Люди'), short: tr('Люди') },
  equipment: { label: tr('Техника и инструмент'), short: tr('Тех.') },
  predecessor: { label: tr('Предыдущая работа'), short: tr('Пред.') },
  approvals: { label: tr('Согласования и допуски'), short: tr('Согл.') },
  access: { label: tr('Фронт работ'), short: tr('Фронт') },
  client_decision: { label: tr('Решение заказчика'), short: tr('Закз.') },
  finance: { label: tr('Оплата и финансирование'), short: tr('Фин.') },
  safety: { label: tr('Охрана труда'), short: tr('ОТ') },
} as const
export type ConstraintKind = keyof typeof CONSTRAINT_KINDS
export const CONSTRAINT_KIND_KEYS = Object.keys(CONSTRAINT_KINDS) as ConstraintKind[]

export interface ConstraintRow {
  id: string
  activity_id: string
  task_id: string
  kind: ConstraintKind
  task: {
    id: string
    key: string
    title: string
    status_category: string
    due_date: string | null
    assignee: { full_name: string } | null
  } | null
}

export const constraintsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['weekly', 'constraints', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_constraints')
        .select('id, activity_id, task_id, kind, task:tasks(id, key, title, status_category, due_date, assignee:users!assignee_id(full_name))')
        .eq('project_id', projectId)
        .limit(5000)
      if (error) throw error
      return (data as unknown as ConstraintRow[]).filter((c) => c.task)
    },
  })

export const checksQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['weekly', 'checks', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_readiness_checks').select('activity_id, checked_at').eq('project_id', projectId).limit(5000)
      if (error) throw error
      return data as unknown as { activity_id: string; checked_at: string }[]
    },
  })

export const isOpenConstraint = (c: ConstraintRow) => c.task !== null && c.task.status_category !== 'done' && c.task.status_category !== 'cancelled'

export async function createConstraint(v: { activityId: string; kind: ConstraintKind; title: string; assigneeId: string | null; dueDate: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('create_constraint', {
    p_activity: v.activityId,
    p_kind: v.kind,
    p_title: v.title,
    p_assignee: (v.assigneeId ?? null) as never,
    p_due: (v.dueDate ?? null) as never,
  })
  if (error) fail(error)
  return data as string
}

export async function setActivityChecked(activityId: string, checked: boolean) {
  const { error } = await supabase.rpc('set_activity_checked', { p_activity: activityId, p_checked: checked })
  if (error) fail(error)
}
