import { symbolOf, useProjectCurrency } from '@/features/projects/currency'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  budgetErrorText,
  deleteActual,
  deleteCommitment,
  DOC_TYPE_LABELS,
  fmtMoney,
  importActuals,
  importCommitments,
  saveActual,
  saveCommitment,
  type ActualDocType,
  type BudgetActual,
  type BudgetCommitment,
  type CbsItem,
} from './api'
import { ImportDialog, type ImportField } from './import-dialog'

const NONE = '__none__'
const ALL = '__all__'
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: '2-digit' })
const fmtDay = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')
/** Сумма в той валюте, в которой введена (без пересчёта в валюту показа). */
const fmtMoney0 = (n: number) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(Math.round(n))
const parseAmount = (s: string) => Number(s.replace(/[\s ]/g, '').replace(',', '.'))

/** Выбор статьи: «1.2 Кладка», вложенность — отступом. */
export function ItemSelect({ items, value, onChange, id, withAll }: { items: CbsItem[]; value: string; onChange: (v: string) => void; id?: string; withAll?: boolean }) {
  const sorted = useMemo(() => [...items].sort((a, b) => a.code.localeCompare(b.code, currentLocale(), { numeric: true })), [items])
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-label={tr('Статья')}>
        <SelectValue placeholder={tr('Выберите статью')} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {withAll && <SelectItem value={ALL}>{tr('Все статьи')}</SelectItem>}
        {sorted.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.code} {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export const ALL_ITEMS = ALL

const COMMITMENT_FIELDS: ImportField[] = [
  { key: 'item_code', label: tr('Код статьи'), required: true, aliases: ['код статьи', 'статья', 'код'] },
  { key: 'title', label: tr('Договор'), required: true, aliases: ['договор', 'наименование', 'предмет', 'название'] },
  { key: 'counterparty', label: tr('Контрагент'), aliases: ['контрагент', 'подрядчик', 'поставщик', 'исполнитель'] },
  { key: 'doc_number', label: tr('Номер'), aliases: ['номер', '№'] },
  { key: 'signed_on', label: tr('Дата'), aliases: ['дата'], kind: 'date' },
  { key: 'amount', label: tr('Сумма'), required: true, aliases: ['сумма', 'стоимость', 'цена'], kind: 'number' },
]
const ACTUAL_FIELDS: ImportField[] = [
  { key: 'item_code', label: tr('Код статьи'), required: true, aliases: ['код статьи', 'статья', 'код'] },
  { key: 'doc_type', label: tr('Тип документа'), aliases: ['тип документа', 'вид документа', 'тип', 'документ'] },
  { key: 'doc_number', label: tr('Номер'), aliases: ['номер', '№'] },
  { key: 'doc_date', label: tr('Дата'), aliases: ['дата'], kind: 'date' },
  { key: 'amount', label: tr('Сумма'), required: true, aliases: ['сумма', 'стоимость'], kind: 'number' },
  { key: 'counterparty', label: tr('Контрагент'), aliases: ['контрагент', 'подрядчик', 'поставщик'] },
  { key: 'note', label: tr('Примечание'), aliases: ['примечание', 'комментарий', 'основание'] },
]
function docTypeFromText(s: unknown): ActualDocType {
  const t = String(s ?? '').toLowerCase()
  if (t.includes('кс') || t.includes('акт')) return 'act'
  if (t.includes('счёт') || t.includes('счет') || t.includes('накладн')) return 'invoice'
  if (t.includes('списан')) return 'writeoff'
  if (t.includes('зарпл') || t.includes('табель') || t.includes('ведомост')) return 'payroll'
  return 'other'
}

// ---------------------------------------------------------------------------
// Договоры
// ---------------------------------------------------------------------------
export function CommitmentsTab({ projectId, items, commitments, actuals, canEdit }: { projectId: string; items: CbsItem[]; commitments: BudgetCommitment[]; actuals: BudgetActual[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const [item, setItem] = useState(ALL)
  const [dialog, setDialog] = useState<BudgetCommitment | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const paid = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of actuals) if (a.commitment_id) m.set(a.commitment_id, (m.get(a.commitment_id) ?? 0) + a.amount)
    return m
  }, [actuals])
  const list = commitments.filter((c) => item === ALL || c.item_id === item)
  const total = list.filter((c) => c.status === 'active').reduce((s, c) => s + c.amount, 0)
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget'] })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64 max-w-full">
            <ItemSelect items={items} value={item} onChange={setItem} withAll />
          </div>
          <p className="text-sm text-muted-foreground">{tr('Действующих:')}{' '}<span className="font-medium text-foreground tabular-nums">{fmtMoney(total)}</span>
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)} disabled={items.length === 0}>
              <FileSpreadsheet />{tr('Из Excel')}</Button>
            <Button onClick={() => setDialog('new')} disabled={items.length === 0}>
              <Plus />{tr('Договор')}</Button>
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{items.length === 0 ? tr('Сначала создайте статьи бюджета.') : tr('Договоров пока нет. Добавьте договор или загрузите реестр из Excel: сумма уйдёт в обязательства по статье.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{tr('Договор')}</th>
                <th className="px-3 py-2 text-left font-medium">{tr('Статья')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('Сумма')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('Оплачено / принято')}</th>
                {canEdit && <th className="w-20 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={`border-b ${c.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}`}>
                  <td className="px-3 py-2">
                    <span className="block font-medium">{c.title}</span>
                    <span className="block text-xs text-muted-foreground">{[c.counterparty, c.doc_number, fmtDay(c.signed_on)].filter((x) => x && x !== '—').join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="ident text-muted-foreground">{byId.get(c.item_id)?.code}</span> {byId.get(c.item_id)?.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(c.amount)}
                    {c.currency && c.orig_amount !== null && <span className="block text-xs text-muted-foreground">{`${fmtMoney0(c.orig_amount)} ${symbolOf(c.currency)}`}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtMoney(paid.get(c.id) ?? 0)} {c.amount > 0 && <span className="text-xs">({Math.round(((paid.get(c.id) ?? 0) / c.amount) * 100)}%)</span>}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-1 text-right">
                      <div className="flex justify-end">
                        <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Изменить {{title}}', { title: c.title })} onClick={() => setDialog(c)}>
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={tr('Удалить {{title}}', { title: c.title })}
                          disabled={busy}
                          onClick={async () => {
                            if (!window.confirm(tr('Удалить договор «{{title}}»?', { title: c.title }))) return
                            setBusy(true)
                            try {
                              await deleteCommitment(c.id)
                              await refresh()
                            } catch (e) {
                              toast.error(budgetErrorText(e, tr('Не удалось удалить.')))
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && <CommitmentDialog projectId={projectId} items={items} initial={dialog === 'new' ? null : dialog} defaultItem={item === ALL ? '' : item} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void refresh() }} />}
      {importing && (
        <ImportDialog
          title={tr('Загрузить договоры из Excel')}
          description={tr('Колонка «Код статьи» должна совпадать с кодами статей бюджета. Каждая строка становится договором.')}
          fields={COMMITMENT_FIELDS}
          onClose={() => { setImporting(false); void refresh() }}
          onImport={async (rows) => {
            try {
              const n = await importCommitments(projectId, rows.map((r) => ({ item_code: r.item_code, title: r.title, counterparty: r.counterparty, doc_number: r.doc_number, signed_on: r.signed_on, amount: r.amount })))
              return tr('Загружено договоров: {{n}}', { n })
            } catch (e) {
              throw new Error(budgetErrorText(e, tr('Не удалось загрузить договоры.')))
            }
          }}
        />
      )}
    </div>
  )
}

function CommitmentDialog({ projectId, items, initial, defaultItem, onClose, onSaved }: { projectId: string; items: CbsItem[]; initial: BudgetCommitment | null; defaultItem: string; onClose: () => void; onSaved: () => void }) {
  const { code: baseCode, rate } = useProjectCurrency(projectId)
  const [currency, setCurrency] = useState(initial?.currency ?? baseCode)
  const [itemId, setItemId] = useState(initial?.item_id ?? defaultItem)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '')
  const [docNumber, setDocNumber] = useState(initial?.doc_number ?? '')
  const [signedOn, setSignedOn] = useState(initial?.signed_on ?? '')
  const [amount, setAmount] = useState(initial ? String(initial.orig_amount ?? initial.amount) : '')
  const [status, setStatus] = useState<'active' | 'cancelled'>(initial?.status ?? 'active')
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState(false)
  const value = parseAmount(amount)
  const ok = !!itemId && title.trim() && Number.isFinite(value) && value >= 0
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? tr('Договор') : tr('Новый договор')}</DialogTitle>
          <DialogDescription>{tr('Обязательство по статье бюджета: что и на какую сумму мы подписали.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!ok || busy) return
            setBusy(true)
            try {
              await saveCommitment({ projectId, id: initial?.id ?? null, itemId, title: title.trim(), counterparty, docNumber, signedOn: signedOn || null, amount: value, currency: currency === baseCode ? null : currency, status, note })
              onSaved()
            } catch (err) {
              toast.error(budgetErrorText(err, tr('Не удалось сохранить договор.')))
              setBusy(false)
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-item">{tr('Статья')}</Label>
            <ItemSelect id="cm-item" items={items} value={itemId} onChange={setItemId} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-title">{tr('Предмет договора')}</Label>
            <Input id="cm-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={tr('Например, монолитные работы корпуса 1')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cm-cp">{tr('Контрагент')}</Label>
              <Input id="cm-cp" value={counterparty} maxLength={200} onChange={(e) => setCounterparty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cm-num">{tr('Номер')}</Label>
              <Input id="cm-num" value={docNumber} maxLength={60} onChange={(e) => setDocNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cm-date">{tr('Дата подписания')}</Label>
              <DatePicker id="cm-date" value={signedOn} onChange={(v) => setSignedOn(v)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cm-amount">{tr('Сумма')}</Label>
              <div className="flex gap-2">
                <Input id="cm-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0 flex-1" />
                {(rate !== null || currency !== baseCode) && (
                  <select aria-label={tr('Валюта суммы')} value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
                    {(['GEL', 'USD'] as const).map((c) => (
                      <option key={c} value={c}>
                        {symbolOf(c)} {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {currency !== baseCode && Number.isFinite(value) && value > 0 && rate !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">{tr('По курсу {{rate}} это {{sum}} {{cur}}', { rate, sum: fmtMoney0(baseCode === 'GEL' ? value * rate : value / rate), cur: symbolOf(baseCode) })}</p>
              )}
            </div>
          </div>
          {initial && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={status === 'cancelled'} onChange={(e) => setStatus(e.target.checked ? 'cancelled' : 'active')} />{tr('Договор расторгнут (не входит в обязательства)')}</label>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-note">{tr('Примечание')}</Label>
            <Textarea id="cm-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!ok || busy}>
              {busy ? tr('Сохраняем…') : tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Факт затрат
// ---------------------------------------------------------------------------
export function ActualsTab({ projectId, items, commitments, actuals, canRecord }: { projectId: string; items: CbsItem[]; commitments: BudgetCommitment[]; actuals: BudgetActual[]; canRecord: boolean }) {
  const qc = useQueryClient()
  const [item, setItem] = useState(ALL)
  const [dialog, setDialog] = useState<BudgetActual | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const cById = useMemo(() => new Map(commitments.map((c) => [c.id, c])), [commitments])
  const list = actuals.filter((a) => item === ALL || a.item_id === item)
  const total = list.reduce((s, a) => s + a.amount, 0)
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget'] })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64 max-w-full">
            <ItemSelect items={items} value={item} onChange={setItem} withAll />
          </div>
          <p className="text-sm text-muted-foreground">{tr('Затрат:')}{' '}<span className="font-medium text-foreground tabular-nums">{fmtMoney(total)}</span>
          </p>
        </div>
        {canRecord && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)} disabled={items.length === 0}>
              <FileSpreadsheet />{tr('Из Excel')}</Button>
            <Button onClick={() => setDialog('new')} disabled={items.length === 0}>
              <Plus />{tr('Затрата')}</Button>
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{items.length === 0 ? tr('Сначала создайте статьи бюджета.') : tr('Затрат пока нет. Вносите акты, счета и списания по статьям или загрузите выгрузку из учётной системы.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{tr('Документ')}</th>
                <th className="px-3 py-2 text-left font-medium">{tr('Статья')}</th>
                <th className="px-3 py-2 text-left font-medium">{tr('Договор')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('Сумма')}</th>
                {canRecord && <th className="w-20 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="px-3 py-2">
                    <span className="block font-medium">
                      {DOC_TYPE_LABELS[a.doc_type]} {a.doc_number}
                    </span>
                    <span className="block text-xs text-muted-foreground">{[fmtDay(a.doc_date), a.counterparty].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="ident text-muted-foreground">{byId.get(a.item_id)?.code}</span> {byId.get(a.item_id)?.name}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.commitment_id ? (cById.get(a.commitment_id)?.title ?? '—') : '—'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${a.amount < 0 ? 'text-green-700 dark:text-green-300' : ''}`}>{fmtMoney(a.amount)}{a.currency && a.orig_amount !== null && <span className="block text-xs font-normal text-muted-foreground">{`${fmtMoney0(a.orig_amount)} ${symbolOf(a.currency)}`}</span>}</td>
                  {canRecord && (
                    <td className="px-2 py-1 text-right">
                      <div className="flex justify-end">
                        <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Изменить')} onClick={() => setDialog(a)}>
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={tr('Удалить')}
                          disabled={busy}
                          onClick={async () => {
                            if (!window.confirm(tr('Удалить запись о затрате?'))) return
                            setBusy(true)
                            try {
                              await deleteActual(a.id)
                              await refresh()
                            } catch (e) {
                              toast.error(budgetErrorText(e, tr('Не удалось удалить.')))
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && <ActualDialog projectId={projectId} items={items} commitments={commitments} initial={dialog === 'new' ? null : dialog} defaultItem={item === ALL ? '' : item} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void refresh() }} />}
      {importing && (
        <ImportDialog
          title={tr('Загрузить затраты из Excel')}
          description={tr('Подходит выгрузка актов, счетов и списаний из учётной системы. «Код статьи» должен совпадать с кодами статей бюджета.')}
          fields={ACTUAL_FIELDS}
          onClose={() => { setImporting(false); void refresh() }}
          onImport={async (rows) => {
            try {
              const n = await importActuals(projectId, rows.map((r) => ({ item_code: r.item_code, doc_type: docTypeFromText(r.doc_type), doc_number: r.doc_number, doc_date: r.doc_date, amount: r.amount, counterparty: r.counterparty, note: r.note })))
              return tr('Загружено записей: {{n}}', { n })
            } catch (e) {
              throw new Error(budgetErrorText(e, tr('Не удалось загрузить затраты.')))
            }
          }}
        />
      )}
    </div>
  )
}

function ActualDialog({ projectId, items, commitments, initial, defaultItem, onClose, onSaved }: { projectId: string; items: CbsItem[]; commitments: BudgetCommitment[]; initial: BudgetActual | null; defaultItem: string; onClose: () => void; onSaved: () => void }) {
  const { code: baseCode, rate } = useProjectCurrency(projectId)
  const [currency, setCurrency] = useState(initial?.currency ?? baseCode)
  const [itemId, setItemId] = useState(initial?.item_id ?? defaultItem)
  const [docType, setDocType] = useState<ActualDocType>(initial?.doc_type ?? 'act')
  const [docNumber, setDocNumber] = useState(initial?.doc_number ?? '')
  const [docDate, setDocDate] = useState(initial?.doc_date ?? new Date().toLocaleDateString('sv'))
  const [amount, setAmount] = useState(initial ? String(initial.orig_amount ?? initial.amount) : '')
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '')
  const [commitmentId, setCommitmentId] = useState(initial?.commitment_id ?? NONE)
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState(false)
  const value = parseAmount(amount)
  const ok = !!itemId && Number.isFinite(value) && value !== 0 && !!docDate
  const options = commitments.filter((c) => c.status === 'active' && (!itemId || c.item_id === itemId))
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? tr('Затрата') : tr('Новая затрата')}</DialogTitle>
          <DialogDescription>{tr('Акт, счёт, списание или зарплата. Корректировку вводите отрицательной суммой.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!ok || busy) return
            setBusy(true)
            try {
              await saveActual({ projectId, id: initial?.id ?? null, itemId, docType, docNumber, docDate, amount: value, currency: currency === baseCode ? null : currency, counterparty, commitmentId: commitmentId === NONE ? null : commitmentId, note })
              onSaved()
            } catch (err) {
              toast.error(budgetErrorText(err, tr('Не удалось сохранить затрату.')))
              setBusy(false)
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="ac-item">{tr('Статья')}</Label>
            <ItemSelect id="ac-item" items={items} value={itemId} onChange={(v) => { setItemId(v); setCommitmentId(NONE) }} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ac-type">{tr('Документ')}</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as ActualDocType)}>
                <SelectTrigger id="ac-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DOC_TYPE_LABELS) as ActualDocType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {DOC_TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ac-num">{tr('Номер')}</Label>
              <Input id="ac-num" value={docNumber} maxLength={60} onChange={(e) => setDocNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ac-date">{tr('Дата')}</Label>
              <DatePicker id="ac-date" value={docDate} onChange={(v) => setDocDate(v)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ac-amount">{tr('Сумма')}</Label>
              <div className="flex gap-2">
                <Input id="ac-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0 flex-1" autoFocus />
                {(rate !== null || currency !== baseCode) && (
                  <select aria-label={tr('Валюта суммы')} value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
                    {(['GEL', 'USD'] as const).map((c) => (
                      <option key={c} value={c}>
                        {symbolOf(c)} {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {currency !== baseCode && Number.isFinite(value) && value > 0 && rate !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">{tr('По курсу {{rate}} это {{sum}} {{cur}}', { rate, sum: fmtMoney(baseCode === 'GEL' ? value * rate : value / rate), cur: symbolOf(baseCode) })}</p>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ac-cp">{tr('Контрагент')}</Label>
              <Input id="ac-cp" value={counterparty} maxLength={200} onChange={(e) => setCounterparty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ac-cm">{tr('По договору')}</Label>
              <Select value={commitmentId} onValueChange={setCommitmentId}>
                <SelectTrigger id="ac-cm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Без договора')}</SelectItem>
                  {options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ac-note">{tr('Примечание')}</Label>
            <Textarea id="ac-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!ok || busy}>
              {busy ? tr('Сохраняем…') : tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
