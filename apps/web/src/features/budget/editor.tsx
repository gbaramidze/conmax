import { fromDisplay, toDisplay, useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FileSpreadsheet, GitCompareArrows, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  approveVersion,
  budgetErrorText,
  COST_TYPE_LABELS,
  createDraft,
  deleteItem,
  diffVersions,
  discardDraft,
  fmtMoney,
  importBudget,
  setAmount,
  upsertItem,
  type BudgetAmount,
  type BudgetModel,
  type BudgetVersion,
  type CbsItem,
  type CostType,
} from './api'
import { ImportDialog, type ImportField } from './import-dialog'

const NONE = '__none__'
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })

const STATUS_LABEL = { draft: tr('Черновик'), approved: tr('Действует'), superseded: tr('Заменена') } as const
const STATUS_STYLE = {
  draft: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-300',
  superseded: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
} as const

const IMPORT_FIELDS: ImportField[] = [
  { key: 'code', label: tr('Код статьи'), required: true, aliases: ['код', 'шифр', 'номер', '№', 'п/п'] },
  { key: 'name', label: tr('Название'), required: true, aliases: ['наименование', 'название', 'статья', 'работ'] },
  { key: 'amount', label: tr('Сумма'), aliases: ['сумма', 'стоимость', 'бюджет', 'итого', 'всего'], kind: 'number' },
  { key: 'cost_type', label: tr('Вид затрат'), aliases: ['вид затрат', 'тип затрат', 'тип', 'вид'] },
]

function costTypeFromText(s: unknown): CostType {
  const t = String(s ?? '').toLowerCase()
  if (!t) return 'other'
  if (t.includes('труд') || t.includes('зарпл')) return 'labor'
  if (t.includes('материал')) return 'materials'
  if (t.includes('механ') || t.includes('техник')) return 'equipment'
  if (t.includes('субпод') || t.includes('подряд')) return 'subcontract'
  if (t.includes('накладн')) return 'overhead'
  if (t.includes('резерв') || t.includes('непредвид')) return 'contingency'
  return 'other'
}

/**
 * Строки Excel → строки импорта. В таблицах у группы обычно стоит итог по вложенным: если сумма группы пустая или
 * совпадает с суммой вложенных, она не загружается (иначе посчиталась бы дважды).
 */
function withoutGroupTotals(rows: Record<string, string | number | null>[]) {
  const list = rows.map((x) => ({ code: String(x.code).trim(), name: String(x.name), amount: Number(x.amount ?? 0), cost_type: costTypeFromText(x.cost_type) }))
  return list.map((r) => {
    const prefix = `${r.code}.`
    const kids = list.filter((k) => k.code.startsWith(prefix) && !list.some((m) => m.code !== r.code && m.code.startsWith(prefix) && k.code.startsWith(`${m.code}.`)))
    if (kids.length === 0) return r
    const sum = kids.reduce((s, k) => s + (k.amount || 0), 0)
    return Math.abs(r.amount - sum) <= Math.max(1, sum * 0.005) ? { ...r, amount: 0 } : r
  })
}

/** Своя сумма статьи + вложенные. */
function rollup(items: CbsItem[], own: Map<string, number>): Map<string, number> {
  const kids = new Map<string | null, CbsItem[]>()
  for (const it of items) kids.set(it.parent_id, [...(kids.get(it.parent_id) ?? []), it])
  const total = new Map<string, number>()
  const walk = (id: string): number => {
    const s = (own.get(id) ?? 0) + (kids.get(id) ?? []).reduce((acc, k) => acc + walk(k.id), 0)
    total.set(id, s)
    return s
  }
  for (const it of kids.get(null) ?? []) walk(it.id)
  return total
}

export function BudgetEditor({
  projectId,
  model,
  items,
  versions,
  amounts,
  canEdit,
  canApprove,
}: {
  projectId: string
  model: BudgetModel
  items: CbsItem[]
  versions: BudgetVersion[]
  amounts: BudgetAmount[]
  canEdit: boolean
  canApprove: boolean
}) {
  const qc = useQueryClient()
  const { symbol: cur } = useDisplayCurrency()
  const draft = versions.find((v) => v.status === 'draft') ?? null
  const shown = draft ?? versions.find((v) => v.status === 'approved') ?? null
  const [busy, setBusy] = useState(false)
  const [itemDialog, setItemDialog] = useState<{ item: CbsItem | null; parent: CbsItem | null } | null>(null)
  const [importing, setImporting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [comparing, setComparing] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['budget'] })
  const run = async (action: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      if (ok) toast.success(ok)
      return true
    } catch (e) {
      toast.error(budgetErrorText(e, tr('Не удалось выполнить действие. Повторите попытку.')))
      return false
    } finally {
      setBusy(false)
    }
  }

  const own = useMemo(() => {
    const m = new Map<string, number>()
    if (shown) for (const a of amounts) if (a.version_id === shown.id) m.set(a.item_id, a.amount)
    return m
  }, [amounts, shown])
  const totals = useMemo(() => rollup(items, own), [items, own])
  const grand = useMemo(() => items.filter((i) => !i.parent_id).reduce((s, i) => s + (totals.get(i.id) ?? 0), 0), [items, totals])
  const versionTotal = (v: BudgetVersion) => amounts.filter((a) => a.version_id === v.id).reduce((s, a) => s + a.amount, 0)
  const flat = model.rows
  const editing = canEdit && !!draft

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="versions" className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="versions" className="text-sm font-semibold">{tr('Версии бюджета')}</h3>
          <div className="flex flex-wrap gap-2">
            {canEdit && !draft && (
              <Button variant="outline" disabled={busy} onClick={() => run(() => createDraft(projectId), tr('Черновик создан: он начинается с копии действующей версии.'))}>
                <Plus /> {versions.length === 0 ? tr('Создать исходный бюджет') : tr('Новая версия')}
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (!draft && !(await run(() => createDraft(projectId)))) return
                  setImporting(true)
                }}
              >
                <FileSpreadsheet />{tr('Загрузить из Excel')}</Button>
            )}
            {versions.filter((v) => v.status !== 'draft').length >= 2 && (
              <Button variant="outline" onClick={() => setComparing(true)}>
                <GitCompareArrows />{tr('Сравнить версии')}</Button>
            )}
          </div>
        </div>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('Версий пока нет. Загрузите бюджет из Excel или создайте статьи вручную: сначала черновик, затем утверждение исходного бюджета.')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium">{v.name}</span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                <span className="text-xs text-muted-foreground">{v.approved_at ? tr('утверждена {{v1}}', { v1: dateFmt.format(new Date(v.approved_at)) }) : tr('создана {{v1}}', { v1: dateFmt.format(new Date(v.created_at)) })}</span>
                <span className="ml-auto tabular-nums">{fmtMoney(versionTotal(v))}</span>
              </li>
            ))}
          </ul>
        )}
        {draft && canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            {canApprove && (
              <Button disabled={busy} onClick={() => setApproving(true)}>
                <Check />{tr('Утвердить версию')}</Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => window.confirm(tr('Отменить черновик? Введённые в нём суммы пропадут.')) && run(() => discardDraft(draft.id), tr('Черновик отменён'))}>
              <X />{tr('Отменить черновик')}</Button>
            {!canApprove && <p className="self-center text-xs text-muted-foreground">{tr('Утверждает руководитель проекта.')}</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="tree" className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <h3 id="tree" className="text-sm font-semibold">{tr('Статьи затрат')}{' '}{shown && <span className="font-normal text-muted-foreground">· {shown.name}</span>}
          </h3>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setItemDialog({ item: null, parent: null })}>
              <Plus />{tr('Статья')}</Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{tr('Статей пока нет. Добавьте вручную или загрузите из Excel.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">{tr('Статья')}</th>
                  <th className="px-3 py-2 text-left font-medium">{tr('Вид затрат')}</th>
                  <th className="w-44 px-3 py-2 text-right font-medium">{tr('Своя сумма, {{cur}}', { cur })}</th>
                  <th className="w-36 px-3 py-2 text-right font-medium">{tr('С вложенными')}</th>
                  {canEdit && <th className="w-28 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {flat.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-3 py-1.5" style={{ paddingLeft: 12 + r.depth * 16 }}>
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      <span className={r.hasChildren ? 'font-medium' : ''}>{r.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{COST_TYPE_LABELS[r.cost_type]}</td>
                    <td className="px-3 py-1 text-right">{editing ? <AmountInput key={`${shown!.id}-${r.id}-${own.get(r.id) ?? 0}`} value={own.get(r.id) ?? 0} onSave={(v) => run(() => setAmount(draft!.id, r.id, v))} label={tr('Сумма: {{name}}', { name: r.name })} /> : <span className="tabular-nums">{(own.get(r.id) ?? 0) > 0 ? fmtMoney(own.get(r.id)!) : '—'}</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.hasChildren ? fmtMoney(totals.get(r.id) ?? 0) : ''}</td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Добавить вложенную статью в {{name}}', { name: r.name })} title={tr('Вложенная статья')} onClick={() => setItemDialog({ item: null, parent: items.find((i) => i.id === r.id)! })}>
                            <Plus />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Изменить {{name}}', { name: r.name })} onClick={() => setItemDialog({ item: items.find((i) => i.id === r.id)!, parent: null })}>
                            <Pencil />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={tr('Удалить {{name}}', { name: r.name })}
                            disabled={busy}
                            onClick={() => window.confirm(tr('Удалить статью «{{name}}»?', { name: r.name })) && run(() => deleteItem(r.id), tr('Статья удалена'))}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{tr('Итого')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(grand)}</td>
                  {canEdit && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {!draft && canEdit && items.length > 0 && <p className="border-t p-3 text-xs text-muted-foreground">{tr('Суммы утверждённой версии не меняются. Чтобы внести изменение, создайте новую версию — она начнётся с копии действующей.')}</p>}
      </section>

      {itemDialog && (
        <ItemDialog
          items={items}
          editing={itemDialog.item}
          parent={itemDialog.parent}
          busy={busy}
          onClose={() => setItemDialog(null)}
          onSave={async (v) => {
            const ok = await run(() => upsertItem({ projectId, id: itemDialog.item?.id ?? null, ...v }), tr('Статья сохранена'))
            if (ok) setItemDialog(null)
          }}
        />
      )}
      {importing && draft && (
        <ImportDialog
          title={tr('Загрузить бюджет из Excel')}
          description={tr('Статьи создаются по кодам (1.2.3 вкладывается в 1.2), суммы попадают в черновик. Существующие статьи с теми же кодами обновляются.')}
          fields={IMPORT_FIELDS}
          onClose={() => {
            setImporting(false)
            void refresh()
          }}
          onImport={async (rows) => {
            try {
              const r = await importBudget(draft.id, withoutGroupTotals(rows))
              return tr('Загружено строк: {{rows}}, новых статей: {{created}}, обновлено: {{updated}}', { rows: r.rows, created: r.created, updated: r.updated })
            } catch (e) {
              throw new Error(budgetErrorText(e, tr('Не удалось загрузить бюджет.')))
            }
          }}
        />
      )}
      {approving && draft && (
        <ApproveDialog
          draft={draft}
          total={versionTotal(draft)}
          previous={versions.find((v) => v.status === 'approved') ? versionTotal(versions.find((v) => v.status === 'approved')!) : null}
          busy={busy}
          onClose={() => setApproving(false)}
          onApprove={async (note) => {
            const ok = await run(() => approveVersion(draft.id, note), tr('Версия утверждена'))
            if (ok) setApproving(false)
          }}
        />
      )}
      {comparing && <CompareDialog items={items} versions={versions.filter((v) => v.status !== 'draft')} amounts={amounts} onClose={() => setComparing(false)} />}
    </div>
  )
}

function AmountInput({ value, onSave, label }: { value: number; onSave: (v: number) => Promise<unknown>; label: string }) {
  // суммы в базе лежат в основной валюте проекта; в поле они показываются и вводятся в валюте показа
  const shown = (v: number) => (v > 0 ? String(Math.round(toDisplay(v) * 100) / 100) : '')
  const [text, setText] = useState(shown(value))
  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder="0"
      className="h-8 w-40 text-right tabular-nums"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text.replace(/\s/g, '').replace(',', '.') || '0')
        if (!Number.isFinite(n) || n < 0) return setText(shown(value))
        if (Math.abs(n - toDisplay(value)) > 0.004) void onSave(Math.round(fromDisplay(n) * 100) / 100)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function ItemDialog({
  items,
  editing,
  parent,
  busy,
  onClose,
  onSave,
}: {
  items: CbsItem[]
  editing: CbsItem | null
  parent: CbsItem | null
  busy: boolean
  onClose: () => void
  onSave: (v: { parentId: string | null; code: string; name: string; costType: CostType }) => void
}) {
  const suggested = parent ? `${parent.code}.${items.filter((i) => i.parent_id === parent.id).length + 1}` : editing ? editing.code : String(items.filter((i) => !i.parent_id).length + 1)
  const [code, setCode] = useState(suggested)
  const [name, setName] = useState(editing?.name ?? '')
  const [type, setType] = useState<CostType>(editing?.cost_type ?? parent?.cost_type ?? 'other')
  const [parentId, setParentId] = useState(editing ? (editing.parent_id ?? NONE) : (parent?.id ?? NONE))
  const sorted = useMemo(() => [...items].sort((a, b) => a.code.localeCompare(b.code, currentLocale(), { numeric: true })), [items])
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? tr('Статья затрат') : parent ? tr('Вложенная статья в {{code}}', { code: parent.code }) : tr('Новая статья')}</DialogTitle>
          <DialogDescription>{tr('Код определяет порядок и вложенность: «1.2» входит в «1».')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim() && name.trim() && !busy) onSave({ parentId: parentId === NONE ? null : parentId, code: code.trim(), name: name.trim(), costType: type })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="it-code">{tr('Код')}</Label>
              <Input id="it-code" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="it-name">{tr('Название')}</Label>
              <Input id="it-name" value={name} maxLength={300} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="it-type">{tr('Вид затрат')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as CostType)}>
                <SelectTrigger id="it-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(COST_TYPE_LABELS) as CostType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {COST_TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="it-parent">{tr('Входит в')}</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="it-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Верхний уровень')}</SelectItem>
                  {sorted
                    .filter((i) => i.id !== editing?.id)
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.code} {i.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!code.trim() || !name.trim() || busy}>
              {busy ? tr('Сохраняем…') : tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ApproveDialog({ draft, total, previous, busy, onClose, onApprove }: { draft: BudgetVersion; total: number; previous: number | null; busy: boolean; onClose: () => void; onApprove: (note: string) => void }) {
  const [note, setNote] = useState('')
  const delta = previous === null ? null : total - previous
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Утвердить «')}{draft.name}»</DialogTitle>
          <DialogDescription>{tr('Версия станет действующей, прежняя — заменённой. Утверждённую версию изменить нельзя.')}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{tr('Сумма версии')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{fmtMoney(total)}</dd>
          </div>
          {delta !== null && (
            <div>
              <dt className="text-xs text-muted-foreground">{tr('К действующей')}</dt>
              <dd className={`text-lg font-semibold tabular-nums ${delta > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>
                {delta > 0 ? '+' : ''}
                {fmtMoney(delta)}
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ap-note">{tr('Основание')}</Label>
          <Textarea id="ap-note" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} placeholder={tr('Например, решение ворот «Строительство» или номер изменения')} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="button" disabled={busy || total <= 0} onClick={() => onApprove(note)}>
            {busy ? tr('Утверждаем…') : tr('Утвердить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompareDialog({ items, versions, amounts, onClose }: { items: CbsItem[]; versions: BudgetVersion[]; amounts: BudgetAmount[]; onClose: () => void }) {
  const ordered = [...versions].sort((a, b) => a.number - b.number)
  const [from, setFrom] = useState(ordered[0].id)
  const [to, setTo] = useState(ordered[ordered.length - 1].id)
  const diff = useMemo(() => diffVersions(items, amounts, from, to), [items, amounts, from, to])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88svh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('Сравнение версий')}</DialogTitle>
          <DialogDescription>{tr('Что изменилось по статьям (с вложенными).')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {([[tr('Было'), from, setFrom], [tr('Стало'), to, setTo]] as const).map(([label, value, set]) => (
            <div key={label} className="flex flex-col gap-1.5">
              <Label>{label}</Label>
              <Select value={value} onValueChange={set}>
                <SelectTrigger className="w-full" aria-label={label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ordered.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <p className="text-sm">{tr('Итого:')}{' '}{fmtMoney(diff.from)} → {fmtMoney(diff.to)} <span className={diff.to - diff.from > 0 ? 'font-medium text-red-700 dark:text-red-300' : 'font-medium text-green-700 dark:text-green-300'}>({diff.to - diff.from > 0 ? '+' : ''}{fmtMoney(diff.to - diff.from)})</span>
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {diff.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{tr('Различий по статьям нет.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{tr('Статья')}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr('Было')}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr('Стало')}</th>
                  <th className="px-3 py-2 text-right font-medium">{tr('Разница')}</th>
                </tr>
              </thead>
              <tbody>
                {diff.rows.map((r) => (
                  <tr key={r.item.id} className="border-t">
                    <td className="px-3 py-1.5" style={{ paddingLeft: 12 + r.depth * 14 }}>
                      <span className="ident mr-1.5 text-muted-foreground">{r.item.code}</span>
                      {r.item.name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.from)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.to)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.to > r.from ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
                      {r.to > r.from ? '+' : ''}
                      {fmtMoney(r.to - r.from)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>{tr('Закрыть')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
