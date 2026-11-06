import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, CheckSquare, ChevronDown, ChevronUp, ChevronsUp, ClipboardCheck, HelpCircle, ListTodo, Minus, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { LocationSelect } from '@/features/locations/location-select'
import { projectMembersQuery } from '@/features/projects/api'
import { createTask, PRIORITY_LABELS, TASK_TYPE_LABELS, updateTask, type Priority } from '@/features/tasks/api'
import { DescriptionInput } from '@/features/tasks/description-editor'
import { tr } from '@/lib/tr'

const NONE = 'none'

type TaskType = keyof typeof TASK_TYPE_LABELS

/** Значок типа: цветной квадрат, как у типов в трекерах. */
const TYPE_ICONS: Record<TaskType, { icon: LucideIcon; tone: string }> = {
  task: { icon: CheckSquare, tone: 'bg-blue-600' },
  punch: { icon: ClipboardCheck, tone: 'bg-amber-600' },
  rfi: { icon: HelpCircle, tone: 'bg-violet-600' },
  action_item: { icon: ListTodo, tone: 'bg-emerald-600' },
  issue: { icon: AlertTriangle, tone: 'bg-red-600' },
  constraint: { icon: Ban, tone: 'bg-slate-600' },
}

const PRIORITY_ICONS: Record<Priority, { icon: LucideIcon; tone: string }> = {
  critical: { icon: ChevronsUp, tone: 'text-red-600' },
  high: { icon: ChevronUp, tone: 'text-orange-500' },
  normal: { icon: Minus, tone: 'text-amber-500' },
  low: { icon: ChevronDown, tone: 'text-blue-500' },
}

function TypeLabel({ type }: { type: TaskType }) {
  const { icon: Icon, tone } = TYPE_ICONS[type]
  return (
    <span className="flex items-center gap-2">
      <span className={`flex size-5 shrink-0 items-center justify-center rounded ${tone}`}>
        <Icon className="size-3.5 text-white" aria-hidden />
      </span>
      {TASK_TYPE_LABELS[type]}
    </span>
  )
}

function PriorityLabel({ priority }: { priority: Priority }) {
  const { icon: Icon, tone } = PRIORITY_ICONS[priority]
  return (
    <span className="flex items-center gap-2">
      <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden />
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

interface Props {
  projectId: string
  canAssign: boolean
  onClose: () => void
  /** Направление из активного фильтра списка */
  defaultDiscipline?: string
  /** Срок, например день, выбранный в календаре */
  defaultDue?: string
  defaultLocation?: string | null
  onCreated?: (key: string) => void
}

/**
 * Создание задачи одним окном в манере трекеров: одна колонка полей сверху вниз, обязательное помечено звёздочкой,
 * «Создать ещё одну» внизу слева — чтобы завести несколько задач подряд и не открывать окно заново.
 */
export function NewTaskDialog({ projectId, canAssign, onClose, defaultDiscipline, defaultDue, defaultLocation, onCreated }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const me = session?.user.id
  const { data: members } = useQuery({ ...projectMembersQuery(projectId), enabled: canAssign })
  const { data: disciplineRows } = useQuery(disciplinesQuery(projectId))
  const disciplines = flattenDisciplines(disciplineRows ?? [])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState<unknown>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [type, setType] = useState<TaskType>('task')
  const [priority, setPriority] = useState<Priority>('normal')
  const [assignee, setAssignee] = useState(NONE)
  const [start, setStart] = useState('')
  const [due, setDue] = useState(defaultDue ?? '')
  const [discipline, setDiscipline] = useState(defaultDiscipline ?? NONE)
  const [location, setLocation] = useState<string | null>(defaultLocation ?? null)
  const [another, setAnother] = useState(false)
  const [triedSubmit, setTriedSubmit] = useState(false)

  const needsLocation = type === 'punch' && !location
  const datesBad = !!start && !!due && due < start
  const meIsMember = !!me && (members ?? []).some((m) => m.user?.id === me)

  const create = useMutation({
    mutationFn: async () => {
      const created = await createTask({
        projectId,
        title: title.trim(),
        type,
        assigneeId: assignee === NONE ? null : assignee,
        dueDate: due || null,
        disciplineId: discipline === NONE ? null : discipline,
        locationId: location,
      })
      // описание, приоритет и начало create_task не принимает — дописываем сразу после создания
      const extra: Parameters<typeof updateTask>[1] = {}
      if (description) extra.description = description
      if (priority !== 'normal') extra.priority = priority
      if (start) extra.planned_start = start
      if (Object.keys(extra).length > 0) {
        try {
          await updateTask(created.id, extra)
        } catch {
          toast.warning(tr('Задача создана, но описание и приоритет не сохранились. Откройте задачу и заполните их.'))
        }
      }
      return created
    },
    onSuccess: async ({ key }) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      toast.success(tr('Задача {{key}} создана', { key }))
      onCreated?.(key)
      if (another) {
        // как в трекерах: тип, исполнитель, сроки и место остаются, очищаются название и описание
        setTitle('')
        setDescription(null)
        setEditorKey((k) => k + 1)
        setTriedSubmit(false)
        document.getElementById('nt-title')?.focus()
      } else onClose()
    },
    onError: () => toast.error(tr('Не удалось создать задачу. Проверьте права и попробуйте ещё раз.')),
  })

  const submit = () => {
    setTriedSubmit(true)
    if (!title.trim() || needsLocation || datesBad || create.isPending) return
    create.mutate()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="flex h-[min(52rem,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogHeader className="shrink-0 px-6 pt-5 pb-3">
            <DialogTitle className="text-xl">{tr('Создать задачу')}</DialogTitle>
            <DialogDescription>
              {tr('Поля, помеченные звёздочкой, обязательны.')} <span className="text-destructive">*</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-5">
            <Field label={tr('Тип задачи')} htmlFor="nt-type">
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger id="nt-type" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      <TypeLabel type={t} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="border-t" />

            <Field label={tr('Название')} htmlFor="nt-title" required>
              <Input id="nt-title" autoFocus value={title} maxLength={300} aria-invalid={triedSubmit && !title.trim()} onChange={(e) => setTitle(e.target.value)} placeholder={tr('Что нужно сделать')} />
              {triedSubmit && !title.trim() && <p className="text-sm text-destructive">{tr('Укажите название задачи')}</p>}
            </Field>

            <Field label={tr('Описание')}>
              <DescriptionInput key={editorKey} onChange={setDescription} />
            </Field>

            {canAssign && (
              <Field label={tr('Исполнитель')} htmlFor="nt-assignee">
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger id="nt-assignee" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr('Без исполнителя')}</SelectItem>
                    {(members ?? []).map((m) =>
                      m.user ? (
                        <SelectItem key={m.user.id} value={m.user.id}>
                          {m.user.full_name}
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
                {meIsMember && assignee !== me && (
                  <button type="button" onClick={() => setAssignee(me!)} className="w-fit text-sm text-primary underline-offset-2 hover:underline">
                    {tr('Назначить на меня')}
                  </button>
                )}
              </Field>
            )}

            <Field label={tr('Приоритет')} htmlFor="nt-priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger id="nt-priority" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as Priority[]).map((pr) => (
                    <SelectItem key={pr} value={pr}>
                      <PriorityLabel priority={pr} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={tr('Направление')} htmlFor="nt-discipline">
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger id="nt-discipline" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
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

            <Field label={tr('Локация')} required={type === 'punch'}>
              <LocationSelect
                projectId={projectId}
                value={location}
                onChange={setLocation}
                className={`w-full ${triedSubmit && needsLocation ? 'border-destructive' : ''}`}
                noneLabel={type === 'punch' ? tr('Выберите локацию') : tr('Без локации')}
              />
              {triedSubmit && needsLocation && <p className="text-sm text-destructive">{tr('У замечания должна быть локация — выберите её.')}</p>}
            </Field>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label={tr('Начало')} htmlFor="nt-start">
                <DatePicker id="nt-start" value={start} onChange={(v) => setStart(v)} />
              </Field>
              <Field label={tr('Срок')} htmlFor="nt-due">
                <DatePicker id="nt-due" value={due} min={start || undefined} aria-invalid={datesBad} onChange={(v) => setDue(v)} />
                {datesBad && <p className="text-sm text-destructive">{tr('Срок не может быть раньше начала')}</p>}
              </Field>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-6 py-3">
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={another} onChange={(e) => setAnother(e.target.checked)} />
              {tr('Создать ещё одну')}
            </label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
                {tr('Отмена')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? tr('Создаём…') : tr('Создать')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, htmlFor, required, children }: { label: string; htmlFor?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[13px] font-semibold text-muted-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      {children}
    </div>
  )
}
