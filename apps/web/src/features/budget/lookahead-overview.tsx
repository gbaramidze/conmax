import { tr } from '@/lib/tr'
import { CalendarCheck, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { BudgetRow, CbsItem } from './api'
import { chartRange, isBalanced, itemLabel, money, pct, type LookaheadData } from './lookahead-model'
import { monthLong, monthShort, THIS_MONTH } from './months'

// ---------------------------------------------------------------------------
// 1. Итог одной фразой и полосой
// ---------------------------------------------------------------------------
export function SummaryCard({ data, bac, versionName }: { data: LookaheadData; bac: number; versionName: string | null }) {
  const { grand, closed, allMonths } = data
  const last = allMonths[allMonths.length - 1]
  const over = !isBalanced(grand.un) && grand.un < 0
  const gap = !isBalanced(grand.un) && grand.un > 0
  const scale = Math.max(bac, grand.fact + grand.plan, 1)
  return (
    <section aria-labelledby="la-sum" className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <h2 id="la-sum" className="text-sm text-muted-foreground">
            {tr('Бюджет проекта')}
            {versionName ? ` · ${versionName}` : ''}
          </h2>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">{money(bac)}</p>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">
          {closed
            ? tr('Выполнено {{fact}} — {{pct}}% бюджета (по актам до конца {{month}}).', { fact: money(grand.fact), pct: pct(grand.fact, bac), month: monthLong(closed) })
            : tr('Факта пока нет: ни один месяц не закрыт.')}{' '}
          {last ? tr('Остальное запланировано по месяцам до {{month}}.', { month: monthLong(last) }) : ''}
        </p>
      </div>

      <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-muted" role="img" aria-label={tr('Выполнено {{a}}, запланировано {{b}}, не распределено {{c}}', { a: money(grand.fact), b: money(grand.plan), c: money(grand.un) })}>
        <div className="bg-blue-600" style={{ width: `${(grand.fact / scale) * 100}%` }} />
        <div className="bg-blue-300 dark:bg-blue-800" style={{ width: `${(grand.plan / scale) * 100}%` }} />
        {gap && <div style={{ width: `${(grand.un / scale) * 100}%`, background: 'repeating-linear-gradient(135deg, var(--color-red-400) 0 4px, transparent 4px 8px)' }} />}
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <Legend swatch="bg-blue-600" label={tr('Выполнено')} value={money(grand.fact)} hint={tr('факт по актам, месяц закрыт')} />
        <Legend swatch="bg-blue-300 dark:bg-blue-800" label={tr('Запланировано')} value={money(grand.plan)} hint={tr('сколько и в каком месяце ещё потратим')} />
        <Legend
          swatch={over || gap ? 'bg-red-500' : 'bg-green-600'}
          label={over ? tr('Лишнее в плане') : gap ? tr('Не разложено') : tr('Сходится с бюджетом')}
          value={over || gap ? money(Math.abs(grand.un)) : '✓'}
          hint={over ? tr('по месяцам расписано больше бюджета') : gap ? tr('часть бюджета ещё не попала в месяцы') : tr('выполнено + запланировано = бюджет')}
          tone={over || gap ? 'bad' : 'good'}
        />
      </dl>
    </section>
  )
}

function Legend({ swatch, label, value, hint, tone }: { swatch: string; label: string; value: string; hint: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="flex gap-2.5">
      <span className={`mt-1.5 size-3 shrink-0 rounded-sm ${swatch}`} aria-hidden />
      <div className="min-w-0">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className={`text-lg font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700 dark:text-red-300' : tone === 'good' ? 'text-green-700 dark:text-green-400' : ''}`}>{value}</dd>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Что нужно сделать
// ---------------------------------------------------------------------------
export function TodoCard({
  data,
  rows,
  byId,
  canEdit,
  canRecord,
  nextToClose,
  onCloseMonth,
  onSpread,
}: {
  data: LookaheadData
  rows: BudgetRow[]
  byId: Map<string, CbsItem>
  canEdit: boolean
  canRecord: boolean
  nextToClose: string
  onCloseMonth: () => void
  onSpread: (row: BudgetRow) => void
}) {
  const [all, setAll] = useState(false)
  const broken = useMemo(
    () => rows.filter((r) => !r.hasChildren && !isBalanced(data.info.get(r.id)?.un ?? 0)).sort((a, b) => Math.abs(data.info.get(b.id)!.un) - Math.abs(data.info.get(a.id)!.un)),
    [rows, data],
  )
  const shown = all ? broken : broken.slice(0, 4)
  const nothing = data.unclosed.length === 0 && broken.length === 0 && data.closed
  const closeButton = canEdit ? (
    <Button size="sm" variant="outline" onClick={onCloseMonth}>
      <CalendarCheck className="size-4" /> {tr('Закрыть {{month}}', { month: monthLong(nextToClose) })}
    </Button>
  ) : null
  return (
    <section aria-labelledby="la-todo" className="rounded-xl border bg-card p-5">
      <h2 id="la-todo" className="text-base font-semibold">
        {tr('Что нужно сделать')}
      </h2>
      {nothing ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4" /> {tr('Всё в порядке: прошедшие месяцы закрыты, план сходится с бюджетом.')}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y">
          {!data.closed && (
            <Todo icon="info" title={tr('Ни один месяц ещё не закрыт')} text={tr('Закройте прошедшие месяцы: тогда вместо плана в них будет факт по актам.')} action={closeButton} />
          )}
          {data.unclosed.length > 0 && (
            <Todo
              icon="warn"
              title={
                data.unclosed.length === 1
                  ? tr('{{month}} уже прошёл, но не закрыт', { month: monthLong(data.unclosed[0]) })
                  : tr('Не закрыты прошедшие месяцы: {{months}}', { months: data.unclosed.map(monthLong).join(', ') })
              }
              text={tr('Пока месяц открыт, в нём показан план, а не факт. Внесите акты на вкладке «Факт» и закройте месяц.')}
              action={closeButton}
            />
          )}
          {shown.map((r) => {
            const un = data.info.get(r.id)!.un
            const l = itemLabel(r, byId.get(r.id))
            return (
              <Todo
                key={r.id}
                icon="bad"
                title={
                  un < 0
                    ? tr('{{code}} {{name}}: в плане на {{sum}} больше бюджета', { code: r.code, name: l.main, sum: money(-un) })
                    : tr('{{code}} {{name}}: {{sum}} ещё не разложено по месяцам', { code: r.code, name: l.main, sum: money(un) })
                }
                text={un < 0 ? tr('Уменьшите план в отдельных месяцах или разложите остаток заново.') : tr('Укажите, в каких месяцах будут эти затраты.')}
                action={
                  canRecord ? (
                    <Button size="sm" variant="outline" onClick={() => onSpread(r)}>
                      {un < 0 ? tr('Разложить заново') : tr('Разложить')}
                    </Button>
                  ) : null
                }
              />
            )
          })}
          {broken.length > 4 && (
            <li className="pt-2">
              <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setAll(!all)}>
                {all ? tr('Свернуть') : tr('Показать ещё {{count}}', { count: broken.length - 4 })}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function Todo({ icon, title, text, action }: { icon: 'warn' | 'bad' | 'info'; title: string; text: string; action?: React.ReactNode }) {
  const Icon = icon === 'bad' ? CircleAlert : icon === 'warn' ? TriangleAlert : CalendarCheck
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon className={`size-5 shrink-0 ${icon === 'bad' ? 'text-red-600' : icon === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}`} aria-hidden />
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
      {action}
    </li>
  )
}

// ---------------------------------------------------------------------------
// 3. Сколько тратим каждый месяц
// ---------------------------------------------------------------------------
export function MonthChart({ data }: { data: LookaheadData }) {
  const months = useMemo(() => chartRange(data), [data])
  const [active, setActive] = useState<string | null>(null)
  if (months.length === 0) return null
  const before = [...data.grand.months].filter(([m]) => m < months[0]).reduce((s, [, v]) => s + v, 0)
  const values = months.map((m) => data.grand.months.get(m) ?? 0)
  const max = Math.max(...values, 1)
  const W = 900
  const H = 200
  const L = 4
  const R = 78
  const B = 34
  const T = 10
  const bw = (W - L - R) / months.length
  const y = (v: number) => T + (1 - Math.max(v, 0) / max) * (H - T - B)
  const shown = active ?? (months.includes(THIS_MONTH) ? THIS_MONTH : months[months.length - 1])
  const shownValue = data.grand.months.get(shown) ?? 0
  const state = (m: string) => (data.isClosed(m) ? 'fact' : m < THIS_MONTH ? 'late' : 'plan')
  const stateText = { fact: tr('факт по актам'), late: tr('план — месяц прошёл, но не закрыт'), plan: tr('план') }

  return (
    <section aria-labelledby="la-chart" className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="la-chart" className="text-base font-semibold">
          {tr('Сколько тратим каждый месяц')}
        </h2>
        <p className="text-sm tabular-nums" aria-live="polite">
          <span className="text-muted-foreground">{monthLong(shown)}: </span>
          <span className="font-semibold">{money(shownValue)}</span>
          <span className="text-muted-foreground"> · {stateText[state(shown)]}</span>
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[36rem]" role="img" aria-label={tr('Затраты по месяцам')} onMouseLeave={() => setActive(null)}>
          {[0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="stroke-border" strokeDasharray="3 4" />
              <text x={W - R + 8} y={y(max * f) + 4} className="fill-muted-foreground text-[11px]">
                {money(max * f)}
              </text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="stroke-border" />
          <text x={W - R + 8} y={y(0) + 4} className="fill-muted-foreground text-[11px]">
            0
          </text>
          {months.map((m, i) => {
            const v = values[i]
            const s = state(m)
            const x = L + i * bw
            return (
              <g key={m} onMouseEnter={() => setActive(m)} onFocus={() => setActive(m)} tabIndex={0} aria-label={`${monthLong(m)}: ${money(v)}, ${stateText[s]}`} className="cursor-default outline-none">
                <rect x={x} y={T} width={bw} height={H - T - B} className={active === m ? 'fill-muted' : 'fill-transparent'} />
                <rect
                  x={x + bw * 0.15}
                  y={y(v)}
                  width={bw * 0.7}
                  height={Math.max(y(0) - y(v), v > 0 ? 1 : 0)}
                  rx={2}
                  className={s === 'fact' ? 'fill-blue-600' : s === 'late' ? 'fill-amber-300 dark:fill-amber-700' : 'fill-blue-300 dark:fill-blue-800'}
                />
                {(m.endsWith('-01') || months.length <= 18) && (
                  <text x={x + bw / 2} y={H - B + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {monthShort(m)}
                  </text>
                )}
                {(m.endsWith('-01') || i === 0) && (
                  <text x={x + 2} y={H - 4} className="fill-foreground text-[12px] font-medium">
                    {m.slice(0, 4)}
                  </text>
                )}
              </g>
            )
          })}
          {months.includes(THIS_MONTH) && (
            <g>
              <line x1={L + months.indexOf(THIS_MONTH) * bw} x2={L + months.indexOf(THIS_MONTH) * bw} y1={T} y2={y(0)} className="stroke-foreground" strokeDasharray="2 3" />
              <text x={L + months.indexOf(THIS_MONTH) * bw + 4} y={T + 10} className="fill-foreground text-[11px]">
                {tr('сегодня')}
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="size-3 rounded-sm bg-blue-600" />{tr('Факт по актам (месяц закрыт)')}</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-3 rounded-sm bg-amber-300 dark:bg-amber-700" />{tr('Месяц прошёл, но не закрыт')}</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-3 rounded-sm bg-blue-300 dark:bg-blue-800" />{tr('План')}</span>
        {before > 0.5 && <span>{tr('До {{month}} уже выполнено {{sum}} — в график не входит.', { month: monthLong(months[0]), sum: money(before) })}</span>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 4. Разделы бюджета
// ---------------------------------------------------------------------------
export function SectionList({
  rows,
  data,
  byId,
  canRecord,
  onSpread,
}: {
  rows: BudgetRow[]
  data: LookaheadData
  byId: Map<string, CbsItem>
  canRecord: boolean
  onSpread: (row: BudgetRow) => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const months = useMemo(() => chartRange(data), [data])
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
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <section aria-labelledby="la-sections" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 id="la-sections" className="text-base font-semibold">
          {tr('Разделы бюджета')}
        </h2>
        <p className="text-xs text-muted-foreground">{tr('Полоса — бюджет раздела: тёмная часть выполнена, светлая запланирована. Справа — в какие месяцы пойдут деньги.')}</p>
      </div>
      <ul>
        {visible.map((r) => {
          const i = data.info.get(r.id)
          if (!i) return null
          const l = itemLabel(r, byId.get(r.id))
          const scale = Math.max(r.bac, i.fact + i.plan, 1)
          const peak = Math.max(...months.map((m) => i.months.get(m) ?? 0), 1)
          const status =
            isBalanced(i.un) ? (r.bac > 0 && i.fact >= r.bac - 0.5 ? 'done' : i.fact > 0 ? 'ok' : 'notstarted') : i.un < 0 ? 'over' : 'gap'
          return (
            <li key={r.id} className="border-b last:border-b-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_9rem_8rem]" style={{ paddingLeft: `${1.25 + r.depth * 1.25}rem` }}>
                <div className="flex min-w-0 items-start gap-2">
                  {r.hasChildren ? (
                    <button
                      type="button"
                      aria-expanded={open.has(r.id)}
                      aria-label={open.has(r.id) ? tr('Свернуть') : tr('Развернуть')}
                      onClick={() => toggle(r.id)}
                      className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted"
                    >
                      {open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  ) : (
                    <span className="inline-block size-6 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className={`text-sm ${r.depth === 0 ? 'font-medium' : ''}`}>
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      {l.main}
                    </p>
                    {l.sub && <p className="truncate text-xs text-muted-foreground">{l.sub}</p>}
                  </div>
                </div>
                <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-blue-600" style={{ width: `${(i.fact / scale) * 100}%` }} />
                    <div className="bg-blue-300 dark:bg-blue-800" style={{ width: `${(i.plan / scale) * 100}%` }} />
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {tr('{{fact}} из {{bac}} · {{pct}}% выполнено', { fact: money(i.fact), bac: money(r.bac), pct: pct(i.fact, r.bac) })}
                  </p>
                </div>
                <div className="hidden h-7 items-end gap-px md:flex" aria-hidden title={tr('В какие месяцы пойдут деньги')}>
                  {months.map((m) => {
                    const v = i.months.get(m) ?? 0
                    return <span key={m} className={`flex-1 rounded-[1px] ${data.isClosed(m) ? 'bg-blue-600' : 'bg-blue-300 dark:bg-blue-800'}`} style={{ height: v > 0 ? `${Math.max(8, (v / peak) * 100)}%` : 0 }} />
                  })}
                </div>
                <div className="row-start-1 justify-self-end md:col-start-4">
                  <StatusChip status={status} un={i.un} onClick={canRecord && !r.hasChildren && (status === 'over' || status === 'gap') ? () => onSpread(r) : undefined} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function StatusChip({ status, un, onClick }: { status: 'done' | 'ok' | 'notstarted' | 'over' | 'gap'; un: number; onClick?: () => void }) {
  const text = {
    done: tr('Выполнено'),
    ok: tr('Идёт по плану'),
    notstarted: tr('Ещё не начато'),
    over: tr('Лишнее в плане: {{sum}}', { sum: money(-un) }),
    gap: tr('Не разложено: {{sum}}', { sum: money(un) }),
  }[status]
  const style = {
    done: 'bg-green-500/10 text-green-700 dark:text-green-400',
    ok: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    notstarted: 'bg-muted text-muted-foreground',
    over: 'bg-red-500/10 text-red-700 dark:text-red-300',
    gap: 'bg-red-500/10 text-red-700 dark:text-red-300',
  }[status]
  const cls = `inline-flex min-h-7 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${style}`
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:brightness-95`} title={tr('Нажмите, чтобы разложить по месяцам')}>
      {text}
    </button>
  ) : (
    <span className={cls}>{text}</span>
  )
}
