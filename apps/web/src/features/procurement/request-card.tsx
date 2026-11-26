import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, Loader2, Pencil, Plus, Trash2, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cbsQuery } from '@/features/budget/api'
import { CbsPicker } from '@/features/budget/cbs-picker'
import { symbolOf } from '@/features/projects/currency'
import { currentLocale } from '@/lib/i18n'
import { tr, trData } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-provider'
import { formatBytes, openFile } from '@/features/activity/api'
import { downloadDecisionSheet } from './decision-sheet'
import {
  attachToRequest,
  decide,
  deleteQuote,
  detachFile,
  dueState,
  hintKey,
  priceHintsQuery,
  suggestQuery,
  suppliersQuery,
  TIERS,
  inBase,
  nowText,
  placeOrder,
  procurementPeopleQuery,
  quoteTotal,
  receive,
  RECEIPTS,
  REQUEST_STATUSES,
  requestBudget,
  requestErrorText,
  requestQuery,
  saveQuote,
  sendToApproval,
  setStock,
  statusClass,
  STEPS,
  STOCK_STATUSES,
  transitionRequest,
  TRANSPORTS,
  updateDelivery,
  type Quote,
  type Receipt,
  type RequestDetail,
  type RequestStatus,
  type Transport,
} from './api'
import { field, RequestForm } from './request-form'
import { BudgetLines, PaymentsSection } from './payments'
import { LinePhotoThumb } from './line-photo'

/** Фото позиции заявки для строки запроса цен: строки запроса скопированы из заявки по порядку */
const photoOf = (r: RequestDetail, position: number) => r.lines.find((x) => x.position === position)?.photo ?? null

const nf = (digits = 2) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: digits })
const money = (n: number, cur: string | null) => `${nf().format(n)} ${cur ? symbolOf(cur) : ''}`.trim()
const day = (d: string) => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d.length === 10 ? `${d}T12:00:00` : d))
const stamp = (d: string) => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
const section = 'flex flex-col gap-2 rounded-lg border p-3'
const h3 = 'text-sm font-semibold'

/**
 * Карточка заявки на закупку: где она сейчас (полоса шагов и фраза), что сделать мне, позиции, склад, предложения,
 * согласующие, заказ и поставка, история. Открывается из списка проекта и со страницы «Закупки» (по ссылке из уведомления).
 */
export function RequestCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: r, isLoading } = useQuery(requestQuery(id))
  const [editing, setEditing] = useState(false)

  if (r && editing) {
    return <RequestForm projectId={r.project.id} request={r} onClose={() => setEditing(false)} />
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl">
        {!r ? (
          <>
            <DialogHeader>
              <DialogTitle>{tr('Заявка на закупку')}</DialogTitle>
              <DialogDescription>{isLoading ? tr('Загружаем…') : tr('Заявка недоступна: её удалили или у вас нет к ней доступа.')}</DialogDescription>
            </DialogHeader>
            {isLoading && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />}
          </>
        ) : (
          <CardBody r={r} onEdit={() => setEditing(true)} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function useRefresh(r: RequestDetail) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['request', r.id] }),
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['budget'] }),
    ])
}

function CardBody({ r, onEdit, onClose }: { r: RequestDetail; onEdit: () => void; onClose: () => void }) {
  const refresh = useRefresh(r)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelNote, setCancelNote] = useState('')
  const cancel = useMutation({
    mutationFn: () => transitionRequest(r.id, 'cancelled', cancelNote),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('{{key}}: заявка отменена', { key: r.key }))
      setConfirmCancel(false)
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const late = r.needed_by && r.needed_by < new Date().toLocaleDateString('sv') && !['delivered', 'rejected', 'cancelled'].includes(r.status)
  const early = ['draft', 'submitted', 'sourcing', 'approval', 'confirming', 'confirmed'].includes(r.status)
  const canCancel = (early && (r.me.can_request || r.me.is_buyer || r.me.is_owner)) || ((r.status === 'ordered' || r.status === 'shipped') && r.me.is_buyer)
  const afterOrder = r.status === 'ordered' || r.status === 'shipped' || r.status === 'delivered'

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
          <span className="ident text-sm font-normal text-muted-foreground">{r.key}</span>
          {r.title}
          {r.urgent && <span className="rounded-full border border-amber-500/60 bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">{tr('Срочно')}</span>}
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusClass(r.status))}>{REQUEST_STATUSES[r.status]}</span>
          <span>
            {r.project.code} · {r.project.name}
          </span>
          {r.requester_name && <span>{tr('инициатор: {{name}}', { name: r.requester_name })}</span>}
          {r.buyer_name && <span>{tr('закупщик: {{name}}', { name: r.buyer_name })}</span>}
          {r.needed_by && <span className={cn(late && 'font-medium text-red-700 dark:text-red-300')}>{tr('нужно до {{d}}', { d: day(r.needed_by) })}</span>}
        </DialogDescription>
      </DialogHeader>

      <Progress status={r.status} />
      <p className="text-sm">
        <b>{tr('Сейчас')}:</b> {r.status === 'delivered' && r.receipt ? RECEIPTS[r.receipt] : nowText({ ...r, approvals_total: r.approvals.filter((a) => a.round === r.approval_round).length, approvals_done: r.approvals.filter((a) => a.round === r.approval_round && a.status === 'approved').length })}
        {r.expected_at && (r.status === 'ordered' || r.status === 'shipped') && <> · {tr('ожидается {{d}}', { d: day(r.expected_at) })}</>}
        {r.due_at && r.status !== 'ordered' && r.status !== 'shipped' && <DueText due={r.due_at} />}
        {r.due_at && (r.status === 'ordered' || r.status === 'shipped') && dueState(r.due_at) === 'late' && <span className="font-medium text-red-700 dark:text-red-300"> · {tr('поставка опаздывает')}</span>}
      </p>
      {r.decision_note.trim() && (r.status === 'sourcing' || r.status === 'draft' || r.status === 'rejected' || r.status === 'cancelled') && (
        <p className="rounded-md border border-amber-500/50 bg-amber-400/10 px-3 py-2 text-sm">
          <b>{r.status === 'cancelled' ? tr('Причина отмены') : r.status === 'rejected' ? tr('Причина отказа') : tr('Последнее замечание')}:</b> {r.decision_note}
        </p>
      )}

      <MyStep r={r} onEdit={onEdit} />

      <Lines r={r} />
      {r.note.trim() && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}
      <FilesSection r={r} />
      <StockSection r={r} />
      {r.rfq && r.me.can_see_prices && (r.status !== 'submitted' || r.rfq.quotes.length > 0) && <QuotesSection r={r} />}
      {!r.me.can_see_prices && <ChosenSection r={r} />}
      {r.approvals.length > 0 && <ApprovalsSection r={r} />}
      {afterOrder && <DeliverySection r={r} />}
      <BudgetLines r={r} />
      <BudgetSection r={r} />
      <PaymentsSection r={r} />
      <History r={r} />

      <DialogFooter className="gap-2 sm:justify-between">
        {canCancel ? (
          confirmCancel ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {(r.status === 'ordered' || r.status === 'shipped') && <input aria-label={tr('Причина отмены')} placeholder={tr('Причина отмены')} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} className={cn(field, 'h-10')} />}
              <Button type="button" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {tr('Да, отменить заявку')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                {tr('Не отменять')}
              </Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmCancel(true)}>
              {tr('Отменить заявку')}
            </Button>
          )
        ) : (
          <span />
        )}
        <span className="flex flex-wrap gap-2">
          {r.quote_id && r.me.can_see_prices && ['approval', 'confirming', 'confirmed', 'ordered', 'shipped', 'delivered'].includes(r.status) && <DecisionSheetButton r={r} />}
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Закрыть')}
          </Button>
        </span>
      </DialogFooter>
    </>
  )
}

/** Полоса шагов: пройденные с галочкой, текущий выделен; отменённая или отклонённая — отдельной строкой */
function Progress({ status }: { status: RequestStatus }) {
  if (status === 'rejected' || status === 'cancelled') return null
  const current = STEPS.findIndex((s) => s.statuses.includes(status))
  return (
    <ol className="grid grid-cols-8 gap-1" aria-label={tr('Шаги заявки')}>
      {STEPS.map((s, i) => {
        const done = i < current || status === 'delivered'
        const now = i === current && status !== 'delivered'
        return (
          <li key={s.key} className="flex min-w-0 flex-col items-center gap-1 text-center" aria-current={now ? 'step' : undefined}>
            <span className={cn('h-1.5 w-full rounded-full', done ? 'bg-emerald-600' : now ? 'bg-primary' : 'bg-muted')} aria-hidden />
            <span className={cn('flex items-center gap-0.5 text-[11px] leading-tight sm:text-xs', now ? 'font-semibold text-foreground max-sm:sr-only' : done ? 'text-emerald-800 max-sm:sr-only dark:text-emerald-300' : 'text-muted-foreground max-sm:sr-only')}>
              {done && <Check className="hidden size-3 shrink-0 sm:block" aria-hidden />}
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** «Ваш шаг»: кнопки только для того, чей сейчас ход */
function MyStep({ r, onEdit }: { r: RequestDetail; onEdit: () => void }) {
  const refresh = useRefresh(r)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<null | 'return' | 'reject' | 'decline' | 'back' | 'partial' | 'issues'>(null)
  const go = useMutation({
    mutationFn: (v: { to: RequestStatus; note?: string }) => transitionRequest(r.id, v.to, v.note ?? ''),
    onSuccess: async (_d, v) => {
      await refresh()
      setMode(null)
      setNote('')
      toast.success(`${r.key}: ${REQUEST_STATUSES[v.to].toLowerCase()}`)
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const vote = useMutation({
    mutationFn: (approve: boolean) => decide(r.id, approve, note),
    onSuccess: async (_d, approve) => {
      await refresh()
      setMode(null)
      setNote('')
      toast.success(approve ? tr('Вы одобрили закупку') : tr('Закупка возвращена закупщику с вашей причиной'))
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const got = useMutation({
    mutationFn: (result: Receipt) => receive(r.id, result, note, result === 'partial' ? Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, Number(v.replace(',', '.')) || 0]).filter(([, v]) => (v as number) > 0)) : undefined),
    onSuccess: async () => {
      await refresh()
      setMode(null)
      setNote('')
      toast.success(tr('Получение отмечено'))
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const busy = go.isPending || vote.isPending || got.isPending
  // частичная приёмка: сколько пришло сейчас по каждой позиции
  const [qty, setQty] = useState<Record<string, string>>({})
  const someQty = Object.values(qty).some((v) => (Number(v.replace(',', '.')) || 0) > 0)

  const box = (title: string, body: React.ReactNode, tone: 'primary' | 'amber' = 'primary') => (
    <section className={cn('flex flex-col gap-2 rounded-lg border p-3', tone === 'amber' ? 'border-amber-500/60 bg-amber-400/10' : 'border-primary/40 bg-primary/5')} aria-label={tr('Ваш шаг')}>
      <h3 className={h3}>{title}</h3>
      {body}
    </section>
  )
  const noteInput = (label: string) => <textarea aria-label={label} placeholder={label} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'py-2')} autoFocus />
  const row = (...nodes: React.ReactNode[]) => <div className="flex flex-wrap gap-2">{nodes}</div>
  const withNote = (label: string, submit: React.ReactNode) => (
    <>
      {noteInput(label)}
      {row(
        submit,
        <Button key="x" variant="ghost" onClick={() => setMode(null)}>
          {tr('Назад')}
        </Button>,
      )}
    </>
  )

  const q = r.rfq?.quotes.find((x) => x.id === r.quote_id)

  if (r.status === 'draft' && (r.me.can_request || r.me.is_owner)) {
    return box(
      tr('Ваш шаг: проверьте и отправьте в закупки'),
      row(
        <Button key="s" disabled={busy || r.lines.length === 0} onClick={() => go.mutate({ to: 'submitted' })}>
          {tr('Отправить в закупки')}
        </Button>,
        r.me.can_request && (
          <Button key="e" variant="outline" onClick={onEdit}>
            <Pencil /> {tr('Править')}
          </Button>
        ),
      ),
    )
  }

  if (r.status === 'review' && r.me.is_manager) {
    if (mode === 'return' || mode === 'reject') {
      return box(
        mode === 'return' ? tr('Вернуть сотруднику на доработку') : tr('Отклонить заявку'),
        withNote(
          tr('Причина — её увидит сотрудник'),
          <Button key="ok" variant={mode === 'reject' ? 'destructive' : 'default'} disabled={busy || !note.trim()} onClick={() => go.mutate({ to: mode === 'return' ? 'draft' : 'rejected', note })}>
            {mode === 'return' ? tr('Вернуть') : tr('Отклонить')}
          </Button>,
        ),
        'amber',
      )
    }
    return box(
      tr('Ваш шаг: подтвердите, что это действительно нужно'),
      <>
        <p className="text-sm text-muted-foreground">{tr('Проверьте, что закупка нужна, а количество и характеристики точные: после вашего подтверждения заявку возьмут в работу закупщики, и меняться она уже не должна.')}</p>
        {row(
          <Button key="a" disabled={busy} onClick={() => go.mutate({ to: 'submitted' })}>
            <Check /> {tr('Подтвердить')}
          </Button>,
          <Button key="r" variant="outline" onClick={() => setMode('return')}>
            {tr('Вернуть на доработку')}
          </Button>,
          <Button key="j" variant="ghost" onClick={() => setMode('reject')}>
            {tr('Отклонить')}
          </Button>,
        )}
      </>,
    )
  }

  if (r.status === 'stock_check' && (r.me.is_storekeeper || r.me.is_buyer)) {
    return box(tr('Ваш шаг: проверьте, есть ли это на складе'), <p className="text-sm text-muted-foreground">{tr('Отметьте ниже в разделе «Склад»: нет, есть частично или есть всё. Закупщик и сотрудник получат уведомление.')}</p>)
  }

  if ((r.status === 'submitted' || r.status === 'sourcing') && r.me.is_buyer) {
    if (mode === 'return' || mode === 'reject') {
      return box(
        mode === 'return' ? tr('Вернуть инициатору на доработку') : tr('Отклонить заявку'),
        withNote(
          tr('Причина — её увидит инициатор'),
          <Button key="ok" variant={mode === 'reject' ? 'destructive' : 'default'} disabled={busy || !note.trim()} onClick={() => go.mutate({ to: mode === 'return' ? 'draft' : 'rejected', note })}>
            {mode === 'return' ? tr('Вернуть') : tr('Отклонить')}
          </Button>,
        ),
        'amber',
      )
    }
    const mine = r.buyer_id && r.status === 'sourcing'
    return box(
      r.status === 'submitted' ? tr('Новая заявка: возьмите в работу') : tr('Ищем цены: внесите предложения (лучше три) и отправьте лучшее на согласование'),
      row(
        r.status === 'submitted' && (
          <Button key="t" disabled={busy} onClick={() => go.mutate({ to: 'sourcing' })}>
            {tr('Взять в работу')}
          </Button>
        ),
        r.status === 'sourcing' && !mine && (
          <Button key="t2" disabled={busy} onClick={() => go.mutate({ to: 'sourcing' })}>
            {tr('Взять себе')}
          </Button>
        ),
        <Button key="sc" variant="outline" disabled={busy} onClick={() => go.mutate({ to: 'stock_check' })}>
          {tr('Проверить на складе')}
        </Button>,
        r.stock_status === 'available' && (
          <Button key="st" variant="outline" disabled={busy} onClick={() => go.mutate({ to: 'delivered', note: tr('Выдано со склада') })}>
            {tr('Выдать со склада и закрыть')}
          </Button>
        ),
        <Button key="r" variant="ghost" onClick={() => setMode('return')}>
          {tr('Вернуть на доработку')}
        </Button>,
        <Button key="j" variant="ghost" onClick={() => setMode('reject')}>
          {tr('Отклонить')}
        </Button>,
      ),
    )
  }

  if (r.status === 'approval' && r.me.my_approval) {
    if (mode === 'decline') {
      return box(
        tr('Не согласовать'),
        withNote(
          tr('Почему — закупщик увидит и поправит'),
          <Button key="d" variant="destructive" disabled={busy || !note.trim()} onClick={() => vote.mutate(false)}>
            {tr('Не согласовать')}
          </Button>,
        ),
        'amber',
      )
    }
    return box(
      tr('Ваш шаг: согласуйте закупку'),
      <>
        <p className="text-sm">
          {q ? tr('Поставщик «{{supplier}}», сумма {{sum}}.', { supplier: r.supplier, sum: money(r.amount ?? 0, r.currency) }) : null} {tr('Сравнение предложений — ниже.')}
        </p>
        {r.approval_note.trim() && (
          <p className="text-sm">
            <b>{tr('Закупщик')}:</b> {r.approval_note}
          </p>
        )}
        {r.single_source_reason.trim() && (
          <p className="text-sm">
            <b>{tr('Почему меньше трёх предложений')}:</b> {r.single_source_reason}
          </p>
        )}
        {r.over_budget && <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{tr('Сумма больше остатка бюджета статьи.')}</p>}
        {q?.supplier_status === 'restricted' && <p className="text-sm font-medium text-red-700 dark:text-red-300">{tr('Поставщик в ограниченном списке.')}</p>}
        <input aria-label={tr('Комментарий (необязательно)')} placeholder={tr('Комментарий (необязательно)')} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-10')} />
        {row(
          <Button key="a" disabled={busy} onClick={() => vote.mutate(true)}>
            <Check /> {tr('Одобрить')}
          </Button>,
          <Button key="d" variant="outline" onClick={() => setMode('decline')}>
            {tr('Не согласовать')}
          </Button>,
        )}
      </>,
    )
  }
  if (r.status === 'approval' && r.me.is_buyer) {
    return box(
      tr('На согласовании — ждём решения'),
      row(
        <Button key="w" variant="outline" disabled={busy} onClick={() => go.mutate({ to: 'sourcing' })}>
          {tr('Отозвать с согласования')}
        </Button>,
      ),
    )
  }

  if (r.status === 'confirming' && r.me.is_initiator) {
    if (mode === 'back') {
      return box(
        tr('Вернуть закупщику'),
        withNote(
          tr('Что не так — например, нужна другая марка'),
          <Button key="b" disabled={busy || !note.trim()} onClick={() => go.mutate({ to: 'sourcing', note })}>
            {tr('Вернуть')}
          </Button>,
        ),
        'amber',
      )
    }
    return box(
      tr('Ваш шаг: подтвердите, что заказываем именно это'),
      <>
        <p className="text-sm">
          {r.amount !== null
            ? tr('Поставщик «{{supplier}}», сумма {{sum}}. Проверьте позиции и цены ниже.', { supplier: r.supplier, sum: money(r.amount, r.currency) })
            : tr('Проверьте ниже, какие именно модели выбрали: это то, что вам нужно?')}
        </p>
        {row(
          <Button key="c" disabled={busy} onClick={() => go.mutate({ to: 'confirmed' })}>
            <Check /> {tr('Да, заказывайте')}
          </Button>,
          <Button key="b" variant="outline" onClick={() => setMode('back')}>
            {tr('Нет, вернуть закупщику')}
          </Button>,
        )}
      </>,
    )
  }

  if (r.status === 'confirmed' && r.me.is_buyer) return <OrderForm r={r} />

  if ((r.status === 'ordered' || r.status === 'shipped') && (r.me.is_buyer || r.me.is_owner || r.me.can_request)) {
    if (mode === 'partial') {
      return box(
        tr('Что пришло сейчас'),
        <>
          <p className="text-xs text-muted-foreground">{tr('Укажите, сколько пришло по каждой позиции. Заявка закроется, когда придёт всё.')}</p>
          <div className="flex flex-col gap-1.5">
            {r.lines.map((l) => {
              const left = Math.max(0, l.qty - (l.received_qty ?? 0))
              return (
                <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
                  <label htmlFor={`rc-${l.id}`} className="min-w-0 text-sm">
                    {l.name} <span className="text-xs text-muted-foreground tabular-nums">{tr('осталось {{n}} {{u}}', { n: nf(3).format(left), u: l.unit })}</span>
                  </label>
                  <input id={`rc-${l.id}`} inputMode="decimal" disabled={left === 0} placeholder="0" value={qty[l.id!] ?? ''} onChange={(e) => setQty((x) => ({ ...x, [l.id!]: e.target.value }))} className={cn(field, 'h-10 text-right tabular-nums')} />
                </div>
              )
            })}
          </div>
          {withNote(
            tr('Что не пришло или когда обещают остальное'),
            <Button key="p" disabled={busy || !note.trim() || !someQty} onClick={() => got.mutate('partial')}>
              {tr('Отметить')}
            </Button>,
          )}
        </>,
        'amber',
      )
    }
    if (mode === 'issues') {
      return box(
        RECEIPTS[mode],
        withNote(
          tr('Какие замечания: брак, не та марка, повреждения'),
          <Button key="p" disabled={busy || !note.trim()} onClick={() => got.mutate('issues')}>
            {tr('Отметить')}
          </Button>,
        ),
        'amber',
      )
    }
    return (
      <>
        {r.me.is_buyer && <DeliveryForm r={r} />}
        {box(
          r.receipt === 'partial' ? tr('Пришла часть. Остальное пришло?') : tr('Груз пришёл?'),
          row(
            <Button key="f" variant={r.me.is_buyer ? 'outline' : 'default'} disabled={busy} onClick={() => got.mutate('full')}>
              <Check /> {r.receipt === 'partial' ? tr('Пришло всё остальное') : tr('Получено полностью')}
            </Button>,
            <Button key="p" variant="outline" onClick={() => setMode('partial')}>
              {tr('Частично')}
            </Button>,
            <Button key="i" variant="outline" onClick={() => setMode('issues')}>
              {tr('С замечаниями')}
            </Button>,
          ),
        )}
      </>
    )
  }
  return null
}

function Lines({ r }: { r: RequestDetail }) {
  // цены инициатора показываются только у старых заявок, где их вносили; новые заявки — просто список
  const priced = r.lines.some((l) => l.est_price !== null)
  const total = r.lines.reduce((s, l) => s + l.qty * (l.est_price ?? 0), 0)
  // после заказа — сколько уже пришло по каждой позиции
  const tracked = ['ordered', 'shipped', 'delivered'].includes(r.status) && r.receipts.length > 0
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">{tr('Позиция')}</th>
            <th className="px-3 py-2 text-right font-medium">{tr('Кол-во')}</th>
            {tracked && <th className="px-3 py-2 text-right font-medium">{tr('Пришло')}</th>}
            {priced && <th className="px-3 py-2 text-right font-medium">{tr('Цена ≈')}</th>}
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  {l.photo && <LinePhotoThumb photo={l.photo} />}
                  {l.name}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {nf(3).format(l.qty)} {l.unit}
              </td>
              {tracked && (
                <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', (l.received_qty ?? 0) < l.qty ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300')}>
                  {nf(3).format(l.received_qty ?? 0)} {l.unit}
                </td>
              )}
              {priced && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.est_price === null ? '—' : money(l.est_price, r.project.currency)}</td>}
            </tr>
          ))}
        </tbody>
        {total > 0 && (
          <tfoot>
            <tr className="bg-muted/30 text-xs text-muted-foreground">
              <td className="px-3 py-2" colSpan={tracked ? 3 : 2}>
                {tr('Оценка инициатора')}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(total, r.project.currency)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function StockSection({ r }: { r: RequestDetail }) {
  const refresh = useRefresh(r)
  const [note, setNote] = useState(r.stock_note)
  const set = useMutation({
    mutationFn: (s: 'none' | 'partial' | 'available') => setStock(r.id, s, note),
    onSuccess: refresh,
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const editable = (r.me.is_buyer && (r.status === 'submitted' || r.status === 'sourcing')) || (r.status === 'stock_check' && (r.me.is_storekeeper || r.me.is_buyer))
  if (!editable && r.stock_status === 'unchecked') return null
  return (
    <section className={section} aria-label={tr('Склад')}>
      <h3 className={h3}>
        {tr('Склад')}: <span className={cn('font-normal', r.stock_status === 'available' && 'text-emerald-800 dark:text-emerald-300')}>{STOCK_STATUSES[r.stock_status]}</span>
      </h3>
      {!editable && r.stock_note.trim() && <p className="text-sm text-muted-foreground">{r.stock_note}</p>}
      {editable && (
        <>
          <p className="text-xs text-muted-foreground">{tr('Сначала проверьте остаток на складе (в 1C и на месте): покупать стоит только то, чего нет.')}</p>
          <input aria-label={tr('Что нашли на складе')} placeholder={tr('Что нашли на складе (код, количество)')} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-10')} />
          <div className="flex flex-wrap gap-2">
            {(['none', 'partial', 'available'] as const).map((s) => (
              <Button key={s} size="sm" variant={r.stock_status === s ? 'default' : 'outline'} disabled={set.isPending} onClick={() => set.mutate(s)}>
                {STOCK_STATUSES[s]}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/** Предложения поставщиков: позиции строками, поставщики столбцами; закупщик вносит, правит и отправляет лучшее на согласование */
function QuotesSection({ r }: { r: RequestDetail }) {
  const refresh = useRefresh(r)
  const rfq = r.rfq!
  const base = r.project.currency
  const rate = r.project.fx_rate
  const editable = r.me.is_buyer && r.status === 'sourcing'
  const [editing, setEditing] = useState<Quote | 'new' | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const remove = useMutation({ mutationFn: (id: string) => deleteQuote(id), onSuccess: refresh, onError: (e) => toast.error(requestErrorText(e)) })

  const totals = rfq.quotes.map((q) => {
    const t = quoteTotal(rfq.lines, q)
    return { q, total: t, base: t === null ? null : inBase(t, q.currency, base, rate) }
  })
  const best = Math.min(...totals.map((t) => t.base ?? Infinity))
  const shown = rfq.quotes

  return (
    <section className={section} aria-label={tr('Предложения поставщиков')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={h3}>{tr('Предложения поставщиков')}</h3>
        {(r.status === 'sourcing' || r.status === 'approval') && (
          <span className={cn('text-xs', rfq.quotes.length < 3 ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>
            {tr('{{n}} из минимум 3', { n: rfq.quotes.length })}
          </span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{editable ? tr('Предложений пока нет. Внесите первое, когда поставщик ответит.') : tr('Предложений пока нет.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{tr('Позиция')}</th>
                {shown.map((q) => (
                  <th key={q.id} className={cn('min-w-32 px-3 py-2 text-right font-medium', q.id === r.quote_id && 'bg-emerald-500/10')}>
                    <span className="block text-foreground">{q.supplier}</span>
                    <span className="block font-normal">
                      {q.currency}
                      {q.id === r.quote_id ? ` · ${tr('выбрано')}` : ''}
                    </span>
                    {q.supplier_status === 'restricted' && <span className="block font-medium text-red-700 dark:text-red-300">{tr('ограниченный список')}</span>}
                    {r.files.some((f) => f.quote_id === q.id) && <span className="block font-normal">{tr('КП: {{n}}', { n: r.files.filter((f) => f.quote_id === q.id).length })}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rfq.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {photoOf(r, l.position) && <LinePhotoThumb photo={photoOf(r, l.position)!} className="size-8" />}
                      <span>
                        {l.name} <span className="text-xs text-muted-foreground tabular-nums">{`${nf(3).format(l.qty)} ${l.unit}`}</span>
                      </span>
                    </span>
                  </td>
                  {shown.map((q) => {
                    const p = q.prices.find((x) => x.line_id === l.id)
                    return (
                      <td key={q.id} className={cn('px-3 py-2 text-right tabular-nums', q.id === r.quote_id && 'bg-emerald-500/10')}>
                        {p?.unit_price != null ? nf().format(p.unit_price) : '—'}
                        {p?.model && <span className="block text-xs font-normal text-muted-foreground">{p.model}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-3 py-2">{tr('Итого')}</td>
                {totals.map(({ q, total, base: b }) => (
                  <td key={q.id} className={cn('px-3 py-2 text-right tabular-nums', q.id === r.quote_id && 'bg-emerald-500/10')}>
                    {total === null ? <span className="text-xs font-normal text-muted-foreground">{tr('не по всем позициям')}</span> : money(total, q.currency)}
                    {total !== null && q.currency !== base && <span className="block text-xs font-normal text-muted-foreground">{b === null ? tr('нужен курс') : `≈ ${money(b, base)}`}</span>}
                    {b !== null && b === best && totals.length > 1 && <span className="block text-xs font-normal text-emerald-800 dark:text-emerald-300">{tr('самое дешёвое')}</span>}
                  </td>
                ))}
              </tr>
              <tr className="text-xs text-muted-foreground">
                <td className="px-3 py-2">{tr('Срок поставки')}</td>
                {shown.map((q) => (
                  <td key={q.id} className="px-3 py-2 text-right tabular-nums">
                    {q.delivery_days === null ? '—' : tr('{{n}} дн.', { n: q.delivery_days })}
                  </td>
                ))}
              </tr>
              <tr className="text-xs text-muted-foreground">
                <td className="px-3 py-2">{tr('Оплата и условия')}</td>
                {shown.map((q) => (
                  <td key={q.id} className="px-3 py-2 text-right">
                    {q.terms || '—'}
                  </td>
                ))}
              </tr>
              {editable && (
                <tr>
                  <td className="px-3 py-2" />
                  {shown.map((q) => (
                    <td key={q.id} className="px-3 py-2 text-right">
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        <Button size="sm" disabled={quoteTotal(rfq.lines, q) === null} onClick={() => setSending(q.id)}>
                          {tr('Выбрать')}
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={tr('Править предложение {{name}}', { name: q.supplier })} onClick={() => setEditing(q)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={tr('Убрать предложение {{name}}', { name: q.supplier })} disabled={remove.isPending} onClick={() => remove.mutate(q.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </span>
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
      {editable && !editing && !sending && (
        <div>
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus /> {tr('Внести предложение')}
          </Button>
        </div>
      )}
      {editable && editing && <QuoteEditor r={r} quote={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      {editable && sending && <SendApproval r={r} quote={rfq.quotes.find((q) => q.id === sending)!} onDone={() => setSending(null)} />}
    </section>
  )
}

function QuoteEditor({ r, quote, onDone }: { r: RequestDetail; quote: Quote | null; onDone: () => void }) {
  const refresh = useRefresh(r)
  const lines = r.rfq!.lines
  const [supplier, setSupplier] = useState(quote?.supplier ?? '')
  const [currency, setCurrency] = useState<string>(quote?.currency ?? r.project.currency)
  const [days, setDays] = useState(quote?.delivery_days == null ? '' : String(quote.delivery_days))
  const [terms, setTerms] = useState(quote?.terms ?? '')
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(quote?.prices.find((p) => p.line_id === l.id)?.unit_price ?? '')])))
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, quote?.prices.find((p) => p.line_id === l.id)?.model ?? ''])))
  const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const { data: suppliers = [] } = useQuery(suppliersQuery)
  const { data: hints = {} } = useQuery(priceHintsQuery(lines.map((l) => hintKey(l.name))))
  const known = suppliers.find((x) => x.name.trim().toLowerCase() === supplier.trim().toLowerCase())
  const valid = supplier.trim() && lines.some((l) => toNum(prices[l.id]) !== null) && lines.every((l) => toNum(prices[l.id]) === null || Number.isFinite(toNum(prices[l.id])))
  const save = useMutation({
    mutationFn: () => saveQuote(r.rfq!.id, { id: quote?.id, supplier: supplier.trim(), currency, deliveryDays: days.trim() === '' ? null : Math.max(0, Math.round(Number(days) || 0)), terms, note: '', prices: Object.fromEntries(lines.map((l) => [l.id, toNum(prices[l.id])])), models }),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Предложение сохранено'))
      onDone()
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  return (
    <form
      className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) save.mutate()
      }}
    >
      <h4 className="text-sm font-medium">{quote ? tr('Правка предложения') : tr('Новое предложение')}</h4>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <input aria-label={tr('Поставщик')} placeholder={tr('Поставщик — из справочника или новый')} list={`sup-${r.id}`} value={supplier} maxLength={200} autoFocus onChange={(e) => setSupplier(e.target.value)} className={cn(field, 'h-10')} />
        <datalist id={`sup-${r.id}`}>
          {suppliers.map((x) => (
            <option key={x.id} value={x.name}>
              {x.status === 'restricted' ? tr('ограниченный список') : x.category}
            </option>
          ))}
        </datalist>
        <select aria-label={tr('Валюта цен')} value={currency} onChange={(e) => setCurrency(e.target.value)} className={cn(field, 'h-10')}>
          {['GEL', 'USD'].map((c) => (
            <option key={c} value={c}>
              {symbolOf(c)} {c}
            </option>
          ))}
        </select>
      </div>
      {known?.status === 'restricted' && (
        <p className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {tr('Поставщик в ограниченном списке')}
          {known.note ? `: ${known.note}` : ''}
        </p>
      )}
      {supplier.trim() && !known && <p className="text-xs text-muted-foreground">{tr('Нового поставщика добавим в справочник автоматически.')}</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-muted-foreground">{tr('Цена за единицу')}</legend>
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)_7rem] items-center gap-2">
            {photoOf(r, l.position) ? <LinePhotoThumb photo={photoOf(r, l.position)!} className="size-8" /> : <span />}
            <label htmlFor={`qe-${l.id}`} className="min-w-0 text-sm">
              {l.name} <span className="text-xs text-muted-foreground tabular-nums">{`${nf(3).format(l.qty)} ${l.unit}`}</span>
              {(hints[hintKey(l.name)] ?? []).length > 0 && (
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {tr('раньше')}: {hints[hintKey(l.name)].map((h) => `${nf().format(h.unit_price)} ${symbolOf(h.currency)} (${h.supplier}, ${new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' }).format(new Date(h.at))})`).join(' · ')}
                </span>
              )}
            </label>
            <input id={`qe-${l.id}`} inputMode="decimal" value={prices[l.id]} onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} className={cn(field, 'h-10 text-right tabular-nums')} />
            <input
              aria-label={tr('Модель для позиции {{name}}', { name: l.name })}
              placeholder={tr('Модель, артикул или ссылка — увидит инициатор')}
              value={models[l.id]}
              maxLength={500}
              onChange={(e) => setModels((m) => ({ ...m, [l.id]: e.target.value }))}
              className={cn(field, 'col-span-3 h-9 text-xs sm:col-span-2 sm:col-start-2')}
            />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <input aria-label={tr('Срок поставки, дней')} placeholder={tr('Срок, дней')} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={cn(field, 'h-10 tabular-nums')} />
        <input aria-label={tr('Оплата и условия: аванс, доставка, гарантия')} placeholder={tr('Оплата и условия: аванс, доставка, гарантия')} value={terms} maxLength={1000} onChange={(e) => setTerms(e.target.value)} className={cn(field, 'h-10')} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !valid}>
          {tr('Сохранить')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {tr('Отмена')}
        </Button>
      </div>
    </form>
  )
}

/** Отправка выбранного предложения на согласование: закупщик сам выбирает, кого спросить */
function SendApproval({ r, quote, onDone }: { r: RequestDetail; quote: Quote; onDone: () => void }) {
  const refresh = useRefresh(r)
  const { data: people = [] } = useQuery(procurementPeopleQuery)
  const prev = r.approvals.filter((a) => a.round === r.approval_round).map((a) => a.user_id)
  const [picked, setPicked] = useState<string[]>(prev)
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState(r.single_source_reason)
  const [note, setNote] = useState(r.approval_note)
  const few = (r.rfq?.quotes.length ?? 0) < 3
  const total = quoteTotal(r.rfq!.lines, quote)
  // сумма в лари для порога (курс проекта — лари за доллар)
  const gel = total === null ? null : quote.currency === 'GEL' ? total : r.project.fx_rate ? total * r.project.fx_rate : null
  const { data: hint } = useQuery(suggestQuery(r.id, gel))
  const suggested = (hint?.suggest ?? []).filter((x) => !picked.includes(x.id))
  const send = useMutation({
    mutationFn: () => sendToApproval(r.id, { quoteId: quote.id, approvers: picked, reason, note }),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Отправлено на согласование: {{n}} чел.', { n: picked.length }))
      onDone()
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const s = search.trim().toLowerCase()
  const list = people.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.job_title ?? '').toLowerCase().includes(s))
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
      <h4 className="text-sm font-semibold">{tr('На согласование: «{{supplier}}», {{sum}}', { supplier: quote.supplier, sum: total === null ? '—' : money(total, quote.currency) })}</h4>
      {quote.supplier_status === 'restricted' && <p className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">{tr('Поставщик в ограниченном списке — согласующие это увидят.')}</p>}
      {hint && (
        <div className="flex flex-col gap-1.5 rounded-md border bg-background p-2.5 text-sm">
          <span>
            {hint.tier ? (
              <>
                <b>{TIERS[hint.tier]}</b>
                <span className="block text-xs text-muted-foreground">
                  {tr('Пороги компании: до {{a}} ₾ — уровень 1, до {{b}} ₾ — уровень 2, выше — комитет. Эта закупка ≈ {{sum}} ₾.', { a: nf(0).format(hint.tier1_limit), b: nf(0).format(hint.tier2_limit), sum: nf(0).format(gel ?? 0) })}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{tr('Уровень не определить: для долларов укажите курс в карточке проекта.')}</span>
            )}
          </span>
          {suggested.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{tr('Рекомендуем')}:</span>
              {suggested.map((x) => (
                <button key={x.id} type="button" onClick={() => toggle(x.id)} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs hover:bg-primary/10">
                  <Plus className="size-3" aria-hidden /> {x.name} <span className="text-muted-foreground">· {trData(x.role)}</span>
                </button>
              ))}
              {suggested.length > 1 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked((p) => [...p, ...suggested.map((x) => x.id)])}>
                  {tr('Добавить всех')}
                </Button>
              )}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{tr('Кого спросить — все выбранные должны одобрить')}</span>
        {picked.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {picked.map((id) => (
              <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-muted" aria-label={tr('Убрать {{name}}', { name: people.find((p) => p.id === id)?.name ?? '' })}>
                {people.find((p) => p.id === id)?.name ?? '…'} <X className="size-3" aria-hidden />
              </button>
            ))}
          </span>
        )}
        <input aria-label={tr('Найти сотрудника')} placeholder={tr('Найти сотрудника: имя или должность')} value={search} onChange={(e) => setSearch(e.target.value)} className={cn(field, 'h-10')} />
        <ul className="max-h-44 overflow-y-auto rounded-md border bg-background">
          {list.slice(0, 50).map((p) => (
            <li key={p.id}>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-muted">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.job_title && <span className="truncate text-xs text-muted-foreground">{p.job_title}</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
      {few && (
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-reason" className="text-xs text-amber-800 dark:text-amber-300">
            {tr('Предложений меньше трёх — почему (обязательно)')}
          </label>
          <input id="sa-reason" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder={tr('Единственный поставщик, гарантия производителя, срочность…')} className={cn(field, 'h-10')} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="sa-note" className="text-xs text-muted-foreground">
          {tr('Почему этот поставщик (увидят согласующие)')}
        </label>
        <input id="sa-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-10')} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={send.isPending || picked.length === 0 || (few && !reason.trim())} onClick={() => send.mutate()}>
          {tr('Отправить на согласование')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {tr('Отмена')}
        </Button>
      </div>
    </div>
  )
}

function ApprovalsSection({ r }: { r: RequestDetail }) {
  const current = r.approvals.filter((a) => a.round === r.approval_round)
  const earlier = r.approvals.filter((a) => a.round < r.approval_round && (a.status === 'rejected' || a.status === 'approved'))
  const icon = (s: string) =>
    s === 'approved' ? <Check className="size-4 text-emerald-700" aria-hidden /> : s === 'rejected' ? <X className="size-4 text-red-700" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />
  const word = (s: string) => (s === 'approved' ? tr('одобрил(а)') : s === 'rejected' ? tr('не согласовал(а)') : s === 'cancelled' ? tr('не потребовалось') : tr('ждём решения'))
  return (
    <section className={section} aria-label={tr('Согласование')}>
      <h3 className={h3}>{r.approval_round > 1 ? tr('Согласование, круг {{n}}', { n: r.approval_round }) : tr('Согласование')}</h3>
      <ul className="flex flex-col gap-1.5">
        {current.map((a) => (
          <li key={a.user_id} className="flex flex-wrap items-center gap-x-2 text-sm">
            {icon(a.status)}
            <span className="font-medium">{a.name}</span>
            {a.job_title && <span className="text-xs text-muted-foreground">{a.job_title}</span>}
            <span className="text-muted-foreground">— {word(a.status)}</span>
            {a.decided_at && <span className="text-xs text-muted-foreground">{stamp(a.decided_at)}</span>}
            {a.note && <span className="basis-full pl-6 text-muted-foreground">«{a.note}»</span>}
          </li>
        ))}
      </ul>
      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">{tr('Прежние круги')}</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {earlier.map((a) => (
              <li key={`${a.round}-${a.user_id}`} className="text-muted-foreground">
                {tr('Круг {{n}}', { n: a.round })}: {a.name} — {word(a.status)}
                {a.note ? `: «${a.note}»` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function OrderForm({ r }: { r: RequestDetail }) {
  const refresh = useRefresh(r)
  const { data: items = [] } = useQuery({ ...cbsQuery(r.project.id), enabled: r.me.can_pick_item })
  const [ref, setRef] = useState('')
  const [expected, setExpected] = useState('')
  const [item, setItem] = useState(r.cbs_item_id ?? '')
  const order = useMutation({
    mutationFn: () => placeOrder(r.id, { orderRef: ref.trim(), expected: expected || null, cbsItem: item || null }),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Заказ оформлен — инициатор получил уведомление'))
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3" aria-label={tr('Ваш шаг')}>
      <h3 className={h3}>{tr('Ваш шаг: оформите заказ у «{{supplier}}»', { supplier: r.supplier })}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="or-ref" className="text-xs text-muted-foreground">
            {tr('Номер заказа (PO), счёта или договора')}
          </label>
          <input id="or-ref" value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} className={cn(field, 'h-10')} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="or-exp" className="text-xs text-muted-foreground">
            {tr('Когда ожидается')}
          </label>
          <DatePicker id="or-exp" value={expected} onChange={setExpected} />
        </div>
        {r.me.can_pick_item && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="or-item" className="text-xs text-muted-foreground">
              {tr('Статья бюджета (по ней появится договор-обязательство)')}
            </label>
            <CbsPicker id="or-item" items={items} value={item} onChange={setItem} extras={[{ value: '', label: tr('Не выбрана — без записи в бюджет') }]} />
          </div>
        )}
      </div>
      <div>
        <Button disabled={order.isPending} onClick={() => order.mutate()}>
          {tr('Оформить заказ')}
        </Button>
      </div>
    </section>
  )
}

function DeliveryForm({ r }: { r: RequestDetail }) {
  const refresh = useRefresh(r)
  const [inTransit, setInTransit] = useState(r.status === 'shipped')
  const [expected, setExpected] = useState(r.expected_at ?? '')
  const [transport, setTransport] = useState<Transport | ''>(r.transport)
  const [forwarder, setForwarder] = useState(r.forwarder)
  const [tracking, setTracking] = useState(r.tracking)
  const [note, setNote] = useState(r.delivery_note)
  const save = useMutation({
    mutationFn: () => updateDelivery(r.id, { inTransit, expected: expected || null, transport, forwarder, tracking, note }),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Поставка обновлена'))
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3" aria-label={tr('Поставка')}>
      <h3 className={cn(h3, 'flex items-center gap-1.5')}>
        <Truck className="size-4" aria-hidden /> {tr('Поставка: отмечайте отправку и меняйте дату — инициатор получит уведомление')}
      </h3>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={inTransit} disabled={r.status === 'shipped'} onChange={(e) => setInTransit(e.target.checked)} className="size-4" />
        {tr('Груз отправлен (в пути)')}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="dl-exp" className="text-xs text-muted-foreground">
            {tr('Ожидаемая дата прибытия')}
          </label>
          <DatePicker id="dl-exp" value={expected} onChange={setExpected} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dl-tr" className="text-xs text-muted-foreground">
            {tr('Транспорт')}
          </label>
          <select id="dl-tr" value={transport} onChange={(e) => setTransport(e.target.value as Transport | '')} className={cn(field, 'h-10')}>
            <option value="">—</option>
            {Object.entries(TRANSPORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <input aria-label={tr('Экспедитор')} placeholder={tr('Экспедитор')} value={forwarder} maxLength={200} onChange={(e) => setForwarder(e.target.value)} className={cn(field, 'h-10')} />
        <input aria-label={tr('Номер груза или накладной')} placeholder={tr('Номер груза или накладной')} value={tracking} maxLength={200} onChange={(e) => setTracking(e.target.value)} className={cn(field, 'h-10')} />
        <input aria-label={tr('Заметка: таможня, риски')} placeholder={tr('Заметка: таможня, риски')} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-10 sm:col-span-2')} />
      </div>
      <div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {tr('Сохранить')}
        </Button>
      </div>
    </section>
  )
}

function DeliverySection({ r }: { r: RequestDetail }) {
  const facts: [string, string][] = [
    [tr('Поставщик'), r.supplier],
    ...(r.amount !== null ? [[tr('Сумма'), money(r.amount, r.currency)] as [string, string]] : []),
    [tr('Заказ'), r.order_ref || '—'],
    [tr('Заказано'), r.ordered_at ? day(r.ordered_at) : '—'],
    [tr('Ожидается'), r.expected_at ? day(r.expected_at) : '—'],
  ]
  if (r.shipped_at) facts.push([tr('Отправлено'), day(r.shipped_at)])
  if (r.transport) facts.push([tr('Транспорт'), TRANSPORTS[r.transport]])
  if (r.forwarder) facts.push([tr('Экспедитор'), r.forwarder])
  if (r.tracking) facts.push([tr('Номер груза'), r.tracking])
  if (r.delivered_at) facts.push([tr('Получено'), `${day(r.delivered_at)}${r.received_by_name ? `, ${r.received_by_name}` : ''}`])
  return (
    <section className={section} aria-label={tr('Заказ и поставка')}>
      <h3 className={h3}>{tr('Заказ и поставка')}</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {r.delivery_note && <p className="text-sm text-muted-foreground">{r.delivery_note}</p>}
      {r.receipts.length > 0 ? (
        <ol className="flex flex-col gap-1.5 border-l pl-3 text-sm" aria-label={tr('Приёмки')}>
          {r.receipts.map((x, i) => (
            <li key={i} className="flex flex-col">
              <span>
                <span className="text-xs text-muted-foreground">{stamp(x.at)}</span> · <b className={cn('font-medium', x.result !== 'full' && 'text-amber-800 dark:text-amber-300')}>{RECEIPTS[x.result]}</b>
                {x.by ? ` · ${x.by}` : ''}
              </span>
              {x.lines.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{x.lines.map((l) => `${l.name} — ${nf(3).format(l.qty)} ${l.unit}`).join('; ')}</span>}
              {x.note && <span className="text-muted-foreground">{x.note}</span>}
            </li>
          ))}
        </ol>
      ) : (
        r.receipt && (
          <p className={cn('text-sm', r.receipt !== 'full' && 'font-medium text-amber-800 dark:text-amber-300')}>
            {RECEIPTS[r.receipt]}
            {r.receipt_note ? `: ${r.receipt_note}` : ''}
          </p>
        )
      )}
    </section>
  )
}

function BudgetSection({ r }: { r: RequestDetail }) {
  // остаток статьи «для всех»; сами коды выбираются в разделе «Коды бюджета»
  const open = ['draft', 'submitted', 'sourcing', 'approval', 'confirming', 'confirmed'].includes(r.status)
  const { data: budget } = useQuery({ queryKey: ['request-budget', r.id, r.status, r.cbs_item_id, r.amount_base], queryFn: () => requestBudget(r.id), enabled: r.me.can_budget && !!r.cbs_item_id && open })
  if (!r.me.can_budget || !open || (r.me.can_pick_item && !r.cbs_item_id)) return null
  const over = !!budget && budget.estimate > budget.remaining + 0.005
  const m = (n: number) => money(n, r.project.currency)
  return (
    <section className={cn(section, over && 'border-amber-500/60 bg-amber-400/10')} aria-label={tr('Бюджет')}>
      <h3 className={h3}>{!r.cbs_item_id ? tr('Статья бюджета не выбрана: остаток не проверяется') : over ? tr('Сумма выше остатка бюджета статьи') : budget ? tr('Остаток бюджета статьи достаточен') : tr('Бюджет')}</h3>
      {r.item && (
        <p className="text-sm">
          {r.item.code} · {r.item.name}
        </p>
      )}
      {budget && (
        <p className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
          <span>
            {tr('Бюджет')}: {m(budget.bac)}
          </span>
          <span>
            {tr('Обязательства и факт')}: {m(Math.max(budget.committed, budget.actual))}
          </span>
          <span>
            {tr('В других заявках')}: {m(budget.reserved)}
          </span>
          <span>
            {tr('Эта заявка')}: {m(budget.estimate)}
          </span>
          <span className="font-medium text-foreground">
            {tr('Остаток')}: {m(budget.remaining)}
          </span>
        </p>
      )}
    </section>
  )
}

function History({ r }: { r: RequestDetail }) {
  if (r.history.length === 0) return null
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">{tr('История ({{n}})', { n: r.history.length })}</summary>
      <ol className="mt-2 flex flex-col gap-1.5 border-l pl-3">
        {r.history.map((h, i) => {
          const to = h.changes.to ?? ''
          const what =
            h.event === 'request_eta'
              ? tr('Срок поставки: {{d}}', { d: to ? day(to) : '—' })
              : !h.changes.from
                ? tr('Заявка создана')
                : (REQUEST_STATUSES[to as RequestStatus] ?? to)
          return (
            <li key={i} className="flex flex-col">
              <span>
                <span className="text-xs text-muted-foreground">{stamp(h.at)}</span> · <b className="font-medium">{what}</b>
                {h.actor ? ` · ${h.actor}` : ''}
              </span>
              {h.changes.note && h.event === 'request_status' && <span className="text-muted-foreground">{h.changes.note}</span>}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

/** Срок текущего шага (п. 13.1): «до 27 ноября», «сегодня», красным — если прошёл */
function DueText({ due }: { due: string }) {
  const st = dueState(due)
  const d = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long' }).format(new Date(new Date(due).getTime() - 1000))
  return (
    <span className={cn(st === 'late' ? 'font-medium text-red-700 dark:text-red-300' : st === 'today' ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>
      {' · '}
      {st === 'late' ? tr('срок шага прошёл ({{d}})', { d }) : st === 'today' ? tr('срок шага — сегодня') : tr('срок шага — до {{d}}', { d })}
    </span>
  )
}

/** Файлы заявки: BOQ, чертежи, спецификации и коммерческие предложения поставщиков */
function FilesSection({ r }: { r: RequestDetail }) {
  const refresh = useRefresh(r)
  const { tenantId } = useAuth()
  const [target, setTarget] = useState('')
  const quotes = r.rfq?.quotes ?? []
  const upload = useMutation({
    mutationFn: (files: File[]) => attachToRequest({ id: r.id, projectId: r.project.id, tenantId: tenantId! }, files, target || undefined),
    onSuccess: async (failed) => {
      await refresh()
      if (failed.length) toast.error(tr('Не удалось загрузить: {{names}}', { names: failed.join(', ') }))
      else toast.success(tr('Файлы прикреплены'))
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const remove = useMutation({ mutationFn: (id: string) => detachFile(id), onSuccess: refresh, onError: (e) => toast.error(requestErrorText(e)) })
  if (r.files.length === 0 && !r.me.can_attach) return null
  const label = (q: string | null) => (q ? tr('КП: {{name}}', { name: quotes.find((x) => x.id === q)?.supplier ?? '—' }) : null)
  return (
    <section className={section} aria-label={tr('Файлы')}>
      <h3 className={h3}>{tr('Файлы')}</h3>
      {r.files.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tr('BOQ, чертежи, спецификации, коммерческие предложения поставщиков.')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {r.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-sm">
              <button type="button" onClick={() => openFile(f.storage_key).catch(() => toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.')))} className="min-w-0 truncate text-left font-medium underline-offset-2 hover:underline">
                {f.name}
              </button>
              <span className="text-xs text-muted-foreground">
                {formatBytes(f.size)}
                {label(f.quote_id) ? ` · ${label(f.quote_id)}` : ''}
                {f.by ? ` · ${f.by}` : ''}
              </span>
              {f.can_delete && (
                <button type="button" aria-label={tr('Убрать файл {{name}}', { name: f.name })} disabled={remove.isPending} onClick={() => remove.mutate(f.id)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {r.me.can_attach && (
        <div className="flex flex-wrap items-center gap-2">
          {quotes.length > 0 && r.me.is_buyer && (
            <select aria-label={tr('К чему прикрепить')} value={target} onChange={(e) => setTarget(e.target.value)} className={cn(field, 'h-9')}>
              <option value="">{tr('К заявке')}</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {tr('КП: {{name}}', { name: q.supplier })}
                </option>
              ))}
            </select>
          )}
          <label className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted', upload.isPending && 'pointer-events-none opacity-60')}>
            {upload.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {tr('Прикрепить файлы')}
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) upload.mutate(files)
              }}
            />
          </label>
        </div>
      )}
    </section>
  )
}

function DecisionSheetButton({ r }: { r: RequestDetail }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await downloadDecisionSheet(r)
        } catch {
          toast.error(tr('Не удалось собрать PDF. Попробуйте ещё раз.'))
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : null} {tr('Decision Sheet (PDF)')}
    </Button>
  )
}

/** Что выбрали — без цен: поставщик и модель по каждой позиции (инициатор подтверждает, что это именно то, что нужно) */
function ChosenSection({ r }: { r: RequestDetail }) {
  const q = r.rfq?.quotes.find((x) => x.id === r.quote_id)
  if (!q || !r.rfq) return null
  return (
    <section className={section} aria-label={tr('Что выбрано')}>
      <h3 className={h3}>{tr('Что выбрано: {{supplier}}', { supplier: q.supplier })}</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {r.rfq.lines.map((l) => {
          const p = q.prices.find((x) => x.line_id === l.id)
          const photo = photoOf(r, l.position)
          return (
            <li key={l.id} className="flex items-center gap-2">
              {photo && <LinePhotoThumb photo={photo} className="size-8" />}
              <span className="flex min-w-0 flex-col">
                <span>
                  {l.name} <span className="text-xs text-muted-foreground tabular-nums">{`${nf(3).format(l.qty)} ${l.unit}`}</span>
                </span>
                <span className={cn('text-sm', p?.model ? 'font-medium' : 'text-muted-foreground')}>{p?.model || tr('модель не указана')}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
