import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/auth-provider'
import { myPermissionsQuery } from '@/features/projects/api'
import {
  isOverdue,
  PRIORITY_LABELS,
  TRANSITION_ERROR_TEXT,
  TransitionError,
  transitionTask,
  workflowQuery,
  type StatusCategory,
  type TaskRow,
} from '@/features/tasks/api'
import { DisciplineBadge } from '@/features/tasks/status-badge'
import { SubtaskChips } from '@/features/tasks/subtask-chips'
import { TransitionDialog } from '@/features/tasks/transition-dialog'
import { availableTransitions, type AvailableTransition } from '@/features/tasks/transitions'

const COLUMN_ACCENT: Record<StatusCategory, string> = {
  backlog: 'border-t-muted-foreground/40',
  todo: 'border-t-slate-400',
  in_progress: 'border-t-blue-500',
  blocked: 'border-t-red-500',
  review: 'border-t-amber-500',
  done: 'border-t-green-500',
  cancelled: 'border-t-muted-foreground/40',
}

interface Props {
  tasks: TaskRow[]
  projectId: string
  code: string
  /** Параметры списка — для ссылок на карточку, чтобы не терять вид при закрытии */
  search: Record<string, unknown>
  /** Ключ запроса списка — по нему делаем оптимистичное обновление */
  queryKey: readonly unknown[]
}

export function TaskBoard({ tasks, projectId, code, search, queryKey }: Props) {
  const { session } = useAuth()
  const uid = session!.user.id
  const queryClient = useQueryClient()
  const { data: workflow } = useSuspenseQuery(workflowQuery)
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))

  const [activeId, setActiveId] = useState<string | null>(null)
  const [pending, setPending] = useState<{ task: TaskRow; transition: AvailableTransition } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // клик по карточке не должен начинать перетаскивание
    useSensor(KeyboardSensor),
  )

  const workflowId = tasks[0]?.workflow_id ?? workflow.statuses[0]?.workflow_id
  const columns = useMemo(
    () => workflow.statuses.filter((s) => s.workflow_id === workflowId).sort((a, b) => a.sort - b.sort),
    [workflow, workflowId],
  )

  const byStatus = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const t of tasks) map.set(t.status_id, [...(map.get(t.status_id) ?? []), t])
    return map
  }, [tasks])

  const active = tasks.find((t) => t.id === activeId) ?? null
  // Колонки, в которые можно перенести перетаскиваемую задачу
  const allowedTargets = useMemo(
    () => new Set(active ? availableTransitions(active, workflow, permissions, uid).map((t) => t.to_status_id) : []),
    [active, workflow, permissions, uid],
  )

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['task'] })
    await queryClient.invalidateQueries({ queryKey: ['activity'] })
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const task = tasks.find((t) => t.id === e.active.id)
    const toStatusId = e.over ? String(e.over.id) : null
    if (!task || !toStatusId || toStatusId === task.status_id) return

    const transition = availableTransitions(task, workflow, permissions, uid).find((t) => t.to_status_id === toStatusId)
    if (!transition) {
      toast.error(tr('Из этого статуса такой переход недоступен или нет прав.'))
      return
    }
    if (transition.requires_reason || transition.requires_comment) {
      setPending({ task, transition }) // причину и комментарий спрашиваем в диалоге
      return
    }

    // Оптимистично двигаем карточку, при ошибке возвращаем
    const to = columns.find((c) => c.id === toStatusId)!
    const previous = queryClient.getQueryData<TaskRow[]>(queryKey)
    queryClient.setQueryData<TaskRow[]>(queryKey, (old) =>
      (old ?? []).map((t) =>
        t.id === task.id
          ? { ...t, status_id: to.id, status_category: to.category as StatusCategory, status: { id: to.id, name: to.name, category: to.category as StatusCategory } }
          : t,
      ),
    )
    try {
      await transitionTask({ taskId: task.id, toStatusId })
    } catch (err) {
      queryClient.setQueryData(queryKey, previous)
      toast.error(TRANSITION_ERROR_TEXT[(err as TransitionError).code] ?? tr('Не удалось сменить статус.'))
    } finally {
      await refresh()
    }
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={(e) => void onDragEnd(e)}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              tr('Чтобы перенести задачу, нажмите пробел, стрелками выберите колонку и снова нажмите пробел. Esc — отмена.'),
          },
          announcements: {
            onDragStart: ({ active }) => tr('Задача {{key}} взята', { key: active.data.current?.key }),
            onDragOver: ({ over }) => (over ? tr('Над колонкой {{name}}', { name: over.data.current?.name }) : tr('Вне колонок')),
            onDragEnd: ({ over }) => (over ? tr('Задача перенесена в колонку {{name}}', { name: over.data.current?.name }) : tr('Перенос отменён')),
            onDragCancel: () => tr('Перенос отменён'),
          },
        }}
      >
        <div className="snap-x-mandatory -mx-4 grid auto-cols-[85%] grid-flow-col scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:auto-cols-[minmax(16rem,1fr)] sm:px-0">
          {columns.map((col) => (
            <Column
              key={col.id}
              id={col.id}
              name={col.name}
              category={col.category as StatusCategory}
              count={byStatus.get(col.id)?.length ?? 0}
              dimmed={!!active && col.id !== active.status_id && !allowedTargets.has(col.id)}
            >
              {(byStatus.get(col.id) ?? []).map((t) => (
                <Card key={t.id} task={t} code={code} search={search} />
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay>{active ? <CardBody task={active} /> : null}</DragOverlay>
      </DndContext>

      {pending && (
        <TransitionDialog
          name={pending.transition.name ?? tr('Сменить статус')}
          requiresReason={pending.transition.requires_reason}
          requiresComment={pending.transition.requires_comment}
          onClose={() => setPending(null)}
          onConfirm={async (reasonCode, comment) => {
            await transitionTask({
              taskId: pending.task.id,
              toStatusId: pending.transition.to_status_id,
              reasonCode,
              comment,
            })
            await refresh()
            setPending(null)
          }}
        />
      )}
    </>
  )
}

function Column({
  id,
  name,
  category,
  count,
  dimmed,
  children,
}: {
  id: string
  name: string
  category: StatusCategory
  count: number
  dimmed: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { name } })
  return (
    <section
      ref={setNodeRef}
      aria-label={tr('{{name}}, задач: {{count_}}', { name, count_: count })}
      aria-disabled={dimmed || undefined}
      className={`snap-start flex min-h-48 flex-col gap-2 rounded-lg border border-t-4 bg-muted/50 p-2 transition-opacity ${COLUMN_ACCENT[category]} ${
        dimmed ? 'opacity-40' : ''
      } ${isOver && !dimmed ? 'ring-2 ring-primary/50' : ''}`}
    >
      <h3 className="px-1 text-sm font-medium">
        {name} <span className="font-normal text-muted-foreground">· {count}</span>
      </h3>
      {children}
    </section>
  )
}

function Card({ task, code, search }: { task: TaskRow; code: string; search: Record<string, unknown> }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: task.id,
    data: { key: task.key },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab touch-none rounded-md active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
    >
      <Link
        to="/projects/$code/tasks/$key"
        params={{ code, key: task.key }}
        search={search as never}
        className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
        draggable={false}
      >
        <CardBody task={task} />
      </Link>
    </div>
  )
}

function CardBody({ task }: { task: TaskRow }) {
  const overdue = isOverdue(task)
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-sm shadow-xs">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="ident">{task.key}</span>
        <span>{PRIORITY_LABELS[task.priority]}</span>
      </div>
      <p className="line-clamp-3 font-medium">{task.title}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {task.discipline && (
          <DisciplineBadge code={task.discipline.code} name={task.discipline.name} color={task.discipline.color} />
        )}
        {task.location_path && (
          <span className="ident rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{task.location_path}</span>
        )}
        <SubtaskChips task={task} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{task.assignee?.full_name ?? tr('Без исполнителя')}</span>
        {task.due_date && (
          <span className={overdue ? 'font-medium text-destructive' : ''}>
            {new Date(task.due_date).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short' })}
            {overdue && tr(' · просрочена')}
          </span>
        )}
      </div>
    </div>
  )
}
