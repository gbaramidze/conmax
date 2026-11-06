import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, CalendarDays, ClipboardList, Columns3, List as ListIcon, Plus, SlidersHorizontal, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/auth-provider'
import { ExportButton } from '@/features/export/export-button'
import { isoToDate } from '@/features/export/xlsx'
import {
  disciplinesQuery,
  disciplineSubtreeIds,
  flattenDisciplines,
  type DisciplineNode,
  type DisciplineRow,
} from '@/features/disciplines/api'
import { flattenTree, locationLabel, locationsQuery, type LocationNode } from '@/features/locations/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { TaskBoard } from '@/features/tasks/board'
import { BulkBar } from '@/features/tasks/bulk-bar'
import { TemplateDialog } from '@/features/tasks/template-dialog'
import { groupTasks } from '@/features/tasks/grouping'
import { NewTaskDialog } from '@/features/tasks/new-task-dialog'
import { DisciplineBadge, StatusBadge } from '@/features/tasks/status-badge'
import { SubtaskChips } from '@/features/tasks/subtask-chips'
import {
  isOverdue,
  PRIORITY_LABELS,
  reasonCodesQuery,
  TASK_FILTER_LABELS,
  TASK_FILTERS,
  TASK_GROUP_LABELS,
  TASK_GROUPS,
  TASK_SORT_LABELS,
  TASK_SORTS,
  TASK_TYPE_LABELS,
  tasksQuery,
  workflowQuery,
  type TaskListParams,
  type TaskRow,
} from '@/features/tasks/api'
import { supabase } from '@/lib/supabase'

// Всё состояние списка живёт в URL: ссылкой на отфильтрованный список можно поделиться
const searchSchema = z.object({
  filter: z.enum(TASK_FILTERS).catch('open'),
  discipline: z.string().catch('any'), // 'any' | 'none' | id дисциплины
  location: z.string().catch('any'), // 'any' | 'none' | путь узла (K2.S1) — включая вложенные
  sort: z.enum(TASK_SORTS).catch('created'),
  dir: z.enum(['asc', 'desc']).catch('desc'),
  group: z.enum(TASK_GROUPS).catch('none'),
  view: z.enum(['list', 'board']).catch('list'), // календарь вынесен в отдельный раздел проекта
  tag: z.string().optional().catch(undefined),
  // «Создать» в верхней панели: открыть нужную форму и убрать параметр из адреса
  create: z.enum(['task', 'template']).optional().catch(undefined),
})
type Search = z.infer<typeof searchSchema>

/** Фильтр по направлению включает поднаправления, поэтому нужно дерево направлений проекта. */
function toParams(s: Search, disciplines: DisciplineRow[]): TaskListParams {
  const byDiscipline = s.discipline !== 'any' && s.discipline !== 'none'
  return {
    filter: s.filter,
    discipline: s.discipline,
    disciplineIds: byDiscipline ? disciplineSubtreeIds(disciplines, s.discipline) : undefined,
    location: s.location,
    sort: s.sort,
    dir: s.dir,
    tag: s.tag,
  }
}

export const Route = createFileRoute('/_app/projects/$code/tasks')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ context: { queryClient, auth }, params, deps }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    const disciplines = await queryClient.ensureQueryData(disciplinesQuery(project.id))
    await Promise.all([
      queryClient.ensureQueryData(tasksQuery(project.id, toParams(deps.search, disciplines), auth.session!.user.id)),
      queryClient.ensureQueryData(workflowQuery),
      queryClient.ensureQueryData(reasonCodesQuery),
      queryClient.ensureQueryData(locationsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем задачи…')}</p>,
  component: TasksPage,
})

const dateFormat = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })

/** Сколько настроек отличается от значений по умолчанию — показывается на кнопке «Фильтры». */
function activeExtras(s: Search): number {
  return (
    (s.discipline !== 'any' ? 1 : 0) +
    (s.location !== 'any' ? 1 : 0) +
    (s.group !== 'none' ? 1 : 0) +
    (s.sort !== 'created' || s.dir !== 'desc' ? 1 : 0) +
    (s.tag ? 1 : 0)
  )
}

function TasksPage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session!.user.id

  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(p.id))
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])
  const listParams = toParams(search, disciplineRows)
  const { data: tasks } = useSuspenseQuery(tasksQuery(p.id, listParams, userId))
  const { data: locationRows } = useSuspenseQuery(locationsQuery(p.id))

  const locationNodes = useMemo(() => flattenTree(locationRows), [locationRows])
  const buckets = useMemo(
    () => groupTasks(tasks, search.group, (path) => locationLabel(path, locationRows)),
    [tasks, search.group, locationRows],
  )
  const setSearch = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  useEffect(() => {
    if (!search.create) return
    if (search.create === 'template') setTemplateOpen(true)
    // с задержкой: закрывающееся меню «Создать» возвращает фокус на свою кнопку и перехватило бы его
    else setTimeout(() => setCreateOpen(true), 250)
    void navigate({ search: (prev) => ({ ...prev, create: undefined }), replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.create])
  // выбор для массовых действий; при смене списка (фильтры, обновление) остаются только ещё показанные задачи
  const [selectedRaw, setSelected] = useState<Set<string>>(new Set())
  const selected = useMemo(() => new Set([...selectedRaw].filter((id) => tasks.some((t) => t.id === id))), [selectedRaw, tasks])

  // Realtime: чужие изменения задач обновляют список
  useEffect(() => {
    const channel = supabase
      .channel(`tasks:${p.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${p.id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['tasks', p.id] })
        void queryClient.invalidateQueries({ queryKey: ['task'] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [p.id, queryClient])

  const canCreate = permissions.includes('task.create')
  const canAssign = permissions.includes('task.assign')
  const defaultDiscipline = search.discipline !== 'any' && search.discipline !== 'none' ? search.discipline : undefined
  const extras = activeExtras(search)

  const controlProps = { search, setSearch, disciplines, locationNodes }

  return (
    <div className="flex flex-col gap-4">
      {/* Десктоп: кнопка над списком. Телефон: кнопка «+» внизу справа. Обе открывают одно окно создания */}
      {canCreate && (
        <div className="hidden md:block">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {tr('Новая задача')}
          </Button>
        </div>
      )}

      {/* Фильтры-чипы: на телефоне одна прокручиваемая строка вместо переноса на 3 строки */}
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label={tr('Фильтр задач')}
          className="-mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {TASK_FILTERS.map((f) => (
            <Link
              key={f}
              to="/projects/$code/tasks"
              params={{ code }}
              search={{ ...search, filter: f }}
              aria-pressed={search.filter === f}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm transition-colors md:min-h-8 md:px-3 ${
                search.filter === f
                  ? 'border-primary bg-primary font-medium text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {TASK_FILTER_LABELS[f]}
            </Link>
          ))}
        </div>

        <div role="group" aria-label={tr('Вид')} className="flex shrink-0 overflow-hidden rounded-lg border bg-card">
          <Button
            variant={search.view === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            className="rounded-none"
            aria-pressed={search.view === 'list'}
            aria-label={tr('Список')}
            title={tr('Список')}
            onClick={() => setSearch({ view: 'list' })}
          >
            <ListIcon />
          </Button>
          <Button
            variant={search.view === 'board' ? 'secondary' : 'ghost'}
            size="icon"
            className="rounded-none border-l"
            aria-pressed={search.view === 'board'}
            aria-label={tr('Доска')}
            title={tr('Доска')}
            onClick={() => setSearch({ view: 'board' })}
          >
            <Columns3 />
          </Button>
          <Button asChild variant="ghost" size="icon" className="rounded-none border-l" aria-label={tr('Календарь')} title={tr('Календарь проекта: сроки задач, совещания, график')}>
            <Link to="/projects/$code/calendar" params={{ code }} search={{ types: 'task_due,task_need' }}>
              <CalendarDays />
            </Link>
          </Button>
        </div>

        {canCreate && (
          <Button variant="outline" className="hidden shrink-0 md:inline-flex" onClick={() => setTemplateOpen(true)} title={tr('Создать набор типовых задач на несколько мест')}>
            <ClipboardList />{tr('Из шаблона')}</Button>
        )}

        <span className="hidden shrink-0 md:block">
          <ExportButton
            fileName={tr('Задачи {{code}}', { code: p.code })}
            disabled={tasks.length === 0}
            build={() => ({
              name: tr('Задачи'),
              headers: [tr('Ключ'), tr('Название'), tr('Статус'), tr('Приоритет'), tr('Исполнитель'), tr('Автор'), tr('Организация'), tr('Направление'), tr('Место'), tr('Начало'), tr('Срок'), tr('Теги'), tr('Подзадачи'), tr('Чек-лист'), tr('Вложений'), tr('Создана')],
              rows: tasks.map((t) => [
                t.key,
                t.title,
                t.status?.name ?? '',
                PRIORITY_LABELS[t.priority],
                t.assignee?.full_name ?? '',
                t.reporter?.full_name ?? '',
                t.organization?.name ?? '',
                t.discipline ? `${t.discipline.code} ${t.discipline.name}` : '',
                t.location_path ? locationLabel(t.location_path, locationRows) : '',
                isoToDate(t.planned_start),
                isoToDate(t.due_date),
                t.tags.join(', '),
                t.subtask_stats.total ? `${t.subtask_stats.done}/${t.subtask_stats.total}` : '',
                t.badges.checklist_total ? `${t.badges.checklist_done}/${t.badges.checklist_total}` : '',
                t.badges.attachments,
                isoToDate(t.created_at),
              ]),
            })}
          />
        </span>

        <Button variant="outline" size="icon" className="relative shrink-0 md:hidden" aria-label={tr('Фильтры')} onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal />
          {extras > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-signal text-xs font-semibold text-signal-foreground">
              {extras}
            </span>
          )}
        </Button>
      </div>

      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <FilterControls layout="inline" {...controlProps} />
      </div>

      {search.view === 'board' ? (
        <TaskBoard
          tasks={tasks}
          projectId={p.id}
          code={code}
          search={search}
          queryKey={tasksQuery(p.id, listParams, userId).queryKey}
        />
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {search.filter === 'open' && search.discipline === 'any' && search.location === 'any' && !search.tag
            ? tr('Задач пока нет. Введите название в поле выше и нажмите Enter.')
            : tr('По этим условиям ничего не найдено. Ослабьте фильтры: «Открытые», «Все дисциплины», «Вся площадка».')}
        </div>
      ) : (
        <>
          {/* Телефон: карточки */}
          <div className="flex flex-col gap-4 md:hidden">
            {buckets.map((b) => (
              <section key={b.id} className="flex flex-col gap-2">
                {search.group !== 'none' && (
                  <h2 className="px-1 text-sm font-medium">
                    {b.label} <span className="font-normal text-muted-foreground">{b.tasks.length}</span>
                  </h2>
                )}
                <ul className="flex flex-col gap-2">
                  {b.tasks.map((t) => (
                    <li key={t.id}>
                      <TaskCardRow task={t} code={code} search={search} locationRows={locationRows} onTag={(tag) => setSearch({ tag })} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Планшет и десктоп: таблица в панели */}
          <div className="hidden overflow-hidden rounded-lg border bg-card shadow-soft md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-10 pr-0">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={tr('Выбрать все задачи на экране')}
                      checked={tasks.length > 0 && selected.size === tasks.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.size > 0 && selected.size < tasks.length
                      }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(tasks.map((x) => x.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead className="w-28">{tr('Ключ')}</TableHead>
                  <TableHead>{tr('Название')}</TableHead>
                  <TableHead>{tr('Статус')}</TableHead>
                  <TableHead>{tr('Исполнитель')}</TableHead>
                  <TableHead>{tr('Срок')}</TableHead>
                  <TableHead>{tr('Приоритет')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((b) => (
                  <Fragment key={b.id}>
                    {search.group !== 'none' && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={7} className="py-2 text-sm font-medium">
                          {b.label} <span className="font-normal text-muted-foreground">{b.tasks.length}</span>
                        </TableCell>
                      </TableRow>
                    )}
                    {b.tasks.map((t) => (
                      <TableRow key={t.id} data-state={selected.has(t.id) ? 'selected' : undefined}>
                        <TableCell className="relative z-10 w-10 pr-0">
                          <input
                            type="checkbox"
                            className="size-4"
                            aria-label={tr('Выбрать задачу {{key}}', { key: t.key })}
                            checked={selected.has(t.id)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(t.id)
                                else next.delete(t.id)
                                return next
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="ident text-muted-foreground">{t.key}</TableCell>
                        <TableCell className="max-w-md whitespace-normal">
                          <div className="flex flex-wrap items-center gap-2">
                            {t.type !== 'task' && (
                              <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{TASK_TYPE_LABELS[t.type]}</span>
                            )}
                            {t.discipline && <DisciplineBadge code={t.discipline.code} name={t.discipline.name} color={t.discipline.color} />}
                            <SubtaskChips task={t} />
                            <Link
                              to="/projects/$code/tasks/$key"
                              params={{ code, key: t.key }}
                              search={search}
                              className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-offset-[-2px]"
                            >
                              {t.title}
                            </Link>
                            {t.location_path && (
                              <span
                                className="ident rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                                title={locationLabel(t.location_path, locationRows)}
                              >
                                {t.location_path}
                              </span>
                            )}
                            {t.tags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                className="relative z-10 rounded-full border px-1.5 text-xs text-muted-foreground hover:bg-accent"
                                onClick={() => setSearch({ tag })}
                                title={tr('Показать задачи с тегом {{tag}}', { tag })}
                              >
                                #{tag}
                              </button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>{t.status && <StatusBadge name={t.status.name} category={t.status.category} />}</TableCell>
                        <TableCell className="text-muted-foreground">{t.assignee?.full_name ?? '—'}</TableCell>
                        <TableCell className={isOverdue(t) ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                          {t.due_date ? dateFormat.format(new Date(t.due_date)) : '—'}
                          {isOverdue(t) && tr(' · просрочена')}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{PRIORITY_LABELS[t.priority]}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {selected.size > 0 && (
            <div className="hidden md:block">
              <BulkBar
                projectId={p.id}
                selected={tasks.filter((x) => selected.has(x.id))}
                canAssign={canAssign}
                disciplineRows={disciplineRows}
                onClear={() => setSelected(new Set())}
              />
            </div>
          )}
        </>
      )}

      {templateOpen && <TemplateDialog projectId={p.id} onClose={() => setTemplateOpen(false)} />}

      {/* Телефон: создание и фильтры в нижних панелях */}
      {canCreate && (
        <Button
          size="icon-lg"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 size-14 rounded-full shadow-lg md:hidden"
          aria-label={tr('Создать задачу')}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-6" />
        </Button>
      )}

      {createOpen && <NewTaskDialog projectId={p.id} canAssign={canAssign} defaultDiscipline={defaultDiscipline} onClose={() => setCreateOpen(false)} />}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto rounded-t-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:hidden">
          <SheetHeader className="p-0">
            <SheetTitle>{tr('Фильтры')}</SheetTitle>
            <SheetDescription>{tr('Дисциплина, локация, группировка и порядок.')}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4">
            <FilterControls layout="stacked" {...controlProps} />
          </div>
          <Button size="lg" onClick={() => setFiltersOpen(false)}>{tr('Показать задач:')}{' '}{tasks.length}
          </Button>
        </SheetContent>
      </Sheet>

      <Outlet />
    </div>
  )
}

/** Карточка задачи в списке на телефоне: вся карточка нажимается. */
function TaskCardRow({
  task: t,
  code,
  search,
  locationRows,
  onTag,
}: {
  task: TaskRow
  code: string
  search: Search
  locationRows: Parameters<typeof locationLabel>[1]
  onTag: (tag: string) => void
}) {
  const overdue = isOverdue(t)
  return (
    <div className="relative flex flex-col gap-2 rounded-lg border bg-card p-3.5 shadow-soft active:bg-muted">
      <div className="flex items-center justify-between gap-2">
        <span className="ident text-muted-foreground">{t.key}</span>
        {t.status && <StatusBadge name={t.status.name} category={t.status.category} />}
      </div>
      <Link
        to="/projects/$code/tasks/$key"
        params={{ code, key: t.key }}
        search={search}
        className="line-clamp-3 font-medium after:absolute after:inset-0 after:rounded-lg"
      >
        {t.title}
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {t.type !== 'task' && <span className="rounded border px-1.5 py-0.5 text-muted-foreground">{TASK_TYPE_LABELS[t.type]}</span>}
        {t.discipline && <DisciplineBadge code={t.discipline.code} name={t.discipline.name} color={t.discipline.color} />}
                            <SubtaskChips task={t} />
        {t.location_path && (
          <span className="ident rounded bg-muted px-1.5 py-0.5 text-muted-foreground" title={locationLabel(t.location_path, locationRows)}>
            {t.location_path}
          </span>
        )}
        {t.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onTag(tag)}
            className="relative z-10 rounded-full border px-2 py-1 text-muted-foreground"
          >
            #{tag}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="truncate">{t.assignee?.full_name ?? tr('Без исполнителя')}</span>
        {t.due_date && (
          <span className={`shrink-0 ${overdue ? 'font-medium text-destructive' : ''}`}>
            {dateFormat.format(new Date(t.due_date))}
            {overdue && tr(' · просрочена')}
          </span>
        )}
      </div>
    </div>
  )
}

/** Дисциплина, локация, группировка, сортировка, тег. inline — в одну строку; stacked — вертикально с подписями (нижняя панель). */
function FilterControls({
  layout,
  search,
  setSearch,
  disciplines,
  locationNodes,
}: {
  layout: 'inline' | 'stacked'
  search: Search
  setSearch: (patch: Partial<Search>) => void
  disciplines: DisciplineNode[]
  locationNodes: LocationNode[]
}) {
  const stacked = layout === 'stacked'
  const size = stacked ? 'default' : 'sm'
  const width = (w: string) => (stacked ? 'w-full' : w)
  const field = (label: string, id: string, node: React.ReactNode) =>
    stacked ? (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{label}</Label>
        {node}
      </div>
    ) : (
      node
    )

  return (
    <>
      {field(
        tr('Дисциплина'),
        'f-discipline',
        <Select value={search.discipline} onValueChange={(v) => setSearch({ discipline: v })}>
          <SelectTrigger id="f-discipline" size={size} aria-label={tr('Дисциплина')} className={width('w-52')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{tr('Все дисциплины')}</SelectItem>
            <SelectItem value="none">{tr('Без дисциплины')}</SelectItem>
            {disciplines.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <span style={{ paddingLeft: d.depth * 12 }}>
                  <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}

      {field(
        tr('Локация'),
        'f-location',
        <Select value={search.location} onValueChange={(v) => setSearch({ location: v })}>
          <SelectTrigger id="f-location" size={size} aria-label={tr('Локация')} className={width('w-52')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="any">{tr('Вся площадка')}</SelectItem>
            <SelectItem value="none">{tr('Без локации')}</SelectItem>
            {locationNodes.map((n) => (
              <SelectItem key={n.id} value={n.path}>
                <span style={{ paddingLeft: n.depth * 12 }}>
                  <span className="ident text-muted-foreground">{n.code}</span> {n.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}

      {field(
        tr('Группировка'),
        'f-group',
        <Select value={search.group} onValueChange={(v) => setSearch({ group: v as Search['group'] })}>
          <SelectTrigger id="f-group" size={size} aria-label={tr('Группировка')} className={width('w-48')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {TASK_GROUP_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}

      {field(
        tr('Сортировка'),
        'f-sort',
        <div className="flex items-center gap-1">
          <Select value={search.sort} onValueChange={(v) => setSearch({ sort: v as Search['sort'] })}>
            <SelectTrigger id="f-sort" size={size} aria-label={tr('Сортировка')} className={stacked ? 'min-w-0 flex-1' : 'w-48'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {TASK_SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            aria-label={search.dir === 'asc' ? tr('По возрастанию. Переключить на убывание') : tr('По убыванию. Переключить на возрастание')}
            title={search.dir === 'asc' ? tr('По возрастанию') : tr('По убыванию')}
            onClick={() => setSearch({ dir: search.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {search.dir === 'asc' ? <ArrowUp /> : <ArrowDown />}
          </Button>
        </div>,
      )}

      {search.tag && (
        <Button size="sm" variant="secondary" onClick={() => setSearch({ tag: undefined })} aria-label={tr('Убрать фильтр по тегу {{tag}}', { tag: search.tag })}>
          #{search.tag} <X />
        </Button>
      )}
    </>
  )
}
