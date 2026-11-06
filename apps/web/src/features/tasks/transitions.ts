import type { TaskRow } from '@/features/tasks/api'

export interface WorkflowData {
  statuses: { id: string; workflow_id: string; code: string; name: string; category: string; sort: number }[]
  transitions: {
    id: string
    workflow_id: string
    from_status_id: string | null
    to_status_id: string
    name: string | null
    required_permission: string | null
    requires_reason: boolean
    requires_comment: boolean
  }[]
}

export type AvailableTransition = WorkflowData['transitions'][number]

/**
 * Переходы, которые пользователь может выполнить из текущего статуса задачи.
 * Это только подсказка для UI — окончательное решение принимает transition_task() на сервере.
 */
export function availableTransitions(
  task: Pick<TaskRow, 'workflow_id' | 'status_id' | 'assignee_id' | 'reporter_id'>,
  workflow: WorkflowData,
  permissions: string[],
  userId: string,
): AvailableTransition[] {
  const isOwn = task.assignee_id === userId || task.reporter_id === userId
  const allowed = permissions.includes('task.transition.any') || (permissions.includes('task.transition.own') && isOwn)
  if (!allowed) return []
  return workflow.transitions.filter(
    (t) =>
      t.workflow_id === task.workflow_id &&
      (t.from_status_id === task.status_id || t.from_status_id === null) &&
      (!t.required_permission || permissions.includes(t.required_permission)),
  )
}
