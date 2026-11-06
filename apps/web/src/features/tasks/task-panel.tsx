import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { CornerDownRight, Link2, Maximize2 } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { useAuth } from '@/features/auth/auth-provider'
import { LocationSelect } from '@/features/locations/location-select'
import { WatchButton } from '@/features/notifications/watch-button'
import { myPermissionsQuery, projectMembersQuery } from '@/features/projects/api'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import {
  DEFAULT_TASK_SEARCH,
  PRIORITY_LABELS,
  reasonCodesQuery,
  TASK_TYPE_LABELS,
  TRANSITION_ERROR_TEXT,
  TransitionError,
  transitionTask,
  updateTask,
  workflowQuery,
  type Priority,
  type TaskPatch,
  type TaskRow,
} from '@/features/tasks/api'
import { EntityDocuments } from '@/features/documents/entity-documents'
import { TaskPlanLinks } from '@/features/plans/task-plan-links'
import { AttachmentsSection } from '@/features/tasks/attachments-section'
import { ChecklistsSection } from '@/features/tasks/checklists'
import { DescriptionEditor } from '@/features/tasks/description-editor'
import { StatusBadge } from '@/features/tasks/status-badge'
import { SubtasksSection } from '@/features/tasks/subtasks-section'
import { TransitionDialog } from '@/features/tasks/transition-dialog'
import { availableTransitions, type AvailableTransition } from '@/features/tasks/transitions'
import { copyText } from '@/lib/utils'

const NO_VALUE = 'none'

/** «Бетон, приёмка #2» → ['бетон', 'приёмка-2']: нижний регистр, без решёток и пробелов, до 10 штук. */
function parseTags(raw: string): string[] {
  const tags = raw
    .split(',')
    .map((t) => t.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
  return [...new Set(tags)].slice(0, 10)
}

const createdFmt = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' })

/**
 * Карточка задачи. В боковой панели и на отдельной странице устройство одно:
 * слева суть (описание, чек-листы, подзадачи, вложения, обсуждение), справа поля. На узком экране поля идут первыми.
 */
export function TaskPanel({ task, projectId, layout = 'sheet' }: { task: TaskRow; projectId: string; layout?: 'sheet' | 'page' }) {
  const { code } = useParams({ strict: false }) as { code: string }
  const { session } = useAuth()
  const uid = session!.user.id
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const { data: workflow } = useSuspenseQuery(workflowQuery)
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const { data: disciplineRows } = useQuery(disciplinesQuery(projectId))
  const disciplines = flattenDisciplines(disciplineRows ?? [])

  const isOwn = task.assignee_id === uid || task.reporter_id === uid
  const canEdit = permissions.includes('task.edit.any') || (permissions.includes('task.edit.own') && isOwn)
  const canAssign = canEdit && permissions.includes('task.assign')
  // Ответственный от подрядчика назначает только сотрудников своей организации (сервер проверяет это тоже)
  const me = members?.find((m) => m.user?.id === uid)
  const onlyOrgId = me?.role?.code === 'subcontractor_lead' ? (me.organization?.id ?? null) : null
  const assignable = (members ?? []).filter((m) => !onlyOrgId || m.organization?.id === onlyOrgId)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['task', task.key] })
    await queryClient.invalidateQueries({ queryKey: ['activity'] })
  }

  const patch = useMutation({
    mutationFn: (p: TaskPatch) => updateTask(task.id, p),
    onSuccess: refresh,
    onError: (e) =>
      toast.error(
        e.message === 'forbidden' || (e as { code?: string }).code === '42501'
          ? tr('У вас нет права на это изменение.')
          : tr('Не удалось сохранить. Попробуйте ещё раз.'),
      ),
  })

  // Название правится на месте; сохраняем по уходу из поля
  const [title, setTitle] = useState(task.title)
  useEffect(() => setTitle(task.title), [task.title])

  const transitions = availableTransitions(task, workflow, permissions, uid)
  const [pending, setPending] = useState<AvailableTransition | null>(null)

  const pageUrl = `${window.location.origin}/projects/${code}/task/${task.key}`

  return (
    <div className="@container flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="ident">{task.key}</span>
          <span>· {TASK_TYPE_LABELS[task.type]}</span>
          {task.parent && (
            <Link
              to="/projects/$code/tasks/$key"
              params={{ code, key: task.parent.key }}
              search={DEFAULT_TASK_SEARCH}
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:bg-muted"
              title={task.parent.title}
            >
              <CornerDownRight className="size-3" aria-hidden />{tr('подзадача')}{' '}<span className="ident">{task.parent.key}</span>
            </Link>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => ((await copyText(pageUrl)) ? toast.success(tr('Ссылка скопирована')) : toast.error(tr('Не удалось скопировать ссылку.')))}
            >
              <Link2 /> <span className="max-sm:sr-only">{tr('Ссылка')}</span>
            </Button>
            {layout === 'sheet' && (
              <Button asChild size="sm" variant="ghost">
                <Link to="/projects/$code/task/$key" params={{ code, key: task.key }} title={tr('Открыть задачу на отдельной странице')}>
                  <Maximize2 /> <span className="max-sm:sr-only">{tr('На страницу')}</span>
                </Link>
              </Button>
            )}
          </span>
        </div>
        <Input
          aria-label={tr('Название задачи')}
          className="h-auto border-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-input"
          value={title}
          disabled={!canEdit}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = title.trim()
            if (next && next !== task.title) patch.mutate({ title: next })
            else setTitle(task.title)
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {task.status && <StatusBadge name={task.status.name} category={task.status.category} />}
        <WatchButton entity={{ type: 'task', id: task.id }} />
        {transitions.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant="outline"
            onClick={() => {
              if (t.requires_reason || t.requires_comment) setPending(t)
              else
                void transitionTask({ taskId: task.id, toStatusId: t.to_status_id })
                  .then(refresh)
                  .catch((e: unknown) =>
                    toast.error(TRANSITION_ERROR_TEXT[(e as TransitionError).code] ?? tr('Не удалось сменить статус.')),
                  )
            }}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {task.status_category === 'blocked' && task.blocked_reason_code && (
        <BlockedNote code={task.blocked_reason_code} comment={task.blocked_comment} />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @2xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2" aria-label={tr('Описание')}>
            <h3 className="text-sm font-semibold">{tr('Описание')}</h3>
            <DescriptionEditor
              doc={task.description}
              canEdit={canEdit}
              saving={patch.isPending}
              onSave={async (doc) => {
                await patch.mutateAsync({ description: doc }).catch(() => undefined)
              }}
            />
          </section>

          <ChecklistsSection taskId={task.id} canEdit={canEdit} />

          <SubtasksSection task={task} projectId={projectId} canCreate={permissions.includes('task.create')} />

          <EntityDocuments entity={{ type: 'task', id: task.id }} projectId={projectId} code={code} title={tr('Документы по задаче')} />

          <TaskPlanLinks taskId={task.id} taskKey={task.key} code={code} />

          <AttachmentsSection
            entity={{ type: 'task', id: task.id }}
            projectId={projectId}
            canAdd={permissions.includes('comment.create')}
            canManage={canEdit}
          />

          <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем обсуждение…')}</p>}>
            <ActivityFeed entity={{ type: 'task', id: task.id }} projectId={projectId} />
          </Suspense>
        </div>

        <aside className="order-first @2xl:order-last" aria-label={tr('Поля задачи')}>
          <dl className="flex flex-col gap-3.5 rounded-lg border bg-card p-3.5 text-sm @2xl:sticky @2xl:top-0">
            <Field label={tr('Исполнитель')}>
              {canAssign ? (
                <Select value={task.assignee_id ?? NO_VALUE} onValueChange={(v) => patch.mutate({ assignee_id: v === NO_VALUE ? null : v })}>
                  <SelectTrigger aria-label={tr('Исполнитель')} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VALUE}>{tr('Без исполнителя')}</SelectItem>
                    {assignable.map((m) =>
                      m.user ? (
                        <SelectItem key={m.user.id} value={m.user.id}>
                          {m.user.full_name}
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
              ) : (
                (task.assignee?.full_name ?? '—')
              )}
            </Field>

            <Field label={tr('Приоритет')}>
              <Select value={task.priority} disabled={!canEdit} onValueChange={(v) => patch.mutate({ priority: v as Priority })}>
                <SelectTrigger aria-label={tr('Приоритет')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={tr('Начало')}>
                <DatePicker
                  aria-label={tr('Дата начала')}
                  disabled={!canEdit}
                  value={task.planned_start ?? ''}
                  onChange={(v) => patch.mutate({ planned_start: v || null })}
                />
              </Field>
              <Field label={tr('Срок')}>
                <DatePicker
                  aria-label={tr('Срок выполнения')}
                  disabled={!canEdit}
                  value={task.due_date ?? ''}
                  onChange={(v) => patch.mutate({ due_date: v || null })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={tr('Оценка, ч')}>
                <HoursInput label={tr('Оценка в часах')} value={task.estimate_hours} disabled={!canEdit} onCommit={(v) => patch.mutate({ estimate_hours: v })} />
              </Field>
              <Field label={tr('Затрачено, ч')}>
                <HoursInput label={tr('Затрачено часов')} value={task.spent_hours} disabled={!canEdit} onCommit={(v) => patch.mutate({ spent_hours: v })} />
              </Field>
            </div>

            <Field label={tr('Направление')}>
              <Select
                value={task.discipline_id ?? NO_VALUE}
                disabled={!canEdit}
                onValueChange={(v) => patch.mutate({ discipline_id: v === NO_VALUE ? null : v })}
              >
                <SelectTrigger aria-label={tr('Направление')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>{tr('Без направления')}</SelectItem>
                  {disciplines.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span style={{ paddingLeft: d.depth * 12 }}>
                        <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={tr('Локация')}>
              <LocationSelect
                projectId={projectId}
                value={task.location_id}
                disabled={!canEdit}
                onChange={(id) => {
                  // у замечания локация обязательна
                  if (id === null && task.type === 'punch') return toast.error(tr('У замечания должна быть локация.'))
                  patch.mutate({ location_id: id })
                }}
                className="w-full"
              />
            </Field>

            <Field label={tr('Теги')}>
              <Input
                aria-label={tr('Теги через запятую')}
                placeholder={tr('бетон, приёмка')}
                disabled={!canEdit}
                key={task.tags.join(',')}
                defaultValue={task.tags.join(', ')}
                onBlur={(e) => {
                  const next = parseTags(e.target.value)
                  if (next.join(',') !== task.tags.join(',')) patch.mutate({ tags: next })
                }}
              />
            </Field>

            <div className="grid gap-3 border-t pt-3 text-muted-foreground">
              <Field label={tr('Автор')}>{task.reporter?.full_name ?? '—'}</Field>
              {task.organization && <Field label={tr('Организация')}>{task.organization.name}</Field>}
              <Field label={tr('Создана')}>{createdFmt.format(new Date(task.created_at))}</Field>
            </div>
          </dl>
        </aside>
      </div>

      {pending && (
        <TransitionDialog
          name={pending.name ?? tr('Сменить статус')}
          requiresReason={pending.requires_reason}
          requiresComment={pending.requires_comment}
          onClose={() => setPending(null)}
          onConfirm={async (reasonCode, comment) => {
            await transitionTask({ taskId: task.id, toStatusId: pending.to_status_id, reasonCode, comment })
            await refresh()
            setPending(null)
          }}
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/** Часы: число с точностью до сотых, сохраняется по уходу из поля. */
function HoursInput({ label, value, disabled, onCommit }: { label: string; value: number | null; disabled: boolean; onCommit: (v: number | null) => void }) {
  return (
    <Input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min="0"
      step="0.5"
      disabled={disabled}
      key={String(value)}
      defaultValue={value ?? ''}
      onBlur={(e) => {
        const raw = e.target.value.trim()
        const next = raw === '' ? null : Math.max(0, Number(raw.replace(',', '.')))
        if (next !== null && Number.isNaN(next)) return
        if (next !== (value ?? null)) onCommit(next)
      }}
    />
  )
}

function BlockedNote({ code, comment }: { code: string; comment: string | null }) {
  const { data: reasons } = useQuery(reasonCodesQuery)
  const name = reasons?.find((r) => r.code === code)?.name ?? code
  return (
    <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
      <span className="font-medium">{tr('Причина блокировки:')}{' '}{name}.</span> {comment}
    </p>
  )
}
