import { ArrowRight } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { MODULE_LINKS, moduleDef, type ModuleKey } from '@/features/projects/modules'

/**
 * Карта связей модулей: в центре основа проекта (задачи, заметки, доски, структура — ими пользуются все модули),
 * по кругу — модули, стрелками — что один модуль передаёт другому. Выключенный модуль — пунктиром, его связи бледные.
 * Наведение или выбор модуля подсвечивает только его связи. Узлы — HTML поверх SVG (текст переносится на любом языке).
 */

type Pt = [number, number]
interface Layout {
  w: number
  h: number
  hub: Pt
  hubHalf: Pt
  half: Pt
  pos: Record<ModuleKey, Pt>
}

// Порядок по кругу подобран так, чтобы связанные модули стояли рядом и стрелки не пересекались
const RING: ModuleKey[] = ['schedule', 'staffing', 'reporting', 'documents', 'procurement', 'budget', 'contracts']

function ring(w: number, h: number, rx: number, ry: number, half: Pt, hubHalf: Pt): Layout {
  const hub: Pt = [w / 2, h / 2]
  const pos = {} as Record<ModuleKey, Pt>
  RING.forEach((k, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / RING.length
    pos[k] = [hub[0] + rx * Math.cos(a), hub[1] + ry * Math.sin(a)]
  })
  return { w, h, hub, hubHalf, half, pos }
}

const WIDE = ring(800, 470, 305, 178, [80, 27], [78, 30])
// На узком экране круг не помещается: две колонки, график сверху, основа проекта между рядами
const TALL: Layout = {
  w: 360,
  h: 570,
  hub: [180, 270],
  hubHalf: [56, 32],
  half: [68, 32],
  pos: {
    schedule: [180, 45],
    contracts: [82, 145],
    staffing: [278, 145],
    budget: [82, 395],
    reporting: [278, 395],
    procurement: [82, 520],
    documents: [278, 520],
  },
}

/** Точка на краю прямоугольника с центром c и полуразмерами half в направлении (ux, uy) */
function edge(c: Pt, half: Pt, ux: number, uy: number, pad = 5): Pt {
  const t = Math.min(ux ? half[0] / Math.abs(ux) : Infinity, uy ? half[1] / Math.abs(uy) : Infinity) + pad
  return [c[0] + ux * t, c[1] + uy * t]
}

function segment(a: Pt, ah: Pt, b: Pt, bh: Pt): [Pt, Pt] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [edge(a, ah, dx / len, dy / len), edge(b, bh, -dx / len, -dy / len)]
}

// Пары модулей с направлениями (двусторонняя связь — одна линия со стрелками на обоих концах)
const PAIRS = (() => {
  const out: { a: ModuleKey; b: ModuleKey; ab: boolean; ba: boolean }[] = []
  for (const l of MODULE_LINKS) {
    const ex = out.find((p) => (p.a === l.from && p.b === l.to) || (p.a === l.to && p.b === l.from))
    if (!ex) out.push({ a: l.from, b: l.to, ab: true, ba: false })
    else if (ex.a === l.from) ex.ab = true
    else ex.ba = true
  }
  return out
})()

export function ModuleMap({
  enabled,
  focus,
  onFocus,
  projectCode,
}: {
  enabled: readonly string[]
  focus: ModuleKey | null
  onFocus: (m: ModuleKey | null) => void
  projectCode: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <Diagram layout={WIDE} className="max-sm:hidden" enabled={enabled} focus={focus} onFocus={onFocus} projectCode={projectCode} />
      <Diagram layout={TALL} className="sm:hidden" enabled={enabled} focus={focus} onFocus={onFocus} projectCode={projectCode} />
      <LinkList enabled={enabled} focus={focus} onFocus={onFocus} />
    </div>
  )
}

function Diagram({
  layout: L,
  className,
  enabled,
  focus,
  onFocus,
  projectCode,
}: {
  layout: Layout
  className?: string
  enabled: readonly string[]
  focus: ModuleKey | null
  onFocus: (m: ModuleKey | null) => void
  projectCode: string
}) {
  const { t } = useTranslation()
  const uid = useId().replace(/:/g, '')
  const on = (m: ModuleKey) => enabled.includes(m)
  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  return (
    <div className={cn('relative w-full select-none', className)} style={{ aspectRatio: `${L.w} / ${L.h}` }}>
      <svg viewBox={`0 0 ${L.w} ${L.h}`} className="absolute inset-0 size-full" aria-hidden>
        <defs>
          {(['strong', 'soft'] as const).map((tone) => (
            <marker key={tone} id={`${uid}-${tone}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: tone === 'strong' ? 'var(--foreground)' : 'var(--muted-foreground)' }} opacity={tone === 'strong' ? 0.85 : 0.45} />
            </marker>
          ))}
        </defs>

        {/* основа проекта связана со всеми модулями */}
        {(Object.keys(L.pos) as ModuleKey[]).map((k) => {
          const [p1, p2] = segment(L.hub, L.hubHalf, L.pos[k], L.half)
          return (
            <line
              key={k}
              x1={p1[0]}
              y1={p1[1]}
              x2={p2[0]}
              y2={p2[1]}
              strokeWidth={1}
              strokeDasharray="2 4"
              style={{ stroke: 'var(--border)' }}
              opacity={on(k) && (!focus || focus === k) ? 1 : 0.4}
            />
          )
        })}

        {PAIRS.map((p) => {
          const [p1, p2] = segment(L.pos[p.a], L.half, L.pos[p.b], L.half)
          const live = on(p.a) && on(p.b)
          const lit = !focus || focus === p.a || focus === p.b
          const tone = live && lit ? 'strong' : 'soft'
          return (
            <line
              key={`${p.a}-${p.b}`}
              x1={p1[0]}
              y1={p1[1]}
              x2={p2[0]}
              y2={p2[1]}
              strokeWidth={focus && lit ? 2.25 : 1.5}
              strokeDasharray={live ? undefined : '5 5'}
              style={{ stroke: tone === 'strong' ? 'var(--foreground)' : 'var(--muted-foreground)', transition: 'opacity 150ms' }}
              opacity={lit ? (live ? 0.75 : 0.5) : 0.15}
              markerEnd={p.ab ? `url(#${uid}-${tone})` : undefined}
              markerStart={p.ba ? `url(#${uid}-${tone})` : undefined}
            />
          )
        })}
      </svg>

      {/* основа проекта */}
      <div
        className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-lg bg-primary px-2 text-center text-primary-foreground shadow-soft"
        style={{ left: pct(L.hub[0], L.w), top: pct(L.hub[1], L.h), width: pct(L.hubHalf[0] * 2, L.w), height: pct(L.hubHalf[1] * 2, L.h) }}
      >
        <span className="ident text-xs font-medium tracking-wide text-signal">{projectCode}</span>
        <span className="line-clamp-2 text-[10.5px] leading-tight opacity-80" title={tr('Задачи, заметки, доски, совещания, структура — ими пользуются все модули')}>
          {tr('Основа проекта')}
        </span>
      </div>

      {(Object.keys(L.pos) as ModuleKey[]).map((k) => {
        const m = moduleDef(k)
        const isOn = on(k)
        const selected = focus === k
        return (
          <button
            key={k}
            type="button"
            onMouseEnter={() => onFocus(k)}
            onMouseLeave={() => onFocus(null)}
            onFocus={() => onFocus(k)}
            onBlur={() => onFocus(null)}
            aria-label={`${t(m.label)}: ${isOn ? tr('включён') : tr('выключен')}`}
            className={cn(
              'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg border bg-card px-2 text-left text-[12px] font-medium leading-tight shadow-soft outline-none transition-[opacity,border-color] focus-visible:ring-2 focus-visible:ring-ring',
              !isOn && 'border-dashed bg-muted/40 text-muted-foreground shadow-none',
              selected && 'border-foreground',
              focus && !selected && !MODULE_LINKS.some((l) => (l.from === focus && l.to === k) || (l.to === focus && l.from === k)) && 'opacity-40',
            )}
            style={{ left: pct(L.pos[k][0], L.w), top: pct(L.pos[k][1], L.h), width: pct(L.half[0] * 2, L.w), height: pct(L.half[1] * 2, L.h) }}
          >
            <m.icon className={cn('size-4 shrink-0', isOn ? 'text-foreground/70' : 'text-muted-foreground')} aria-hidden />
            <span className="line-clamp-2 min-w-0 break-words">{t(m.label)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Те же связи списком: читается на телефоне и экранным диктором; при выборе модуля — только его связи */
function LinkList({ enabled, focus, onFocus }: { enabled: readonly string[]; focus: ModuleKey | null; onFocus: (m: ModuleKey | null) => void }) {
  const { t } = useTranslation()
  const links = MODULE_LINKS.filter((l) => !focus || l.from === focus || l.to === focus)
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
      {links.map((l) => {
        const a = moduleDef(l.from)
        const b = moduleDef(l.to)
        const off = [l.from, l.to].filter((k) => !enabled.includes(k))
        return (
          <li
            key={`${l.from}-${l.to}`}
            className={cn('flex flex-col gap-1 px-4 py-3', off.length > 0 && 'text-muted-foreground')}
            onMouseEnter={() => onFocus(l.from)}
            onMouseLeave={() => onFocus(null)}
          >
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <a.icon className="size-4 shrink-0 opacity-70" aria-hidden />
              {t(a.label)}
              <ArrowRight className="size-3.5 shrink-0 opacity-60" aria-label={tr('передаёт в')} />
              <b.icon className="size-4 shrink-0 opacity-70" aria-hidden />
              {t(b.label)}
            </span>
            <span className="text-sm text-muted-foreground">{l.text}</span>
            {off.length > 0 && (
              <span className="text-xs">
                {tr('Не действует: выключен модуль {{v1}}', { v1: off.map((k) => `«${t(moduleDef(k).label)}»`).join(', ') })}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
