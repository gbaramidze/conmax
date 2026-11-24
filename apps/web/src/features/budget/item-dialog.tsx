import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { CircleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DOC_TYPE_LABELS, fmtMoney, phasing, type BudgetActual, type BudgetCommitment, type BudgetForecast, type BudgetRow, type CbsItem } from './api'
import type { Why } from './explain'
import { fullMoney, itemLabel, money, pct } from './lookahead-model'
import { Money } from './money'
import { addMonths, monthLong, monthShort } from './months'

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
const fmtDay = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')

/**
 * Карточка статьи (или раздела) — широкое окно: главные цифры; «Почему дороже» и накопленные затраты против бюджета;
 * таблица актов с нарастающим итогом и итоговой строкой; договоры.
 */
export function ItemDialog({
  row,
  item,
  items,
  commitments,
  actuals,
  forecast,
  closedThrough,
  why,
  whyFull,
  onOpenItem,
  onClose,
}: {
  row: BudgetRow
  item: CbsItem | undefined
  items: CbsItem[]
  commitments: BudgetCommitment[]
  actuals: BudgetActual[]
  forecast: BudgetForecast[]
  closedThrough: string | null
  why: Why | null
  whyFull: Why | null
  onOpenItem: (code: string) => void
  onClose: () => void
}) {
  // статья и все вложенные
  const ids = useMemo(() => {
    const set = new Set<string>([row.id])
    let grew = true
    while (grew) {
      grew = false
      for (const it of items)
        if (it.parent_id && set.has(it.parent_id) && !set.has(it.id)) {
          set.add(it.id)
          grew = true
        }
    }
    return set
  }, [row.id, items])
  const codes = useMemo(() => new Map(items.map((i) => [i.id, i.code])), [items])
  const cs = useMemo(() => commitments.filter((c) => ids.has(c.item_id)), [commitments, ids])
  const as = useMemo(() => actuals.filter((a) => ids.has(a.item_id)).sort((a, b) => a.doc_date.localeCompare(b.doc_date) || a.id.localeCompare(b.id)), [actuals, ids])
  const l = itemLabel(row, item)
  const over = row.eac - row.bac
  const many = ids.size > 1

  // по месяцам: закрытые — факт, открытые — план (как в «Раскладке»)
  const months = useMemo(() => {
    const ph = phasing(
      forecast.filter((f) => ids.has(f.item_id)),
      as,
      closedThrough,
    )
    const m = new Map<string, { v: number; fact: boolean }>()
    for (const [, row2] of ph.fact) for (const [k, v] of row2) if (ph.isClosed(k)) m.set(k, { v: (m.get(k)?.v ?? 0) + v, fact: true })
    for (const [, row2] of ph.plan) for (const [k, v] of row2) if (!ph.isClosed(k)) m.set(k, { v: (m.get(k)?.v ?? 0) + v, fact: false })
    return m
  }, [forecast, as, ids, closedThrough])

  // нарастающий итог по актам
  const runningAt = useMemo(() => as.map((_, i) => as.slice(0, i + 1).reduce((t, x) => t + x.amount, 0)), [as])
  const actTotal = runningAt[runningAt.length - 1] ?? 0
  const csTotal = cs.filter((c) => c.status === 'active').reduce((s, c) => s + c.amount, 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 p-5 sm:max-w-5xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="pr-8 text-lg">
            <span className="ident mr-2 text-muted-foreground">{row.code}</span>
            {l.main}
          </DialogTitle>
          <DialogDescription>{l.sub ?? tr('Статья бюджета')}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={tr('Бюджет')} value={row.bac} />
          <Tile label={tr('Уже выполнено')} value={row.actual} note={`${pct(row.actual, row.bac)}%`} />
          <Tile label={tr('Осталось потратить')} value={row.etc} />
          <Tile label={over > 9.99 ? tr('Выйдет дороже на') : tr('Прогноз на конец')} value={over > 9.99 ? over : row.eac} bad={over > 9.99} />
        </dl>

        <div className={`grid gap-4 ${why ? 'lg:grid-cols-2' : ''}`}>
          {why && <WhyBlock why={why} full={whyFull} onOpenItem={onOpenItem} />}
          <CumulativeChart months={months} bac={row.bac} closedThrough={closedThrough} />
        </div>

        <section aria-labelledby="item-acts">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="item-acts" className="text-base font-semibold">
              {tr('Выполнено по актам')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {tr('документов: {{n}}', { n: as.length })} · {tr('итого')} <span className="font-semibold text-foreground tabular-nums">{fmtMoney(actTotal)}</span>
            </p>
          </div>
          {as.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">{tr('Затрат по статье пока нет.')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
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
                  {as.map((a, idx) => {
                    const running = runningAt[idx]
                    const overBudget = row.bac > 0 && running > row.bac + 9.99
                    return (
                      <tr key={a.id} className="border-b last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(a.doc_date)}</td>
                        <td className="px-3 py-2">{a.note && !a.doc_number ? a.note : `${DOC_TYPE_LABELS[a.doc_type]}${a.doc_number ? ` № ${a.doc_number}` : ''}`}</td>
                        {many && <td className="ident px-3 py-2 text-muted-foreground">{codes.get(a.item_id)}</td>}
                        <td className="px-3 py-2 text-muted-foreground">{a.counterparty ?? '—'}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${a.amount < 0 ? 'text-green-700 dark:text-green-300' : ''}`}>{fmtMoney(a.amount)}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${overBudget ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>{fmtMoney(running)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${overBudget ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>{row.bac > 0 ? `${pct(running, row.bac)}%` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/50 font-semibold">
                    <td className="px-3 py-2.5" colSpan={many ? 4 : 3}>
                      {tr('Итого выполнено')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtMoney(actTotal)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-normal text-muted-foreground">
                      {tr('из бюджета {{sum}}', { sum: fmtMoney(row.bac) })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.bac > 0 ? `${pct(actTotal, row.bac)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="item-contracts">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="item-contracts" className="text-base font-semibold">
              {tr('Договоры')}
            </h3>
            {cs.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {tr('итого')} <span className="font-semibold text-foreground tabular-nums">{fmtMoney(csTotal)}</span>
              </p>
            )}
          </div>
          {cs.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">{tr('Договоров по статье нет.')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">{tr('Договор')}</th>
                    <th className="px-3 py-2 text-left font-medium">{tr('Контрагент')}</th>
                    <th className="px-3 py-2 text-left font-medium">{tr('Подписан')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tr('Сумма')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cs.map((c) => (
                    <tr key={c.id} className={`border-b last:border-b-0 ${c.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}`}>
                      <td className="px-3 py-2">
                        {c.title}
                        {c.doc_number ? <span className="text-muted-foreground"> · № {c.doc_number}</span> : null}
                        {many && <span className="ident ml-1.5 text-muted-foreground">{codes.get(c.item_id)}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.counterparty ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(c.signed_on)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtMoney(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}

function Tile({ label, value, note, bad }: { label: string; value: number; note?: string; bad?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${bad ? 'border-red-500/40 bg-red-500/5' : ''}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold ${bad ? 'text-red-700 dark:text-red-300' : ''}`}>
        <Money value={value} />
        {note && <span className="ml-1.5 text-sm font-normal text-muted-foreground">· {note}</span>}
      </dd>
      <p className="text-xs tabular-nums text-muted-foreground">{fullMoney(value)}</p>
    </div>
  )
}

/** Почему дороже: расчёт по шагам, причина и что сделать. */
function WhyBlock({ why, full, onOpenItem }: { why: Why; full: Why | null; onOpenItem: (code: string) => void }) {
  return (
    <section aria-labelledby="why-h" className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
      <h3 id="why-h" className="flex items-center gap-2 text-base font-semibold text-red-800 dark:text-red-300">
        <CircleAlert className="size-4" aria-hidden /> {tr('Почему дороже')}
      </h3>
      <ol className="mt-2 flex flex-col text-sm">
        {why.steps.map((s, i) => (
          <li key={s.label} className={`flex justify-between gap-3 py-0.5 ${i === why.steps.length - 1 ? 'mt-1 border-t pt-1.5' : ''}`}>
            <span className="text-muted-foreground">{s.label}</span>
            <span className="text-right">
              <Money value={s.amount} className={s.tone === 'bad' ? 'font-semibold text-red-700 dark:text-red-300' : 'font-medium'} />
              <span className="ml-2 text-xs tabular-nums text-muted-foreground">{fullMoney(s.amount)}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm" title={full?.reason}>
        {why.reason}
      </p>
      {why.items && why.items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {why.items.map((i) => (
            <li key={i.code}>
              <button type="button" onClick={() => onOpenItem(i.code)} className="flex w-full justify-between gap-3 rounded px-1 text-left text-sm hover:bg-red-500/10">
                <span>
                  <span className="ident mr-1.5 text-muted-foreground">{i.code}</span>
                  {i.name}
                </span>
                <span className="text-red-700 dark:text-red-300">
                  +<Money value={i.over} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm" title={full?.fix}>
        <span className="font-medium">{tr('Что сделать:')}</span> {why.fix}
      </p>
    </section>
  )
}

/**
 * Подписи оси месяцев без наложений: сначала январи, затем первый месяц, затем июли — каждая не ближе 72 единиц
 * к уже поставленной (подпись «янв 2026» занимает около 55).
 */
function axisLabels(all: string[], x: (i: number) => number): number[] {
  const order = [...all.keys()].sort((a, b) => rank(all[a], a) - rank(all[b], b) || a - b)
  const kept: number[] = []
  for (const i of order) {
    if (rank(all[i], i) > 2) break
    if (kept.every((k) => Math.abs(x(k) - x(i)) >= 72)) kept.push(i)
  }
  return kept.sort((a, b) => a - b)
}
const rank = (m: string, i: number) => (m.endsWith('-01') ? 0 : i === 0 ? 1 : m.endsWith('-07') ? 2 : 3)

/** Затраты статьи накопленным итогом против бюджета: где линия переходит бюджет — там перерасход. */
function CumulativeChart({ months, bac, closedThrough }: { months: Map<string, { v: number; fact: boolean }>; bac: number; closedThrough: string | null }) {
  const keys = [...months.keys()].sort()
  if (keys.length === 0)
    return (
      <section className="rounded-lg border p-4">
        <h3 className="text-base font-semibold">{tr('Затраты по месяцам')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{tr('По месяцам у статьи пока ничего нет.')}</p>
      </section>
    )
  const all: string[] = []
  for (let m = keys[0]; m <= keys[keys.length - 1]; m = addMonths(m, 1)) all.push(m)
  const cum: number[] = []
  all.reduce((s, m, i) => (cum[i] = s + (months.get(m)?.v ?? 0)), 0)
  const closed = closedThrough?.slice(0, 7) ?? null
  const top = Math.max(bac, cum[cum.length - 1], 1) * 1.08
  const W = 520
  const H = 200
  const L = 6
  const R = 70
  const T = 12
  const B = 26
  const x = (i: number) => L + (all.length === 1 ? 0.5 : i / (all.length - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const lastFact = closed ? all.reduce((acc, m, i) => (m <= closed ? i : acc), -1) : -1
  const pts = (from: number, to: number) => all.slice(from, to + 1).map((_, j) => `${x(from + j).toFixed(1)},${y(cum[from + j]).toFixed(1)}`).join(' ')
  const cross = bac > 0 ? cum.findIndex((v) => v > bac + 9.99) : -1

  return (
    <section aria-labelledby="item-chart" className="rounded-lg border p-4">
      <h3 id="item-chart" className="text-base font-semibold">
        {tr('Затраты накопленным итогом')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {cross >= 0
          ? tr('Линия переходит бюджет в {{month}} — с этого месяца план больше бюджета.', { month: monthLong(all[cross]) })
          : tr('Сплошная линия — факт по актам, пунктир — план. Пока линия ниже бюджета, статья в бюджете.')}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={tr('Затраты накопленным итогом')}>
        {cross >= 0 && <rect x={x(cross)} y={T} width={Math.max(x(all.length - 1) - x(cross), 2)} height={y(bac) - T} className="fill-red-500/10" />}
        <line x1={L} x2={W - R} y1={y(bac)} y2={y(bac)} className="stroke-foreground" strokeDasharray="5 4" />
        <text x={W - R + 6} y={y(bac) + 4} className="fill-foreground text-[11px] font-medium">
          {tr('бюджет')}
          <title>{fullMoney(bac)}</title>
        </text>
        <text x={W - R + 6} y={y(bac) + 17} className="fill-muted-foreground text-[10px]">
          {money(bac)}
        </text>
        {lastFact >= 0 && <polyline points={pts(0, lastFact)} fill="none" className="stroke-blue-600" strokeWidth="2.5" />}
        {lastFact < all.length - 1 && <polyline points={pts(Math.max(lastFact, 0), all.length - 1)} fill="none" className="stroke-blue-400" strokeWidth="2" strokeDasharray="5 4" />}
        {all.map((m, i) => (
          <circle key={m} cx={x(i)} cy={y(cum[i])} r={cross >= 0 && i >= cross ? 3 : 2.5} className={cross >= 0 && i >= cross ? 'fill-red-500' : m <= (closed ?? '') ? 'fill-blue-600' : 'fill-blue-400'}>
            <title>{`${monthLong(m)}: ${tr('за месяц')} ${fullMoney(months.get(m)?.v ?? 0)}, ${tr('всего')} ${fullMoney(cum[i])}`}</title>
          </circle>
        ))}
        {/* итог в конце линии; если он равен бюджету, хватает подписи бюджета */}
        {Math.abs(cum[cum.length - 1] - bac) > Math.max(bac * 0.005, 10) && (
          <text x={W - R + 6} y={y(cum[cum.length - 1]) + (Math.abs(y(cum[cum.length - 1]) - y(bac)) < 26 ? -14 : 4)} className={`text-[11px] font-semibold ${cross >= 0 ? 'fill-red-600' : 'fill-blue-600'}`}>
            {money(cum[cum.length - 1])}
            <title>{fullMoney(cum[cum.length - 1])}</title>
          </text>
        )}
        {axisLabels(all, x).map((i) => (
          <text key={`l-${all[i]}`} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[10px]">
            {`${monthShort(all[i])} ${all[i].slice(0, 4)}`}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0.5 w-4 bg-blue-600" />
          {tr('факт по актам')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0 w-4 border-t-2 border-dashed border-blue-400" />
          {tr('план')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0 w-4 border-t border-dashed border-foreground" />
          {tr('бюджет')}
        </span>
      </div>
    </section>
  )
}
