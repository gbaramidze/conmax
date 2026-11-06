import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarPlus, CheckCircle2, ListPlus, RefreshCw, SlidersHorizontal, ThumbsDown, ThumbsUp, UserPlus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { DatePicker } from '@/components/ui/date-picker'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { meetingsQuery } from '@/features/meetings/api'
import { myPermissionsQuery, projectByCodeQuery, projectMembersQuery } from '@/features/projects/api'
import {
  assignSignal,
  createTaskFromSignal,
  dismissSignal,
  evaluateSignals,
  GROUPS,
  groupOf,
  healthQuery,
  RULE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  SEVERITY_STYLES,
  signalErrorText,
  signalFeedback,
  signalsQuery,
  signalToAgenda,
  STATUS_LABELS,
  type GroupKey,
  type Severity,
  type Signal,
} from '@/features/signals/api'
import { RulesSheet } from '@/features/signals/rules-sheet'
import { HealthBreakdown } from '@/features/signals/widgets'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'

// Паттерн «Inbox / Лента»: индекс здоровья сверху, ниже сигналы с фильтрами и карточкой действий
export const Route = createFileRoute('/_app/projects/$code/signals')({
  validateSearch: z.object({ s: z.string().optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(myPermissionsQuery(project.id)), queryClient.ensureQueryData(signalsQuery(project.id)), queryClient.ensureQueryData(healthQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем сигналы…')}</p>,
  component: SignalsPage,
})

const NONE = '__none__'
const dateTime = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function SignalsPage() {
  const { code } = Route.useParams()
  const { s } = Route.useSearch()
  const navigate = Route.useNavigate()
  const qc = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: signals } = useSuspenseQuery(signalsQuery(p.id))
  const { data: health } = useSuspenseQuery(healthQuery(p.id))
  const canManage = permissions.includes('signal.manage')

  const [showClosed, setShowClosed] = useState(false)
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [group, setGroup] = useState<GroupKey | 'all'>('all')
  const [busy, setBusy] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const list = useMemo(
    () =>
      signals
        .filter((x) => (showClosed ? true : x.status === 'open'))
        .filter((x) => severity === 'all' || x.severity === severity)
        .filter((x) => group === 'all' || groupOf(x.rule) === group)
        .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.last_seen_at.localeCompare(a.last_seen_at)),
    [signals, showClosed, severity, group],
  )
  const selected = signals.find((x) => x.id === s) ?? null
  const openCount = signals.filter((x) => x.status === 'open').length
  const refresh = () => qc.invalidateQueries({ queryKey: ['signals'] })

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="signals" title={tr('Что такое сигналы')}>
        <p>{tr('Система сама, каждые два часа, проверяет проект и поднимает «флажки» там, где что-то идёт не так: задача заблокирована больше суток, просрочена работа на критическом пути, давно нет свежего факта, план недели выполняется плохо, веха сдвинулась, на ближайшие дни ожидается опасная погода.')}</p>
        <p>{tr('У каждого сигнала есть важность и объяснение: что случилось и по каким цифрам. Из сигнала можно создать задачу, внести его в повестку совещания или назначить ответственного. Когда причина исчезла, сигнал закрывается сам. Индекс здоровья вверху — общая оценка проекта.')}</p>
      </PageHelp>
      <section aria-labelledby="health" className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="health" className="text-sm font-semibold">{tr('Индекс здоровья')}</h2>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setRulesOpen(true)}>
            <SlidersHorizontal />{canManage ? tr('Правила и пороги') : tr('Правила')}
          </Button>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await evaluateSignals(p.id)
                  await refresh()
                  toast.success(tr('Пересчитано: открытых {{open}}, закрыто системой {{resolved}}, индекс {{health}}', { open: r.open, resolved: r.resolved, health: r.health }))
                } catch (e) {
                  toast.error(signalErrorText(e, tr('Не удалось пересчитать сигналы.')))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <RefreshCw />{tr('Пересчитать')}</Button>
          )}
        </div>
        {health ? (
          <>
            <HealthBreakdown health={health} />
            <p className="mt-3 text-xs text-muted-foreground">{tr('Рассчитано')}{' '}{dateTime.format(new Date(health.computed_at))}{tr('. Сигналы пересчитываются автоматически каждые два часа.')}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{tr('Индекс появится после первого расчёта сигналов.')}{canManage ? tr(' Нажмите «Пересчитать».') : ''}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm font-semibold">{tr('Сигналы')}{' '}<span className="font-normal text-muted-foreground">{openCount}{tr('открыто')}</span>
        </h2>
        <Select value={severity} onValueChange={(v) => setSeverity(v as Severity | 'all')}>
          <SelectTrigger className="w-40" aria-label={tr('Важность')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr('Любая важность')}</SelectItem>
            {(Object.keys(SEVERITY_LABELS) as Severity[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SEVERITY_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={group} onValueChange={(v) => setGroup(v as GroupKey | 'all')}>
          <SelectTrigger className="w-56" aria-label={tr('Область')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr('Все области')}</SelectItem>
            {(Object.keys(GROUPS) as GroupKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {GROUPS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{tr('и закрытые')}</label>
      </div>

      {list.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          {signals.length === 0 ? tr('Сигналов пока нет: либо всё в порядке, либо расчёт ещё не запускался.') : tr('По выбранным фильтрам сигналов нет.')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {list.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => void navigate({ search: { s: x.id } })} className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[x.severity]}`}>{SEVERITY_LABELS[x.severity]}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${x.status !== 'open' ? 'text-muted-foreground' : ''}`}>{x.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {RULE_LABELS[x.rule] ?? x.rule} · {GROUPS[groupOf(x.rule)].label}{tr('· с')}{' '}{dateTime.format(new Date(x.first_seen_at))}
                    {x.status !== 'open' && ` · ${STATUS_LABELS[x.status].toLowerCase()}`}
                    {x.task_id && tr(' · есть задача')}
                    {x.agenda_meeting_id && tr(' · в повестке')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && void navigate({ search: {} })}>
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
          {selected && <SignalDetail signal={selected} projectId={p.id} code={code} canManage={canManage} canTask={canManage || permissions.includes('task.create')} onChanged={refresh} />}
        </SheetContent>
      </Sheet>
      {rulesOpen && <RulesSheet projectId={p.id} canManage={canManage} onClose={() => setRulesOpen(false)} />}
    </div>
  )
}

type ActionDialog = 'task' | 'agenda' | 'assign' | 'dismiss' | null

function SignalDetail({ signal: x, projectId, code, canManage, canTask, onChanged }: { signal: Signal; projectId: string; code: string; canManage: boolean; canTask: boolean; onChanged: () => Promise<unknown> }) {
  const [dialog, setDialog] = useState<ActionDialog>(null)
  const open = x.status === 'open'
  const suggested = x.actions.find((a) => a.type === 'create_task')?.title ?? x.title

  const feedback = async (useful: boolean) => {
    try {
      await signalFeedback(x.id, useful)
      await onChanged()
      toast.success(tr('Спасибо, учтём при настройке правил'))
    } catch (e) {
      toast.error(signalErrorText(e, tr('Не удалось сохранить отзыв.')))
    }
  }

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[x.severity]}`}>{SEVERITY_LABELS[x.severity]}</span>
          <span className="text-xs text-muted-foreground">{RULE_LABELS[x.rule] ?? x.rule}</span>
        </div>
        <SheetTitle className="text-left leading-snug">{x.title}</SheetTitle>
        <SheetDescription className="text-left">{tr('Возник')}{' '}{dateTime.format(new Date(x.first_seen_at))}{tr(', подтверждён')}{' '}{dateTime.format(new Date(x.last_seen_at))}
          {x.status === 'resolved' && x.resolved_at && tr('. Закрыт системой {{v1}}: условие больше не выполняется', { v1: dateTime.format(new Date(x.resolved_at)) })}
          {x.status === 'dismissed' && tr('. Отклонён{{until}}', { until: x.dismiss_until ? tr(' до {{v1}}', { v1: new Date(x.dismiss_until).toLocaleDateString(currentLocale()) }) : '' })}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {x.rule_text && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">{tr('Почему сработало')}</h3>
            <p className="text-sm text-muted-foreground">{x.rule_text}</p>
          </section>
        )}
        {x.facts.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">{tr('Факты')}</h3>
            <dl className="flex flex-col divide-y rounded-lg border text-sm">
              {x.facts.map((f, i) => (
                <div key={i} className="flex items-start justify-between gap-4 px-3 py-2">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="shrink-0 font-medium tabular-nums">{String(f.value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {x.evidence.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">{tr('Что затронуто')}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {x.evidence.map((e, i) => (
                <li key={i}>
                  {e.type === 'task' && e.key ? (
                    <Link to="/projects/$code/tasks/$key" params={{ code, key: e.key }} search={DEFAULT_TASK_SEARCH} className="hover:underline">
                      <span className="ident text-muted-foreground">{e.key}</span> {e.title}
                    </Link>
                  ) : e.type === 'activity' ? (
                    <Link to="/projects/$code/schedule" params={{ code }} className="hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    <span>{e.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {x.severity_history.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">{tr('Как менялась важность')}</h3>
            <ul className="text-xs text-muted-foreground">
              {x.severity_history.map((h, i) => (
                <li key={i}>
                  {dateTime.format(new Date(h.at))}: {SEVERITY_LABELS[h.from]} → {SEVERITY_LABELS[h.to]}
                </li>
              ))}
            </ul>
          </section>
        )}

        {x.task_id && (
          <p className="text-sm">
            <CheckCircle2 className="mr-1 inline size-4 text-green-600" aria-hidden />{tr('Из сигнала создана задача.')}</p>
        )}

        {open && (
          <section aria-label={tr('Действия')} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{tr('Что сделать')}</h3>
            <div className="flex flex-wrap gap-2">
              {canTask && (
                <Button size="sm" onClick={() => setDialog('task')}>
                  <ListPlus />{tr('Создать задачу')}</Button>
              )}
              {canManage && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setDialog('agenda')}>
                    <CalendarPlus />{tr('В повестку')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setDialog('assign')}>
                    <UserPlus />{tr('Назначить')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDialog('dismiss')}>
                    <X />{tr('Отклонить')}</Button>
                </>
              )}
            </div>
          </section>
        )}
        <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">{tr('Сигнал полезен?')}<Button size="icon" variant={x.useful === true ? 'secondary' : 'ghost'} className="size-8" aria-label={tr('Полезно')} aria-pressed={x.useful === true} onClick={() => feedback(true)}>
            <ThumbsUp />
          </Button>
          <Button size="icon" variant={x.useful === false ? 'secondary' : 'ghost'} className="size-8" aria-label={tr('Не полезно')} aria-pressed={x.useful === false} onClick={() => feedback(false)}>
            <ThumbsDown />
          </Button>
        </div>
      </div>

      {dialog && (
        <ActionDialogs
          kind={dialog}
          signal={x}
          projectId={projectId}
          suggested={suggested}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await Promise.all([onChanged()])
          }}
        />
      )}
    </>
  )
}

function ActionDialogs({ kind, signal, projectId, suggested, onClose, onDone }: { kind: Exclude<ActionDialog, null>; signal: Signal; projectId: string; suggested: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const { data: meetings = [] } = useQuery(meetingsQuery(projectId))
  const upcoming = meetings.filter((m) => m.status === 'scheduled' || m.status === 'in_progress').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const [title, setTitle] = useState(suggested)
  const [who, setWho] = useState(NONE)
  const [due, setDue] = useState('')
  const [meeting, setMeeting] = useState(upcoming[0]?.id ?? NONE)
  const [reason, setReason] = useState('known')
  const [days, setDays] = useState('14')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      await onDone()
    } catch (e) {
      toast.error(signalErrorText(e, tr('Не удалось выполнить действие.')))
      setBusy(false)
    }
  }
  const memberSelect = (id: string) => (
    <Select value={who} onValueChange={setWho}>
      <SelectTrigger id={id} className="w-full">
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
  )
  const ids = { task: tr('Создать задачу'), agenda: tr('В повестку совещания'), assign: tr('Назначить ответственного'), dismiss: tr('Отклонить сигнал') }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ids[kind]}</DialogTitle>
          <DialogDescription>{signal.title}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {kind === 'task' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sg-title">{tr('Задача')}</Label>
                <Input id="sg-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sg-who">{tr('Исполнитель')}</Label>
                  {memberSelect('sg-who')}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sg-due">{tr('Срок')}</Label>
                  <DatePicker id="sg-due" value={due} onChange={(v) => setDue(v)} />
                </div>
              </div>
            </>
          )}
          {kind === 'assign' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="sg-who2">{tr('Ответственный за сигнал')}</Label>
              {memberSelect('sg-who2')}
            </div>
          )}
          {kind === 'agenda' &&
            (upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr('Ближайших совещаний нет. Создайте совещание в разделе «Совещания», затем добавьте сигнал в повестку.')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="sg-meeting">{tr('Совещание')}</Label>
                <Select value={meeting} onValueChange={setMeeting}>
                  <SelectTrigger id="sg-meeting" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {upcoming.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title} · {dateTime.format(new Date(m.scheduled_at))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          {kind === 'dismiss' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sg-reason">{tr('Причина')}</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id="sg-reason" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">{tr('Ложное срабатывание')}</SelectItem>
                    <SelectItem value="known">{tr('Уже знаем, занимаемся')}</SelectItem>
                    <SelectItem value="unimportant">{tr('Неважно сейчас')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sg-days">{tr('Не поднимать снова, дней')}</Label>
                <Input id="sg-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
          {kind === 'task' && (
            <Button disabled={busy || !title.trim()} onClick={() => run(() => createTaskFromSignal({ signalId: signal.id, title: title.trim(), assigneeId: who === NONE ? null : who, dueDate: due || null }), tr('Задача создана'))}>{tr('Создать')}</Button>
          )}
          {kind === 'assign' && (
            <Button disabled={busy} onClick={() => run(() => assignSignal(signal.id, who === NONE ? null : who), tr('Ответственный назначен'))}>{tr('Назначить')}</Button>
          )}
          {kind === 'agenda' && (
            <Button disabled={busy || meeting === NONE || upcoming.length === 0} onClick={() => run(() => signalToAgenda(signal.id, meeting), tr('Добавлено в повестку'))}>{tr('Добавить')}</Button>
          )}
          {kind === 'dismiss' && (
            <Button disabled={busy} onClick={() => run(() => dismissSignal(signal.id, reason, Math.max(1, Number(days) || 14)), tr('Сигнал отклонён'))}>{tr('Отклонить')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
