import { History, MoreHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EntityImage } from '@/features/renders/api'
import { tr } from '@/lib/tr'

/** Телефон и планшет: касание вместо мыши или узкий экран. Там просмотр фото открывается как нативная галерея. */
export function useTouchGallery(): boolean {
  const query = '(pointer: coarse), (max-width: 639px)'
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return match
}

const MAX_SCALE = 5
const SWITCH_RATIO = 0.2 // доля ширины, после которой отпущенный жест переключает фото
const SWITCH_SPEED = 0.45 // px/мс: быстрый короткий взмах тоже переключает
const CLOSE_DISTANCE = 110 // свайп вниз дальше этого закрывает просмотр
const DOUBLE_TAP_MS = 300

interface Pt {
  x: number
  y: number
}

/**
 * Просмотр фото на весь экран, как в галерее телефона: фото идёт за пальцем, соседние подъезжают сбоку, горизонтальный взмах
 * листает, щипок и двойное касание масштабируют (в приближении фото двигается пальцем), свайп вниз закрывает, одиночное касание
 * прячет и показывает подписи. «Подробнее» открывает окно с правкой, версиями и папкой.
 */
export function PhotoViewer({
  images,
  urls,
  index,
  onIndex,
  onClose,
  onMore,
}: {
  images: EntityImage[]
  urls?: Map<string, string>
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onMore: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const n = images.length
  const at = (i: number) => images[(i + n) % n]!
  // жест в движении: сдвиг ленты по горизонтали, смещение по вертикали (закрытие), масштаб и сдвиг приближенного фото
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [anim, setAnim] = useState(false)
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 })
  const [chrome, setChrome] = useState(true)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const pointers = useRef(new Map<number, Pt>())
  const g = useRef({
    axis: null as 'x' | 'y' | 'pan' | null,
    start: { x: 0, y: 0, t: 0 },
    moved: false,
    pinch: null as { dist: number; s: number; x: number; y: number; cx: number; cy: number } | null,
    lastTap: { t: 0, x: 0, y: 0 },
    last: { x: 0, t: 0, v: 0 },
    prev: { x: 0, y: 0 },
  })

  const width = () => box.current?.clientWidth ?? window.innerWidth
  const height = () => box.current?.clientHeight ?? window.innerHeight

  // «Назад» (кнопка телефона или жест от края экрана) закрывает просмотр, а не уходит по истории на номера, которые смотрели до этого:
  // просмотр занимает свою запись в истории. Запись создаётся отложенно: в режиме разработки эффект запускается дважды.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    let pushed = false
    let byBack = false
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state ?? {}), photoViewer: true }, '')
      pushed = true
    }, 0)
    const onPop = () => {
      if (!pushed) return
      byBack = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('popstate', onPop)
      // закрыли кнопкой или жестом, а не «Назад»: убираем свою запись, чтобы история осталась прежней
      if (pushed && !byBack && window.history.state?.photoViewer) window.history.back()
    }
  }, [])

  // Esc закрывает; страница под просмотром не прокручивается
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') slideTo(-1)
      if (e.key === 'ArrowRight') slideTo(1)
    }
    const prev = document.body.style.overflow
    const prevOver = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    // браузер не должен принимать горизонтальный жест за «назад/вперёд» по истории и не тянуть страницу вниз
    document.documentElement.style.overscrollBehavior = 'none'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.documentElement.style.overscrollBehavior = prevOver
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, n])

  // Новое фото: масштаб сбрасывается
  useEffect(() => setZoom({ s: 1, x: 0, y: 0 }), [index])

  /** Доехать до соседнего фото: лента едет на ширину экрана, потом индекс меняется, а сдвиг обнуляется без анимации. */
  function slideTo(dir: -1 | 1) {
    if (n < 2) return snapBack()
    setAnim(true)
    setDx(-dir * width())
    window.setTimeout(() => {
      setAnim(false)
      setDx(0)
      onIndex((index + dir + n) % n)
    }, 220)
  }
  function snapBack() {
    setAnim(true)
    setDx(0)
    setDy(0)
    window.setTimeout(() => setAnim(false), 220)
  }

  const clampPan = (s: number, x: number, y: number) => {
    const mx = (width() * (s - 1)) / 2
    const my = (height() * (s - 1)) / 2
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) }
  }

  function down(e: React.PointerEvent) {
    try {
      box.current?.setPointerCapture(e.pointerId)
    } catch {
      // синтетический или уже завершённый указатель
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const st = g.current
    if (pointers.current.size === 1) {
      st.start = { x: e.clientX, y: e.clientY, t: e.timeStamp }
      st.last = { x: e.clientX, t: e.timeStamp, v: 0 }
      st.prev = { x: e.clientX, y: e.clientY }
      st.axis = zoomRef.current.s > 1.02 ? 'pan' : null
      st.moved = false
      setAnim(false)
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt]
      const z = zoomRef.current
      st.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: z.s, x: z.x, y: z.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      st.axis = 'pan'
      st.moved = true
      setDx(0)
      setDy(0)
    }
  }

  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const st = g.current
    if (st.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const s = Math.min(MAX_SCALE, Math.max(0.8, st.pinch.s * (dist / st.pinch.dist)))
      const rect = box.current!.getBoundingClientRect()
      // точка под пальцами остаётся на месте
      const ox = st.pinch.cx - rect.left - rect.width / 2
      const oy = st.pinch.cy - rect.top - rect.height / 2
      const k = s / st.pinch.s
      setZoom({ s, x: ox - (ox - st.pinch.x) * k + ((a.x + b.x) / 2 - st.pinch.cx), y: oy - (oy - st.pinch.y) * k + ((a.y + b.y) / 2 - st.pinch.cy) })
      return
    }
    const ddx = e.clientX - st.start.x
    const ddy = e.clientY - st.start.y
    if (!st.moved && Math.hypot(ddx, ddy) > 8) st.moved = true
    if (!st.moved) return
    if (st.axis === null) st.axis = Math.abs(ddx) > Math.abs(ddy) ? 'x' : ddy > 0 ? 'y' : null
    if (st.axis === 'x') {
      setDx(ddx)
      const dt = e.timeStamp - st.last.t
      if (dt > 0) st.last = { x: e.clientX, t: e.timeStamp, v: (e.clientX - st.last.x) / dt }
    } else if (st.axis === 'y') {
      setDy(Math.max(0, ddy))
    } else if (st.axis === 'pan') {
      // приближенное фото двигается за пальцем: сдвиг считаем по приращению от прошлого события
      const z = zoomRef.current
      const p = clampPan(z.s, z.x + (e.clientX - st.prev.x), z.y + (e.clientY - st.prev.y))
      setZoom({ s: z.s, ...p })
    }
    st.prev = { x: e.clientX, y: e.clientY }
  }

  function up(e: React.PointerEvent) {
    const st = g.current
    const had = pointers.current.has(e.pointerId)
    pointers.current.delete(e.pointerId)
    if (!had) return
    if (pointers.current.size > 0) {
      // остался один палец после щипка: он продолжает двигать фото
      const rest = [...pointers.current.values()][0]!
      st.prev = { x: rest.x, y: rest.y }
      st.pinch = null
      return
    }
    st.pinch = null
    const z = zoomRef.current
    if (z.s < 1.05) setZoom({ s: 1, x: 0, y: 0 })
    else setZoom({ s: z.s, ...clampPan(z.s, z.x, z.y) })

    if (!st.moved) {
      // касание без движения: двойное приближает или возвращает, одиночное прячет и показывает подписи
      const dbl = e.timeStamp - st.lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - st.lastTap.x, e.clientY - st.lastTap.y) < 30
      if (dbl) {
        st.lastTap = { t: 0, x: 0, y: 0 }
        if (z.s > 1.05) setZoom({ s: 1, x: 0, y: 0 })
        else {
          const rect = box.current!.getBoundingClientRect()
          const s = 2.5
          const p = clampPan(s, -(e.clientX - rect.left - rect.width / 2) * (s - 1), -(e.clientY - rect.top - rect.height / 2) * (s - 1))
          setAnim(true)
          setZoom({ s, ...p })
          window.setTimeout(() => setAnim(false), 220)
        }
      } else {
        st.lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY }
        window.setTimeout(() => {
          if (st.lastTap.t === e.timeStamp) setChrome((c) => !c)
        }, DOUBLE_TAP_MS)
      }
      return
    }
    if (st.axis === 'x') {
      const fast = Math.abs(st.last.v) > SWITCH_SPEED
      const far = Math.abs(dx) > width() * SWITCH_RATIO
      if ((far || fast) && n > 1) slideTo((fast ? st.last.v : dx) < 0 ? 1 : -1)
      else snapBack()
    } else if (st.axis === 'y') {
      if (dy > CLOSE_DISTANCE) onClose()
      else snapBack()
    }
    st.axis = null
  }

  const prev = n > 1 ? at(index - 1) : null
  const next = n > 1 ? at(index + 1) : null
  const cur = at(index)
  const fade = Math.max(0.25, 1 - dy / 400)
  const slide = (im: EntityImage, offset: number, current: boolean) => (
    <div key={`${im.id}-${offset}`} className="absolute inset-0 grid place-items-center" style={{ transform: `translateX(${offset * 100}%)` }}>
      {urls?.get(im.file.storage_key) ? (
        <img
          src={urls.get(im.file.storage_key)}
          alt={im.caption ?? im.file.name}
          draggable={false}
          decoding="async"
          className="max-h-full max-w-full select-none object-contain"
          style={
            current
              ? { transform: `translate(${zoom.x}px, ${zoom.y + dy}px) scale(${zoom.s})`, transition: anim ? 'transform 220ms ease-out' : undefined, touchAction: 'none' }
              : undefined
          }
        />
      ) : (
        <span className="text-sm text-white/70">{tr('Загружаем…')}</span>
      )}
    </div>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[100] select-none overflow-hidden overscroll-none"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      role="dialog" aria-modal="true" aria-label={cur.caption ?? cur.file.name} style={{ backgroundColor: `rgba(0,0,0,${fade})` }}>
      <div
        ref={box}
        className="absolute inset-0 touch-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid="photo-viewer-surface"
      >
        <div className="absolute inset-0" style={{ transform: `translateX(${dx}px)`, transition: anim ? 'transform 220ms ease-out' : undefined }}>
          {prev && slide(prev, -1, false)}
          {slide(cur, 0, true)}
          {next && slide(next, 1, false)}
        </div>
      </div>

      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 text-white transition-opacity ${chrome && dy === 0 ? 'opacity-100' : 'opacity-0'}`}
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <button type="button" onClick={onClose} aria-label={tr('Закрыть')} className="pointer-events-auto grid size-11 place-items-center rounded-full bg-black/40 outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="size-6" />
        </button>
        <span className="rounded-full bg-black/40 px-3 py-1 text-sm tabular-nums">
          {index + 1} / {n}
        </span>
        <button type="button" onClick={onMore} aria-label={tr('Подробнее')} className="pointer-events-auto grid size-11 place-items-center rounded-full bg-black/40 outline-none focus-visible:ring-2 focus-visible:ring-white">
          <MoreHorizontal className="size-6" />
        </button>
      </div>

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/70 to-transparent px-4 pt-10 text-white transition-opacity ${chrome && dy === 0 && zoom.s <= 1.05 ? 'opacity-100' : 'opacity-0'}`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {cur.caption && <p className="text-sm">{cur.caption}</p>}
        <p className="flex items-center gap-2 text-xs text-white/70">
          {cur.folder && <span>{cur.folder.replace(/\//g, ' › ')}</span>}
          {cur.versions > 1 && (
            <span className="inline-flex items-center gap-1">
              <History className="size-3" aria-hidden /> {tr('версия {{n}}', { n: cur.versions })}
            </span>
          )}
        </p>
      </div>
    </div>,
    document.body,
  )
}
