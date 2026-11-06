import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, ChevronRight, CircleSlash, Footprints, ShieldAlert, ShieldCheck, TrendingDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { dashboardQuery, fmtLongDate, fmtPercent, fmtShortDate, type DashboardData } from '@/features/dashboard/api'

type Tab = 'location' | 'discipline' | 'contractor'

interface BarRow {
  key: string
  label: ReactNode
  meta?: string
  title?: string
  percent: number | null
  indent?: number
  search: { loc?: string; disc?: string; contractor?: string }
}

/** Главное сверху обзора: готовность проекта, насколько ей можно верить, и что требует внимания. */
export function ProgressHeadline({ projectId, code, canManage }: { projectId: string; code: string; canManage: boolean }) {
  const { data } = useSuspenseQuery(dashboardQuery(projectId))

  if (data.totals.items === 0) {
    return (
      <section className="flex flex-col items-start gap-2 rounded-lg border bg-card p-5 shadow-soft" aria-label={tr('Готовность проекта')}>
        <h2 className="text-base font-semibold">{tr('Готовность проекта')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Процент готовности считается по плану объёмов и фактам обходов. План ещё не внесён')}{canManage ? tr(' — добавьте позиции вручную или загрузите таблицу из Excel.') : '.'}
        </p>
        {canManage && (
          <Link to="/projects/$code/volumes" params={{ code }} className="text-sm font-medium underline underline-offset-4">{tr('Перейти к объёмам')}</Link>
        )}
      </section>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Readiness data={data} />
      {data.attention && <Attention data={data} code={code} />}
    </div>
  )
}

const NO_PLAN = () => (
  <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-soft">{tr('План объёмов ещё не внесён: готовность считать не из чего.')}</p>
)

/** Вкладка «Динамика»: S-кривая за 12 недель. */
export function DynamicsPanel({ projectId }: { projectId: string }) {
  const { data } = useSuspenseQuery(dashboardQuery(projectId))
  return data.totals.items === 0 ? <NO_PLAN /> : <Dynamics data={data} />
}

/** Вкладка «Где что сделано»: готовность по местам, направлениям и подрядчикам. */
export function BreakdownPanel({ projectId, code }: { projectId: string; code: string }) {
  const { data } = useSuspenseQuery(dashboardQuery(projectId))
  return data.totals.items === 0 ? <NO_PLAN /> : <Breakdown data={data} code={code} />
}

// ---------------------------------------------------------------------------
// Готовность
// ---------------------------------------------------------------------------
function Readiness({ data }: { data: DashboardData }) {
  const { totals, plan, forecast } = data
  const accepted = totals.percent ?? 0
  const reported = Math.max(accepted, totals.reported ?? 0)
  const gap = plan.plan !== null && plan.fact !== null ? plan.fact - plan.plan : null

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-soft sm:p-5" aria-label={tr('Готовность проекта')}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">{tr('Готовность проекта')}</h2>
          <p className="text-5xl font-semibold leading-none tracking-tight tabular-nums">{fmtPercent(totals.percent)}</p>
        </div>
        <p className="text-sm text-muted-foreground">{tr('Принято по')}{' '}{totals.items} {totals.items === 1 ? tr('позиции') : tr('позициям')}{tr(', завершено')}{' '}{totals.items_done}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-valuenow={Math.round(accepted)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={tr('Принято {{v1}}, заявлено {{v2}}', { v1: fmtPercent(totals.percent), v2: fmtPercent(totals.reported) })}
          className="relative flex h-3 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${accepted}%` }} />
          {reported > accepted && <div className="h-full bg-primary/35" style={{ width: `${reported - accepted}%` }} title={tr('Заявлено, ждёт подтверждения')} />}
        </div>
        <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-sm sm:gap-x-6">
          <Fact label={tr('Заявлено')} value={fmtPercent(totals.reported)} hint={tr('с фактом, ждущим подтверждения')} />
          {/* проверки видит только внутренняя команда: подрядчику «0 проверено» выглядело бы как претензия */}
          {data.attention && (
            <>
              <Fact label={tr('Проверено независимо')} value={fmtPercent(totals.verified)} hint={tr('{{v1}} заявленного', { v1: fmtPercent(totals.verified_share) })} />
              <Fact
                label={tr('Позиции с фактом')}
                value={tr('{{verified}} из {{v2}} проверено', { verified: totals.states.verified, v2: totals.states.verified + totals.states.accepted + totals.states.disputed + totals.states.unchecked })}
                hint={tr('спорных — {{disputed}}, принято решением — {{accepted}}', { disputed: totals.states.disputed, accepted: totals.states.accepted })}
              />
            </>
          )}
        </dl>
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
        {gap !== null ? (
          <PlanLine gap={gap} plan={plan.plan!} fact={plan.fact!} coverage={plan.coverage} />
        ) : (
          <p className="text-muted-foreground">{tr('Сроки позиций не заданы — план на сегодня не считается.')}</p>
        )}
        {forecast && forecast.finish_date && forecast.rate_per_week > 0 && (
          <p className="text-muted-foreground">{tr('По темпу последних 4 недель (+')}{fmtPercent(forecast.rate_per_week).replace('%', '')}{tr('п. п. в неделю) завершение —')}{' '}
            <span className="font-medium text-foreground">{fmtLongDate(forecast.finish_date)}</span>
          </p>
        )}
        {forecast && forecast.rate_per_week <= 0 && totals.percent !== null && totals.percent < 100 && (
          <p className="text-muted-foreground">{tr('За последние 4 недели принятый факт не прибавился — прогноз окончания не строится.')}</p>
        )}
        {!totals.weights_set && (
          <p className="text-muted-foreground">{tr('Веса позиций не заданы — все позиции считаются равнозначными. Укажите вес (стоимость или трудоёмкость) в плане объёмов для точного процента.')}</p>
        )}
      </div>
    </section>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md bg-muted/40 p-2 sm:bg-transparent sm:p-0">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="text-[15px] font-semibold tabular-nums sm:text-sm sm:font-medium">{value}</dd>
      <dd className="hidden text-xs text-muted-foreground sm:block">{hint}</dd>
    </div>
  )
}

function PlanLine({ gap, plan, fact, coverage }: { gap: number; plan: number; fact: number; coverage: number | null }) {
  const behind = gap <= -10 ? 'serious' : gap < -3 ? 'warn' : 'ok'
  const rounded = fmtPercent(Math.abs(gap)).replace('%', '')
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {behind === 'serious' && <TrendingDown className="size-4 text-red-700 dark:text-red-300" aria-hidden />}
      {behind === 'warn' && <AlertTriangle className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />}
      {behind === 'ok' && <CheckCircle2 className="size-4 text-green-700 dark:text-green-300" aria-hidden />}
      <span className="font-medium">
        {behind === 'ok' ? (gap > 3 ? tr('Опережаем план на {{rounded}} п. п.', { rounded }) : tr('В графике')) : tr('Отстаём от плана на {{rounded}} п. п.', { rounded })}
      </span>
      <span className="text-muted-foreground">{tr('план на сегодня')}{' '}{fmtPercent(plan)}{tr(', факт')}{' '}{fmtPercent(fact)}<span className="hidden sm:inline">{tr('(по позициям со сроками, охват')}{' '}{Math.round(coverage ?? 0)}{tr('% веса)')}</span></span>
    </p>
  )
}

// ---------------------------------------------------------------------------
// Внимание
// ---------------------------------------------------------------------------
function Attention({ data, code }: { data: DashboardData; code: string }) {
  const a = data.attention!
  const bad = a.discrepancies.major + a.discrepancies.minor
  const calm = bad === 0 && a.walks_pending === 0 && a.stale.length === 0 && a.blocked.length === 0

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft sm:p-5" aria-label={tr('Требует внимания')}>
      <h2 className="text-base font-semibold">{tr('Требует внимания')}</h2>

      {calm ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-green-700 dark:text-green-300" aria-hidden />{tr('Расхождений нет, обходы свежие, ограничений в последних обходах не отмечено.')}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {bad > 0 && (
            <Row
              icon={<ShieldAlert className="size-4 text-red-700 dark:text-red-300" aria-hidden />}
              to={{ to: '/projects/$code/checks', params: { code } }}
              title={tr('Расхождений с проверкой: {{bad}}', { bad })}
              hint={a.discrepancies.major > 0 ? tr('серьёзных — {{major}}', { major: a.discrepancies.major }) : tr('требуют решения ПТО или руководителя')}
            />
          )}
          {a.walks_pending > 0 && (
            <Row
              icon={<CheckCircle2 className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />}
              to={{ to: '/projects/$code/volumes', params: { code } }}
              title={tr('Обходов ждут подтверждения: {{walks_pending}}', { walks_pending: a.walks_pending })}
              hint={tr('факт не учтён в принятом, пока не подтверждён')}
            />
          )}
          {a.blocked.length > 0 && (
            <li className="flex flex-col gap-1 py-2.5 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <CircleSlash className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />{tr('Работы не идут (последние обходы)')}</span>
              <span className="pl-6 text-muted-foreground">{a.blocked.map((b) => `${b.name} — ${b.count}`).join(' · ')}</span>
            </li>
          )}
          {a.stale.length > 0 && (
            <li className="flex flex-col gap-1.5 py-2.5 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Footprints className="size-4 text-muted-foreground" aria-hidden />{tr('Давно без обхода (больше')}{' '}{a.stale_days}{tr('дн.)')}</span>
              <ul className="flex flex-wrap gap-1.5 pl-6">
                {a.stale.slice(0, 6).map((s) => (
                  <li key={s.path}>
                    <Link
                      to="/projects/$code/walk"
                      params={{ code }}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs hover:bg-muted"
                      title={s.last_walk ? tr('Последний обход {{v1}}', { v1: fmtShortDate(s.last_walk) }) : tr('Обходов не было')}
                    >
                      <span className="ident">{s.path}</span>
                      <span className="text-muted-foreground">{s.days === null ? tr('не обходили') : tr('{{days}} дн.', { days: s.days })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{tr('Последний обход:')}{' '}{a.last_walk_at ? fmtLongDate(a.last_walk_at) : tr('ещё не было')}
      </p>
    </section>
  )
}

function Row({ icon, title, hint, to }: { icon: ReactNode; title: string; hint: string; to: { to: '/projects/$code/checks' | '/projects/$code/volumes'; params: { code: string } } }) {
  return (
    <li>
      <Link {...to} className="flex min-h-12 items-center gap-2 py-2 text-sm hover:bg-muted/40">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Динамика: S-кривая за 12 недель
// ---------------------------------------------------------------------------
const H = 190
const PAD = { l: 38, r: 56, t: 12, b: 26 }

/** Ширина элемента: график рисуется в пикселях контейнера, чтобы подписи не уменьшались вместе с экраном. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function Dynamics({ data }: { data: DashboardData }) {
  const { series } = data
  const [box, boxWidth] = useElementWidth<HTMLDivElement>()
  const W = Math.max(260, boxWidth || 640)
  const hasPlan = series.some((s) => s.plan !== null)
  const values = series.flatMap((s) => [s.fact, s.plan]).filter((v): v is number => v !== null)
  const ymax = Math.min(100, Math.max(10, Math.ceil(Math.max(0, ...values) / 10) * 10))
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, series.length - 1)
  const y = (v: number) => PAD.t + (1 - v / ymax) * (H - PAD.t - PAD.b)
  const line = (key: 'fact' | 'plan') =>
    series
      .map((s, i) => (s[key] === null ? null : `${i === 0 || series[i - 1][key] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[key]!).toFixed(1)}`))
      .filter(Boolean)
      .join(' ')
  const last = series[series.length - 1]

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-5 shadow-soft" aria-label={tr('Динамика готовности')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{tr('Динамика за 12 недель')}</h2>
        <p className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-foreground" aria-hidden />{tr('Факт (принято)')}</span>
          {hasPlan && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-muted-foreground" aria-hidden />{tr('План')}</span>
          )}
        </p>
      </div>
      <div ref={box} className="w-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block text-foreground" role="img" aria-label={tr('График готовности по неделям')}>
        {[0, ymax / 2, ymax].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {v}%
            </text>
          </g>
        ))}
        {hasPlan && <path d={line('plan')} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />}
        <path d={line('fact')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {last?.fact !== null && last?.fact !== undefined && (
          <>
            <circle cx={x(series.length - 1)} cy={y(last.fact)} r={4.5} fill="currentColor" className="stroke-card" strokeWidth={2} />
            <text x={x(series.length - 1) + 9} y={y(last.fact) + 4} className="fill-foreground text-[12px] font-medium">
              {fmtPercent(last.fact)}
            </text>
          </>
        )}
        <text x={PAD.l} y={H - 6} className="fill-muted-foreground text-[11px]">
          {fmtShortDate(series[0].date)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {fmtShortDate(last.date)}
        </text>
        {series.map((s, i) => (
          <rect key={s.date} x={x(i) - 22} y={PAD.t} width={44} height={H - PAD.t - PAD.b} fill="transparent">
            <title>
              {fmtShortDate(s.date)}{tr(': факт')}{' '}{fmtPercent(s.fact)}
              {s.plan !== null ? tr(', план {{v1}}', { v1: fmtPercent(s.plan) }) : ''}
            </title>
          </rect>
        ))}
      </svg>
      </div>
      {!hasPlan &&<p className="text-xs text-muted-foreground">{tr('Линия плана появится, когда сроки заданы у позиций, составляющих не меньше половины веса проекта.')}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{tr('Показать таблицей')}</summary>
        <table className="mt-2 w-full max-w-md text-left text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 font-normal">{tr('Неделя')}</th>
              <th className="py-1 font-normal">{tr('Факт')}</th>
              <th className="py-1 font-normal">{tr('План')}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.date} className="border-t">
                <td className="py-1">{fmtShortDate(s.date)}</td>
                <td className="py-1 tabular-nums">{fmtPercent(s.fact)}</td>
                <td className="py-1 tabular-nums">{fmtPercent(s.plan)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Срезы: по месту, по направлению, по подрядчику
// ---------------------------------------------------------------------------
const TABS: { id: Tab; label: string }[] = [
  { id: 'location', label: tr('По местам') },
  { id: 'discipline', label: tr('По направлениям') },
  { id: 'contractor', label: tr('По подрядчикам') },
]

function Breakdown({ data, code }: { data: DashboardData; code: string }) {
  const [tab, setTab] = useState<Tab>('location')

  const rows: BarRow[] = useMemo(() => {
    if (tab === 'location') {
      return data.by_location.map((l) => ({
        key: l.path,
        label: l.name,
        title: l.path,
        percent: l.percent,
        indent: l.depth - 1,
        search: { loc: l.path },
      }))
    }
    if (tab === 'discipline') {
      const depthOf = new Map<string, number>()
      const byId = new Map(data.by_discipline.map((d) => [d.discipline_id, d]))
      const depth = (id: string): number => {
        if (depthOf.has(id)) return depthOf.get(id)!
        const p = byId.get(id)?.parent_id
        const d = p && byId.has(p) ? depth(p) + 1 : 0
        depthOf.set(id, d)
        return d
      }
      const sorted = [...data.by_discipline].sort((a, b) => a.sort_key - b.sort_key)
      return sorted.map((d) => ({ key: d.discipline_id, label: d.name, meta: d.code, percent: d.percent, indent: depth(d.discipline_id), search: { disc: d.discipline_id } }))
    }
    return data.by_contractor.map((c) => ({ key: c.org_id ?? 'none', label: c.name, meta: tr('{{items}} поз.', { items: c.items }), percent: c.percent, search: { contractor: c.org_id ?? 'none' } }))
  }, [data, tab])

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-soft" aria-label={tr('Готовность по срезам')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{tr('Где что сделано')}</h2>
        <div role="group" aria-label={tr('Срез')} className="inline-flex rounded-md border bg-muted/40 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-9 rounded px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === t.id ? 'bg-card font-medium shadow-soft' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Нет данных для этого среза.')}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((r) => (
            <li key={r.key}>
              <Link
                to="/projects/$code/volumes"
                params={{ code }}
                search={r.search}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_4.5rem_3.25rem] items-center gap-3 py-1.5 text-sm hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,16rem)_3.25rem]"
                style={{ paddingLeft: (r.indent ?? 0) * 14 }}
                title={r.title}
              >
                <span className="min-w-0 truncate">
                  {r.meta && <span className="ident mr-2 text-muted-foreground">{r.meta}</span>}
                  {r.label}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${r.percent ?? 0}%` }} />
                </span>
                <span className="text-right font-medium tabular-nums">{fmtPercent(r.percent)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
