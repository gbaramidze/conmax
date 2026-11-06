import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const TASK_TYPE_LABELS = {
  task: tr('Задача'),
  punch: tr('Замечание'),
  rfi: 'RFI',
  action_item: tr('Поручение'),
  issue: tr('Проблема'),
  constraint: tr('Ограничение'),
} as const

export const PRIORITY_LABELS = {
  low: tr('Низкий'),
  normal: tr('Обычный'),
  high: tr('Высокий'),
  critical: tr('Критичный'),
} as const
export type Priority = keyof typeof PRIORITY_LABELS

export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled'

export const TASK_FILTERS = ['open', 'mine', 'reported', 'overdue', 'blocked', 'unassigned', 'done', 'all'] as const
export type TaskFilter = (typeof TASK_FILTERS)[number]

export const TASK_FILTER_LABELS: Record<TaskFilter, string> = {
  open: tr('Открытые'),
  mine: tr('Мои'),
  reported: tr('Я автор'),
  overdue: tr('Просроченные'),
  blocked: tr('Заблокированные'),
  unassigned: tr('Без исполнителя'),
  done: tr('Закрытые'),
  all: tr('Все'),
}

/** Статусные категории → стили бейджа (цвет + текст, не только цвет). */
export const CATEGORY_STYLES: Record<StatusCategory, string> = {
  backlog: 'bg-muted text-muted-foreground',
  todo: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  blocked: 'bg-red-500/10 text-red-700 dark:text-red-300',
  review: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  done: 'bg-green-500/10 text-green-700 dark:text-green-300',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

export const TASK_SORTS = ['created', 'due', 'priority', 'status', 'key'] as const
export type TaskSort = (typeof TASK_SORTS)[number]
export const TASK_SORT_LABELS: Record<TaskSort, string> = {
  created: tr('По дате создания'),
  due: tr('По сроку'),
  priority: tr('По приоритету'),
  status: tr('По статусу'),
  key: tr('По номеру'),
}

export const TASK_GROUPS = ['none', 'status', 'assignee', 'discipline', 'location', 'priority'] as const
export type TaskGroup = (typeof TASK_GROUPS)[number]
export const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  none: tr('Без группировки'),
  status: tr('По статусу'),
  assignee: tr('По исполнителю'),
  discipline: tr('По дисциплине'),
  location: tr('По локации'),
  priority: tr('По приоритету'),
}

/** Параметры списка: всё, кроме группировки, влияет на запрос. Живут в URL. */
export interface TaskListParams {
  filter: TaskFilter
  discipline: string // 'any' | 'none' | uuid
  /** id выбранного направления и его потомков (считает вызывающий по дереву направлений) */
  disciplineIds?: string[]
  location: string // 'any' | 'none' | путь узла (K2.S1): задачи этого узла и всех вложенных
  sort: TaskSort
  dir: 'asc' | 'desc'
  tag?: string
}

/** Цвет дисциплины (имя из disciplines.color) → классы бейджа. Строки статичны, чтобы их видел Tailwind. */
export const DISCIPLINE_STYLES: Record<string, string> = {
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
}
export const DEFAULT_DISCIPLINE_STYLE = 'bg-muted text-muted-foreground'

const TASK_COLUMNS =
  'id, key, number, type, title, description, workflow_id, status_id, status_category, priority, due_date, planned_start, need_by_date, estimate_hours, spent_hours, reporter_id, assignee_id, organization_id, discipline_id, location_id, location_path, tags, visibility, blocked_reason_code, blocked_comment, version, created_at, ' +
  'status:workflow_statuses!status_id(id, name, category), ' +
  'assignee:users!assignee_id(id, full_name), reporter:users!reporter_id(id, full_name), organization:organizations(id, name), ' +
  'discipline:disciplines(id, code, name, color), parent_id'

/** Параметры списка задач по умолчанию — для ссылок из других разделов. */
export const DEFAULT_TASK_SEARCH = {
  filter: 'open',
  discipline: 'any',
  location: 'any',
  sort: 'created',
  dir: 'desc',
  group: 'none',
  view: 'list',
} as const

export function todayISO(): string {
  return new Date().toLocaleDateString('sv') // YYYY-MM-DD в локальной таймзоне
}

export function isOverdue(t: { due_date: string | null; status_category: string }): boolean {
  return !!t.due_date && t.due_date < todayISO() && t.status_category !== 'done' && t.status_category !== 'cancelled'
}

export const tasksQuery = (projectId: string, params: TaskListParams, userId: string) =>
  queryOptions({
    queryKey: ['tasks', projectId, params, userId],
    queryFn: async () => {
      let q = supabase.from('tasks').select(TASK_COLUMNS).eq('project_id', projectId).is('deleted_at', null)
      const open = '(done,cancelled)'
      if (params.discipline === 'none') q = q.is('discipline_id', null)
      else if (params.discipline !== 'any') {
        // направление + все его поднаправления
        q = q.in('discipline_id', params.disciplineIds?.length ? params.disciplineIds : [params.discipline])
      }
      if (params.location === 'none') q = q.is('location_id', null)
      else if (params.location !== 'any' && /^[A-Z0-9_.]+$/.test(params.location)) {
        // поддерево: сам узел или любой вложенный (путь содержит только [A-Z0-9_.], значит, безопасен для or-фильтра)
        q = q.or(`location_path.eq.${params.location},location_path.like.${params.location}.*`)
      }
      if (params.tag) q = q.contains('tags', [params.tag])
      switch (params.filter) {
        case 'open':
          q = q.not('status_category', 'in', open)
          break
        case 'mine':
          q = q.eq('assignee_id', userId).not('status_category', 'in', open)
          break
        case 'reported':
          q = q.eq('reporter_id', userId)
          break
        case 'overdue':
          q = q.lt('due_date', todayISO()).not('status_category', 'in', open)
          break
        case 'blocked':
          q = q.eq('status_category', 'blocked')
          break
        case 'unassigned':
          q = q.is('assignee_id', null).not('status_category', 'in', open)
          break
        case 'done':
          q = q.in('status_category', ['done', 'cancelled'])
          break
      }
      // Сортировка на сервере; number — запасной критерий (задачи из одной транзакции имеют одинаковый created_at)
      const asc = params.dir === 'asc'
      switch (params.sort) {
        case 'due':
          q = q.order('due_date', { ascending: asc, nullsFirst: false }).order('priority_rank')
          break
        case 'priority':
          q = q.order('priority_rank', { ascending: asc }).order('due_date', { ascending: true, nullsFirst: false })
          break
        case 'status':
          q = q.order('status_rank', { ascending: asc }).order('priority_rank')
          break
        case 'key':
          q = q.order('number', { ascending: asc })
          break
        default:
          q = q.order('created_at', { ascending: asc })
      }
      const { data, error } = await q.order('number', { ascending: false }).limit(500)
      if (error) throw error
      return withSubtaskInfo(data as unknown as BaseTaskRow[])
    },
  })

export const taskByKeyQuery = (key: string) =>
  queryOptions({
    queryKey: ['task', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('key', key)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return (await withSubtaskInfo([data as unknown as BaseTaskRow]))[0]
    },
  })

/**
 * Дополняет строки сводкой по подзадачам (сколько выполнено из скольких) и данными родителя.
 * Отдельные запросы вместо встраивания: самоссылка `tasks → tasks` неоднозначна для PostgREST.
 */
async function withSubtaskInfo(rows: BaseTaskRow[]): Promise<TaskRow[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const parentIds = [...new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x))]

  const [children, parents, badgeRows] = await Promise.all([
    supabase.from('tasks').select('parent_id, status_category').in('parent_id', ids).is('deleted_at', null),
    parentIds.length
      ? supabase.from('tasks').select('id, key, title').in('id', parentIds)
      : Promise.resolve({ data: [] as { id: string; key: string; title: string }[], error: null }),
    supabase.rpc('task_badges', { p_tasks: ids }),
  ])
  if (children.error) throw children.error
  if (parents.error) throw parents.error
  // значки — украшение: если сводка не загрузилась, список всё равно показываем
  const badges = new Map((badgeRows.data ?? []).map((b) => [b.task_id, b]))

  const stats = new Map<string, { total: number; done: number }>()
  for (const c of children.data ?? []) {
    if (c.status_category === 'cancelled') continue // отменённые не считаются
    const s = stats.get(c.parent_id!) ?? { total: 0, done: 0 }
    s.total += 1
    if (c.status_category === 'done') s.done += 1
    stats.set(c.parent_id!, s)
  }
  const parentById = new Map((parents.data ?? []).map((p) => [p.id, p]))

  return rows.map((r) => ({
    ...r,
    parent: r.parent_id ? (parentById.get(r.parent_id) ?? null) : null,
    subtask_stats: stats.get(r.id) ?? { total: 0, done: 0 },
    badges: badges.get(r.id) ?? EMPTY_BADGES,
  }))
}

export interface TaskBadges {
  checklist_total: number
  checklist_done: number
  attachments: number
  comments: number
  documents: number
}
const EMPTY_BADGES: TaskBadges = { checklist_total: 0, checklist_done: 0, attachments: 0, comments: 0, documents: 0 }

export interface SubtaskRow {
  id: string
  key: string
  title: string
  status_category: StatusCategory
  status: { name: string; category: StatusCategory } | null
  assignee: { full_name: string } | null
}

export const subtasksQuery = (parentId: string) =>
  queryOptions({
    queryKey: ['subtasks', parentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, key, title, status_category, status:workflow_statuses!status_id(name, category), assignee:users!assignee_id(full_name)')
        .eq('parent_id', parentId)
        .is('deleted_at', null)
        .order('number')
      if (error) throw error
      return data as unknown as SubtaskRow[]
    },
  })

export interface TaskRow extends BaseTaskRow {
  parent: { id: string; key: string; title: string } | null
  subtask_stats: { total: number; done: number }
  badges: TaskBadges
}

interface BaseTaskRow {
  id: string
  parent_id: string | null
  key: string
  type: keyof typeof TASK_TYPE_LABELS
  title: string
  description: unknown
  workflow_id: string
  status_id: string
  status_category: StatusCategory
  priority: Priority
  due_date: string | null
  planned_start: string | null
  need_by_date: string | null
  estimate_hours: number | null
  spent_hours: number | null
  reporter_id: string
  assignee_id: string | null
  organization_id: string | null
  visibility: 'internal' | 'external'
  blocked_reason_code: string | null
  blocked_comment: string | null
  version: number
  created_at: string
  status: { id: string; name: string; category: StatusCategory } | null
  assignee: { id: string; full_name: string } | null
  reporter: { id: string; full_name: string } | null
  organization: { id: string; name: string } | null
  discipline_id: string | null
  discipline: { id: string; code: string; name: string; color: string | null } | null
  tags: string[]
  number: number
  location_id: string | null
  location_path: string | null
}

/** Статусы и переходы workflow по умолчанию (небольшой справочник — грузим целиком). */
export const workflowQuery = queryOptions({
  queryKey: ['workflow'],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const [statuses, transitions] = await Promise.all([
      supabase.from('workflow_statuses').select('id, workflow_id, code, name, category, sort').order('sort'),
      supabase
        .from('workflow_transitions')
        .select('id, workflow_id, from_status_id, to_status_id, name, required_permission, requires_reason, requires_comment'),
    ])
    if (statuses.error) throw statuses.error
    if (transitions.error) throw transitions.error
    return { statuses: statuses.data, transitions: transitions.data }
  },
})

export const reasonCodesQuery = queryOptions({
  queryKey: ['reason-codes'],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data, error } = await supabase
      .from('reason_codes')
      .select('code, name, category')
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return data
  },
})

export async function createTask(input: {
  projectId: string
  title: string
  assigneeId?: string | null
  dueDate?: string | null
  type?: keyof typeof TASK_TYPE_LABELS
  disciplineId?: string | null
  locationId?: string | null
  /** Родительская задача — создаётся подзадача (наследует направление, локацию и видимость) */
  parentId?: string | null
}): Promise<{ id: string; key: string }> {
  const { data, error } = await supabase.rpc('create_task', {
    p_project: input.projectId,
    p_title: input.title,
    p_type: input.type ?? 'task',
    p_assignee: input.assigneeId ?? undefined,
    p_due_date: input.dueDate ?? undefined,
    p_discipline: input.disciplineId ?? undefined,
    p_location: input.locationId ?? undefined,
    p_parent: input.parentId ?? undefined,
  })
  if (error) throw error
  return data
}

export class TransitionError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export const TRANSITION_ERROR_TEXT: Record<string, string> = {
  reason_required: tr('Выберите причину.'),
  comment_required: tr('Добавьте комментарий.'),
  transition_not_allowed: tr('Из этого статуса такой переход недоступен. Обновите страницу.'),
  task_not_found: tr('Задача не найдена или у вас нет к ней доступа.'),
  subtasks_open: tr('Сначала закройте все подзадачи.'),
}

export async function transitionTask(input: {
  taskId: string
  toStatusId: string
  reasonCode?: string
  comment?: string
}): Promise<void> {
  const { error } = await supabase.rpc('transition_task', {
    p_task: input.taskId,
    p_to_status: input.toStatusId,
    p_reason_code: input.reasonCode ?? undefined,
    p_comment: input.comment ?? undefined,
  })
  if (error) throw new TransitionError(error.code === '42501' ? 'forbidden' : error.message)
}

export type TaskPatch = Partial<{
  title: string
  /** Документ Tiptap (JSON); null — описание очищено */
  description: unknown
  priority: Priority
  assignee_id: string | null
  due_date: string | null
  planned_start: string | null
  need_by_date: string | null
  estimate_hours: number | null
  spent_hours: number | null
  discipline_id: string | null
  location_id: string | null
  tags: string[]
}>

export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  const { data, error } = await supabase.from('tasks').update(patch as never).eq('id', id).select('id')
  if (error) throw error
  // RLS молча отфильтровывает чужие строки — считаем это отказом
  if (!data || data.length === 0) throw new Error('forbidden')
}
