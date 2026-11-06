import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MoreHorizontal, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  archiveDiscipline,
  createDiscipline,
  DISCIPLINE_COLORS,
  disciplinesQuery,
  disciplineSubtreeIds,
  flattenDisciplines,
  updateDiscipline,
  type DisciplineNode,
} from '@/features/disciplines/api'
import { myPermissionsQuery, projectByCodeQuery, projectMembersQuery } from '@/features/projects/api'
import { DEFAULT_DISCIPLINE_STYLE, DISCIPLINE_STYLES } from '@/features/tasks/api'

// Паттерн «Список / Index»: дерево направлений проекта с руководителями
export const Route = createFileRoute('/_app/projects/$code/disciplines')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(disciplinesQuery(project.id)),
      queryClient.ensureQueryData(projectMembersQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем направления…')}</p>,
  component: DisciplinesPage,
})

const NONE = '__none__'

function errorText(e: unknown): string {
  const code = (e as { code?: string }).code
  if (code === '23505') return tr('Такой код уже есть на этом уровне. Выберите другой.')
  if (code === '42501') return tr('У вас нет права менять направления проекта.')
  if (code === '23514') return tr('Руководитель должен быть участником проекта, а направление — не вложено само в себя.')
  return tr('Не удалось сохранить. Попробуйте ещё раз.')
}

function DisciplinesPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(disciplinesQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canManage = permissions.includes('project.settings.manage')
  const nodes = useMemo(() => flattenDisciplines(rows), [rows])

  const [editing, setEditing] = useState<DisciplineNode | 'new-root' | { parent: DisciplineNode } | null>(null)
  const [archiving, setArchiving] = useState<DisciplineNode | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Направления этого проекта: у каждого есть руководитель, внутри можно создавать поднаправления. Руководитель автоматически следит за задачами своего направления.')}</p>
        {canManage && (
          <Button onClick={() => setEditing('new-root')}>
            <Plus />{tr('Добавить направление')}</Button>
        )}
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{tr('В проекте пока нет направлений.')}{canManage ? tr(' Добавьте первое, например «Конструктивные решения».') : ''}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border bg-card shadow-soft" aria-label={tr('Направления проекта')}>
          {nodes.map((n) => (
            <li key={n.id} className="flex min-h-14 items-center gap-3 border-b px-3 py-2 last:border-b-0">
              <div style={{ paddingLeft: n.depth * 20 }} className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className={`ident inline-flex h-7 min-w-10 shrink-0 items-center justify-center rounded px-1.5 font-medium ${
                    (n.color && DISCIPLINE_STYLES[n.color]) || DEFAULT_DISCIPLINE_STYLE
                  }`}
                >
                  {n.code}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm ${n.depth === 0 ? 'font-semibold' : 'font-medium'}`}>{n.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UserRound className="size-3" aria-hidden />
                    {n.lead?.full_name ?? tr('Руководитель не назначен')}
                  </span>
                </span>
              </div>
              {canManage && (
                <>
                  {/* Десктоп: кнопки действий */}
                  <div className="hidden shrink-0 gap-0.5 md:flex">
                    <Button size="icon" variant="ghost" title={tr('Добавить поднаправление')} aria-label={tr('Добавить поднаправление в {{name}}', { name: n.name })} onClick={() => setEditing({ parent: n })}>
                      <Plus />
                    </Button>
                    <Button size="icon" variant="ghost" title={tr('Изменить')} aria-label={tr('Изменить {{name}}', { name: n.name })} onClick={() => setEditing(n)}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={n.hasChildren ? tr('Сначала уберите поднаправления') : tr('Убрать')}
                      aria-label={tr('Убрать {{name}}', { name: n.name })}
                      disabled={n.hasChildren}
                      onClick={() => setArchiving(n)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {/* Телефон: одно меню, чтобы название не обрезалось */}
                  <div className="md:hidden">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label={tr('Действия: {{name}}', { name: n.name })}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuItem onSelect={() => setEditing({ parent: n })}>
                          <Plus />{tr('Добавить поднаправление')}</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing(n)}>
                          <Pencil />{tr('Изменить')}</DropdownMenuItem>
                        <DropdownMenuItem disabled={n.hasChildren} onSelect={() => setArchiving(n)}>
                          <Trash2 /> {n.hasChildren ? tr('Убрать (сначала поднаправления)') : tr('Убрать')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <DisciplineDialog projectId={p.id} nodes={nodes} state={editing} onClose={() => setEditing(null)} />}
      {archiving && <ArchiveDialog projectId={p.id} node={archiving} onClose={() => setArchiving(null)} />}
    </div>
  )
}

const schema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,12}$/, tr('Код — латиница и цифры, до 12 символов, например KR')),
  name: z.string().trim().min(2, tr('Укажите название')),
  color: z.string(),
  lead: z.string(),
  parent: z.string(),
})

function DisciplineDialog({
  projectId,
  nodes,
  state,
  onClose,
}: {
  projectId: string
  nodes: DisciplineNode[]
  state: DisciplineNode | 'new-root' | { parent: DisciplineNode }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const isEdit = typeof state === 'object' && 'id' in state
  const current = isEdit ? (state as DisciplineNode) : null
  const initialParent = isEdit ? (current!.parent_id ?? NONE) : state === 'new-root' ? NONE : (state as { parent: DisciplineNode }).parent.id

  // Нельзя перенести направление внутрь себя или своего потомка
  const forbidden = current ? new Set(disciplineSubtreeIds(nodes, current.id)) : new Set<string>()

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      code: current?.code ?? '',
      name: current?.name ?? '',
      color: current?.color ?? NONE,
      lead: current?.lead_user_id ?? NONE,
      parent: initialParent,
    },
  })

  const uniqueUsers = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.full_name)
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, currentLocale()))
  }, [members])

  const save = useMutation({
    mutationFn: async (v: z.output<typeof schema>) => {
      const color = v.color === NONE ? null : v.color
      const lead = v.lead === NONE ? null : v.lead
      const parent = v.parent === NONE ? null : v.parent
      if (current) {
        await updateDiscipline(current.id, { name: v.name, color, lead_user_id: lead, parent_id: parent })
      } else {
        await createDiscipline({
          projectId,
          parentId: parent,
          code: v.code,
          name: v.name,
          color,
          leadUserId: lead,
          sort: nodes.filter((n) => n.parent_id === parent).length + 1,
        })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['disciplines', projectId] })
      toast.success(current ? tr('Направление сохранено') : tr('Направление добавлено'))
      onClose()
    },
    onError: (e) => toast.error(errorText(e)),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current ? tr('Изменить «{{name}}»', { name: current.name }) : tr('Новое направление')}</DialogTitle>
          <DialogDescription>{tr('Руководитель получает уведомления о задачах направления и поднаправлений.')}</DialogDescription>
        </DialogHeader>
        <form id="discipline-form" onSubmit={handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-code">{tr('Код')}</Label>
              <Input id="d-code" disabled={!!current} aria-invalid={!!errors.code} placeholder="KR" {...register('code')} />
              {errors.code && <p className="col-span-2 text-sm text-destructive">{errors.code.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-name">{tr('Название')}</Label>
              <Input id="d-name" aria-invalid={!!errors.name} placeholder={tr('Конструктивные решения')} {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="d-lead">{tr('Руководитель направления')}</Label>
            <Controller
              control={control}
              name="lead"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="d-lead" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr('Не назначен')}</SelectItem>
                    {uniqueUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="d-parent">{tr('Входит в направление')}</Label>
            <Controller
              control={control}
              name="parent"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="d-parent" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr('Верхний уровень')}</SelectItem>
                    {nodes
                      .filter((n) => !forbidden.has(n.id))
                      .map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          <span style={{ paddingLeft: n.depth * 12 }}>
                            <span className="ident text-muted-foreground">{n.code}</span> {n.name}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Цвет метки')}</Label>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div role="radiogroup" aria-label={tr('Цвет метки')} className="flex flex-wrap gap-2">
                  {[NONE, ...DISCIPLINE_COLORS].map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={field.value === c}
                      aria-label={c === NONE ? tr('Без цвета') : tr('Цвет {{c}}', { c })}
                      onClick={() => field.onChange(c)}
                      className={`flex size-11 items-center justify-center rounded-md border-2 md:size-9 ${
                        field.value === c ? 'border-foreground' : 'border-transparent'
                      } ${c === NONE ? DEFAULT_DISCIPLINE_STYLE : DISCIPLINE_STYLES[c]}`}
                    >
                      <span className="ident font-medium">Aa</span>
                    </button>
                  ))}
                </div>
              )}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="discipline-form" disabled={save.isPending}>
            {current ? tr('Сохранить') : tr('Добавить направление')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveDialog({ projectId, node, onClose }: { projectId: string; node: DisciplineNode; onClose: () => void }) {
  const queryClient = useQueryClient()
  const archive = useMutation({
    mutationFn: () => archiveDiscipline(node.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['disciplines', projectId] })
      toast.success(tr('«{{name}}» убрано', { name: node.name }))
      onClose()
    },
    onError: (e) => toast.error(errorText(e)),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Убрать «')}{node.name}»?</DialogTitle>
          <DialogDescription>{tr('Направление исчезнет из выбора. У задач, которые к нему уже привязаны, привязка сохранится.')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button variant="destructive" disabled={archive.isPending} onClick={() => archive.mutate()}>{tr('Убрать «')}{node.name}»
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
