import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { groupOf, healthQuery, HEALTH_STYLES, RULE_LABELS, SEVERITY_LABELS, SEVERITY_RANK, SEVERITY_STYLES, signalsQuery, type Health } from './api'

/** Индекс здоровья: число, цвет и разложение по компонентам; первым идёт то, что сильнее всего его снижает. */
export function HealthBreakdown({ health }: { health: Health }) {
  const st = HEALTH_STYLES[health.color]
  const drag = [...health.components].sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score))
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-start">
        <div className={`text-5xl font-semibold tabular-nums ${st.text}`} aria-label={tr('Индекс здоровья {{score}} из 100', { score: health.score })}>
          {health.score}
        </div>
        <div>
          <p className={`text-sm font-medium ${st.text}`}>{st.label}</p>
          <p className="text-xs text-muted-foreground">{tr('из 100 · зелёный от 75')}</p>
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
        {drag.map((c, i) => (
          <li key={c.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">
                {c.label} {i === 0 && c.score < 90 && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{tr('сильнее всего снижает')}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{c.score}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted" role="presentation">
              <div className={`h-2 rounded-full ${c.score >= 75 ? 'bg-green-500' : c.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${c.score}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.value}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Блок для хаба проекта: индекс здоровья и главные сигналы. */
export function HealthWidget({ projectId, code }: { projectId: string; code: string }) {
  const { data: health } = useQuery(healthQuery(projectId))
  const { data: signals = [] } = useQuery(signalsQuery(projectId))
  const open = signals.filter((s) => s.status === 'open').sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  if (!health && open.length === 0) return null
  const st = health ? HEALTH_STYLES[health.color] : null
  return (
    <section aria-labelledby="health-widget" className="rounded-lg border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="health-widget" className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-muted-foreground" aria-hidden />{tr('Здоровье проекта')}</h2>
        <Link to="/projects/$code/signals" params={{ code }} search={{}} className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{tr('Все сигналы')}{open.length > 0 ? ` (${open.length})` : ''}
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        {health && st && (
          <div className="flex items-center gap-3 md:flex-col md:items-start">
            <span className={`text-4xl font-semibold tabular-nums ${st.text}`}>{health.score}</span>
            <span className="text-sm">
              <span className={`block font-medium ${st.text}`}>{st.label}</span>
              <span className="block text-xs text-muted-foreground">{tr('индекс из 100')}</span>
            </span>
          </div>
        )}
        {open.length === 0 ? (
          <p className="self-center text-sm text-muted-foreground">{tr('Открытых сигналов нет.')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {open.slice(0, 5).map((s) => (
              <li key={s.id} className="py-1.5">
                <Link to="/projects/$code/signals" params={{ code }} search={{ s: s.id }} className="flex items-start gap-2 text-sm hover:underline">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[s.severity]}`}>{SEVERITY_LABELS[s.severity]}</span>
                  <span className="min-w-0">
                    {s.title}
                    <span className="block text-xs text-muted-foreground">{RULE_LABELS[s.rule] ?? groupOf(s.rule)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
