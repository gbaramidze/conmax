import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  assessChange,
  CHANGE_REASONS,
  CHANGE_STATUSES,
  changesQuery,
  isOpen,
  saveChange,
  statusClass,
  transitionChange,
  type ChangeReason,
  type ChangeRequest,
  type ChangeStatus,
} from '@/features/changes/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { useProjectCurrency } from '@/features/projects/currency'
import { displaySymbol, toDisplay } from '@/features/projects/display-currency'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Реестр»: запросы на изменение объёма, срока или бюджета и их маршрут согласования
export const Route = createFileRoute('/_app/projects/$code/changes')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(changesQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем запросы на изменение…')}</p>,
  component: ChangesPage,
})

const GROUPS = ['open', 'decided', 'all'] as const
type Group = (typeof GROUPS)[number]

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function ChangesPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: changes } = useSuspenseQuery(changesQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canCreate = perms.includes('change.create')
  const [group, setGroup] = useState<Group>('open')
  const [opened, setOpened] = useState<string | 'new' | null>(null)
  const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 })
  const money = (n: number) => `${n > 0 ? '+' : ''}${nf.format(toDisplay(n))} ${displaySymbol()}`

  const shown = useMemo(() => changes.filter((c) => (group === 'all' ? true : group === 'open' ? isOpen(c.status) : !isOpen(c.status))), [changes, group])
  const approved = changes.filter((c) => c.status === 'approved' || c.status === 'implemented')
  const approvedCost = approved.reduce((s, c) => s + (c.cost_impact ?? 0), 0)
  const approvedDays = approved.reduce((s, c) => s + (c.schedule_impact_days ?? 0), 0)
  const waiting = changes.filter((c) => c.status === 'approval')
  const waitingCost = waiting.reduce((s, c) => s + (c.cost_impact ?? 0), 0)
  const current = typeof opened === 'string' && opened !== 'new' ? changes.find((c) => c.id === opened) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="changes" title={tr('Что такое запрос на изменение')}>
        <p>{tr('Когда заказчик просит переделать, в проекте находят ошибку или на площадке выясняется неожиданное, объём работ, срок или бюджет меняются. Запрос на изменение фиксирует это до того, как работа сделана: кто просит, почему, во сколько обойдётся и на сколько сдвинет срок.')}</p>
        <p>{tr('Путь запроса: черновик → оценка влияния (ПТО, экономист, главный инженер) → согласование руководителем проекта → внедрение. Каждый шаг остаётся в ленте проекта, поэтому потом видно, кто и что решил.')}</p>
      </PageHelp>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={tr('Утверждено: стоимость')} value={approved.length ? money(approvedCost) : '—'} hint={tr('Запросов: {{n}}', { n: approved.length })} />
        <Stat label={tr('Утверждено: срок, дней')} value={approved.length ? signed(approvedDays) : '—'} hint={tr('Сдвиг сроков по утверждённым')} />
        <Stat label={tr('Ждут решения')} value={String(waiting.length)} hint={waiting.length ? tr('Если утвердить все: {{v}}', { v: money(waitingCost) }) : tr('Нет запросов на согласовании')} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={tr('Показать')} value={group} onChange={(e) => setGroup(e.target.value as Group)} className="h-10 rounded-md border bg-background px-2 text-sm">
          <option value="open">{tr('В работе')}</option>
          <option value="decided">{tr('Решённые')}</option>
          <option value="all">{tr('Все')}</option>
        </select>
        {canCreate && (
          <Button className="ml-auto" onClick={() => setOpened('new')}>
            <Plus /> {tr('Новый запрос')}
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {changes.length === 0 ? (canCreate ? tr('Запросов пока нет. Заведите первый, когда что-то в объёме, сроке или бюджете придётся менять.') : tr('Запросов на изменение пока нет.')) : tr('В этой группе запросов нет.')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpened(c.id)} className="flex w-full flex-wrap items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="ident text-xs text-muted-foreground">{c.key}</span>
                    <span className={cn('font-medium', (c.status === 'cancelled' || c.status === 'rejected') && 'text-muted-foreground line-through')}>{c.title}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{CHANGE_REASONS[c.reason]}</span>
                    {c.initiator && <span>{c.initiator.full_name}</span>}
                    {c.cost_impact !== null && <span className="tabular-nums">{money(c.cost_impact)}</span>}
                    {c.schedule_impact_days !== null && <span className="tabular-nums">{tr('{{n}} дн.', { n: signed(c.schedule_impact_days) })}</span>}
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', statusClass(c.status))}>{CHANGE_STATUSES[c.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {opened === 'new' && <ChangeForm projectId={p.id} change={null} onClose={() => setOpened(null)} />}
      {current && <ChangeDialog projectId={p.id} change={current} perms={perms} money={money} onClose={() => setOpened(null)} />}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <section className="flex flex-col gap-0.5 rounded-lg border bg-card p-3 shadow-soft">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </section>
  )
}

const field = 'rounded-md border bg-background px-3 text-sm disabled:opacity-70'

/** Создание запроса и правка черновика: название, причина, описание. */
function ChangeForm({ projectId, change, onClose }: { projectId: string; change: ChangeRequest | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(change?.title ?? '')
  const [description, setDescription] = useState(change?.description ?? '')
  const [reason, setReason] = useState<ChangeReason>(change?.reason ?? 'client_request')
  const save = useMutation({
    mutationFn: () => saveChange(projectId, { id: change?.id, title: title.trim(), description, reason }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['changes', projectId] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
      toast.success(change ? tr('Запрос сохранён') : tr('Запрос записан'))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '42501' ? tr('Нет права создавать запросы на изменение.') : tr('Не удалось сохранить запрос. Проверьте поля.')),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{change ? `${change.key} · ${tr('правка')}` : tr('Новый запрос на изменение')}</DialogTitle>
          <DialogDescription>{tr('Что предлагается изменить и почему. Влияние на стоимость и срок оценят следующим шагом.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="cr-title" className="text-xs text-muted-foreground">
              {tr('Название')}
            </label>
            <input id="cr-title" value={title} maxLength={200} required autoFocus onChange={(e) => setTitle(e.target.value)} className={cn(field, 'h-10')} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cr-reason" className="text-xs text-muted-foreground">
              {tr('Причина')}
            </label>
            <select id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value as ChangeReason)} className={cn(field, 'h-10')}>
              {(Object.keys(CHANGE_REASONS) as ChangeReason[]).map((r) => (
                <option key={r} value={r}>
                  {CHANGE_REASONS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cr-desc" className="text-xs text-muted-foreground">
              {tr('Описание: что именно меняется')}
            </label>
            <textarea id="cr-desc" rows={4} maxLength={6000} value={description} onChange={(e) => setDescription(e.target.value)} className={cn(field, 'py-2')} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={save.isPending || !title.trim()}>
              {tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Карточка запроса: состав, оценка влияния, решение и кнопки перехода по маршруту, доступные роли. */
function ChangeDialog({ projectId, change: c, perms, money, onClose }: { projectId: string; change: ChangeRequest; perms: string[]; money: (n: number) => string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { symbol: cur } = useProjectCurrency(projectId)
  const canCreate = perms.includes('change.create')
  const canAssess = perms.includes('change.assess')
  const canApprove = perms.includes('change.approve')
  const [editing, setEditing] = useState(false)
  const [cost, setCost] = useState(c.cost_impact === null ? '' : String(c.cost_impact))
  const [days, setDays] = useState(c.schedule_impact_days === null ? '' : String(c.schedule_impact_days))
  const [aNote, setANote] = useState(c.assessment_note)
  const [note, setNote] = useState('')
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['changes', projectId] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
  const fail = (e: unknown) => {
    const m = (e as { message?: string })?.message ?? ''
    toast.error(m.includes('note_required') ? tr('Для отклонения укажите причину.') : m.includes('assessment_required') ? tr('Сначала оцените стоимость и срок.') : (e as { code?: string })?.code === '42501' ? tr('Эта роль не может выполнить такой шаг.') : tr('Не удалось выполнить шаг. Обновите страницу и повторите.'))
  }

  const assessing = c.status === 'draft' || c.status === 'assessment'
  const canEstimate = assessing && canAssess
  const costNum = cost.trim() === '' ? null : Number(cost.replace(',', '.').replace(/\s+/g, ''))
  const daysNum = days.trim() === '' ? null : Number(days.replace(',', '.'))
  const estimateOk = costNum !== null && Number.isFinite(costNum) && daysNum !== null && Number.isInteger(daysNum)

  const saveEstimate = useMutation({
    mutationFn: () => assessChange(c.id, costNum!, daysNum!, aNote),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Оценка сохранена'))
    },
    onError: fail,
  })
  const go = useMutation({
    mutationFn: async (to: ChangeStatus) => {
      // оценка уходит вместе с передачей на согласование, чтобы введённое не потерялось
      if (to === 'approval' && canEstimate && estimateOk) await assessChange(c.id, costNum!, daysNum!, aNote)
      await transitionChange(c.id, to, note)
    },
    onSuccess: async (_d, to) => {
      await refresh()
      toast.success(`${c.key}: ${CHANGE_STATUSES[to].toLowerCase()}`)
      onClose()
    },
    onError: fail,
  })

  if (editing) return <ChangeForm projectId={projectId} change={c} onClose={() => setEditing(false)} />

  const step = (to: ChangeStatus, label: string, opts?: { primary?: boolean; destructive?: boolean; disabled?: boolean }) => (
    <Button key={to + label} type="button" variant={opts?.destructive ? 'destructive' : opts?.primary ? 'default' : 'outline'} disabled={go.isPending || opts?.disabled} onClick={() => go.mutate(to)}>
      {label}
    </Button>
  )
  const actions: React.ReactNode[] = []
  if (c.status === 'draft') {
    if (canCreate) actions.push(step('assessment', tr('Отправить на оценку'), { primary: true }))
    if (canCreate || canApprove) actions.push(step('cancelled', tr('Отменить запрос')))
  } else if (c.status === 'assessment') {
    if (canAssess) actions.push(step('approval', tr('Передать на согласование'), { primary: true, disabled: !estimateOk && !(c.cost_impact !== null && c.schedule_impact_days !== null) }))
    if (canAssess) actions.push(step('draft', tr('Вернуть автору')))
    if (canCreate || canApprove) actions.push(step('cancelled', tr('Отменить запрос')))
  } else if (c.status === 'approval' && canApprove) {
    actions.push(step('approved', tr('Утвердить'), { primary: true }))
    actions.push(step('rejected', tr('Отклонить'), { destructive: true, disabled: note.trim() === '' }))
    actions.push(step('assessment', tr('На доработку оценки')))
  } else if (c.status === 'approved' && canApprove) {
    actions.push(step('implemented', tr('Отметить внедрённым'), { primary: true }))
  }
  const needsNote = c.status === 'approval' && canApprove

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="ident text-sm font-normal text-muted-foreground">{c.key}</span>
            {c.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusClass(c.status))}>{CHANGE_STATUSES[c.status]}</span>
            <span>{CHANGE_REASONS[c.reason]}</span>
            {c.initiator && <span>{tr('автор: {{name}}', { name: c.initiator.full_name })}</span>}
            <span>{dateFmt.format(new Date(c.created_at))}</span>
          </DialogDescription>
        </DialogHeader>

        {c.description.trim() && <p className="whitespace-pre-wrap text-sm">{c.description}</p>}

        <section className="flex flex-col gap-2 rounded-lg border p-3" aria-label={tr('Оценка влияния')}>
          <h3 className="text-sm font-semibold">{tr('Оценка влияния')}</h3>
          {canEstimate ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="cr-cost" className="text-xs text-muted-foreground">
                    {tr('Стоимость, {{cur}} (минус — экономия)', { cur })}
                  </label>
                  <input id="cr-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={cn(field, 'h-10 tabular-nums')} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="cr-days" className="text-xs text-muted-foreground">
                    {tr('Срок, дней (минус — быстрее)')}
                  </label>
                  <input id="cr-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={cn(field, 'h-10 tabular-nums')} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="cr-anote" className="text-xs text-muted-foreground">
                  {tr('Как посчитано')}
                </label>
                <textarea id="cr-anote" rows={2} maxLength={4000} value={aNote} onChange={(e) => setANote(e.target.value)} className={cn(field, 'py-2')} />
              </div>
              <div>
                <Button type="button" variant="secondary" size="sm" disabled={!estimateOk || saveEstimate.isPending} onClick={() => saveEstimate.mutate()}>
                  {tr('Сохранить оценку')}
                </Button>
              </div>
            </>
          ) : c.cost_impact === null && c.schedule_impact_days === null ? (
            <p className="text-sm text-muted-foreground">{tr('Влияние ещё не оценено.')}</p>
          ) : (
            <>
              <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
                <span>
                  {tr('Стоимость')}: <b>{c.cost_impact === null ? '—' : money(c.cost_impact)}</b>
                </span>
                <span>
                  {tr('Срок')}: <b>{c.schedule_impact_days === null ? '—' : tr('{{n}} дн.', { n: signed(c.schedule_impact_days) })}</b>
                </span>
              </p>
              {c.assessment_note.trim() && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{c.assessment_note}</p>}
            </>
          )}
        </section>

        {(c.status === 'approved' || c.status === 'rejected' || c.status === 'implemented') && c.decided_at && (
          <p className="text-sm">
            <b>{c.status === 'rejected' ? tr('Отклонён') : tr('Утверждён')}</b>
            {c.decider ? `, ${c.decider.full_name}` : ''}, {dateFmt.format(new Date(c.decided_at))}
            {c.decision_note.trim() && <span className="mt-1 block whitespace-pre-wrap text-muted-foreground">{c.decision_note}</span>}
          </p>
        )}

        {actions.length > 0 && (
          <div className="flex flex-col gap-2">
            {needsNote && (
              <div className="flex flex-col gap-1">
                <label htmlFor="cr-note" className="text-xs text-muted-foreground">
                  {tr('Комментарий к решению (при отклонении обязателен)')}
                </label>
                <textarea id="cr-note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'py-2')} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {c.status === 'draft' && canCreate ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
              {tr('Править текст')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Закрыть')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
