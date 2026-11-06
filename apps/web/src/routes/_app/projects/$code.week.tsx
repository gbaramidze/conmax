import { tr } from '@/lib/tr'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, ListPlus, Pencil, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { myPermissionsQuery, projectByCodeQuery, projectMembersQuery } from '@/features/projects/api'
import { organizationsListQuery } from '@/features/volumes/api'
import {
  addCommitment,
  addDays,
  closePeriod,
  commitmentsQuery,
  createPeriod,
  deleteCommitment,
  mondayOf,
  periodsQuery,
  PERIOD_STATUS_LABELS,
  PERIOD_STATUS_STYLES,
  ppcOf,
  REASON_LABELS,
  setResult,
  startPeriod,
  updateCommitment,
  weekLabel,
  weeklyErrorText,
  type CommitmentRow,
  type PeriodRow,
  type Reason,
} from '@/features/weekly/api'
import { AddFromScheduleDialog, CommitmentDialog, ReasonDialog, type CommitmentFormValue } from '@/features/weekly/dialogs'
import { LookAhead } from '@/features/weekly/lookahead'
import { WeeklyStats } from '@/features/weekly/stats'

// Паттерн «Список / Index» для недели: обязательства на неделю → итоги → PPC. Динамика и причины — на отдельной вкладке.
export const Route = createFileRoute('/_app/projects/$code/week')({
  validateSearch: z.object({
    w: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
    tab: z.enum(['plan', 'lookahead', 'stats']).optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(periodsQuery(project.id)),
      queryClient.ensureQueryData(commitmentsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем недельный план…')}</p>,
  component: WeekPage,
})

const todayIso = () => new Date().toLocaleDateString('sv')

function WeekPage() {
  const { code } = Route.useParams()
  const { w, tab = 'plan' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: periods } = useSuspenseQuery(periodsQuery(p.id))
  const { data: commitments } = useSuspenseQuery(commitmentsQuery(p.id))
  const qc = useQueryClient()

  const thisMonday = mondayOf(todayIso())
  const weekStart = w ? mondayOf(w) : thisMonday
  const weekEnd = addDays(weekStart, 6)
  const period = periods.find((x) => x.starts_on === weekStart) ?? null
  const prevPeriod = periods.find((x) => x.starts_on === addDays(weekStart, -7)) ?? null
  const list = useMemo(() => (period ? commitments.filter((c) => c.period_id === period.id) : []), [commitments, period])

  const canPlan = permissions.includes('commitment.create')
  const canClose = permissions.includes('commitment.close') || permissions.includes('period.manage')
  const canManage = permissions.includes('period.manage')

  const goto = (start: string) => void navigate({ search: (prev) => ({ ...prev, w: start === thisMonday ? undefined : start }) })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['weekly'] })])

  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<{ type: 'schedule' } | { type: 'free' } | { type: 'edit'; c: CommitmentRow } | { type: 'reason'; c: CommitmentRow } | null>(null)

  const run = async (action: () => Promise<unknown>, okText?: string) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      if (okText) toast.success(okText)
      return true
    } catch (e) {
      toast.error(weeklyErrorText(e, tr('Не удалось выполнить действие. Повторите попытку.')))
      return false
    } finally {
      setBusy(false)
    }
  }

  const ensurePeriod = async () => {
    if (period) return period.id
    return createPeriod(p.id, weekStart)
  }

  const carryOver = () =>
    run(async () => {
      const id = await ensurePeriod()
      const missed = commitments.filter((c) => prevPeriod && c.period_id === prevPeriod.id && c.result === 'not_completed')
      let added = 0
      for (const c of missed) {
        try {
          await addCommitment(id, { activityId: c.activity_id, title: c.title, note: c.note, locationId: c.location_id, organizationId: c.organization_id, responsibleId: c.responsible_id })
          added++
        } catch {
          // уже в плане — пропускаем
        }
      }
      toast.success(added > 0 ? tr('Перенесено: {{added}}', { added }) : tr('Переносить нечего'))
    })

  const unresolved = list.filter((c) => c.result === null).length

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="week" title={tr('Что такое план недели')}>
        <p>{tr('Мастера и прорабы записывают обязательства: что какая бригада берётся сделать на этой неделе. В конце недели по каждому пункту отмечают: выполнено или нет, а если нет — почему.')}</p>
        <p>{tr('Из итогов считается процент выполнения плана (PPC): какая доля обещанного действительно сделана. На вкладке «Выполнение плана» видно, как он меняется и какие причины срывают работы чаще всего.')}</p>
      </PageHelp>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label={tr('Предыдущая неделя')} onClick={() => goto(addDays(weekStart, -7))}>
            <ChevronLeft />
          </Button>
          <h2 className="min-w-48 px-2 text-center text-base font-semibold">{weekLabel(weekStart)}</h2>
          <Button variant="outline" size="icon" aria-label={tr('Следующая неделя')} onClick={() => goto(addDays(weekStart, 7))}>
            <ChevronRight />
          </Button>
          {weekStart !== thisMonday && (
            <Button variant="ghost" onClick={() => goto(thisMonday)}>{tr('Эта неделя')}</Button>
          )}
        </div>
        {period && <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${PERIOD_STATUS_STYLES[period.status]}`}>{PERIOD_STATUS_LABELS[period.status]}</span>}
      </div>

      <nav aria-label={tr('Разделы')} className="flex gap-1 border-b">
        {(
          [
            ['plan', tr('План недели')],
            ['lookahead', 'Look-ahead'],
            ['stats', tr('Выполнение плана')],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            to="/projects/$code/week"
            params={{ code }}
            search={(prev) => ({ ...prev, tab: value === 'plan' ? undefined : value })}
            aria-current={tab === value ? 'page' : undefined}
            className={`-mb-px min-h-11 content-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'lookahead' ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}>
          <LookAhead projectId={p.id} code={code} permissions={permissions} />
        </Suspense>
      ) : tab === 'stats' ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Считаем…')}</p>}>
          <WeeklyStats projectId={p.id} periods={periods} commitments={commitments} onOpenWeek={(s) => void navigate({ search: { w: s === thisMonday ? undefined : s } })} />
        </Suspense>
      ) : (
        <>
          <Summary period={period} list={list} />

          {!period && (
            <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
              <p className="max-w-prose text-sm text-muted-foreground">{tr('На эту неделю плана ещё нет. Составьте обязательства: что бригады берутся сделать. В конце недели отметьте итог — по нему считается процент выполнения плана (PPC).')}</p>
              {canPlan ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => run(async () => { await createPeriod(p.id, weekStart) })}>
                    <Plus />{tr('Составить план недели')}</Button>
                  {prevPeriod && commitments.some((c) => c.period_id === prevPeriod.id && c.result === 'not_completed') && (
                    <Button variant="outline" disabled={busy} onClick={carryOver}>
                      <RotateCcw />{tr('Начать с невыполненного прошлой недели')}</Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{tr('План недели составляют прорабы и руководитель проекта.')}</p>
              )}
            </div>
          )}

          {period && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {canPlan && period.status !== 'closed' && (
                    <>
                      <Button variant="outline" onClick={() => setDialog({ type: 'schedule' })}>
                        <ListPlus />{tr('Работы из графика')}</Button>
                      <Button variant="outline" onClick={() => setDialog({ type: 'free' })}>
                        <Plus />{tr('Свободный пункт')}</Button>
                      {period.status === 'planned' && prevPeriod && (
                        <Button variant="ghost" disabled={busy} onClick={carryOver}>
                          <RotateCcw />{tr('Невыполненное с прошлой недели')}</Button>
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {period.status === 'planned' && canClose && (
                    <Button disabled={busy || list.length === 0} onClick={() => run(() => startPeriod(period.id), tr('Неделя началась: план зафиксирован.'))}>
                      <Play />{tr('Начать неделю')}</Button>
                  )}
                  {period.status === 'active' && canClose && (
                    <Button
                      disabled={busy || (unresolved > 0 && !canManage)}
                      title={unresolved > 0 && !canManage ? tr('Отметьте итог по всем обязательствам') : undefined}
                      onClick={() => {
                        const force = unresolved > 0
                        if (force && !window.confirm(tr('Итог не отмечен у обязательств: {{unresolved}}. Закрыть неделю? Они будут считаться невыполненными без указания причины.', { unresolved }))) return
                        void run(() => closePeriod(period.id, force), tr('Неделя закрыта.'))
                      }}
                    >
                      <Check />{tr('Закрыть неделю')}</Button>
                  )}
                </div>
              </div>

              {period.status === 'active' && unresolved > 0 && canClose && (
                <p className="text-sm text-muted-foreground">{tr('Осталось отметить итог:')}{' '}{unresolved}{tr('. Закрыть неделю можно, когда отмечено всё.')}</p>
              )}

              <CommitmentList
                projectId={p.id}
                period={period}
                list={list}
                canPlan={canPlan}
                canClose={canClose}
                busy={busy}
                onEdit={(c) => setDialog({ type: 'edit', c })}
                onDelete={(c) => run(() => deleteCommitment(c.id))}
                onDone={(c) => run(() => setResult(c.id, c.result === 'completed' ? null : 'completed'))}
                onMissed={(c) => (c.result === 'not_completed' ? void run(() => setResult(c.id, null)) : setDialog({ type: 'reason', c }))}
              />
            </>
          )}
        </>
      )}

      {dialog?.type === 'schedule' && period && (
        <AddFromScheduleDialog
          projectId={p.id}
          weekStart={weekStart}
          weekEnd={weekEnd}
          plannedActivityIds={new Set(list.map((c) => c.activity_id).filter((x): x is string => !!x))}
          busy={busy}
          onClose={() => setDialog(null)}
          onAdd={async (ids) => {
            const ok = await run(async () => {
              for (const id of ids) await addCommitment(period.id, { activityId: id })
            }, tr('Добавлено в план: {{length}}', { length: ids.length }))
            if (ok) setDialog(null)
          }}
        />
      )}
      {(dialog?.type === 'free' || dialog?.type === 'edit') && period && (
        <CommitmentDialog
          projectId={p.id}
          initial={dialog.type === 'edit' ? dialog.c : null}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={async (v: CommitmentFormValue) => {
            const edit = dialog.type === 'edit' ? dialog.c : null
            const ok = await run(() =>
              edit
                ? updateCommitment(edit.id, v)
                : addCommitment(period.id, { title: v.title, note: v.note, locationId: v.locationId, organizationId: v.organizationId, responsibleId: v.responsibleId }),
            )
            if (ok) setDialog(null)
          }}
        />
      )}
      {dialog?.type === 'reason' && (
        <ReasonDialog
          commitment={dialog.c}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={async (reason: Reason, note: string) => {
            const ok = await run(() => setResult(dialog.c.id, 'not_completed', reason, note))
            if (ok) setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function Summary({ period, list }: { period: PeriodRow | null; list: CommitmentRow[] }) {
  if (!period) return null
  const s = ppcOf(list)
  const started = period.status !== 'planned'
  const tiles: [string, string, string?][] = [
    [tr('Обязательств'), String(s.total), s.late > 0 ? tr('ещё {{late}} добавлено позже', { late: s.late }) : undefined],
    started ? [tr('Выполнено'), tr('{{done}} из {{total}}', { done: s.done, total: s.total })] : [tr('Не готовы к старту'), String(s.notReady), s.notReady > 0 ? tr('есть незавершённые предшественники') : tr('всё готово')],
    ['PPC', s.ppc === null || !started ? '—' : `${s.ppc}%`, period.status === 'active' ? tr('промежуточный, итог — при закрытии') : period.status === 'planned' ? tr('считается после начала недели') : undefined],
  ]
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map(([label, value, hint]) => (
        <div key={label} className="rounded-lg border bg-card p-4">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
      ))}
    </dl>
  )
}

function CommitmentList({
  projectId,
  period,
  list,
  canPlan,
  canClose,
  busy,
  onEdit,
  onDelete,
  onDone,
  onMissed,
}: {
  projectId: string
  period: PeriodRow
  list: CommitmentRow[]
  canPlan: boolean
  canClose: boolean
  busy: boolean
  onEdit: (c: CommitmentRow) => void
  onDelete: (c: CommitmentRow) => void
  onDone: (c: CommitmentRow) => void
  onMissed: (c: CommitmentRow) => void
}) {
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const { data: orgs = [] } = useQuery(organizationsListQuery)
  const { data: locations = [] } = useQuery(locationsQuery(projectId))
  const userName = useMemo(() => new Map(members.filter((m) => m.user).map((m) => [m.user!.id, m.user!.full_name])), [members])
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  if (list.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{tr('В плане пока ничего нет. Добавьте работы из графика или свободные пункты.')}</p>
  }

  const marking = period.status === 'active' && canClose
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {list.map((c) => {
        const loc = c.location_id ? locById.get(c.location_id) : null
        const meta = [
          loc ? locationLabel(loc.path, locations) : null,
          c.organization_id ? orgName.get(c.organization_id) : null,
          c.responsible_id ? userName.get(c.responsible_id) : null,
        ].filter(Boolean)
        return (
          <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.title}</p>
              {meta.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{meta.join(' · ')}</p>}
              {c.note && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{c.note}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!c.was_ready && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">{tr('на старте не готова')}</span>}
                {c.added_late && <span className="rounded bg-slate-500/10 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">{tr('добавлено позже')}</span>}
              </div>
              {c.result === 'not_completed' && c.reason && (
                <p className="mt-1.5 text-sm text-red-700 dark:text-red-300">
                  {REASON_LABELS[c.reason]}
                  {c.reason_note ? `: ${c.reason_note}` : ''}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {marking ? (
                <>
                  <Button
                    size="sm"
                    variant={c.result === 'completed' ? 'default' : 'outline'}
                    aria-pressed={c.result === 'completed'}
                    disabled={busy}
                    onClick={() => onDone(c)}
                    className={c.result === 'completed' ? 'bg-green-600 text-white hover:bg-green-700' : ''}
                  >
                    <Check />{tr('Выполнено')}</Button>
                  <Button
                    size="sm"
                    variant={c.result === 'not_completed' ? 'default' : 'outline'}
                    aria-pressed={c.result === 'not_completed'}
                    disabled={busy}
                    onClick={() => onMissed(c)}
                    className={c.result === 'not_completed' ? 'bg-red-600 text-white hover:bg-red-700' : ''}
                  >
                    <X />{tr('Нет')}</Button>
                </>
              ) : period.status !== 'planned' ? (
                <ResultBadge c={c} />
              ) : null}
              {canPlan && period.status !== 'closed' && (
                <>
                  <Button size="icon" variant="ghost" aria-label={tr('Изменить')} disabled={busy} onClick={() => onEdit(c)}>
                    <Pencil />
                  </Button>
                  {(period.status === 'planned' || c.added_late) && (
                    <Button size="icon" variant="ghost" aria-label={tr('Убрать из плана')} disabled={busy} onClick={() => onDelete(c)}>
                      <Trash2 />
                    </Button>
                  )}
                </>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ResultBadge({ c }: { c: CommitmentRow }) {
  if (c.result === 'completed') return <span className="inline-flex rounded-md bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">{tr('Выполнено')}</span>
  if (c.result === 'not_completed') return <span className="inline-flex rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">{tr('Не выполнено')}</span>
  return <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tr('Итог не отмечен')}</span>
}
