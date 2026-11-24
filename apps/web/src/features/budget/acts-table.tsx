import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { DOC_TYPE_LABELS, fmtMoney, type BudgetActual, type CbsItem } from './api'
import { itemLabel, pct } from './lookahead-model'

const dayFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
const monthFmt = new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric' })
const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`))
const docTitle = (a: BudgetActual) => (a.note && !a.doc_number ? a.note : `${DOC_TYPE_LABELS[a.doc_type]}${a.doc_number ? ` № ${a.doc_number}` : ''}`)

type View = 'list' | 'month' | 'year' | 'item' | 'counterparty'

interface Group {
  key: string
  label: string
  sub?: string
  acts: BudgetActual[]
  sum: number
}

/**
 * Акты статьи (раздела) в нескольких видах: списком с нарастающим итогом, по месяцам, по годам, по статьям раздела,
 * по контрагентам. В сгруппированных видах строка раскрывается до самих актов.
 */
export function ActsTable({ acts, itemsById, bac, many }: { acts: BudgetActual[]; itemsById: Map<string, CbsItem>; bac: number; many: boolean }) {
  const withCounterparty = acts.some((a) => a.counterparty)
  const views: [View, string][] = [
    ['list', tr('Списком')],
    ['month', tr('По месяцам')],
    ['year', tr('По годам')],
    ...(many ? ([['item', tr('По статьям')]] as [View, string][]) : []),
    ...(withCounterparty ? ([['counterparty', tr('По контрагентам')]] as [View, string][]) : []),
  ]
  const [view, setView] = useState<View>('list')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const total = acts.reduce((s, a) => s + a.amount, 0)
  // время — по порядку, остальное — по сумме
  const timeView = view === 'month' || view === 'year' || view === 'list'

  const groups = useMemo((): Group[] => {
    if (view === 'list') return []
    const m = new Map<string, Group>()
    for (const a of acts) {
      let key: string
      let label: string
      let sub: string | undefined
      if (view === 'month') {
        key = a.doc_date.slice(0, 7)
        label = monthFmt.format(new Date(`${key}-01T00:00:00`))
      } else if (view === 'year') {
        key = a.doc_date.slice(0, 4)
        label = key
      } else if (view === 'item') {
        const it = itemsById.get(a.item_id)
        key = a.item_id
        label = it ? `${it.code} ${itemLabel(it, it).main}` : '—'
        sub = it ? (itemLabel(it, it).sub ?? undefined) : undefined
      } else {
        key = a.counterparty ?? ''
        label = a.counterparty ?? tr('Контрагент не указан')
      }
      const g = m.get(key) ?? { key, label, sub, acts: [], sum: 0 }
      g.acts.push(a)
      g.sum += a.amount
      m.set(key, g)
    }
    const list = [...m.values()]
    return view === 'month' || view === 'year' ? list.sort((x, y) => x.key.localeCompare(y.key)) : list.sort((x, y) => y.sum - x.sum)
  }, [acts, view, itemsById])

  const runningList = useMemo(() => acts.map((_, i) => acts.slice(0, i + 1).reduce((t, x) => t + x.amount, 0)), [acts])
  const runningGroups = useMemo(() => groups.map((_, i) => groups.slice(0, i + 1).reduce((t, g) => t + g.sum, 0)), [groups])
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const overCls = (v: number) => (bac > 0 && v > bac + 9.99 ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted-foreground')

  return (
    <section aria-labelledby="item-acts">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="item-acts" className="text-base font-semibold">
          {tr('Выполнено по актам')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {tr('документов: {{n}}', { n: acts.length })} · {tr('итого')} <span className="font-semibold text-foreground tabular-nums">{fmtMoney(total)}</span>
        </p>
      </div>
      {acts.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{tr('Затрат по статье пока нет.')}</p>
      ) : (
        <>
          <div role="tablist" aria-label={tr('Как показать акты')} className="mb-2 inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted/40 p-0.5">
            {views.map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setView(v)
                  setOpen(new Set())
                }}
                className={`min-h-8 rounded-md px-3 text-sm ${view === v ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            {view === 'list' ? (
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">{tr('Дата')}</th>
                    <th className="px-3 py-2 text-left font-medium">{tr('Документ')}</th>
                    {many && <th className="px-3 py-2 text-left font-medium">{tr('Статья')}</th>}
                    <th className="px-3 py-2 text-left font-medium">{tr('Контрагент')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('Сумма')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('Нарастающим итогом')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('% бюджета')}</th>
                  </tr>
                </thead>
                <tbody>
                  {acts.map((a, i) => (
                    <tr key={a.id} className="border-b last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(a.doc_date)}</td>
                      <td className="px-3 py-2">{docTitle(a)}</td>
                      {many && <td className="ident px-3 py-2 text-muted-foreground">{itemsById.get(a.item_id)?.code}</td>}
                      <td className="px-3 py-2 text-muted-foreground">{a.counterparty ?? '—'}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${a.amount < 0 ? 'text-green-700 dark:text-green-300' : ''}`}>{fmtMoney(a.amount)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${overCls(runningList[i])}`}>{fmtMoney(runningList[i])}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${overCls(runningList[i])}`}>{bac > 0 ? `${pct(runningList[i], bac)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <TotalRow span={many ? 4 : 3} total={total} bac={bac} />
              </table>
            ) : (
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">{{ month: tr('Месяц'), year: tr('Год'), item: tr('Статья'), counterparty: tr('Контрагент') }[view]}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('Документов')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('Сумма')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('Доля выполненного')}</th>
                    {timeView && <th className="px-3 py-2 text-right font-medium">{tr('Нарастающим итогом')}</th>}
                    <th className="px-3 py-2 text-right font-medium">{timeView ? tr('% бюджета (нараст.)') : tr('% бюджета')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => {
                    const isOpen = open.has(g.key)
                    const share = total ? (g.sum / total) * 100 : 0
                    return (
                      <Fragment key={g.key}>
                        <tr className="border-b last:border-b-0 hover:bg-muted/40">
                          <td className="px-3 py-2">
                            <button type="button" aria-expanded={isOpen} onClick={() => toggle(g.key)} className="flex items-start gap-1.5 text-left">
                              {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
                              <span>
                                <span className={`font-medium ${view === 'month' ? 'capitalize' : ''}`}>{g.label}</span>
                                {g.sub && <span className="block text-xs text-muted-foreground">{g.sub}</span>}
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{g.acts.length}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{fmtMoney(g.sum)}</td>
                          <td className="px-3 py-2">
                            <span className="flex items-center justify-end gap-2">
                              <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                                <span className="block h-full bg-blue-600" style={{ width: `${Math.min(Math.max(share, 0), 100)}%` }} />
                              </span>
                              <span className="w-10 text-right tabular-nums">{Math.round(share)}%</span>
                            </span>
                          </td>
                          {timeView && <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${overCls(runningGroups[i])}`}>{fmtMoney(runningGroups[i])}</td>}
                          <td className={`px-3 py-2 text-right tabular-nums ${timeView ? overCls(runningGroups[i]) : 'text-muted-foreground'}`}>
                            {bac > 0 ? `${pct(timeView ? runningGroups[i] : g.sum, bac)}%` : '—'}
                          </td>
                        </tr>
                        {isOpen &&
                          g.acts.map((a) => (
                            <tr key={a.id} className="border-b bg-muted/20 text-xs">
                              <td className="py-1.5 pl-9 pr-3" colSpan={2}>
                                <span className="tabular-nums text-muted-foreground">{fmtDay(a.doc_date)}</span> · {docTitle(a)}
                                {view !== 'item' && many && <span className="ident ml-1.5 text-muted-foreground">{itemsById.get(a.item_id)?.code}</span>}
                                {view !== 'counterparty' && a.counterparty && <span className="text-muted-foreground"> · {a.counterparty}</span>}
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtMoney(a.amount)}</td>
                              <td colSpan={timeView ? 3 : 2} />
                            </tr>
                          ))}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/50 font-semibold">
                    <td className="px-3 py-2.5">{tr('Итого выполнено')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{acts.length}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtMoney(total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">100%</td>
                    {timeView && (
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-normal text-muted-foreground">{tr('из бюджета {{sum}}', { sum: fmtMoney(bac) })}</td>
                    )}
                    <td className="px-3 py-2.5 text-right tabular-nums">{bac > 0 ? `${pct(total, bac)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function TotalRow({ span, total, bac }: { span: number; total: number; bac: number }) {
  return (
    <tfoot>
      <tr className="border-t-2 bg-muted/50 font-semibold">
        <td className="px-3 py-2.5" colSpan={span}>
          {tr('Итого выполнено')}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtMoney(total)}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-normal text-muted-foreground">{tr('из бюджета {{sum}}', { sum: fmtMoney(bac) })}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{bac > 0 ? `${pct(total, bac)}%` : '—'}</td>
      </tr>
    </tfoot>
  )
}
