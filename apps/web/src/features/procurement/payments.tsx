import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatBytes, openFile } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { cbsQuery } from '@/features/budget/api'
import { CbsPicker } from '@/features/budget/cbs-picker'
import { symbolOf } from '@/features/projects/currency'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import {
  attachPaymentFile,
  cancelPayment,
  createPayment,
  decidePayment,
  markPaid,
  PAY_KINDS,
  PAY_ROLES,
  PAY_STATUSES,
  requestErrorText,
  setItems,
  type Payment,
  type PayKind,
  type RequestDetail,
} from './api'
import { field } from './request-form'

const section = 'flex flex-col gap-2 rounded-lg border p-3'
const h3 = 'text-sm font-semibold'
const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 })
const money = (n: number, cur: string | null) => `${nf.format(n)} ${cur ? symbolOf(cur) : ''}`.trim()
const day = (d: string) => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d))

function useRefresh(id: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['request', id] }),
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
      queryClient.invalidateQueries({ queryKey: ['budget'] }),
    ])
}

/** Код бюджета: одна статья «для всех», у отдельных позиций — своя (до заказа) */
export function BudgetLines({ r }: { r: RequestDetail }) {
  const refresh = useRefresh(r.id)
  const { data: items = [] } = useQuery({ ...cbsQuery(r.project.id), enabled: r.me.can_pick_item })
  const [def, setDef] = useState(r.cbs_item_id ?? '')
  const [over, setOver] = useState<Record<string, string>>(() => Object.fromEntries(r.lines.map((l) => [l.id!, l.cbs_item_id ?? ''])))
  const [exceptions, setExceptions] = useState(r.lines.some((l) => !!l.cbs_item_id))
  const save = useMutation({
    mutationFn: () => setItems(r.id, def || null, Object.fromEntries(r.lines.map((l) => [l.id!, exceptions ? over[l.id!] || null : null]))),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Коды бюджета сохранены'))
    },
    onError: (e) => toast.error(requestErrorText(e)),
  })
  const editable = r.me.can_pick_item && ['draft', 'review', 'submitted', 'sourcing', 'stock_check', 'approval', 'confirming', 'confirmed'].includes(r.status)
  if (!editable) {
    if (!r.lines.some((l) => l.item)) return null
    return (
      <section className={section} aria-label={tr('Коды бюджета')}>
        <h3 className={h3}>{tr('Коды бюджета')}</h3>
        <ul className="flex flex-col gap-0.5 text-sm">
          {r.lines.map((l) => (
            <li key={l.id}>
              {l.name} — <span className="text-muted-foreground">{l.item ? `${l.item.code} · ${l.item.name}` : tr('не указан')}</span>
            </li>
          ))}
        </ul>
      </section>
    )
  }
  return (
    <section className={section} aria-label={tr('Коды бюджета')}>
      <h3 className={h3}>{tr('Коды бюджета')}</h3>
      <div className="flex flex-col gap-1">
        <label htmlFor="bl-def" className="text-xs text-muted-foreground">
          {tr('Для всех позиций')}
        </label>
        <CbsPicker id="bl-def" items={items} value={def} onChange={setDef} extras={[{ value: '', label: tr('Не выбрана') }]} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={exceptions} onChange={(e) => setExceptions(e.target.checked)} className="size-4" />
        {tr('У некоторых позиций — другой код')}
      </label>
      {exceptions && (
        <ul className="flex flex-col gap-2">
          {r.lines.map((l) => (
            <li key={l.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center">
              <span className="text-sm">{l.name}</span>
              <CbsPicker id={`bl-${l.id}`} items={items} value={over[l.id!] ?? ''} onChange={(v) => setOver((o) => ({ ...o, [l.id!]: v }))} extras={[{ value: '', label: tr('Как у всех') }]} />
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {tr('Сохранить коды')}
        </Button>
      </div>
    </section>
  )
}

/** Оплата: итоги (сколько оплачено, из них аванс, остаток) и платежи с цепочкой согласования по очереди */
export function PaymentsSection({ r }: { r: RequestDetail }) {
  const [creating, setCreating] = useState(false)
  if (!r.me.can_see_prices || !r.pay_summary || r.amount === null) return null
  if (r.payments.length === 0 && !r.me.can_pay_create) return null
  const s = r.pay_summary
  const share = r.amount > 0 ? Math.min(1, s.paid / r.amount) : 0
  return (
    <section className={section} aria-label={tr('Оплата')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={h3}>{tr('Оплата')}</h3>
        <span className="text-sm tabular-nums">
          {tr('оплачено {{paid}} из {{total}}', { paid: money(s.paid, r.currency), total: money(r.amount, r.currency) })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        <span>{tr('аванс: {{v}}', { v: money(s.advance, r.currency) })}</span>
        {s.in_approval > 0 && <span>{tr('на согласовании и к оплате: {{v}}', { v: money(s.in_approval, r.currency) })}</span>}
        <span className="font-medium text-foreground">{tr('осталось оплатить: {{v}}', { v: money(s.remaining, r.currency) })}</span>
      </p>
      {r.payments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {r.payments.map((p) => (
            <PaymentRow key={p.id} r={r} p={p} />
          ))}
        </ul>
      )}
      {r.me.can_pay_create && !creating && s.remaining - s.in_approval > 0.005 && (
        <div>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus /> {tr('Новый платёж')}
          </Button>
        </div>
      )}
      {creating && <PaymentForm r={r} max={s.remaining - s.in_approval} onDone={() => setCreating(false)} />}
    </section>
  )
}

function PaymentForm({ r, max, onDone }: { r: RequestDetail; max: number; onDone: () => void }) {
  const refresh = useRefresh(r.id)
  const { tenantId } = useAuth()
  const [kind, setKind] = useState<PayKind>(r.payments.some((p) => p.status === 'paid') ? 'final' : 'advance')
  const [amount, setAmount] = useState('')
  const [invoice, setInvoice] = useState('')
  const [note, setNote] = useState('')
  const [owner, setOwner] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const value = Number(amount.replace(',', '.').replace(/\s/g, ''))
  const valid = value > 0 && value <= max + 0.005
  const create = useMutation({
    mutationFn: async () => {
      const id = await createPayment(r.id, { kind, amount: value, invoiceRef: invoice.trim(), note: note.trim(), needOwner: owner })
      if (file) await attachPaymentFile(id, { projectId: r.project.id, tenantId: tenantId! }, file)
    },
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Платёж отправлен на согласование'))
      onDone()
    },
    onError: (e) => toast.error((e as { message?: string })?.message?.includes('over_amount') ? tr('Сумма больше остатка к оплате.') : requestErrorText(e)),
  })
  return (
    <form
      className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) create.mutate()
      }}
    >
      <h4 className="text-sm font-medium">{tr('Новый платёж')}</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <select aria-label={tr('Вид платежа')} value={kind} onChange={(e) => setKind(e.target.value as PayKind)} className={cn(field, 'h-10')}>
          {Object.entries(PAY_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-1">
          <input aria-label={tr('Сумма платежа')} inputMode="decimal" placeholder={tr('Сумма, {{cur}}', { cur: symbolOf(r.currency ?? '') })} value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(field, 'h-10 tabular-nums')} />
          <span className="text-xs text-muted-foreground">{tr('не больше {{v}}', { v: money(max, r.currency) })}</span>
        </div>
        <input aria-label={tr('Номер инвойса или счёта')} placeholder={tr('Номер инвойса или счёта')} value={invoice} maxLength={200} onChange={(e) => setInvoice(e.target.value)} className={cn(field, 'h-10')} />
      </div>
      <input aria-label={tr('Комментарий для согласующих')} placeholder={tr('Комментарий для согласующих (необязательно)')} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-10')} />
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
        <Plus className="size-4" aria-hidden />
        {file ? file.name : tr('Прикрепить инвойс или договор')}
        <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} className="size-4" />
        {tr('Нужен учредитель')}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!valid || create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />} {tr('Отправить на согласование')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {tr('Отмена')}
        </Button>
      </div>
    </form>
  )
}

function PaymentRow({ r, p }: { r: RequestDetail; p: Payment }) {
  const refresh = useRefresh(r.id)
  const { tenantId } = useAuth()
  const [mode, setMode] = useState<null | 'reject' | 'pay'>(null)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const done = async (msg: string) => {
    await refresh()
    setMode(null)
    setNote('')
    toast.success(msg)
  }
  const decide = useMutation({ mutationFn: (ok: boolean) => decidePayment(p.id, ok, note), onSuccess: (_d, ok) => done(ok ? tr('Платёж согласован') : tr('Платёж не согласован')), onError: (e) => toast.error(requestErrorText(e)) })
  const pay = useMutation({ mutationFn: () => markPaid(p.id, note.trim(), file, { projectId: r.project.id, tenantId: tenantId! }), onSuccess: () => done(tr('Отмечено оплаченным')), onError: (e) => toast.error(requestErrorText(e)) })
  const cancel = useMutation({ mutationFn: () => cancelPayment(p.id), onSuccess: () => done(tr('Платёж отменён')), onError: (e) => toast.error(requestErrorText(e)) })
  const busy = decide.isPending || pay.isPending || cancel.isPending
  const icon = (st: string) =>
    st === 'approved' ? <Check className="size-3.5 text-emerald-700" aria-hidden /> : st === 'rejected' ? <X className="size-3.5 text-red-700" aria-hidden /> : <Circle className={cn('size-3.5', st === 'pending' ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
  return (
    <li className={cn('flex flex-col gap-1.5 rounded-md border p-2.5 text-sm', p.my_step && 'border-primary/60 bg-primary/5', p.status === 'paid' && 'border-emerald-600/40')}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <b className="font-medium">{tr('Платёж №{{n}}', { n: p.number })}</b>
        <span>{PAY_KINDS[p.kind]}</span>
        <span className="tabular-nums font-medium">{money(p.amount, p.currency)}</span>
        <span className={cn('text-xs', p.status === 'paid' ? 'text-emerald-800 dark:text-emerald-300' : p.status === 'rejected' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground')}>{PAY_STATUSES[p.status]}</span>
        {p.invoice_ref && <span className="text-xs text-muted-foreground">{tr('инвойс {{n}}', { n: p.invoice_ref })}</span>}
      </div>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs" aria-label={tr('Цепочка согласования платежа')}>
        {p.steps.map((st, i) => (
          <li key={st.position} className={cn('flex items-center gap-1', st.status === 'skipped' && 'line-through opacity-50')} title={st.note || undefined}>
            {i > 0 && <span className="text-muted-foreground">→</span>}
            {icon(st.status)}
            <span className={cn(st.status === 'pending' && 'font-medium text-foreground')}>{PAY_ROLES[st.role] ?? st.role}</span>
            {st.by && <span className="text-muted-foreground">({st.by})</span>}
          </li>
        ))}
      </ol>
      {p.decision_note && <p className="text-xs text-red-700 dark:text-red-300">{p.decision_note}</p>}
      {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
      {p.status === 'paid' && (
        <p className="text-xs text-muted-foreground">{tr('Оплачено {{d}}{{by}}{{ref}}', { d: p.paid_at ? day(p.paid_at) : '', by: p.paid_by ? `, ${p.paid_by}` : '', ref: p.payment_ref ? ` · ${tr('платёжка {{n}}', { n: p.payment_ref })}` : '' })}</p>
      )}
      {p.files.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 text-xs">
          {p.files.map((f) => (
            <li key={f.id}>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => openFile(f.storage_key).catch(() => toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.')))}>
                {f.name}
              </button>{' '}
              <span className="text-muted-foreground">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}

      {p.my_step && mode !== 'reject' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide.mutate(true)}>
            <Check /> {tr('Согласовать платёж')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode('reject')}>
            {tr('Не согласовать')}
          </Button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="flex flex-col gap-2">
          <input aria-label={tr('Причина отказа')} placeholder={tr('Причина — её увидит закупщик')} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-9')} autoFocus />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy || !note.trim()} onClick={() => decide.mutate(false)}>
              {tr('Не согласовать')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              {tr('Назад')}
            </Button>
          </div>
        </div>
      )}
      {p.can_pay && mode !== 'pay' && (
        <div>
          <Button size="sm" onClick={() => setMode('pay')}>
            {tr('Отметить оплаченным')}
          </Button>
        </div>
      )}
      {mode === 'pay' && (
        <div className="flex flex-col gap-2">
          <input aria-label={tr('Номер платёжного поручения')} placeholder={tr('Номер платёжного поручения')} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'h-9')} autoFocus />
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
            <Plus className="size-3.5" aria-hidden />
            {file ? file.name : tr('Прикрепить платёжное поручение')}
            <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => pay.mutate()}>
              {pay.isPending && <Loader2 className="animate-spin" />} {tr('Оплачено')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              {tr('Назад')}
            </Button>
          </div>
        </div>
      )}
      {(p.status === 'approval' || p.status === 'approved') && r.me.can_pay_create && !p.my_step && !p.can_pay && mode === null && (
        <div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel.mutate()}>
            {tr('Отменить платёж')}
          </Button>
        </div>
      )}
    </li>
  )
}
