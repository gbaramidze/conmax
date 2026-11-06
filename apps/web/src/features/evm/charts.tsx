import { tr } from '@/lib/tr'
import { addDays } from '@/features/weekly/api'
import { toDisplay } from '@/features/projects/display-currency'

const W = 460
const H = 230
const PAD = { l: 56, r: 14, t: 16, b: 30 }

const COLORS = { pv: '#64748b', ev: '#2563eb', ac: '#d97706' }

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
const label = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
const money = (v: number) => {
  const n = toDisplay(v)
  return Math.abs(n) >= 1e6 ? tr('{{v1}} млн', { v1: (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace('.', ',') }) : Math.abs(n) >= 1e3 ? tr('{{v1}} тыс', { v1: Math.round(n / 1e3) }) : String(Math.round(n))
}

interface Point {
  day: string
  value: number
}

/** S-кривая: плановая стоимость (пунктир), освоенный объём и факт затрат по снимкам и на сегодня. */
export function SCurve({ pv, ev, ac, today, bac }: { pv: Point[]; ev: Point[]; ac: Point[]; today: string; bac: number }) {
  const all = [...pv, ...ev, ...ac]
  if (all.length < 2) return null
  const from = Math.min(...all.map((p) => day(p.day)))
  const to = Math.max(...all.map((p) => day(p.day)), day(today))
  const max = Math.max(bac, ...all.map((p) => p.value), 1)
  const x = (iso: string) => PAD.l + ((day(iso) - from) / Math.max(to - from, 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const path = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const ticks = [0, 0.5, 1].map((k) => Math.round(max * k))
  const xs = [from, from + (to - from) / 2, to].map((d) => new Date(d * 86_400_000).toISOString().slice(0, 10))
  const lastEv = ev[ev.length - 1]
  const lastAc = ac[ac.length - 1]

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('S-кривая: плановая стоимость, освоенный объём и факт затрат по неделям')} className="h-auto w-full">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={13} fill="currentColor" fillOpacity={0.6}>
              {money(v)}
            </text>
          </g>
        ))}
        <line x1={x(today)} x2={x(today)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 3" />
        <text x={x(today)} y={PAD.t + 8} textAnchor="middle" fontSize={12} fill="currentColor" fillOpacity={0.6}>{tr('сегодня')}</text>
        <path d={path(pv)} fill="none" stroke={COLORS.pv} strokeWidth={2} strokeDasharray="6 4" />
        {ac.length > 0 && <path d={path(ac)} fill="none" stroke={COLORS.ac} strokeWidth={2.5} strokeLinejoin="round" />}
        {ev.length > 0 && <path d={path(ev)} fill="none" stroke={COLORS.ev} strokeWidth={2.5} strokeLinejoin="round" />}
        {ac.map((p) => <rect key={`a${p.day}`} x={x(p.day) - 3} y={y(p.value) - 3} width={6} height={6} fill={COLORS.ac} stroke="white" strokeWidth={1.5} />)}
        {ev.map((p) => <circle key={`e${p.day}`} cx={x(p.day)} cy={y(p.value)} r={3.5} fill={COLORS.ev} stroke="white" strokeWidth={1.5} />)}
        {xs.map((d, i) => (
          <text key={d} x={x(d)} y={H - 9} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={13} fill="currentColor" fillOpacity={0.6}>
            {label(d)}
          </text>
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 border-t-2 border-dashed" style={{ borderColor: COLORS.pv }} aria-hidden />{tr('План (PV)')}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5" style={{ background: COLORS.ev }} aria-hidden />{tr('Освоено (EV)')}{lastEv && <span className="font-medium text-foreground"> {money(lastEv.value)}</span>}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5" style={{ background: COLORS.ac }} aria-hidden />{tr('Факт затрат (AC)')}{lastAc && <span className="font-medium text-foreground"> {money(lastAc.value)}</span>}
        </span>
      </figcaption>
    </figure>
  )
}

/** Тренд индекса по снимкам: линия, единица и зелёная зона допуска. */
export function IndexTrend({ title, points, green }: { title: string; points: Point[]; green: number }) {
  if (points.length === 0) return null
  const values = points.map((p) => p.value)
  const lo = Math.min(0.6, ...values) - 0.05
  const hi = Math.max(1.2, ...values) + 0.05
  const h = 150
  const x = (i: number) => PAD.l - 14 + (points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (points.length - 1)) * (W - PAD.l - PAD.r))
  const y = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (h - 30)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{title}</span>
        <span className="tabular-nums text-muted-foreground">{tr('сейчас')}{' '}{last.value.toFixed(2).replace('.', ',')}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={tr('{{title}} по неделям', { title })} className="h-auto w-full">
        <rect x={PAD.l - 14} y={y(hi)} width={W - PAD.l - PAD.r + 14} height={y(green) - y(hi)} fill="#22c55e" fillOpacity={0.08} />
        <line x1={PAD.l - 14} x2={W - PAD.r} y1={y(1)} y2={y(1)} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 3" />
        <text x={PAD.l - 20} y={y(1) + 4} textAnchor="end" fontSize={13} fill="currentColor" fillOpacity={0.6}>
          1,0
        </text>
        <path d={d} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.day}>
            <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="#2563eb" stroke="white" strokeWidth={1.5} />
            {(i === 0 || i === points.length - 1 || points.length <= 8) && (
              <text x={x(i)} y={h - 6} textAnchor="middle" fontSize={12} fill="currentColor" fillOpacity={0.6}>
                {label(p.day)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  )
}

export { addDays }
