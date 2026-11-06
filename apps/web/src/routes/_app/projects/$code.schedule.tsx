import { tr } from '@/lib/tr'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CalendarCheck, ChevronsDownUp, ChevronsUpDown, Flag, FolderPlus, Layers, Plus, RefreshCw, Route as RouteIcon, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { disciplinesQuery } from '@/features/disciplines/api'
import { ExportButton } from '@/features/export/export-button'
import { locationsQuery } from '@/features/locations/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { ActivityPanel } from '@/features/schedule/activity-panel'
import {
  activitiesQuery,
  addLink,
  baselineActivitiesQuery,
  baselinesQuery,
  createActivity,
  createBaseline,
  generateByLocations,
  KIND_LABELS,
  LINK_SHORT,
  linksQuery,
  recalculateSchedule,
  removeLink,
  scheduleErrorText,
  updateActivity,
  updateLink,
  type Activity,
  type ActivityKind,
  type ActivityPatch,
} from '@/features/schedule/api'
import { BaselineDialog, GenerateDialog, NewActivityDialog } from '@/features/schedule/dialogs'
import { Gantt } from '@/features/schedule/gantt'
import { buildRows, calendarFromSettings, dayOf, fmtDate, groupIds, makeScale, todayDay, type Zoom } from '@/features/schedule/model'

// Паттерн «Gantt»: таблица работ и шкала времени; расчёт критического пути и базовый план
export const Route = createFileRoute('/_app/projects/$code/schedule')({
  validateSearch: z.object({ create: z.enum(['task', 'generate']).optional().catch(undefined) }), // из «Создать» в верхней панели
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(activitiesQuery(project.id)),
      queryClient.ensureQueryData(linksQuery(project.id)),
      queryClient.ensureQueryData(baselinesQuery(project.id)),
      queryClient.ensureQueryData(disciplinesQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем график…')}</p>,
  component: SchedulePage,
})

const NO_BASELINE = '__none__'
const ZOOMS: [Zoom, string][] = [
  ['day', tr('Дни')],
  ['week', tr('Недели')],
  ['month', tr('Месяцы')],
]

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* хранилище недоступно — настройка просмотра просто не запомнится */
  }
}

function SchedulePage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: activities } = useSuspenseQuery(activitiesQuery(p.id))
  const { data: links } = useSuspenseQuery(linksQuery(p.id))
  const { data: baselines } = useSuspenseQuery(baselinesQuery(p.id))
  const { data: disciplines } = useSuspenseQuery(disciplinesQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canEdit = permissions.includes('schedule.edit')
  const canBaseline = permissions.includes('baseline.create')

  const zoomKey = `schedule-zoom:${p.id}`
  const collapsedKey = `schedule-collapsed:${p.id}`
  const [zoom, setZoomState] = useState<Zoom>(() => readStored<Zoom>(zoomKey, 'week'))
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => new Set(readStored<string[]>(collapsedKey, [])))
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [baselineId, setBaselineId] = useState<string>(NO_BASELINE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ type: 'new'; kind: ActivityKind } | { type: 'generate' } | { type: 'baseline' } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (search.create && canEdit) setDialog(search.create === 'generate' ? { type: 'generate' } : { type: 'new', kind: 'task' })
    if (search.create) void navigate({ search: {}, replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.create])

  const setZoom = (z: Zoom) => {
    setZoomState(z)
    store(zoomKey, z)
  }
  const setCollapsed = (next: Set<string>) => {
    setCollapsedState(next)
    store(collapsedKey, [...next])
  }
  const toggle = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
  }

  const calendar = useMemo(() => calendarFromSettings(p.settings), [p.settings])
  const rows = useMemo(() => buildRows(activities, collapsed), [activities, collapsed])
  const { data: baselineMap } = useQuery(baselineActivitiesQuery(baselineId === NO_BASELINE ? null : baselineId))
  const baselineDays = useMemo(() => {
    const out: number[] = []
    for (const b of baselineMap?.values() ?? []) {
      if (b.start_date) out.push(dayOf(b.start_date))
      if (b.finish_date) out.push(dayOf(b.finish_date))
    }
    return out
  }, [baselineMap])
  const hasDates = activities.some((a) => a.start_date)
  const scale = useMemo(() => makeScale(activities.filter((a) => a.start_date), zoom, baselineDays), [activities, zoom, baselineDays])

  const selected = activities.find((a) => a.id === selectedId) ?? null
  const groups = useMemo(() => activities.filter((a) => a.kind === 'summary'), [activities])

  const stats = useMemo(() => {
    const work = activities.filter((a) => a.kind !== 'summary')
    const finish = work.reduce<string | null>((m, a) => (a.finish_date && (!m || a.finish_date > m) ? a.finish_date : m), null)
    const start = work.reduce<string | null>((m, a) => (a.start_date && (!m || a.start_date < m) ? a.start_date : m), null)
    const critical = work.filter((a) => a.is_critical).length
    const totalDur = work.reduce((s, a) => s + Math.max(a.duration_days, 1), 0)
    const done = totalDur > 0 ? work.reduce((s, a) => s + a.percent_complete * Math.max(a.duration_days, 1), 0) / totalDur : 0
    const late = work.filter((a) => a.finish_date && !a.actual_finish && dayOf(a.finish_date) < todayDay() && a.percent_complete < 100).length
    return { work: work.length, finish, start, critical, done, late }
  }, [activities])

  const refresh = useCallback(
    () => Promise.all([queryClient.invalidateQueries({ queryKey: ['schedule'] }), queryClient.invalidateQueries({ queryKey: ['activity'] })]),
    [queryClient],
  )

  /** Выполняет изменение, пересчитывает график и обновляет экран; ошибку показывает понятным текстом. */
  const run = useCallback(
    async (job: () => Promise<unknown>, fallback: string, ok?: string, recalc = true) => {
      setBusy(true)
      try {
        await job()
        if (recalc) await recalculateSchedule(p.id)
        await refresh()
        if (ok) toast.success(ok)
        return true
      } catch (e) {
        // если связь или правка уже записаны, а пересчёт упал, график всё равно надо перерисовать
        await refresh()
        toast.error(scheduleErrorText(e, fallback))
        return false
      } finally {
        setBusy(false)
      }
    },
    [p.id, refresh],
  )

  const patch = (id: string, change: ActivityPatch) => run(() => updateActivity(id, change), tr('Не удалось сохранить изменение.'))

  const nextSort = (parentId: string | null) => Math.max(0, ...activities.filter((a) => a.parent_id === parentId).map((a) => a.sort)) + 10

  async function remove(a: Activity) {
    const byParent = new Map<string, string[]>()
    for (const x of activities) if (x.parent_id) byParent.set(x.parent_id, [...(byParent.get(x.parent_id) ?? []), x.id])
    const ids: string[] = []
    const walk = (id: string) => {
      for (const c of byParent.get(id) ?? []) walk(c)
      ids.push(id)
    }
    walk(a.id)
    const stamp = new Date().toISOString()
    const ok = await run(async () => {
      for (const id of ids) await updateActivity(id, { deleted_at: stamp })
    }, tr('Не удалось удалить.'), ids.length > 1 ? tr('Удалено работ: {{length}}', { length: ids.length }) : tr('Работа удалена'))
    if (ok) setSelectedId(null)
  }

  const exportRows = () => {
    const byId = new Map(activities.map((a) => [a.id, a]))
    return buildRows(activities, new Set()).map((r) => {
      const a = r.a
      const preds = links
        .filter((l) => l.successor_id === a.id)
        .map((l) => `${byId.get(l.predecessor_id)?.name ?? '?'} (${LINK_SHORT[l.type]}${l.lag_days ? (l.lag_days > 0 ? '+' : '') + l.lag_days : ''})`)
        .join('; ')
      return [
        r.wbs,
        '  '.repeat(r.depth) + a.name,
        KIND_LABELS[a.kind],
        a.kind === 'summary' ? '' : a.duration_days,
        fmtDate(a.start_date),
        fmtDate(a.finish_date),
        a.total_float ?? '',
        a.is_critical ? tr('да') : '',
        Math.round(a.percent_complete),
        preds,
      ]
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('График работ: сроки считаются по зависимостям в рабочих днях. Красным показан критический путь — задержка любой такой работы сдвигает завершение проекта.')}</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog({ type: 'new', kind: 'task' })}>
              <Plus />{tr('Работа')}</Button>
            <Button variant="outline" onClick={() => setDialog({ type: 'new', kind: 'milestone' })}>
              <Flag />{tr('Веха')}</Button>
            <Button variant="outline" onClick={() => setDialog({ type: 'new', kind: 'summary' })}>
              <FolderPlus />{tr('Группа')}</Button>
            <Button variant="outline" onClick={() => setDialog({ type: 'generate' })}>
              <Layers />{tr('По этажам')}</Button>
          </div>
        )}
      </div>

      {activities.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label={tr('Сводка графика')}>
          <Stat label={tr('Начало')} value={fmtDate(stats.start)} />
          <Stat label={tr('Завершение')} value={fmtDate(stats.finish)} />
          <Stat label={tr('Работ')} value={String(stats.work)} />
          <Stat label={tr('На критическом пути')} value={String(stats.critical)} tone={stats.critical > 0 ? 'warn' : undefined} />
          <Stat label={tr('Выполнено')} value={`${Math.round(stats.done)}%`} hint={stats.late > 0 ? tr('просрочено: {{late}}', { late: stats.late }) : undefined} tone={stats.late > 0 ? 'warn' : undefined} />
        </dl>
      )}

      {activities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={tr('Масштаб')}>
            {ZOOMS.map(([z, label]) => (
              <Button key={z} size="sm" variant={zoom === z ? 'secondary' : 'ghost'} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {label}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set())} title={tr('Развернуть все группы')}>
            <ChevronsUpDown />{tr('Развернуть')}</Button>
          <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set(groupIds(activities)))} title={tr('Свернуть все группы')}>
            <ChevronsDownUp />{tr('Свернуть')}</Button>
          <Button size="sm" variant={criticalOnly ? 'secondary' : 'outline'} aria-pressed={criticalOnly} onClick={() => setCriticalOnly((v) => !v)}>
            <RouteIcon />{tr('Критический путь')}</Button>
          {baselines.length > 0 && (
            <Select value={baselineId} onValueChange={setBaselineId}>
              <SelectTrigger size="sm" aria-label={tr('Базовый план для сравнения')} className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BASELINE}>{tr('Без базового плана')}</SelectItem>
                {baselines.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {canBaseline && hasDates && (
              <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'baseline' })}>
                <Save />{tr('Базовый план')}</Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => undefined, tr('Не удалось пересчитать график.'), tr('График пересчитан'))}>
                <RefreshCw className={busy ? 'animate-spin' : ''} />{tr('Пересчитать')}</Button>
            )}
            <ExportButton
              fileName={tr('График {{code}}', { code: p.code })}
              build={() => ({
                name: tr('График'),
                headers: ['№', tr('Работа'), tr('Вид'), tr('Длит., раб. дн.'), tr('Начало'), tr('Конец'), tr('Резерв, дн.'), tr('Критическая'), tr('Готово, %'), tr('Зависит от')],
                rows: exportRows() as (string | number)[][],
              })}
            />
          </div>
        </div>
      )}

      {activities.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-soft">
          <CalendarCheck className="size-6 text-muted-foreground" aria-hidden />
          <p className="max-w-prose text-sm text-muted-foreground">{tr('Графика пока нет. Добавьте работы и свяжите их зависимостями — система сама посчитает сроки, резервы и критический путь. Для поточных работ по этажам есть быстрый способ: одна работа на каждый этаж с лагом между ними.')}</p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialog({ type: 'new', kind: 'task' })}>
                <Plus />{tr('Добавить работу')}</Button>
              <Button variant="outline" onClick={() => setDialog({ type: 'generate' })}>
                <Layers />{tr('Создать по этажам')}</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tr('Работы добавляет руководитель проекта или ПТО.')}</p>
          )}
        </div>
      ) : !hasDates ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p>{tr('Сроки ещё не рассчитаны.')}</p>
          {canEdit && (
            <Button disabled={busy} onClick={() => void run(async () => undefined, tr('Не удалось рассчитать график.'), tr('График рассчитан'))}>
              <RefreshCw />{tr('Рассчитать график')}</Button>
          )}
        </div>
      ) : (
        <Gantt
          rows={rows}
          links={links}
          scale={scale}
          zoom={zoom}
          baseline={baselineMap ?? null}
          selectedId={selectedId}
          criticalOnly={criticalOnly}
          canEdit={canEdit}
          calendar={calendar}
          height="max(420px, calc(100svh - 360px))"
          onSelect={setSelectedId}
          onToggle={toggle}
          onMove={(id, startIso) => {
            const a = activities.find((x) => x.id === id)
            if (a) void patch(id, { constraint_type: a.constraint_type === 'mso' ? 'mso' : 'snet', constraint_date: startIso })
          }}
          onResize={(id, durationDays) => void patch(id, { duration_days: durationDays })}
        />
      )}

      <ActivityPanel
        projectId={p.id}
        activity={selected}
        activities={activities}
        links={links}
        disciplines={disciplines}
        locations={locations}
        canEdit={canEdit}
        onClose={() => setSelectedId(null)}
        onPatch={patch}
        onAddLink={(input) => run(() => addLink(input), tr('Не удалось добавить зависимость.'))}
        onChangeLink={(id, change) => run(() => updateLink(id, change), tr('Не удалось изменить связь.'))}
        onRemoveLink={(id) => run(() => removeLink(id), tr('Не удалось убрать связь.'))}
        onDelete={remove}
      />

      {dialog?.type === 'new' && (
        <NewActivityDialog
          kind={dialog.kind}
          groups={groups}
          defaultParent={selected?.kind === 'summary' ? selected.id : (selected?.parent_id ?? null)}
          busy={busy}
          onClose={() => setDialog(null)}
          onCreate={async (v) => {
            const ok = await run(
              () => createActivity({ projectId: p.id, name: v.name, kind: v.kind, durationDays: v.durationDays, parentId: v.parentId, sort: nextSort(v.parentId) }),
              tr('Не удалось создать.'),
              tr('Добавлено'),
            )
            if (ok) setDialog(null)
          }}
        />
      )}
      {dialog?.type === 'generate' && (
        <GenerateDialog
          projectId={p.id}
          groups={groups}
          disciplines={disciplines}
          busy={busy}
          onClose={() => setDialog(null)}
          onGenerate={async (v) => {
            const ok = await run(() => generateByLocations({ projectId: p.id, ...v }), tr('Не удалось создать работы.'), tr('Работы по этажам созданы'))
            if (ok) setDialog(null)
          }}
        />
      )}
      {dialog?.type === 'baseline' && (
        <BaselineDialog
          number={baselines.length}
          busy={busy}
          onClose={() => setDialog(null)}
          onCreate={async (name, reason) => {
            const ok = await run(() => createBaseline(p.id, name, reason), tr('Не удалось сохранить базовый план.'), tr('Базовый план зафиксирован'), false)
            if (ok) setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-soft">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone === 'warn' ? 'text-red-700 dark:text-red-300' : ''}`}>{value}</dd>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
