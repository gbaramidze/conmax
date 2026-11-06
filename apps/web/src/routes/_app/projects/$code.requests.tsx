import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cbsQuery } from '@/features/budget/api'
import {
  isActive,
  REQUEST_STATUSES,
  requestBudget,
  requestsQuery,
  requestTotal,
  saveRequest,
  setRequestItem,
  statusClass,
  transitionRequest,
  type MaterialRequest,
  type RequestLine,
  type RequestStatus,
} from '@/features/procurement/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { useProjectCurrency } from '@/features/projects/currency'
import { displaySymbol, toDisplay } from '@/features/projects/display-currency'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Реестр»: заявки на материалы с площадки и их согласование
export const Route = createFileRoute('/_app/projects/$code/requests')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(requestsQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем заявки…')}</p>,
  component: RequestsPage,
})

const GROUPS = ['active', 'done', 'all'] as const
type Group = (typeof GROUPS)[number]

function RequestsPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: requests } = useSuspenseQuery(requestsQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canRequest = perms.includes('procurement.request')
  const [group, setGroup] = useState<Group>('active')
  const [opened, setOpened] = useState<string | 'new' | null>(null)
  const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 })
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
  const today = new Date().toLocaleDateString('sv')

  const shown = useMemo(() => requests.filter((r) => (group === 'all' ? true : group === 'active' ? isActive(r.status) : !isActive(r.status))), [requests, group])
  const waiting = requests.filter((r) => r.status === 'submitted')
  const toOrder = requests.filter((r) => r.status === 'approved')
  const current = typeof opened === 'string' && opened !== 'new' ? requests.find((r) => r.id === opened) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="requests" title={tr('Что такое заявка на материалы')}>
        <p>{tr('Заявка — это «нужно привезти на площадку»: что, сколько и к какой дате. Её заводит прораб или мастер, согласует руководитель проекта, и только после этого материалы заказывают.')}</p>
        <p>{tr('При согласовании система сверяет оценку заявки с остатком бюджета статьи: если не хватает, заявку можно согласовать только с комментарием, и это видно в ленте проекта. Запросы цен поставщикам и сравнение предложений появятся следующим этапом.')}</p>
      </PageHelp>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={tr('Ждут согласования')} value={String(waiting.length)} hint={waiting.length ? `${nf.format(toDisplay(waiting.reduce((s, r) => s + requestTotal(r), 0)))} ${displaySymbol()}` : tr('Нет заявок на согласовании')} />
        <Stat label={tr('Согласованы, ещё не заказаны')} value={String(toOrder.length)} hint={toOrder.length ? `${nf.format(toDisplay(toOrder.reduce((s, r) => s + requestTotal(r), 0)))} ${displaySymbol()}` : tr('Нечего заказывать')} />
        <Stat label={tr('Всего заявок')} value={String(requests.length)} hint={tr('В работе: {{n}}', { n: requests.filter((r) => isActive(r.status)).length })} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={tr('Показать')} value={group} onChange={(e) => setGroup(e.target.value as Group)} className="h-10 rounded-md border bg-background px-2 text-sm">
          <option value="active">{tr('В работе')}</option>
          <option value="done">{tr('Завершённые')}</option>
          <option value="all">{tr('Все')}</option>
        </select>
        {canRequest && (
          <Button className="ml-auto" onClick={() => setOpened('new')}>
            <Plus /> {tr('Новая заявка')}
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {requests.length === 0 ? (canRequest ? tr('Заявок пока нет. Заведите первую, когда на площадке понадобятся материалы.') : tr('Заявок пока нет.')) : tr('В этой группе заявок нет.')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => {
            const late = r.needed_by && r.needed_by < today && (r.status === 'approved' || r.status === 'ordered' || r.status === 'submitted')
            const total = requestTotal(r)
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpened(r.id)} className="flex w-full flex-wrap items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="ident text-xs text-muted-foreground">{r.key}</span>
                      <span className={cn('font-medium', (r.status === 'cancelled' || r.status === 'rejected') && 'text-muted-foreground line-through')}>{r.title}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{tr('позиций: {{n}}', { n: r.lines.length })}</span>
                      {total > 0 && <span className="tabular-nums">{`${nf.format(toDisplay(total))} ${displaySymbol()}`}</span>}
                      {r.requester && <span>{r.requester.full_name}</span>}
                      {r.needed_by && <span className={cn(late && 'font-medium text-red-700 dark:text-red-300')}>{tr('нужно до {{d}}', { d: dateFmt.format(new Date(`${r.needed_by}T12:00:00`)) })}</span>}
                      {r.over_budget && <span className="font-medium text-amber-800 dark:text-amber-300">{tr('сверх бюджета')}</span>}
                    </span>
                  </span>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', statusClass(r.status))}>{REQUEST_STATUSES[r.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {opened === 'new' && <RequestForm projectId={p.id} request={null} perms={perms} onClose={() => setOpened(null)} />}
      {current && <RequestDialog projectId={p.id} request={current} perms={perms} onClose={() => setOpened(null)} />}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <section className="flex flex-col gap-0.5 rounded-lg border bg-card p-3 shadow-soft">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>
    </section>
  )
}

const field = 'rounded-md border bg-background px-3 text-sm disabled:opacity-70'
const emptyLine = (): RequestLine => ({ name: '', unit: '', qty: 1, est_price: null, note: '' })

/** Создание заявки и правка черновика: название, срок, статья бюджета (если есть право читать бюджет), позиции. */
function RequestForm({ projectId, request, perms, onClose }: { projectId: string; request: MaterialRequest | null; perms: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { symbol: cur } = useProjectCurrency(projectId)
  const canSeeBudget = perms.includes('budget.view')
  const { data: items = [] } = useQuery({ ...cbsQuery(projectId), enabled: canSeeBudget })
  const [title, setTitle] = useState(request?.title ?? '')
  const [neededBy, setNeededBy] = useState(request?.needed_by ?? '')
  const [cbsItem, setCbsItem] = useState(request?.cbs_item_id ?? '')
  const [note, setNote] = useState(request?.note ?? '')
  const [lines, setLines] = useState<RequestLine[]>(request?.lines.length ? request.lines.map((l) => ({ ...l })) : [emptyLine()])
  const setLine = (i: number, patch: Partial<RequestLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const valid = title.trim() && lines.every((l) => l.name.trim() && l.qty > 0)
  const save = useMutation({
    mutationFn: () => saveRequest(projectId, { id: request?.id, title: title.trim(), cbsItem: cbsItem || null, neededBy: neededBy || null, note, lines: lines.map((l) => ({ ...l, name: l.name.trim() })) }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['requests', projectId] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
      toast.success(request ? tr('Заявка сохранена') : tr('Заявка записана'))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '42501' ? tr('Нет права создавать заявки.') : tr('Не удалось сохранить заявку. Проверьте поля и позиции.')),
  })
  const total = lines.reduce((s, l) => s + l.qty * (l.est_price ?? 0), 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request ? `${request.key} · ${tr('правка')}` : tr('Новая заявка на материалы')}</DialogTitle>
          <DialogDescription>{tr('Что нужно привезти на площадку, сколько и к какой дате.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="pr-title" className="text-xs text-muted-foreground">
              {tr('Название заявки')}
            </label>
            <input id="pr-title" value={title} maxLength={200} required autoFocus={!request} onChange={(e) => setTitle(e.target.value)} className={cn(field, 'h-10')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="pr-needed" className="text-xs text-muted-foreground">
                {tr('Нужно на площадке до')}
              </label>
              <DatePicker id="pr-needed" value={neededBy} onChange={setNeededBy} />
            </div>
            {canSeeBudget && (
              <div className="flex flex-col gap-1">
                <label htmlFor="pr-item" className="text-xs text-muted-foreground">
                  {tr('Статья бюджета')}
                </label>
                <select id="pr-item" value={cbsItem} onChange={(e) => setCbsItem(e.target.value)} className={cn(field, 'h-10')}>
                  <option value="">{tr('Не выбрана')}</option>
                  {[...items]
                    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code} · {i.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-muted-foreground">{tr('Позиции')}</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_auto]">
                <input aria-label={tr('Наименование')} placeholder={tr('Наименование')} value={l.name} maxLength={300} onChange={(e) => setLine(i, { name: e.target.value })} className={cn(field, 'col-span-1 h-10 sm:col-span-1')} />
                <button type="button" aria-label={tr('Убрать позицию')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 sm:order-last">
                  <Trash2 className="size-4" />
                </button>
                <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
                  <input aria-label={tr('Количество')} placeholder={tr('Кол-во')} inputMode="decimal" value={l.qty || ''} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(',', '.')) || 0 })} className={cn(field, 'h-10 tabular-nums')} />
                  <input aria-label={tr('Единица')} placeholder={tr('Ед.')} value={l.unit} maxLength={20} onChange={(e) => setLine(i, { unit: e.target.value })} className={cn(field, 'h-10')} />
                  <input aria-label={tr('Цена за единицу, {{cur}}', { cur })} placeholder={tr('Цена, {{cur}}', { cur })} inputMode="decimal" value={l.est_price ?? ''} onChange={(e) => setLine(i, { est_price: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0 })} className={cn(field, 'h-10 tabular-nums')} />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus /> {tr('Добавить позицию')}
              </Button>
              {total > 0 && (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {tr('Оценка')}: <b className="text-foreground">{`${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(total)} ${cur}`}</b>
                </span>
              )}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor="pr-note" className="text-xs text-muted-foreground">
              {tr('Примечание: куда доставить, требования к материалу')}
            </label>
            <textarea id="pr-note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'py-2')} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={save.isPending || !valid}>
              {tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Карточка заявки: состав, проверка остатка бюджета, решение и кнопки шага для тех, кому они разрешены. */
function RequestDialog({ projectId, request: r, perms, onClose }: { projectId: string; request: MaterialRequest; perms: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const canRequest = perms.includes('procurement.request')
  const canApprove = perms.includes('procurement.approve')
  const canSeeBudget = perms.includes('budget.view') || canApprove
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 })
  const money = (n: number) => `${nf.format(toDisplay(n))} ${displaySymbol()}`
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
  const { data: items = [] } = useQuery({ ...cbsQuery(projectId), enabled: canApprove })
  const { data: budget } = useQuery({
    queryKey: ['request-budget', r.id, r.status, r.cbs_item_id],
    queryFn: () => requestBudget(r.id),
    enabled: canSeeBudget && !!r.cbs_item_id && (r.status === 'draft' || r.status === 'submitted' || r.status === 'approved'),
  })
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['requests', projectId] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
  const total = requestTotal(r)
  const over = !!budget && total > budget.remaining + 0.005

  const fail = (e: unknown) => {
    const m = (e as { message?: string })?.message ?? ''
    toast.error(
      m.includes('over_budget_note_required')
        ? tr('Оценка выше остатка бюджета: напишите комментарий, почему согласуете.')
        : m.includes('note_required')
          ? tr('Для отклонения укажите причину.')
          : m.includes('lines_required')
            ? tr('Добавьте хотя бы одну позицию.')
            : (e as { code?: string })?.code === '42501'
              ? tr('Эта роль не может выполнить такой шаг.')
              : tr('Не удалось выполнить шаг. Обновите страницу и повторите.'),
    )
  }
  const go = useMutation({
    mutationFn: (to: RequestStatus) => transitionRequest(r.id, to, note),
    onSuccess: async (_d, to) => {
      await refresh()
      toast.success(`${r.key}: ${REQUEST_STATUSES[to].toLowerCase()}`)
      onClose()
    },
    onError: fail,
  })
  const setItem = useMutation({
    mutationFn: (id: string) => setRequestItem(r.id, id || null),
    onSuccess: refresh,
    onError: fail,
  })

  if (editing) return <RequestForm projectId={projectId} request={r} perms={perms} onClose={() => setEditing(false)} />

  const step = (to: RequestStatus, label: string, opts?: { primary?: boolean; destructive?: boolean; disabled?: boolean }) => (
    <Button key={to + label} type="button" variant={opts?.destructive ? 'destructive' : opts?.primary ? 'default' : 'outline'} disabled={go.isPending || opts?.disabled} onClick={() => go.mutate(to)}>
      {label}
    </Button>
  )
  const actions: React.ReactNode[] = []
  if (r.status === 'draft') {
    if (canRequest) actions.push(step('submitted', tr('Отправить на согласование'), { primary: true, disabled: r.lines.length === 0 }))
    if (canRequest || canApprove) actions.push(step('cancelled', tr('Отменить заявку')))
  } else if (r.status === 'submitted') {
    if (canApprove) {
      actions.push(step('approved', over ? tr('Согласовать сверх бюджета') : tr('Согласовать'), { primary: true, disabled: over && note.trim() === '' }))
      actions.push(step('rejected', tr('Отклонить'), { destructive: true, disabled: note.trim() === '' }))
      actions.push(step('draft', tr('Вернуть на доработку')))
    }
    if (canRequest || canApprove) actions.push(step('cancelled', tr('Отменить заявку')))
  } else if (r.status === 'approved') {
    if (canApprove) actions.push(step('ordered', tr('Отметить заказанной'), { primary: true }))
    if (canRequest || canApprove) actions.push(step('cancelled', tr('Отменить заявку')))
  } else if (r.status === 'ordered' && (canRequest || canApprove)) {
    actions.push(step('delivered', tr('Материалы поставлены'), { primary: true }))
  }
  const needsNote = (r.status === 'submitted' && canApprove) || (r.status === 'approved' && canApprove)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="ident text-sm font-normal text-muted-foreground">{r.key}</span>
            {r.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusClass(r.status))}>{REQUEST_STATUSES[r.status]}</span>
            {r.requester && <span>{tr('автор: {{name}}', { name: r.requester.full_name })}</span>}
            {r.needed_by && <span>{tr('нужно до {{d}}', { d: dateFmt.format(new Date(`${r.needed_by}T12:00:00`)) })}</span>}
            {r.item && (
              <span>
                {r.item.code} · {r.item.name}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{tr('Наименование')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('Кол-во')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('Цена')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('Сумма')}</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {l.qty} {l.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.est_price === null ? '—' : money(l.est_price)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.est_price === null ? '—' : money(l.qty * l.est_price)}</td>
                </tr>
              ))}
            </tbody>
            {total > 0 && (
              <tfoot>
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-2" colSpan={3}>
                    {tr('Оценка заявки')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {r.note.trim() && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}

        {canApprove && (r.status === 'draft' || r.status === 'submitted' || r.status === 'approved') && (
          <div className="flex flex-col gap-1">
            <label htmlFor="pr-set-item" className="text-xs text-muted-foreground">
              {tr('Статья бюджета')}
            </label>
            <select id="pr-set-item" value={r.cbs_item_id ?? ''} disabled={setItem.isPending} onChange={(e) => setItem.mutate(e.target.value)} className={cn(field, 'h-10')}>
              <option value="">{tr('Не выбрана')}</option>
              {[...items]
                .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {budget && (
          <section className={cn('flex flex-col gap-1 rounded-lg border p-3 text-sm', over ? 'border-amber-500/60 bg-amber-400/10' : 'bg-muted/30')} aria-label={tr('Остаток бюджета')}>
            <h3 className="font-semibold">{over ? tr('Оценка выше остатка бюджета статьи') : tr('Остаток бюджета статьи достаточен')}</h3>
            <p className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
              <span>
                {tr('Бюджет')}: {money(budget.bac)}
              </span>
              <span>
                {tr('Обязательства и факт')}: {money(Math.max(budget.committed, budget.actual))}
              </span>
              <span>
                {tr('Согласовано, не заказано')}: {money(budget.reserved)}
              </span>
              <span className="font-medium text-foreground">
                {tr('Остаток')}: {money(budget.remaining)}
              </span>
            </p>
          </section>
        )}
        {!r.cbs_item_id && canApprove && r.status === 'submitted' && <p className="text-xs text-muted-foreground">{tr('Статья бюджета не выбрана: остаток не проверяется.')}</p>}

        {(r.status === 'rejected' || r.decision_note.trim() || r.order_ref.trim()) && (
          <p className="text-sm">
            {r.decision_note.trim() && (
              <span className="block whitespace-pre-wrap">
                <b>{r.status === 'rejected' ? tr('Отклонена') : tr('Решение')}</b>
                {r.decider ? `, ${r.decider.full_name}` : ''}
                {r.decided_at ? `, ${dateFmt.format(new Date(r.decided_at))}` : ''}: {r.decision_note}
              </span>
            )}
            {r.order_ref.trim() && (
              <span className="block text-muted-foreground">
                {tr('Заказ')}: {r.order_ref}
              </span>
            )}
          </p>
        )}

        {actions.length > 0 && (
          <div className="flex flex-col gap-2">
            {needsNote && (
              <div className="flex flex-col gap-1">
                <label htmlFor="pr-note-decision" className="text-xs text-muted-foreground">
                  {r.status === 'approved' ? tr('Номер заказа или договора') : tr('Комментарий (при отклонении и согласовании сверх бюджета обязателен)')}
                </label>
                <input id="pr-note-decision" maxLength={r.status === 'approved' ? 200 : 4000} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-10')} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {r.status === 'draft' && canRequest ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
              {tr('Править заявку')}
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
