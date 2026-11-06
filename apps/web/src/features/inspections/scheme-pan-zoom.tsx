import { useQuery } from '@tanstack/react-query'
import { Maximize2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STATUS_STYLE } from '@/features/inspections/api'
import { schemeImageQuery, type SchemeSource } from '@/features/inspections/scheme-image'
import type { SchemeMarker } from '@/features/inspections/scheme-view'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

interface View {
  x: number
  y: number
  z: number
}

const MAX_ZOOM = 8
/** Сдвиг пальца меньше этого (в пикселях) считается касанием, а не перетаскиванием */
const TAP_SLOP = 8

type Gesture = { type: 'pan'; sx: number; sy: number; v: View; moved: number } | { type: 'pinch'; dist: number; cx: number; cy: number; v: View }

/**
 * Схема с жестами, как на карте: двумя пальцами (или колесом мыши) увеличить, одним пальцем сдвинуть, коснуться, чтобы поставить
 * точку замечания (`onPick`). Точки и подписи не растут вместе со схемой, чтобы оставаться читаемыми. Кнопка в углу возвращает схему целиком.
 */
export function SchemePanZoom({
  source,
  alt,
  markers,
  draft,
  onPick,
  heightClass = 'h-[58svh]',
}: {
  source: SchemeSource
  alt: string
  markers: SchemeMarker[]
  draft?: { x: number; y: number } | null
  onPick?: (point: { x: number; y: number }) => void
  heightClass?: string
}) {
  const { data: url, isError } = useQuery(schemeImageQuery(source))
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [cs, setCs] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const viewRef = useRef(view)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)

  // размер схемы при масштабе 1: вписана в окно целиком
  const fit = natural && cs.w > 0 && cs.h > 0 ? Math.min(cs.w / natural.w, cs.h / natural.h) : 0
  const sw = natural ? natural.w * fit : 0
  const sh = natural ? natural.h * fit : 0

  /** Держит схему в окне: меньше окна — по центру, больше — не дальше краёв. */
  const clamp = useCallback(
    (v: View): View => {
      const z = Math.min(MAX_ZOOM, Math.max(1, v.z))
      const lim = (pos: number, size: number, win: number) => (size * z <= win ? (win - size * z) / 2 : Math.min(0, Math.max(win - size * z, pos)))
      return { z, x: lim(v.x, sw, cs.w), y: lim(v.y, sh, cs.h) }
    },
    [sw, sh, cs.w, cs.h],
  )
  const commit = useCallback(
    (v: View) => {
      const c = clamp(v)
      viewRef.current = c
      setView(c)
    },
    [clamp],
  )
  const reset = useCallback(() => commit({ x: 0, y: 0, z: 1 }), [commit])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setCs({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // новый размер окна или схемы — показываем схему целиком по центру
  useEffect(() => {
    if (fit > 0) reset()
  }, [fit, reset])

  const zoomAt = useCallback(
    (px: number, py: number, k: number) => {
      const v = viewRef.current
      const z = Math.min(MAX_ZOOM, Math.max(1, v.z * k))
      const r = z / v.z
      commit({ z, x: px - (px - v.x) * r, y: py - (py - v.y) * r })
    },
    [commit],
  )

  // колесо мыши: увеличение к курсору (слушатель не пассивный, чтобы страница не прокручивалась)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0018))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, url])

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const down = (e: React.PointerEvent) => {
    box.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    const pts = [...pointers.current.values()]
    if (pts.length === 1) gesture.current = { type: 'pan', sx: pts[0].x, sy: pts[0].y, v: viewRef.current, moved: 0 }
    else if (pts.length === 2) {
      const [a, b] = pts
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: viewRef.current }
    }
  }

  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, local(e))
    const pts = [...pointers.current.values()]
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan' && pts.length === 1) {
      const dx = pts[0].x - g.sx
      const dy = pts[0].y - g.sy
      g.moved = Math.max(g.moved, Math.hypot(dx, dy))
      if (g.moved >= TAP_SLOP) commit({ z: g.v.z, x: g.v.x + dx, y: g.v.y + dy })
    } else if (g.type === 'pinch' && pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const z = Math.min(MAX_ZOOM, Math.max(1, g.v.z * (dist / g.dist)))
      const r = z / g.v.z
      // точка схемы под центром щипка остаётся под ним, плюс сдвиг центра
      commit({ z, x: cx - (g.cx - g.v.x) * r, y: cy - (g.cy - g.v.y) * r })
    }
  }

  const up = (e: React.PointerEvent) => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      gesture.current = null
      // короткое касание без сдвига — это выбор места на схеме
      if (g?.type === 'pan' && g.moved < TAP_SLOP && onPick && stage.current) {
        const r = stage.current.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width
        const y = (e.clientY - r.top) / r.height
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPick({ x, y })
      }
    } else {
      // осталась одна точка после щипка: дальше только сдвиг, а не касание
      const [p] = [...pointers.current.values()]
      gesture.current = { type: 'pan', sx: p.x, sy: p.y, v: viewRef.current, moved: TAP_SLOP }
    }
  }

  if (isError) return <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{tr('Не удалось показать схему. Попробуйте открыть страницу заново.')}</p>

  const inverse = 1 / view.z
  return (
    <div
      ref={box}
      role="img"
      aria-label={alt}
      className={cn('relative w-full touch-none select-none overflow-hidden rounded-md border bg-white', heightClass, onPick ? 'cursor-crosshair' : 'cursor-grab')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {!url ? (
        <div className="size-full animate-pulse bg-muted" role="status" aria-label={tr('Рисуем схему…')} />
      ) : (
        <div ref={stage} className="absolute left-0 top-0" style={{ width: sw || undefined, height: sh || undefined, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0', visibility: fit > 0 ? 'visible' : 'hidden' }}>
          <img src={url} alt="" draggable={false} className="pointer-events-none block size-full" onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {markers.map((m) => (
            <span
              key={m.id}
              className={cn('pointer-events-none absolute grid h-6 min-w-6 place-items-center rounded-full border-2 border-white px-1 text-[10px] font-semibold leading-none shadow', m.status ? STATUS_STYLE[m.status].on : 'bg-slate-500 text-white')}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: `translate(-50%, -50%) scale(${inverse})` }}
            >
              {m.label}
            </span>
          ))}
          {draft && (
            <span
              className="pointer-events-none absolute size-7 rounded-full border-[3px] border-white bg-signal shadow ring-2 ring-foreground"
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, transform: `translate(-50%, -50%) scale(${inverse})` }}
              aria-label={tr('Новая точка')}
            />
          )}
        </div>
      )}
      {view.z > 1 && (
        <button
          type="button"
          aria-label={tr('Показать схему целиком')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={reset}
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-full border bg-background/95 shadow outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 className="size-4" />
        </button>
      )}
    </div>
  )
}
