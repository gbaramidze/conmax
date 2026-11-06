import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Check, ExternalLink, Minus, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { projectMembersQuery } from '@/features/projects/api'
import { activitiesQuery, linksQuery, type Activity } from '@/features/schedule/api'
import { fmtDate } from '@/features/schedule/model'
import { CATEGORY_STYLES, DEFAULT_TASK_SEARCH } from '@/features/tasks/api'
import { organizationsListQuery } from '@/features/volumes/api'
import { addDays, mondayOf, weeklyErrorText } from './api'
import {
  checksQuery,
  CONSTRAINT_KIND_KEYS,
  CONSTRAINT_KINDS,
  constraintsQuery,
  createConstraint,
  isOpenConstraint,
  setActivityChecked,
  type ConstraintKind,
  type ConstraintRow,
} from './lookahead-api'

const NONE = '__none__'
const todayIso = () => new Date().toLocaleDateString('sv')

type Readiness = 'ready' | 'constrained' | 'unknown'
const READINESS_LABELS: Record<Readiness, string> = { ready: tr('Готова'), constrained: tr('Есть ограничения'), unknown: tr('Не проверена') }
const READINESS_STYLES: Record<Readiness, string> = {
  ready: 'bg-green-500/10 text-green-700 dark:text-green-300',
  constrained: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  unknown: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
}
const STATUS_LABELS: Record<string, string> = {
  backlog: tr('Не начато'),
  todo: tr('К выполнению'),
  in_progress: tr('В работе'),
  blocked: tr('Заблокировано'),
  review: tr('На проверке'),
  done: tr('Снято'),
  cancelled: tr('Отменено'),
}

interface Row {
  a: Activity
  open: ConstraintRow[]
  all: ConstraintRow[]
  /** Предшественник просрочен: система показывает сама, в базе не хранится */
  latePred: Activity | null
  readiness: Readiness
  /** По каждому виду: есть неснятое (open), все сняты (done) или не было (none) */
  cells: Record<ConstraintKind, 'open' | 'done' | 'none'>
}

/** Look-ahead: ближайшие недели графика, готовность работ и матрица ограничений. */
export function LookAhead({ projectId, code, permissions }: { projectId: string; code: string; permissions: string[] }) {
  const qc = useQueryClient()
  const { data: activities = [], isLoading } = useQuery(activitiesQuery(projectId))
  const { data: links = [] } = useQuery(linksQuery(projectId))
  const { data: constraints = [] } = useQuery(constraintsQuery(projectId))
  const { data: checks = [] } = useQuery(checksQuery(projectId))
  const { data: locations = [] } = useQuery(locationsQuery(projectId))
  const { data: orgs = [] } = useQuery(organizationsListQuery)

  const canCreate = permissions.includes('task.create')
  const canCheck = permissions.includes('schedule.edit') || permissions.includes('commitment.create')

  const [weeks, setWeeks] = useState(6)
  const [org, setOrg] = useState(NONE)
  const [query, setQuery] = useState('')
  const [onlyConstrained, setOnlyConstrained] = useState(false)
  const [overdue, setOverdue] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ activity: Activity; kind: ConstraintKind } | null>(null)

  const today = todayIso()
  const start = mondayOf(today)
  const end = addDays(start, weeks * 7 - 1)
  const weekStarts = useMemo(() => Array.from({ length: weeks }, (_, i) => addDays(start, i * 7)), [start, weeks])

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(activities.map((a) => [a.id, a]))
    const checked = new Set(checks.map((c) => c.activity_id))
    const byActivity = new Map<string, ConstraintRow[]>()
    for (const c of constraints) byActivity.set(c.activity_id, [...(byActivity.get(c.activity_id) ?? []), c])
    const q = query.trim().toLowerCase()

    return activities
      .filter((a) => a.kind === 'task' && a.percent_complete < 100 && a.start_date && a.finish_date && a.start_date <= end && (overdue || a.finish_date >= start))
      .filter((a) => org === NONE || a.contractor_org_id === org)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .map((a): Row => {
        const all = byActivity.get(a.id) ?? []
        const open = all.filter(isOpenConstraint)
        const latePred =
          links
            .filter((l) => l.successor_id === a.id && l.type === 'FS')
            .map((l) => byId.get(l.predecessor_id))
            .find((p) => p && p.kind !== 'summary' && p.percent_complete < 100 && p.finish_date && p.finish_date < today) ?? null
        const cells = {} as Row['cells']
        for (const k of CONSTRAINT_KIND_KEYS) {
          const ofKind = all.filter((c) => c.kind === k)
          const hasOpen = ofKind.some(isOpenConstraint) || (k === 'predecessor' && !!latePred)
          cells[k] = hasOpen ? 'open' : ofKind.length > 0 ? 'done' : 'none'
        }
        const readiness: Readiness = open.length > 0 || latePred ? 'constrained' : checked.has(a.id) ? 'ready' : 'unknown'
        return { a, open, all, latePred, readiness, cells }
      })
      .filter((r) => !onlyConstrained || r.readiness === 'constrained')
      .sort((x, y) => (x.a.start_date ?? '').localeCompare(y.a.start_date ?? '') || x.a.name.localeCompare(y.a.name, currentLocale()))
  }, [activities, links, constraints, checks, weeks, org, query, onlyConstrained, overdue, start, end, today])

  // доля готовых работ, которые стартуют на этой и трёх следующих неделях
  const readinessByWeek = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => {
        const from = addDays(start, i * 7)
        const to = addDays(from, 6)
        const inWeek = rows.filter((r) => r.a.start_date! >= (i === 0 ? '0000-00-00' : from) && r.a.start_date! <= to)
        const ready = inWeek.filter((r) => r.readiness === 'ready').length
        return { label: i === 0 ? tr('Эта неделя') : tr('Через {{i}} нед.', { i }), total: inWeek.length, ready }
      }),
    [rows, start],
  )

  const selected = rows.find((r) => r.a.id === selectedId) ?? null
  const refresh = () => qc.invalidateQueries({ queryKey: ['weekly'] })
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">{tr('Работы ближайших недель и то, что мешает их начать. Нажмите на пустую клетку, чтобы поставить ограничение, на ⚠ — посмотреть, что открыто. Ограничение — обычная задача: у неё есть ответственный, срок и обсуждение.')}</p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {readinessByWeek.map((w) => (
          <div key={w.label} className="rounded-lg border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{tr('Готово к старту:')}{' '}{w.label.toLowerCase()}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{w.total === 0 ? '—' : `${Math.round((w.ready / w.total) * 100)}%`}</dd>
            <p className="text-xs text-muted-foreground">{w.total === 0 ? tr('работ не стартует') : tr('{{ready}} из {{total}}', { ready: w.ready, total: w.total })}</p>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Найти работу')} aria-label={tr('Найти работу')} className="pl-9" />
        </div>
        <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))}>
          <SelectTrigger className="w-36" aria-label={tr('Окно планирования')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[4, 6, 8].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}{tr('недель')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="w-48" aria-label={tr('Подрядчик')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>{tr('Все подрядчики')}</SelectItem>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyConstrained} onChange={(e) => setOnlyConstrained(e.target.checked)} />{tr('только с ограничениями')}</label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />{tr('и просроченные')}</label>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 min-w-56 bg-muted px-3 py-2 text-left font-medium">{tr('Работа')}</th>
              {weekStarts.map((w) => (
                <th key={w} className="w-9 px-0.5 py-2 text-center font-normal" title={tr('Неделя с {{v1}}', { v1: fmtDate(w) })}>
                  {w.slice(8, 10)}.{w.slice(5, 7)}
                </th>
              ))}
              <th className="px-2 py-2 text-left font-medium">{tr('Готовность')}</th>
              {CONSTRAINT_KIND_KEYS.map((k) => (
                <th key={k} className="w-11 px-0.5 py-2 text-center font-normal" title={CONSTRAINT_KINDS[k].label}>
                  {CONSTRAINT_KINDS[k].short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={weeks + CONSTRAINT_KIND_KEYS.length + 2} className="p-6 text-center text-muted-foreground">
                  {isLoading ? tr('Загружаем график…') : activities.length === 0 ? tr('В графике пока нет работ.') : tr('В выбранном окне нет подходящих работ.')}
                </td>
              </tr>
            )}
            {rows.slice(0, 300).map((r) => {
              const loc = r.a.location_id ? locById.get(r.a.location_id) : null
              return (
                <tr key={r.a.id} className={`border-b last:border-0 ${r.a.id === selectedId ? 'bg-signal/10' : ''}`}>
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                    <button type="button" className="block w-full text-left outline-none hover:underline focus-visible:underline" onClick={() => setSelectedId(r.a.id)}>
                      <span className="block font-medium">{r.a.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {fmtDate(r.a.start_date)} – {fmtDate(r.a.finish_date)}
                        {r.a.finish_date! < today && <span className="text-red-700 dark:text-red-300">{tr('· просрочена')}</span>}
                        {loc && ` · ${locationLabel(loc.path, locations)}`}
                        {r.a.contractor_org_id && orgName.get(r.a.contractor_org_id) && ` · ${orgName.get(r.a.contractor_org_id)}`}
                      </span>
                    </button>
                  </th>
                  {weekStarts.map((w) => {
                    const on = r.a.start_date! <= addDays(w, 6) && r.a.finish_date! >= w
                    return (
                      <td key={w} className="px-0.5 py-2">
                        {on && <span className={`block h-3 rounded-sm ${r.a.is_critical ? 'bg-red-500/70' : 'bg-blue-500/60'}`} aria-label={tr('работа идёт')} />}
                      </td>
                    )
                  })}
                  <td className="px-2 py-2">
                    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${READINESS_STYLES[r.readiness]}`}>{READINESS_LABELS[r.readiness]}</span>
                  </td>
                  {CONSTRAINT_KIND_KEYS.map((k) => {
                    const state = r.cells[k]
                    const label = `${CONSTRAINT_KINDS[k].label}: ${state === 'open' ? tr('есть ограничение') : state === 'done' ? tr('снято') : tr('нет')}`
                    return (
                      <td key={k} className="px-0.5 py-1 text-center">
                        <button
                          type="button"
                          aria-label={`${r.a.name}. ${label}`}
                          title={label}
                          disabled={state === 'none' && !canCreate}
                          onClick={() => (state === 'none' ? setAdding({ activity: r.a, kind: k }) : setSelectedId(r.a.id))}
                          className="inline-flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          {state === 'open' ? (
                            <AlertTriangle className="size-4 text-amber-600" aria-hidden />
                          ) : state === 'done' ? (
                            <Check className="size-4 text-green-600" aria-hidden />
                          ) : (
                            <Minus className="size-3.5 text-muted-foreground/50" aria-hidden />
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 300 && <p className="text-xs text-muted-foreground">{tr('Показаны первые 300 работ из')}{' '}{rows.length}{tr(': сузьте окно или выберите подрядчика.')}</p>}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.a.name}</SheetTitle>
                <SheetDescription>
                  {fmtDate(selected.a.start_date)} – {fmtDate(selected.a.finish_date)}
                  {selected.a.is_critical && tr(' · критическая')}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-4">
                <span className={`inline-flex w-fit rounded-md px-2 py-0.5 text-xs font-medium ${READINESS_STYLES[selected.readiness]}`}>{READINESS_LABELS[selected.readiness]}</span>

                {selected.latePred && (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('Предыдущая работа «')}{selected.latePred.name}{tr('» должна была закончиться')}{' '}{fmtDate(selected.latePred.finish_date)}{tr(', а готова на')}{' '}{Math.round(selected.latePred.percent_complete)}%.
                  </p>
                )}

                <h3 className="text-sm font-semibold">{tr('Ограничения')}</h3>
                {selected.all.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tr('Пока ни одного. Если работе ничего не мешает, отметьте её проверенной.')}</p>
                ) : (
                  <ul className="flex flex-col divide-y rounded-lg border">
                    {selected.all.map((c) => (
                      <li key={c.id} className="flex flex-col gap-1 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{CONSTRAINT_KINDS[c.kind].label}</span>
                          <span className={`rounded px-1 ${CATEGORY_STYLES[c.task!.status_category as keyof typeof CATEGORY_STYLES] ?? ''}`}>{STATUS_LABELS[c.task!.status_category] ?? c.task!.status_category}</span>
                        </div>
                        <Link to="/projects/$code/tasks/$key" params={{ code, key: c.task!.key }} search={DEFAULT_TASK_SEARCH} className="inline-flex items-start gap-1.5 text-sm font-medium hover:underline">
                          <span className="ident text-muted-foreground">{c.task!.key}</span> {c.task!.title} <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {c.task!.assignee?.full_name ?? tr('без ответственного')}
                          {c.task!.due_date && tr(' · снять до {{v1}}', { v1: fmtDate(c.task!.due_date) })}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2">
                  {canCreate && (
                    <Button variant="outline" onClick={() => setAdding({ activity: selected.a, kind: 'materials' })}>
                      <Plus />{tr('Добавить ограничение')}</Button>
                  )}
                  {canCheck && selected.readiness !== 'constrained' && (
                    <Button
                      variant={selected.readiness === 'ready' ? 'ghost' : 'default'}
                      onClick={async () => {
                        try {
                          await setActivityChecked(selected.a.id, selected.readiness !== 'ready')
                          await refresh()
                          toast.success(selected.readiness === 'ready' ? tr('Отметка снята') : tr('Готовность подтверждена'))
                        } catch (e) {
                          toast.error(weeklyErrorText(e, tr('Не удалось сохранить отметку.')))
                        }
                      }}
                    >
                      <Check /> {selected.readiness === 'ready' ? tr('Снять отметку') : tr('Готова к старту')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {adding && (
        <ConstraintDialog
          projectId={projectId}
          activity={adding.activity}
          initialKind={adding.kind}
          canAssign={permissions.includes('task.assign')}
          onClose={() => setAdding(null)}
          onCreated={async () => {
            setAdding(null)
            await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['tasks'] })])
            toast.success(tr('Ограничение создано'))
          }}
        />
      )}
    </div>
  )
}

function ConstraintDialog({
  projectId,
  activity,
  initialKind,
  canAssign,
  onClose,
  onCreated,
}: {
  projectId: string
  activity: Activity
  initialKind: ConstraintKind
  canAssign: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const [kind, setKind] = useState<ConstraintKind>(initialKind)
  const [title, setTitle] = useState('')
  const [who, setWho] = useState(NONE)
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const titleOrDefault = title.trim() || `${CONSTRAINT_KINDS[kind].label}: ${activity.name}`

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Новое ограничение')}</DialogTitle>
          <DialogDescription>{activity.name}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await createConstraint({ activityId: activity.id, kind, title: titleOrDefault, assigneeId: who === NONE ? null : who, dueDate: due || null })
              onCreated()
            } catch (err) {
              toast.error(weeklyErrorText(err, tr('Не удалось создать ограничение.')))
              setBusy(false)
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="cs-kind">{tr('Что мешает')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ConstraintKind)}>
              <SelectTrigger id="cs-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSTRAINT_KIND_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CONSTRAINT_KINDS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cs-title">{tr('Что нужно сделать')}</Label>
            <Input id="cs-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder={titleOrDefault} autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {canAssign && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cs-who">{tr('Ответственный')}</Label>
                <Select value={who} onValueChange={setWho}>
                  <SelectTrigger id="cs-who" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>{tr('Не назначен')}</SelectItem>
                    {members
                      .filter((m) => m.user)
                      .map((m) => (
                        <SelectItem key={m.user!.id} value={m.user!.id}>
                          {m.user!.full_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="cs-due">{tr('Снять до')}</Label>
              <DatePicker id="cs-due" value={due} onChange={(v) => setDue(v)} />
              <p className="text-xs text-muted-foreground">{tr('Если не указать — за неделю до старта работы.')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={busy}>
              {busy ? tr('Создаём…') : tr('Создать')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
