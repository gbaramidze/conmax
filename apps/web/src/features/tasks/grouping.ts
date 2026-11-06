import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { PRIORITY_LABELS, type TaskGroup, type TaskRow } from '@/features/tasks/api'

export interface TaskGroupBucket {
  id: string
  label: string
  order: number
  tasks: TaskRow[]
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
const STATUS_ORDER: Record<string, number> = {
  blocked: 0,
  in_progress: 1,
  review: 2,
  todo: 3,
  backlog: 4,
  done: 5,
  cancelled: 6,
}

/** Раскладывает задачи по группам, сохраняя порядок сортировки внутри группы. Пустые значения — в конец. */
export function groupTasks(
  tasks: TaskRow[],
  group: TaskGroup,
  locationName: (path: string | null) => string = (p) => p ?? tr('Без локации'),
): TaskGroupBucket[] {
  if (group === 'none') return [{ id: 'all', label: '', order: 0, tasks }]

  const buckets = new Map<string, TaskGroupBucket>()
  for (const t of tasks) {
    let id: string
    let label: string
    let order: number
    switch (group) {
      case 'status':
        id = t.status_id
        label = t.status?.name ?? '—'
        order = STATUS_ORDER[t.status_category] ?? 9
        break
      case 'assignee':
        id = t.assignee_id ?? 'none'
        label = t.assignee?.full_name ?? tr('Без исполнителя')
        order = t.assignee_id ? 0 : 1
        break
      case 'discipline':
        id = t.discipline_id ?? 'none'
        label = t.discipline ? `${t.discipline.code} — ${t.discipline.name}` : tr('Без дисциплины')
        order = t.discipline_id ? 0 : 1
        break
      case 'location':
        id = t.location_path ?? 'none'
        label = locationName(t.location_path)
        order = t.location_path ? 0 : 1
        break
      default:
        id = t.priority
        label = PRIORITY_LABELS[t.priority]
        order = PRIORITY_ORDER[t.priority] ?? 9
    }
    const bucket = buckets.get(id) ?? { id, label, order, tasks: [] }
    bucket.tasks.push(t)
    buckets.set(id, bucket)
  }
  return [...buckets.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, currentLocale()))
}
