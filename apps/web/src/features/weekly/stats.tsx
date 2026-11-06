import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { organizationsListQuery } from '@/features/volumes/api'
import { ppcOf, REASON_LABELS, weekLabel, type CommitmentRow, type PeriodRow, type Reason } from './api'

const WEEKS = 12

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)

/** Динамика PPC, причины невыполнения (Парето), PPC по подрядчикам и влияние готовности работ на старте недели. */
export function WeeklyStats({
  projectId: _projectId,
  periods,
  commitments,
  onOpenWeek,
}: {
  projectId: string
  periods: PeriodRow[]
  commitments: CommitmentRow[]
  onOpenWeek: (startsOn: string) => void
}) {
  const { data: orgs = [] } = useQuery(organizationsListQuery)

  const closed = useMemo(() => periods.filter((p) => p.status === 'closed').slice(0, WEEKS).reverse(), [periods])
  const closedIds = useMemo(() => new Set(closed.map((p) => p.id)), [closed])
  const inScope = useMemo(() => commitments.filter((c) => closedIds.has(c.period_id)), [commitments, closedIds])
  const base = useMemo(() => inScope.filter((c) => !c.added_late), [inScope])

  const trend = useMemo(
    () => closed.map((p) => ({ period: p, stats: ppcOf(commitments.filter((c) => c.period_id === p.id)) })),
    [closed, commitments],
  )
  const overall = ppcOf(inScope)

  const pareto = useMemo(() => {
    const counts = new Map<Reason, number>()
    for (const c of base) if (c.result === 'not_completed' && c.reason) counts.set(c.reason, (counts.get(c.reason) ?? 0) + 1)
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const total = rows.reduce((s, [, n]) => s + n, 0)
    let acc = 0
    return rows.map(([reason, n]) => {
      acc += n
      return { reason, n, share: total > 0 ? Math.round((acc / total) * 100) : 0 }
    })
  }, [base])

  const byOrg = useMemo(() => {
    const names = new Map(orgs.map((o) => [o.id, o.name]))
    const groups = new Map<string, CommitmentRow[]>()
    for (const c of base) {
      const key = c.organization_id ?? ''
      groups.set(key, [...(groups.get(key) ?? []), c])
    }
    return [...groups.entries()]
      .map(([key, rows]) => ({ name: key ? (names.get(key) ?? tr('Организация')) : tr('Подрядчик не указан'), ...ppcOf(rows) }))
      .sort((a, b) => b.total - a.total)
  }, [base, orgs])

  const ready = ppcOf(base.filter((c) => c.was_ready))
  const notReady = ppcOf(base.filter((c) => !c.was_ready))

  if (closed.length === 0) {
    return (
      <p className="max-w-prose rounded-lg border bg-card p-6 text-sm text-muted-foreground">{tr('Здесь появится динамика выполнения плана, когда будет закрыта первая неделя: процент выполненных обязательств (PPC), главные причины срывов и сравнение подрядчиков.')}</p>
    )
  }

  const maxN = Math.max(1, ...pareto.map((r) => r.n))

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ppc-trend" className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="ppc-trend" className="text-sm font-semibold">{tr('PPC по неделям')}</h3>
          <p className="text-xs text-muted-foreground">{tr('За')}{' '}{closed.length} {closed.length === 1 ? tr('неделю') : tr('нед.')}: {pct(overall.ppc)} ({overall.done}{tr('из')}{' '}{overall.total})
          </p>
        </div>
        <ol className="flex h-44 items-end gap-1.5 sm:gap-2" aria-label={tr('Столбцы: процент выполненных обязательств по неделям')}>
          {trend.map(({ period, stats }) => (
            <li key={period.id} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <button
                type="button"
                onClick={() => onOpenWeek(period.starts_on)}
                title={tr('{{v1}}: {{v2}} ({{done}} из {{total}})', { v1: weekLabel(period.starts_on), v2: pct(stats.ppc), done: stats.done, total: stats.total })}
                className="group flex h-full min-h-11 flex-col justify-end gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-center text-xs tabular-nums text-muted-foreground">{pct(stats.ppc)}</span>
                <span className="mx-auto w-full max-w-14 rounded-t-sm bg-primary/60 group-hover:bg-primary/80" style={{ height: `${Math.max(stats.ppc ?? 0, 2)}%` }} />
              </button>
            </li>
          ))}
        </ol>
        <ol className="mt-1 flex gap-1.5 sm:gap-2" aria-hidden>
          {trend.map(({ period }) => (
            <li key={period.id} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">
              {period.starts_on.slice(8, 10)}.{period.starts_on.slice(5, 7)}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">{tr('Дата под столбцом — понедельник недели. Нажмите на столбец, чтобы открыть неделю.')}</p>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section aria-labelledby="reasons" className="rounded-lg border bg-card p-4">
          <h3 id="reasons" className="mb-3 text-sm font-semibold">{tr('Почему не выполняется план')}</h3>
          {pareto.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('Невыполненных обязательств за этот период нет.')}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {pareto.map(({ reason, n, share }) => (
                <li key={reason}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{REASON_LABELS[reason]}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {n} <span className="text-xs">{tr('· накоплено')}{' '}{share}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary/60" style={{ width: `${(n / maxN) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ready" className="rounded-lg border bg-card p-4">
          <h3 id="ready" className="mb-1 text-sm font-semibold">{tr('Готовность к старту недели')}</h3>
          <p className="mb-3 text-xs text-muted-foreground">{tr('Работы, у которых к понедельнику не были закончены предшественники, срываются чаще — это и есть цена неснятых ограничений.')}</p>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{tr('Были готовы')}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{pct(ready.ppc)}</dd>
              <p className="text-xs text-muted-foreground">
                {ready.done}{tr('из')}{' '}{ready.total}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{tr('Не были готовы')}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{pct(notReady.ppc)}</dd>
              <p className="text-xs text-muted-foreground">
                {notReady.done}{tr('из')}{' '}{notReady.total}
              </p>
            </div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="orgs" className="rounded-lg border bg-card">
        <h3 id="orgs" className="border-b p-4 text-sm font-semibold">{tr('По подрядчикам')}</h3>
        <ul className="divide-y">
          {byOrg.map((o) => (
            <li key={o.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {o.done}{tr('из')}{' '}{o.total}
              </span>
              <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{pct(o.ppc)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
