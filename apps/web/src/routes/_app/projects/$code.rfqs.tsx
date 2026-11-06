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
import { awardRfq, cancelRfq, createRfq, deleteQuote, quoteInBase, quoteTotal, RFQ_STATUSES, rfqsQuery, saveQuote, type Rfq, type RfqQuote } from '@/features/procurement/rfq-api'
import { requestsQuery } from '@/features/procurement/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { symbolOf, useProjectCurrency } from '@/features/projects/currency'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Реестр»: запросы цен поставщикам и сравнение предложений
export const Route = createFileRoute('/_app/projects/$code/rfqs')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(rfqsQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем запросы цен…')}</p>,
  component: RfqsPage,
})

const field = 'rounded-md border bg-background px-3 text-sm disabled:opacity-70'
const nf = () => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 })

function RfqsPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rfqs } = useSuspenseQuery(rfqsQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canRequest = perms.includes('procurement.request')
  const [group, setGroup] = useState<'open' | 'done' | 'all'>('open')
  const [opened, setOpened] = useState<string | 'new' | null>(null)
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
  const today = new Date().toLocaleDateString('sv')
  const shown = useMemo(() => rfqs.filter((r) => (group === 'all' ? true : group === 'open' ? r.status === 'open' : r.status !== 'open')), [rfqs, group])
  const current = typeof opened === 'string' && opened !== 'new' ? rfqs.find((r) => r.id === opened) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="rfqs" title={tr('Что такое запрос цен')}>
        <p>{tr('Прежде чем заказывать, цены спрашивают у нескольких поставщиков. Запрос цен собирает позиции (обычно из согласованной заявки), вы вносите предложения поставщиков, и система ставит их рядом: по каждой позиции видно, у кого дешевле, а в итоге — сумма, срок поставки и условия оплаты.')}</p>
        <p>{tr('Когда выбор сделан, руководитель проекта присуждает запрос: выбранное предложение сразу становится договором в бюджете (сумма пересчитывается в основную валюту по курсу проекта), а заявка отмечается заказанной.')}</p>
      </PageHelp>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={tr('Показать')} value={group} onChange={(e) => setGroup(e.target.value as typeof group)} className="h-10 rounded-md border bg-background px-2 text-sm">
          <option value="open">{tr('Открытые')}</option>
          <option value="done">{tr('Закрытые')}</option>
          <option value="all">{tr('Все')}</option>
        </select>
        {canRequest && (
          <Button className="ml-auto" onClick={() => setOpened('new')}>
            <Plus /> {tr('Новый запрос цен')}
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {rfqs.length === 0 ? (canRequest ? tr('Запросов цен пока нет. Создайте первый из согласованной заявки на материалы или вручную.') : tr('Запросов цен пока нет.')) : tr('В этой группе запросов нет.')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => {
            const late = r.status === 'open' && r.due_date && r.due_date < today
            const winner = r.quotes.find((q) => q.id === r.winner_id)
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpened(r.id)} className="flex w-full flex-wrap items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="ident text-xs text-muted-foreground">{r.key}</span>
                      <span className={cn('font-medium', r.status === 'cancelled' && 'text-muted-foreground line-through')}>{r.title}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{tr('позиций: {{n}}', { n: r.lines.length })}</span>
                      <span>{tr('предложений: {{n}}', { n: r.quotes.length })}</span>
                      {r.request && <span>{tr('по заявке {{key}}', { key: r.request.key })}</span>}
                      {r.due_date && <span className={cn(late && 'font-medium text-red-700 dark:text-red-300')}>{tr('ответ до {{d}}', { d: dateFmt.format(new Date(`${r.due_date}T12:00:00`)) })}</span>}
                      {winner && <span className="font-medium text-foreground">{winner.supplier}</span>}
                    </span>
                  </span>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', r.status === 'awarded' && 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300', r.status === 'cancelled' && 'text-muted-foreground')}>{RFQ_STATUSES[r.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {opened === 'new' && <RfqForm projectId={p.id} onClose={() => setOpened(null)} />}
      {current && <RfqDialog projectId={p.id} rfq={current} perms={perms} onClose={() => setOpened(null)} />}
    </div>
  )
}

/** Новый запрос цен: из согласованной заявки (позиции подтянутся) или вручную. */
function RfqForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: requests = [] } = useQuery(requestsQuery(projectId))
  const approved = requests.filter((r) => r.status === 'approved')
  const [requestId, setRequestId] = useState('')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState([{ name: '', unit: '', qty: 1 }])
  const fromRequest = !!requestId
  const valid = title.trim() && (fromRequest || lines.every((l) => l.name.trim() && l.qty > 0))
  const create = useMutation({
    mutationFn: () => createRfq(projectId, { title: title.trim(), requestId: requestId || null, dueDate: dueDate || null, lines: fromRequest ? [] : lines.map((l) => ({ ...l, name: l.name.trim() })) }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['rfqs', projectId] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
      toast.success(tr('Запрос цен создан'))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '42501' ? tr('Нет права создавать запросы цен.') : tr('Не удалось создать запрос. Проверьте поля и позиции.')),
  })
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr('Новый запрос цен')}</DialogTitle>
          <DialogDescription>{tr('Что покупаем и до какого срока ждём предложения.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) create.mutate()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="rq-from" className="text-xs text-muted-foreground">
              {tr('Из заявки на материалы')}
            </label>
            <select
              id="rq-from"
              value={requestId}
              onChange={(e) => {
                setRequestId(e.target.value)
                const r = approved.find((x) => x.id === e.target.value)
                if (r && !title.trim()) setTitle(r.title)
              }}
              className={cn(field, 'h-10')}
            >
              <option value="">{tr('Без заявки, позиции вручную')}</option>
              {approved.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.key} · {r.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="flex flex-col gap-1">
              <label htmlFor="rq-title" className="text-xs text-muted-foreground">
                {tr('Название')}
              </label>
              <input id="rq-title" value={title} maxLength={200} required autoFocus onChange={(e) => setTitle(e.target.value)} className={cn(field, 'h-10')} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="rq-due" className="text-xs text-muted-foreground">
                {tr('Ответ поставщиков до')}
              </label>
              <DatePicker id="rq-due" value={dueDate} onChange={setDueDate} />
            </div>
          </div>
          {fromRequest ? (
            <p className="text-sm text-muted-foreground">{tr('Позиции будут взяты из заявки.')}</p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs text-muted-foreground">{tr('Позиции')}</legend>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_auto] items-center gap-2">
                  <input aria-label={tr('Наименование')} placeholder={tr('Наименование')} value={l.name} maxLength={300} onChange={(e) => setLine(i, { name: e.target.value })} className={cn(field, 'h-10')} />
                  <input aria-label={tr('Количество')} placeholder={tr('Кол-во')} inputMode="decimal" value={l.qty || ''} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(',', '.')) || 0 })} className={cn(field, 'h-10 tabular-nums')} />
                  <input aria-label={tr('Единица')} placeholder={tr('Ед.')} value={l.unit} maxLength={20} onChange={(e) => setLine(i, { unit: e.target.value })} className={cn(field, 'h-10')} />
                  <button type="button" aria-label={tr('Убрать позицию')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { name: '', unit: '', qty: 1 }])}>
                  <Plus /> {tr('Добавить позицию')}
                </Button>
              </div>
            </fieldset>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={create.isPending || !valid}>
              {tr('Создать')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Предложение поставщика: кто, в какой валюте, срок, условия и цена за единицу по каждой позиции. */
function QuoteForm({ rfq, quote, onClose }: { rfq: Rfq; quote: RfqQuote | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [supplier, setSupplier] = useState(quote?.supplier ?? '')
  const [currency, setCurrency] = useState<string>(quote?.currency ?? 'GEL')
  const [days, setDays] = useState(quote?.delivery_days === null || quote?.delivery_days === undefined ? '' : String(quote.delivery_days))
  const [terms, setTerms] = useState(quote?.terms ?? '')
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(rfq.lines.map((l) => [l.id, String(quote?.prices.find((p) => p.line_id === l.id)?.unit_price ?? '')])))
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const valid = supplier.trim() && rfq.lines.some((l) => num(prices[l.id]) !== null) && rfq.lines.every((l) => num(prices[l.id]) === null || Number.isFinite(num(prices[l.id])))
  const save = useMutation({
    mutationFn: () => saveQuote(rfq.id, { id: quote?.id, supplier: supplier.trim(), currency, deliveryDays: days.trim() === '' ? null : Math.max(0, Math.round(Number(days) || 0)), terms, note: '', prices: Object.fromEntries(rfq.lines.map((l) => [l.id, num(prices[l.id])])) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rfqs', rfq.id] })
      await queryClient.invalidateQueries({ queryKey: ['rfqs'] })
      toast.success(tr('Предложение сохранено'))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось сохранить предложение. Проверьте поля.')),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{quote ? tr('Правка предложения') : tr('Предложение поставщика')}</DialogTitle>
          <DialogDescription>{`${rfq.key} · ${rfq.title}`}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="flex flex-col gap-1">
              <label htmlFor="qt-supplier" className="text-xs text-muted-foreground">
                {tr('Поставщик')}
              </label>
              <input id="qt-supplier" value={supplier} maxLength={200} required autoFocus onChange={(e) => setSupplier(e.target.value)} className={cn(field, 'h-10')} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="qt-cur" className="text-xs text-muted-foreground">
                {tr('Валюта цен')}
              </label>
              <select id="qt-cur" value={currency} onChange={(e) => setCurrency(e.target.value)} className={cn(field, 'h-10')}>
                {['GEL', 'USD'].map((c) => (
                  <option key={c} value={c}>
                    {symbolOf(c)} {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-muted-foreground">{tr('Цена за единицу')}</legend>
            {rfq.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
                <label htmlFor={`qt-p-${l.id}`} className="min-w-0 text-sm">
                  {l.name} <span className="text-xs text-muted-foreground tabular-nums">{`${nf().format(l.qty)} ${l.unit}`}</span>
                </label>
                <input id={`qt-p-${l.id}`} inputMode="decimal" value={prices[l.id]} onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} className={cn(field, 'h-10 text-right tabular-nums')} />
              </div>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <div className="flex flex-col gap-1">
              <label htmlFor="qt-days" className="text-xs text-muted-foreground">
                {tr('Срок поставки, дней')}
              </label>
              <input id="qt-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={cn(field, 'h-10 tabular-nums')} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="qt-terms" className="text-xs text-muted-foreground">
                {tr('Условия оплаты и доставки')}
              </label>
              <input id="qt-terms" value={terms} maxLength={1000} onChange={(e) => setTerms(e.target.value)} className={cn(field, 'h-10')} />
            </div>
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

/** Сравнение предложений: позиции строками, поставщики столбцами, самая низкая цена по позиции отмечена; присуждение. */
function RfqDialog({ projectId, rfq, perms, onClose }: { projectId: string; rfq: Rfq; perms: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { code: base, rate, symbol: baseSymbol } = useProjectCurrency(projectId)
  const canRequest = perms.includes('procurement.request')
  const canApprove = perms.includes('procurement.approve')
  const [quoteForm, setQuoteForm] = useState<RfqQuote | 'new' | null>(null)
  const [awarding, setAwarding] = useState<string | null>(null)
  const [item, setItem] = useState(rfq.request?.cbs_item_id ?? '')
  const [doc, setDoc] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const { data: items = [] } = useQuery({ ...cbsQuery(projectId), enabled: canApprove && awarding !== null })
  const open = rfq.status === 'open'
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['rfqs', projectId] }), queryClient.invalidateQueries({ queryKey: ['requests', projectId] }), queryClient.invalidateQueries({ queryKey: ['budget'] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
  const fail = (e: unknown) => {
    const m = (e as { message?: string })?.message ?? ''
    toast.error(
      m.includes('quote_incomplete')
        ? tr('В предложении цены указаны не по всем позициям.')
        : m.includes('budget_item_required')
          ? tr('Выберите статью бюджета для договора.')
          : m.includes('rate_required')
            ? tr('Предложение в другой валюте: укажите курс в карточке проекта.')
            : (e as { code?: string })?.code === '42501'
              ? tr('Эта роль не может выполнить такой шаг.')
              : tr('Не удалось выполнить шаг. Обновите страницу и повторите.'),
    )
  }
  const award = useMutation({
    mutationFn: () => awardRfq(rfq.id, awarding!, item || null, doc),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Присуждено: договор создан в бюджете'))
      onClose()
    },
    onError: fail,
  })
  const remove = useMutation({ mutationFn: (id: string) => deleteQuote(id), onSuccess: refresh, onError: fail })
  const cancel = useMutation({
    mutationFn: () => cancelRfq(rfq.id),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Запрос отменён'))
      onClose()
    },
    onError: fail,
  })

  const totals = rfq.quotes.map((q) => {
    const t = quoteTotal(rfq, q)
    return { q, total: t, inBase: t === null ? null : quoteInBase(t, q.currency, base, rate) }
  })
  const cheapestTotal = Math.min(...totals.map((t) => t.inBase ?? Infinity))
  // самая низкая цена за единицу по каждой позиции (в основной валюте)
  const cheapest = (lineId: string) => {
    let best = Infinity
    for (const q of rfq.quotes) {
      const p = q.prices.find((x) => x.line_id === lineId)
      const b = p ? quoteInBase(p.unit_price, q.currency, base, rate) : null
      if (b !== null && b < best) best = b
    }
    return best
  }
  const money = (n: number, cur: string) => `${nf().format(n)} ${symbolOf(cur)}`
  const awardedQuote = rfq.quotes.find((q) => q.id === awarding)

  if (quoteForm) return <QuoteForm rfq={rfq} quote={quoteForm === 'new' ? null : quoteForm} onClose={() => setQuoteForm(null)} />

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="ident text-sm font-normal text-muted-foreground">{rfq.key}</span>
            {rfq.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full border px-2 py-0.5 text-xs">{RFQ_STATUSES[rfq.status]}</span>
            {rfq.request && <span>{tr('по заявке {{key}}', { key: rfq.request.key })}</span>}
            {rfq.due_date && <span>{tr('ответ до {{d}}', { d: new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long' }).format(new Date(`${rfq.due_date}T12:00:00`)) })}</span>}
          </DialogDescription>
        </DialogHeader>

        {rfq.quotes.length === 0 ? (
          <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{tr('Предложений пока нет. Внесите первое, когда поставщик ответит.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{tr('Позиция')}</th>
                  {rfq.quotes.map((q) => (
                    <th key={q.id} className={cn('min-w-32 px-3 py-2 text-right font-medium', q.status === 'selected' && 'text-emerald-800 dark:text-emerald-300', q.status === 'rejected' && 'opacity-60')}>
                      <span className="block text-foreground">{q.supplier}</span>
                      <span className="block font-normal">{q.currency}{q.status === 'selected' ? ` · ${tr('выбрано')}` : ''}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rfq.lines.map((l) => {
                  const best = cheapest(l.id)
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {l.name} <span className="text-xs text-muted-foreground tabular-nums">{`${nf().format(l.qty)} ${l.unit}`}</span>
                      </td>
                      {rfq.quotes.map((q) => {
                        const p = q.prices.find((x) => x.line_id === l.id)
                        const b = p ? quoteInBase(p.unit_price, q.currency, base, rate) : null
                        const isBest = b !== null && rfq.quotes.length > 1 && Math.abs(b - best) < 0.005
                        return (
                          <td key={q.id} className={cn('px-3 py-2 text-right tabular-nums', isBest && 'font-semibold text-emerald-800 dark:text-emerald-300', q.status === 'rejected' && 'opacity-60')}>
                            {p ? nf().format(p.unit_price) : '—'}
                            {isBest && <span className="sr-only"> {tr('самая низкая цена')}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-3 py-2">{tr('Итого')}</td>
                  {totals.map(({ q, total, inBase }) => (
                    <td key={q.id} className={cn('px-3 py-2 text-right tabular-nums', q.status === 'rejected' && 'opacity-60')}>
                      {total === null ? <span className="text-xs font-normal text-muted-foreground">{tr('не по всем позициям')}</span> : money(total, q.currency)}
                      {total !== null && q.currency !== base && (
                        <span className={cn('block text-xs font-normal', inBase !== null && inBase === cheapestTotal && totals.length > 1 ? 'text-emerald-800 dark:text-emerald-300' : 'text-muted-foreground')}>{inBase === null ? tr('нужен курс') : `≈ ${money(inBase, base)}`}</span>
                      )}
                      {total !== null && q.currency === base && inBase === cheapestTotal && totals.length > 1 && <span className="block text-xs font-normal text-emerald-800 dark:text-emerald-300">{tr('самое дешёвое')}</span>}
                    </td>
                  ))}
                </tr>
                <tr className="text-xs text-muted-foreground">
                  <td className="px-3 py-2">{tr('Срок поставки')}</td>
                  {rfq.quotes.map((q) => (
                    <td key={q.id} className="px-3 py-2 text-right tabular-nums">
                      {q.delivery_days === null ? '—' : tr('{{n}} дн.', { n: q.delivery_days })}
                    </td>
                  ))}
                </tr>
                <tr className="text-xs text-muted-foreground">
                  <td className="px-3 py-2">{tr('Условия')}</td>
                  {rfq.quotes.map((q) => (
                    <td key={q.id} className="px-3 py-2 text-right">
                      {q.terms || '—'}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr>
                    <td className="px-3 py-2" />
                    {rfq.quotes.map((q) => (
                      <td key={q.id} className="px-3 py-2 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          {canApprove && (
                            <Button size="sm" disabled={quoteTotal(rfq, q) === null} onClick={() => setAwarding(q.id)}>
                              {tr('Выбрать')}
                            </Button>
                          )}
                          {canRequest && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setQuoteForm(q)}>
                                {tr('Править')}
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={tr('Убрать предложение {{name}}', { name: q.supplier })} disabled={remove.isPending} onClick={() => remove.mutate(q.id)}>
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          )}
                        </span>
                      </td>
                    ))}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {open && awarding && awardedQuote && canApprove && (
          <section className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3" aria-label={tr('Присуждение')}>
            <h3 className="text-sm font-semibold">{tr('Присудить поставщику «{{name}}»', { name: awardedQuote.supplier })}</h3>
            <p className="text-xs text-muted-foreground">{tr('Предложение станет договором в бюджете на сумму в {{cur}}, остальные будут отклонены.', { cur: baseSymbol })}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="aw-item" className="text-xs text-muted-foreground">
                  {tr('Статья бюджета')}
                </label>
                <select id="aw-item" value={item} onChange={(e) => setItem(e.target.value)} className={cn(field, 'h-10')}>
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
              <div className="flex flex-col gap-1">
                <label htmlFor="aw-doc" className="text-xs text-muted-foreground">
                  {tr('Номер договора или заказа')}
                </label>
                <input id="aw-doc" value={doc} maxLength={60} onChange={(e) => setDoc(e.target.value)} className={cn(field, 'h-10')} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={award.isPending || !item} onClick={() => award.mutate()}>
                {tr('Присудить и создать договор')}
              </Button>
              <Button variant="ghost" onClick={() => setAwarding(null)}>
                {tr('Не присуждать')}
              </Button>
            </div>
          </section>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <span className="flex flex-wrap gap-2">
            {open && canRequest && (
              <Button type="button" variant="outline" onClick={() => setQuoteForm('new')}>
                <Plus /> {tr('Внести предложение')}
              </Button>
            )}
            {open && (canRequest || canApprove) &&
              (confirmCancel ? (
                <span className="flex gap-1.5">
                  <Button type="button" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                    {tr('Да, отменить запрос')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                    {tr('Не отменять')}
                  </Button>
                </span>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setConfirmCancel(true)}>
                  {tr('Отменить запрос')}
                </Button>
              ))}
          </span>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Закрыть')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
