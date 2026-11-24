import { fromDisplay, toDisplay, useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtMoney, type BudgetRow } from './api'
import { addMonths, monthLong, spreadParts } from './months'

const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 })

/** «Разложить по месяцам»: сумма делится на N месяцев поровну или колоколом. */
export function SpreadDialog({
  rows,
  initial,
  closedFact,
  firstOpen,
  busy,
  onClose,
  onSpread,
}: {
  rows: BudgetRow[]
  initial: BudgetRow | null
  closedFact: (id: string) => number
  firstOpen: string
  busy: boolean
  onClose: () => void
  onSpread: (v: { itemId: string; from: string; months: number; amount: number; shape: 'equal' | 'scurve' }) => Promise<void>
}) {
  const { symbol: cur } = useDisplayCurrency()
  const leaves = rows.filter((r) => !r.hasChildren)
  const [itemId, setItemId] = useState(initial && !initial.hasChildren ? initial.id : (leaves[0]?.id ?? ''))
  const row = leaves.find((r) => r.id === itemId)
  const rest = row ? Math.max(row.bac - closedFact(row.id), 0) : 0
  const [amount, setAmount] = useState(String(Math.round(toDisplay(rest))))
  const [from, setFrom] = useState(firstOpen)
  const [count, setCount] = useState('6')
  const [shape, setShape] = useState<'equal' | 'scurve'>('equal')
  const n = Math.max(1, Math.min(120, Math.round(Number(count) || 1)))
  const total = Number(amount.replace(/[\s ]/g, '').replace(',', '.') || '0')
  const parts = spreadParts(Number.isFinite(total) ? total : 0, n, shape)
  const startOptions = Array.from({ length: 36 }, (_, i) => addMonths(firstOpen, i))
  const peak = Math.max(...parts, 1)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Разложить по месяцам')}</DialogTitle>
          <DialogDescription>{tr('Укажите, сколько денег и на сколько месяцев. Прежний план статьи заменится, закрытые месяцы не меняются.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="spread-item">{tr('Статья')}</Label>
            <Select
              value={itemId}
              onValueChange={(v) => {
                setItemId(v)
                const r = leaves.find((x) => x.id === v)
                if (r) setAmount(String(Math.round(toDisplay(Math.max(r.bac - closedFact(r.id), 0)))))
              }}
            >
              <SelectTrigger id="spread-item">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {leaves.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.code} {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row && (
              <p className="text-xs text-muted-foreground">
                {tr('Бюджет {{bac}}, уже выполнено {{fact}}, осталось {{rest}}', { bac: fmtMoney(row.bac), fact: fmtMoney(closedFact(row.id)), rest: fmtMoney(rest) })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="spread-amount">{tr('Сумма, {{cur}}', { cur })}</Label>
              <Input id="spread-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="spread-count">{tr('На сколько месяцев')}</Label>
              <Input id="spread-count" type="number" min={1} max={120} value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="spread-from">{tr('Начиная с')}</Label>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id="spread-from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {startOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLong(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="spread-shape">{tr('Как делить')}</Label>
              <Select value={shape} onValueChange={(v) => setShape(v as 'equal' | 'scurve')}>
                <SelectTrigger id="spread-shape">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equal">{tr('Поровну каждый месяц')}</SelectItem>
                  <SelectItem value="scurve">{tr('Больше в середине срока')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex h-16 items-end gap-0.5" aria-hidden>
              {parts.map((p, i) => (
                <div key={i} className="flex-1 rounded-sm bg-blue-400" style={{ height: `${Math.max(4, (p / peak) * 100)}%` }} title={`${monthLong(addMonths(from, i))}: ${nf.format(Math.round(p))}`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {tr('{{from}} – {{to}}, в первый месяц {{first}}', { from: monthLong(from), to: monthLong(addMonths(from, n - 1)), first: `${nf.format(Math.round(parts[0] ?? 0))} ${cur}` })}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button
            disabled={busy || !row || !Number.isFinite(total) || total < 0}
            onClick={() => onSpread({ itemId, from: `${from}-01`, months: n, amount: Math.round(fromDisplay(total) * 100) / 100, shape })}
          >
            {tr('Разложить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Закрытие месяца: сравнение плана и внесённых актов. */
export function CloseMonthDialog({ month, expected, acts, busy, onClose, onConfirm }: { month: string; expected: number; acts: number; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const diff = acts - expected
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Закрыть {{month}}?', { month: monthLong(month) })}</DialogTitle>
          <DialogDescription>{tr('После закрытия в этом месяце будет факт по актам вместо плана. План за месяц сохранится для сравнения, править его будет нельзя.')}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border p-3">
            <dt className="text-xs text-muted-foreground">{tr('Было в плане')}</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(expected)}</dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-xs text-muted-foreground">{tr('Внесено актов')}</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(acts)}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {acts === 0
            ? tr('Актов за месяц нет: после закрытия месяц будет пустым. Сначала внесите факт на вкладке «Факт».')
            : tr('Разница с планом: {{diff}} ({{pct}}%).', { diff: `${diff > 0 ? '+' : ''}${fmtMoney(diff)}`, pct: expected ? Math.round((diff / expected) * 100) : 0 })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={busy} onClick={() => void onConfirm()}>
            <Lock className="size-4" /> {tr('Закрыть месяц')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
