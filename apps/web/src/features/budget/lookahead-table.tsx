import { fromDisplay, toDisplay } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtMoney, type BudgetRow, type CbsItem } from './api'
import { fullMoney, isBalanced, itemLabel, money, type LookaheadData } from './lookahead-model'
import { monthLong, monthShort, THIS_MONTH, ym } from './months'

const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 })
/** Сумма в тысячах валюты показа; ноль — пусто */
const k = (n: number) => (Math.abs(toDisplay(n)) < 500 ? '' : nf.format(Math.round(toDisplay(n) / 1000)))

/** Таблица по месяцам «как в Excel»: статья × 12 месяцев выбранного года. */
export function MonthTable({
  rows,
  data,
  byId,
  canRecord,
  cur,
  onSave,
  onSpread,
}: {
  rows: BudgetRow[]
  data: LookaheadData
  byId: Map<string, CbsItem>
  canRecord: boolean
  cur: string
  onSave: (itemId: string, month: string, amount: number) => Promise<unknown>
  onSpread: (row: BudgetRow) => void
}) {
  const years = useMemo(() => {
    const ys = new Set<number>([Number(THIS_MONTH.slice(0, 4))])
    for (const m of data.allMonths) ys.add(Number(m.slice(0, 4)))
    return [...ys].sort()
  }, [data.allMonths])
  const [year, setYear] = useState(() => Number(data.firstOpen.slice(0, 4)))
  const months = Array.from({ length: 12 }, (_, i) => ym(year, i + 1))
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const visible = useMemo(() => {
    const out: BudgetRow[] = []
    let hide: number | null = null
    for (const r of rows) {
      if (hide !== null && r.depth > hide) continue
      hide = null
      out.push(r)
      if (r.hasChildren && !open.has(r.id)) hide = r.depth
    }
    return out
  }, [rows, open])
  const state = (m: string) => (data.isClosed(m) ? 'fact' : m < THIS_MONTH ? 'late' : 'plan')
  const yearSum = (mm: Map<string, number>) => months.reduce((s, m) => s + (mm.get(m) ?? 0), 0)

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div role="group" aria-label={tr('Год')} className="inline-flex overflow-hidden rounded-md border">
          {years.map((y) => (
            <button key={y} type="button" aria-pressed={y === year} onClick={() => setYear(y)} className={`min-h-9 px-3 text-sm tabular-nums ${y === year ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {y}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i className="size-3 rounded-sm border bg-muted" />
            {tr('Факт — месяц закрыт')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-3 rounded-sm bg-amber-200 dark:bg-amber-900" />
            {tr('Прошёл, но не закрыт')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-3 rounded-sm border bg-card" />
            {canRecord ? tr('План — нажмите на сумму, чтобы изменить') : tr('План')}
          </span>
        </div>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setOpen(open.size ? new Set() : new Set(rows.filter((r) => r.hasChildren).map((r) => r.id)))}>
          {open.size ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
          {open.size ? tr('Свернуть всё') : tr('Развернуть всё')}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="sticky left-0 z-20 min-w-64 border-b bg-card px-4 py-2 text-left font-normal">{tr('Суммы в тысячах {{cur}}', { cur })}</th>
              <th className="border-b px-3 py-2 text-right font-medium">{tr('Бюджет')}</th>
              {months.map((m) => {
                const s = state(m)
                return (
                  <th key={m} className={`border-b px-2 py-2 text-right font-medium ${s === 'fact' ? 'bg-muted' : s === 'late' ? 'bg-amber-100 dark:bg-amber-950' : ''}`} title={monthLong(m)}>
                    <span className="inline-flex items-center gap-1">
                      {s === 'fact' && <Lock className="size-3" aria-label={tr('закрыт')} />}
                      {monthShort(m)}
                    </span>
                  </th>
                )
              })}
              <th className="border-b border-l px-3 py-2 text-right font-medium">{tr('За {{year}}', { year })}</th>
              <th className="border-b px-3 py-2 text-center font-medium">{tr('Сходится?')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const i = data.info.get(r.id)
              if (!i) return null
              const l = itemLabel(r, byId.get(r.id))
              const group = r.hasChildren
              const ok = isBalanced(i.un)
              return (
                <tr key={r.id} className={r.depth === 0 ? 'font-medium' : ''}>
                  <th scope="row" className="sticky left-0 z-10 border-b bg-card px-4 py-2 text-left font-normal">
                    <div className="flex items-start gap-1.5" style={{ paddingLeft: r.depth * 16 }}>
                      {group ? (
                        <button
                          type="button"
                          aria-label={open.has(r.id) ? tr('Свернуть') : tr('Развернуть')}
                          aria-expanded={open.has(r.id)}
                          onClick={() =>
                            setOpen((s) => {
                              const n = new Set(s)
                              if (n.has(r.id)) n.delete(r.id)
                              else n.add(r.id)
                              return n
                            })
                          }
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted"
                        >
                          {open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      ) : (
                        <span className="inline-block size-6 shrink-0" />
                      )}
                      <span className="min-w-0 max-w-72">
                        <span className="ident mr-1.5 text-muted-foreground" title={byId.get(r.id)?.source_code ? tr('В файле: {{code}}', { code: byId.get(r.id)!.source_code! }) : undefined}>
                          {r.code}
                        </span>
                        <span className={r.depth === 0 ? 'font-medium' : ''}>{l.main}</span>
                      </span>
                    </div>
                  </th>
                  <td className="border-b px-3 py-2 text-right" title={fullMoney(r.bac)}>
                    {k(r.bac)}
                  </td>
                  {months.map((m) => {
                    const v = i.months.get(m) ?? 0
                    const s = state(m)
                    const acts = i.pending.get(m) ?? 0
                    const bg = s === 'fact' ? 'bg-muted text-muted-foreground' : s === 'late' ? 'bg-amber-50 dark:bg-amber-950/40' : ''
                    return (
                      <td key={m} className={`border-b px-1 py-1 text-right ${bg}`}>
                        {canRecord && !group && s !== 'fact' ? (
                          <MonthCell value={v} label={`${r.code}, ${monthLong(m)}`} acts={acts} cur={cur} onSave={(x) => onSave(r.id, `${m}-01`, x)} />
                        ) : (
                          <span className="px-1.5" title={[v ? fullMoney(v) : null, acts ? tr('Уже внесено актов: {{sum}}', { sum: fmtMoney(acts) }) : null].filter(Boolean).join(' · ') || undefined}>
                            {k(v) || <span className="text-muted-foreground/40">—</span>}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="border-b border-l px-3 py-2 text-right font-medium" title={fullMoney(yearSum(i.months))}>
                    {k(yearSum(i.months))}
                  </td>
                  <td className="border-b px-3 py-2 text-center">
                    {ok ? (
                      <Check className="mx-auto size-4 text-green-600" aria-label={tr('Сходится с бюджетом')} />
                    ) : (
                      <button
                        type="button"
                        disabled={!canRecord || group}
                        onClick={() => onSpread(r)}
                        title={i.un < 0 ? tr('В плане на {{sum}} больше бюджета', { sum: fullMoney(-i.un) }) : tr('{{sum}} ещё не разложено по месяцам', { sum: fullMoney(i.un) })}
                        className="whitespace-nowrap rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 enabled:hover:bg-red-500/20 dark:text-red-300"
                      >
                        {i.un < 0 ? tr('лишнее {{sum}}', { sum: money(-i.un) }) : tr('не хватает {{sum}}', { sum: money(i.un) })}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr className="bg-muted/50 font-semibold">
              <th scope="row" className="sticky left-0 z-10 bg-muted px-4 py-2 text-left">
                {tr('Итого')}
              </th>
              <td className="px-3 py-2 text-right" title={fullMoney(data.grand.fact + data.grand.plan + data.grand.un)}>
                {k(data.grand.fact + data.grand.plan + data.grand.un)}
              </td>
              {months.map((m) => (
                <td key={m} className="px-2 py-2 text-right" title={fullMoney(data.grand.months.get(m) ?? 0)}>
                  {k(data.grand.months.get(m) ?? 0)}
                </td>
              ))}
              <td className="border-l px-3 py-2 text-right" title={fullMoney(yearSum(data.grand.months))}>
                {k(yearSum(data.grand.months))}
              </td>
              <td className="px-3 py-2 text-center">{isBalanced(data.grand.un) ? <Check className="mx-auto size-4 text-green-600" /> : <span className="text-xs text-red-700 dark:text-red-300" title={fullMoney(data.grand.un)}>{money(data.grand.un)}</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Ячейка плана: тысячи; по нажатию — поле с полной суммой в валюте показа. */
function MonthCell({ value, label, acts, cur, onSave }: { value: number; label: string; acts: number; cur: string; onSave: (v: number) => Promise<unknown> }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState('')
  if (!edit)
    return (
      <button
        type="button"
        aria-label={tr('План: {{label}}', { label })}
        title={[value ? fullMoney(value) : null, acts ? tr('Уже внесено актов: {{sum}}', { sum: fmtMoney(acts) }) : null, tr('Нажмите, чтобы изменить план')].filter(Boolean).join(' · ')}
        onClick={() => {
          setText(value ? String(Math.round(toDisplay(value) * 100) / 100) : '')
          setEdit(true)
        }}
        className="min-h-8 w-full min-w-12 rounded px-1.5 text-right hover:bg-blue-500/10 hover:ring-1 hover:ring-blue-500/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {k(value) || <span className="text-muted-foreground/40">—</span>}
      </button>
    )
  const save = async () => {
    setEdit(false)
    const n = Number(text.replace(/[\s ]/g, '').replace(',', '.') || '0')
    if (!Number.isFinite(n) || n < 0) return toast.error(tr('Проверьте сумму.'))
    const next = Math.round(fromDisplay(n) * 100) / 100
    if (Math.abs(next - value) < 0.005) return
    await onSave(next)
  }
  return (
    <Input
      autoFocus
      inputMode="decimal"
      aria-label={tr('План в {{cur}}: {{label}}', { cur, label })}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setEdit(false)
      }}
      className="h-8 w-28 px-1.5 text-right text-sm tabular-nums"
    />
  )
}
