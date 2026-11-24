import { tr } from '@/lib/tr'
import { useState } from 'react'
import { fullMoney, money, pct, type Slice } from './lookahead-model'
import { Money } from './money'

/**
 * Круговая диаграмма-«бублик» с легендой: доля каждого куска, сумма и процент. Наведение на кусок или строку легенды
 * подсвечивает его и показывает в центре.
 */
export function Donut({ title, hint, slices, total, totalLabel }: { title: string; hint?: string; slices: Slice[]; total?: number; totalLabel?: string }) {
  const [active, setActive] = useState<number | null>(null)
  const sum = total ?? slices.reduce((s, x) => s + Math.max(x.value, 0), 0)
  const R = 42
  const C = 2 * Math.PI * R
  const lens = slices.map((s) => (sum > 0 ? (Math.max(s.value, 0) / sum) * C : 0))
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  const shown = active === null ? null : slices[active]
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {sum <= 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{tr('Данных пока нет.')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-5">
          <svg viewBox="0 0 100 100" className="size-40 shrink-0 -rotate-90" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${pct(s.value, sum)}%`).join(', ')}`}>
            <circle cx="50" cy="50" r={R} fill="none" className="stroke-muted" strokeWidth="14" />
            {slices.map((s, i) => (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={active === i ? 17 : 14}
                strokeDasharray={`${Math.max(lens[i] - 0.6, 0)} ${C}`}
                strokeDashoffset={-offsets[i]}
                opacity={active === null || active === i ? 1 : 0.35}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className="transition-[stroke-width,opacity] motion-reduce:transition-none"
              />
            ))}
            <g className="rotate-90 [transform-origin:50px_50px]">
              <text x="50" y="47" textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                {shown ? `${pct(shown.value, sum)}%` : money(sum)}
                <title>{shown ? `${shown.label}: ${fullMoney(shown.value)}` : fullMoney(sum)}</title>
              </text>
              <text x="50" y="60" textAnchor="middle" className="fill-muted-foreground text-[6.5px]">
                {shown ? (shown.label.length > 18 ? `${shown.label.slice(0, 17)}…` : shown.label) : (totalLabel ?? tr('всего'))}
              </text>
            </g>
          </svg>
          <ul className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm">
            {slices.map((s, i) => (
              <li key={s.label} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} className={`flex items-center gap-2 rounded px-1 ${active === i ? 'bg-muted' : ''}`}>
                <span className="size-3 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={s.label}>
                  {s.label}
                </span>
                <Money className="text-muted-foreground" value={s.value} />
                <span className="w-10 text-right font-medium tabular-nums">{pct(s.value, sum)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
