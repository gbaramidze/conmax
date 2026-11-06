import { tr } from '@/lib/tr'
import { ChevronLeft, ChevronRight, MapPin, X, Maximize2, Minus, Plus, Square } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { pinNumber, type PinRow, type PinTask } from '@/features/plans/api'
import { findInPdf, queryWords, type TextHit } from '@/features/plans/pdf-text-search'
import { OBJECT_STATUS_COLORS, objectColor, objectIcon, objectType, objectVariant, specTexts } from '@/features/plans/object-types'
import { hitLine, type PlanObject } from '@/features/plans/objects'
import { centroid, hitZone, polygonArea, rectPoints, zoneShortName, type PlanZone, type Point } from '@/features/plans/zones'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PlanHandle {
  fit: () => void
  zoomBy: (factor: number) => void
  /** Подвести булавку в центр экрана */
  focus: (x: number, y: number) => void
  /** Рисование зоны многоугольником: закончить, убрать последнюю точку, отменить */
  finishPoly: () => void
  undoPoint: () => void
  cancelDraw: () => void
}

export type PlanMode = 'view' | 'add' | 'move'
export type PlanTool = 'point' | 'area'

/** Отметка на плане: точка (x, y) или область — прямоугольник от (x, y) до (x2, y2). */
export interface PlanSpot {
  x: number
  y: number
  x2?: number
  y2?: number
}

interface View {
  x: number
  y: number
  z: number
}

const MAX_Z = 14
const MAX_PIXELS = 16_000_000 // потолок размера холста: на телефоне больше не потянет

/** Цвет и подпись булавки по состоянию задачи. */
export function pinTone(t: PinTask): { className: string; label: string; color: string } {
  const open = t.status_category !== 'done' && t.status_category !== 'cancelled'
  const overdue = open && t.due_date !== null && t.due_date < new Date().toLocaleDateString('sv')
  if (!open) return { className: 'bg-green-600 text-white', label: tr('закрыто'), color: '#16a34a' }
  if (t.status_category === 'blocked') return { className: 'bg-red-600 text-white', label: tr('заблокировано'), color: '#dc2626' }
  if (overdue) return { className: 'bg-red-600 text-white', label: tr('просрочено'), color: '#dc2626' }
  if (t.priority === 'critical' || t.priority === 'high') return { className: 'bg-orange-500 text-white', label: tr('высокий приоритет'), color: '#f97316' }
  return { className: 'bg-signal text-signal-foreground', label: tr('открыто'), color: '#e0a800' }
}

/**
 * Холст плана: PDF (через pdf.js) или картинка с перемещением, масштабом (колесо, щипок) и булавками замечаний.
 * Координаты булавок — доли страницы, поэтому совпадают при любом масштабе и на любом устройстве.
 */
export function PlanCanvas({
  url,
  mime,
  page,
  pages,
  onPage,
  onPages,
  pins,
  selectedId,
  pending,
  mode,
  tool,
  onTool,
  onPlace,
  onPlaceArea,
  onSelect,
  handle,
  zones,
  zoneColor,
  selectedZoneId,
  onZoneSelect,
  zoneDraw,
  zoneHint,
  onZoneDrawn,
  onZoneCancel,
  objects,
  selectedObjectId,
  onObjectSelect,
  objectDraw,
  objectHint,
  onObjectDrawn,
  onObjectCancel,
  objectsEditable,
  onObjectMove,
  ghostLine,
  onAspect,
  highlight,
  furniture,
  placeMark,
}: {
  url: string
  mime: string
  page: number
  pages: number
  onPage: (n: number) => void
  onPages: (n: number) => void
  pins: PinRow[]
  selectedId: string | null
  pending: PlanSpot | null
  mode: PlanMode
  tool: PlanTool
  onTool: (t: PlanTool) => void
  onPlace: (x: number, y: number) => void
  onPlaceArea: (x: number, y: number, x2: number, y2: number) => void
  onSelect: (id: string | null) => void
  handle?: React.Ref<PlanHandle>
  /** Зоны мест на этом плане (все страницы; рисуются только зоны текущей) и их цвет */
  zones?: PlanZone[]
  zoneColor?: (z: PlanZone) => string
  selectedZoneId?: string | null
  onZoneSelect?: (id: string | null) => void
  /** Идёт рисование зоны: прямоугольником (тянуть) или многоугольником (нажимать вершины) */
  zoneDraw?: 'rect' | 'poly' | null
  zoneHint?: string
  onZoneDrawn?: (points: Point[]) => void
  onZoneCancel?: () => void
  /** Объекты слоёв (камеры, щиты, трассы); показываются те, что переданы, и только текущей страницы */
  objects?: PlanObject[]
  selectedObjectId?: string | null
  onObjectSelect?: (id: string | null) => void
  /** Идёт постановка объекта: точкой (нажать) или линией (нажимать вершины) */
  objectDraw?: 'point' | 'line' | null
  objectHint?: string
  onObjectDrawn?: (points: Point[]) => void
  onObjectCancel?: () => void
  /** Выбранный объект можно перетаскивать (точку целиком, у трассы — вершины) */
  objectsEditable?: boolean
  onObjectMove?: (id: string, points: Point[]) => void
  /** Временная линия поверх плана (например, отрезок для задания масштаба) */
  ghostLine?: Point[] | null
  /** Пропорции листа (высота / ширина) — нужны, чтобы считать длины и площади в метрах */
  onAspect?: (aspect: number) => void
  /** Слова из поиска по реестру: у PDF с текстом открывается лист с первым совпадением и совпадения подсвечиваются */
  highlight?: string
  /** Отметки мебели на плане комнаты: точка или зона, нажатие открывает позицию (в режиме просмотра) */
  furniture?: {
    marks: { id: string; page: number; x: number; y: number; x2: number | null; y2: number | null; label: string; out: boolean }[]
    onOpen: (markId: string) => void
  }
  /** Идёт постановка отметки мебели: точкой (нажать) или зоной (обвести); обычные нажатия не срабатывают */
  placeMark?: { tool: 'point' | 'area'; hint: string; onPlace: (x: number, y: number) => void; onPlaceArea: (x: number, y: number, x2: number, y2: number) => void } | null
}) {
  const isPdf = mime === 'application/pdf'
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const [renderZ, setRenderZ] = useState(1)
  const [error, setError] = useState<string | null>(null)
  // прямоугольник, который рисуется прямо сейчас (доли страницы)
  const [draft, setDraft] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null)
  const fitted = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  // многоугольник зоны, который рисуется сейчас, и зона под курсором
  const [poly, setPoly] = useState<Point[]>([])
  const polyRef = useRef<Point[]>([])
  polyRef.current = poly
  const [hoverZone, setHoverZone] = useState<string | null>(null)
  // перетаскивание объекта: точка целиком (index = null) или одна вершина трассы
  const [drag, setDrag] = useState<{ id: string; index: number | null; points: Point[]; sx: number; sy: number; moved: boolean } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  useEffect(() => setPoly([]), [zoneDraw, objectDraw, page])
  // ломаная: многоугольник зоны или линия объекта (вершины нажатиями)
  const drawing = !!zoneDraw || !!objectDraw
  const polyMode = zoneDraw === 'poly' || objectDraw === 'line'
  const minPoly = objectDraw === 'line' ? 2 : 3
  // пропорции листа — наверх, для расчёта длин и площадей
  useEffect(() => {
    if (size) onAspect?.(size.h / size.w)
  }, [size, onAspect])
  // размер окна просмотра и счётчик готовых отрисовок — для миникарты
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  const [rendered, setRendered] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setBoxSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- загрузка ----
  useEffect(() => {
    setError(null)
    setSize(null)
    setPageProxy(null)
    fitted.current = false
    if (!isPdf) {
      // картинка: узнаём размеры, дальше она рисуется на той же сцене, что и булавки
      const img = new Image()
      img.onload = () => {
        setSize({ w: img.naturalWidth, h: img.naturalHeight })
        onPages(1)
      }
      img.onerror = () => setError(tr('Не удалось открыть изображение.'))
      img.src = url
      return () => {
        img.onload = null
        img.onerror = null
      }
    }
    // шрифты и таблицы символов отдаём со своего адреса: без них pdf.js не рисует текст стандартными шрифтами
    const task = pdfjs.getDocument({ url, standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true })
    let cancelled = false
    task.promise.then(
      (d) => {
        if (cancelled) return
        setDoc(d)
        onPages(d.numPages)
      },
      () => !cancelled && setError(tr('Не удалось открыть PDF. Попробуйте скачать файл из документа.')),
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isPdf])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    void doc.getPage(Math.min(Math.max(page, 1), doc.numPages)).then((p) => {
      if (cancelled) return
      const vp = p.getViewport({ scale: 1 })
      setPageProxy(p)
      setSize({ w: vp.width, h: vp.height })
    })
    return () => {
      cancelled = true
    }
  }, [doc, page])

  // ---- поиск слов на листах (текстовый слой PDF) ----
  const [hits, setHits] = useState<TextHit[] | null>(null)
  const [active, setActive] = useState(0)
  const [searchDone, setSearchDone] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const words = highlight ? queryWords(highlight).join(' ') : ''
  useEffect(() => {
    setHits(null)
    setActive(0)
    setSearchDone(false)
    setDismissed(false)
    if (!doc || !words) return
    let cancelled = false
    void findInPdf(doc, words, () => cancelled)
      .then((found) => {
        if (cancelled) return
        setHits(found)
        setSearchDone(true)
        // сразу на лист с первым совпадением
        if (found.length > 0 && found[0]!.page !== page) onPage(found[0]!.page)
      })
      .catch(() => !cancelled && setSearchDone(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, words])
  const hit = hits && hits.length > 0 ? hits[Math.min(active, hits.length - 1)] : null
  const goHit = (i: number) => {
    if (!hits || hits.length === 0) return
    const n = (i + hits.length) % hits.length
    setActive(n)
    if (hits[n]!.page !== page) onPage(hits[n]!.page)
  }
  // подвести окно к активному совпадению, когда нужный лист нарисован
  useEffect(() => {
    if (!hit || hit.page !== page || !size || !fitted.current) return
    const el = box.current
    if (!el) return
    // масштаб, при котором найденное слово высотой около 28 px: на крупных чертежах текст мелкий, и без приближения его не видно
    const z = Math.min(MAX_Z, Math.max(1.2, 28 / Math.max(1, hit.h * size.h)))
    setView({ z, x: el.clientWidth / 2 - (hit.x + hit.w / 2) * size.w * z, y: el.clientHeight / 2 - (hit.y + hit.h / 2) * size.h * z })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.page, hit?.x, hit?.y, page, size])

  // ---- вписать в экран ----
  const fit = useCallback(() => {
    const el = box.current
    if (!el || !size) return
    const pad = 16
    const z = Math.min((el.clientWidth - pad * 2) / size.w, (el.clientHeight - pad * 2) / size.h)
    setView({ z, x: (el.clientWidth - size.w * z) / 2, y: (el.clientHeight - size.h * z) / 2 })
  }, [size])

  useEffect(() => {
    if (size && !fitted.current) {
      fitted.current = true
      fit()
    }
  }, [size, fit])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const z = Math.min(MAX_Z, Math.max(0.05, v.z * factor))
      const k = z / v.z
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })
  }, [])

  /** Поставить в центр окна точку страницы (доли 0..1), масштаб сохраняется. */
  const centerOn = useCallback(
    (fx: number, fy: number) => {
      const el = box.current
      if (!el || !size) return
      const z = viewRef.current.z
      setView({ z, x: el.clientWidth / 2 - fx * size.w * z, y: el.clientHeight / 2 - fy * size.h * z })
    },
    [size],
  )

  const finishPoly = useCallback(() => {
    const pts = polyRef.current
    if (pts.length >= minPoly) {
      setPoly([])
      if (objectDraw) onObjectDrawn?.(pts)
      else onZoneDrawn?.(pts)
    }
  }, [onZoneDrawn, onObjectDrawn, objectDraw, minPoly])
  const undoPoint = useCallback(() => setPoly((p) => p.slice(0, -1)), [])
  const cancelDraw = useCallback(() => {
    setPoly([])
    onZoneCancel?.()
    onObjectCancel?.()
  }, [onZoneCancel, onObjectCancel])

  // клавиши при рисовании зоны или объекта: Enter — закончить, Backspace — убрать точку, Esc — отмена
  useEffect(() => {
    if (!drawing) return
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Enter' && polyMode) {
        e.preventDefault()
        finishPoly()
      } else if (e.key === 'Backspace' && polyMode && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        undoPoint()
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        cancelDraw()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawing, polyMode, finishPoly, undoPoint, cancelDraw])

  useImperativeHandle(
    handle,
    () => ({
      finishPoly,
      undoPoint,
      cancelDraw,
      fit,
      zoomBy: (factor) => {
        const el = box.current
        if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
      },
      focus: (x, y) => {
        const el = box.current
        if (!el || !size) return
        const z = Math.max(viewRef.current.z, Math.min(el.clientWidth / size.w, 1.2) * 1.6)
        setView({ z, x: el.clientWidth / 2 - x * size.w * z, y: el.clientHeight / 2 - y * size.h * z })
      },
    }),
    [fit, zoomAt, size, finishPoly, undoPoint, cancelDraw],
  )

  // ---- чёткость: перерисовываем PDF под текущий масштаб, когда он перестал меняться ----
  useEffect(() => {
    const t = setTimeout(() => setRenderZ(view.z), 220)
    return () => clearTimeout(t)
  }, [view.z])

  useEffect(() => {
    if (!pageProxy || !size || !canvas.current) return
    const dpr = window.devicePixelRatio || 1
    const maxScale = Math.sqrt(MAX_PIXELS / (size.w * size.h))
    const scale = Math.min(Math.max(renderZ * dpr, 1), maxScale)
    const vp = pageProxy.getViewport({ scale })
    // рисуем во внешний холст и переносим готовое: экран не мигает пустым
    const off = document.createElement('canvas')
    off.width = Math.ceil(vp.width)
    off.height = Math.ceil(vp.height)
    const task = pageProxy.render({ canvasContext: off.getContext('2d')!, viewport: vp, canvas: off })
    let cancelled = false
    task.promise.then(
      () => {
        const target = canvas.current
        if (cancelled || !target) return
        target.width = off.width
        target.height = off.height
        target.getContext('2d')!.drawImage(off, 0, 0)
        setRendered((n) => n + 1)
      },
      (e: unknown) => {
        // отмена отрисовки при смене масштаба — не ошибка; остальное покажем
        if ((e as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error('plan render failed', e)
          if (!cancelled) setError(tr('Не удалось нарисовать план. Попробуйте скачать файл из документа.'))
        }
      },
    )
    return () => {
      cancelled = true
      task.cancel()
    }
  }, [pageProxy, size, renderZ])

  // ---- колесо мыши: масштаб к точке под курсором ----
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ---- перетаскивание и щипок ----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<
    | { type: 'pan'; sx: number; sy: number; v: View; moved: boolean }
    | { type: 'pinch'; dist: number; cx: number; cy: number; v: View }
    | { type: 'draw'; fx: number; fy: number; sx: number; sy: number }
    | null
  >(null)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /** Экранная точка → доли страницы (могут выйти за 0..1 — ограничиваем при необходимости) */
  const toPage = (p: { x: number; y: number }) => {
    const v = viewRef.current
    return { x: (p.x - v.x) / v.z / size!.w, y: (p.y - v.y) / v.z / size!.h }
  }
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

  function down(e: React.PointerEvent) {
    box.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    const pts = [...pointers.current.values()]
    if (pts.length === 1 && size && ((mode !== 'view' && tool === 'area') || zoneDraw === 'rect' || placeMark?.tool === 'area')) {
      // область: тянем прямоугольник от точки нажатия
      const f = toPage(pts[0])
      gesture.current = { type: 'draw', fx: clamp01(f.x), fy: clamp01(f.y), sx: pts[0].x, sy: pts[0].y }
    } else if (pts.length === 1) gesture.current = { type: 'pan', sx: pts[0].x, sy: pts[0].y, v: viewRef.current, moved: false }
    else if (pts.length === 2) {
      setDraft(null)
      const [a, b] = pts
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: viewRef.current }
    }
  }

  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) {
      if (zones && zones.length > 0 && !drawing && mode === 'view' && size && e.pointerType === 'mouse') {
        const f = toPage(local(e))
        setHoverZone(hitZone(zones.filter((z) => z.page === page), f.x, f.y)?.id ?? null)
      }
      return
    }
    pointers.current.set(e.pointerId, local(e))
    const g = gesture.current
    if (!g) return
    const pts = [...pointers.current.values()]
    if (g.type === 'draw' && pts.length === 1 && size) {
      const f = toPage(pts[0])
      const x = clamp01(f.x)
      const y = clamp01(f.y)
      setDraft({ x: Math.min(g.fx, x), y: Math.min(g.fy, y), x2: Math.max(g.fx, x), y2: Math.max(g.fy, y) })
    } else if (g.type === 'pan' && pts.length === 1) {
      const dx = pts[0].x - g.sx
      const dy = pts[0].y - g.sy
      if (!g.moved && Math.hypot(dx, dy) > 5) g.moved = true
      if (g.moved) setView({ ...g.v, x: g.v.x + dx, y: g.v.y + dy })
    } else if (g.type === 'pinch' && pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const z = Math.min(MAX_Z, Math.max(0.05, g.v.z * (dist / g.dist)))
      const k = z / g.v.z
      setView({ z, x: cx - (g.cx - g.v.x) * k, y: cy - (g.cy - g.v.y) * k })
    }
  }

  function up(e: React.PointerEvent) {
    const g = gesture.current
    const wasSingle = pointers.current.size === 1
    const p = local(e)
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    if (g && g.type === 'draw') {
      const d = draft
      setDraft(null)
      // слишком маленький прямоугольник — случайное касание, не область
      if (wasSingle && d && Math.hypot(p.x - g.sx, p.y - g.sy) > 8 && d.x2 - d.x > 0.002 && d.y2 - d.y > 0.002) {
        if (zoneDraw === 'rect') onZoneDrawn?.(rectPoints(d.x, d.y, d.x2, d.y2))
        else if (placeMark) placeMark.onPlaceArea(d.x, d.y, d.x2, d.y2)
        else onPlaceArea(d.x, d.y, d.x2, d.y2)
      }
      return
    }
    if (!(g && g.type === 'pan' && wasSingle && !g.moved) || !size) return
    // короткий «тап»: ставим точку в режимах добавления и переноса, иначе снимаем выбор
    const v = viewRef.current
    const x = (p.x - v.x) / v.z / size.w
    const y = (p.y - v.y) / v.z / size.h
    if (placeMark) {
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) placeMark.onPlace(x, y)
      return
    }
    if (objectDraw === 'point') {
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onObjectDrawn?.([[x, y]])
      return
    }
    if (polyMode) {
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) addPoint(x, y, p.x, p.y)
      return
    }
    if (zoneDraw === 'rect') return
    if (mode === 'view') {
      // нажатие: сначала линия объекта (она тонкая), затем зона (у вложенных — меньшая), мимо — снимает выбор
      const line = objects && objects.length > 0 ? hitLine(objects.filter((o) => o.page === page), x, y, size.w, size.h, v.z) : null
      const hit = !line && zones && zones.length > 0 ? hitZone(zones.filter((z) => z.page === page), x, y) : null
      onSelect(null)
      onObjectSelect?.(line?.id ?? null)
      onZoneSelect?.(hit?.id ?? null)
    } else if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPlace(x, y)
  }

  /** Вершина многоугольника зоны; нажатие рядом с первой вершиной (при трёх и больше точках) замыкает фигуру. */
  function addPoint(fx: number, fy: number, sx: number, sy: number) {
    const cur = polyRef.current
    const v = viewRef.current
    if (cur.length >= 3 && !objectDraw) {
      const [x0, y0] = cur[0]!
      if (Math.hypot(v.x + x0 * size!.w * v.z - sx, v.y + y0 * size!.h * v.z - sy) < 14) {
        finishPoly()
        return
      }
    }
    setPoly([...cur, [clamp01(fx), clamp01(fy)]])
  }

  /** Перетаскивание точки объекта или вершины трассы: пока тянем — показываем новое положение, по отпусканию сообщаем наверх. */
  function dragMove(e: React.PointerEvent) {
    const g = dragRef.current
    if (!g || !size) return
    const f = toPage(local(e))
    const x = clamp01(f.x)
    const y = clamp01(f.y)
    const points: Point[] = g.index === null ? [[x, y]] : g.points.map((q, i) => (i === g.index ? ([x, y] as Point) : q))
    setDrag({ ...g, points, moved: g.moved || Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 3 })
  }
  function dragEnd() {
    const g = dragRef.current
    setDrag(null)
    if (g && g.moved) onObjectMove?.(g.id, g.points)
  }

  const stage: React.CSSProperties | undefined = size
    ? { width: size.w, height: size.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }
    : undefined

  return (
    <div
      ref={box}
      role="application"
      aria-label={tr('План. Перетаскивайте, чтобы сдвинуть; колесо мыши или щипок — масштаб')}
      className={`relative h-full min-h-72 touch-none select-none overflow-hidden rounded-lg border bg-muted/60 ${mode === 'view' && !drawing && !placeMark ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
      onPointerLeave={() => setHoverZone(null)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {error && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">{error}</p>}
      {!error && !size && <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">{tr('Открываем план…')}</p>}

      {stage && (
        <div className="absolute left-0 top-0 bg-white shadow-lg" style={stage}>
          {isPdf ? <canvas ref={canvas} className="block size-full" /> : <img src={url} alt={tr('План')} draggable={false} className="block size-full max-w-none" />}
          {size &&
            furniture?.marks
              .filter((m) => m.page === page)
              .map((m) => {
                const area = m.x2 !== null && m.y2 !== null
                const live = !placeMark && mode === 'view'
                const pill = (
                  <button
                    type="button"
                    title={m.label}
                    aria-label={m.label}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      furniture.onOpen(m.id)
                    }}
                    className={`flex min-h-7 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold leading-none text-white shadow-md outline-none ring-2 ring-white focus-visible:ring-4 focus-visible:ring-ring ${m.out ? 'bg-amber-600' : 'bg-teal-600'}`}
                  >
                    {m.label}
                  </button>
                )
                if (area) {
                  return (
                    <div
                      key={`mark-${m.id}`}
                      className="absolute z-[5]"
                      style={{
                        left: m.x * size.w,
                        top: m.y * size.h,
                        width: (m.x2! - m.x) * size.w,
                        height: (m.y2! - m.y) * size.h,
                        backgroundColor: m.out ? 'rgba(245, 158, 11, 0.18)' : 'rgba(13, 148, 136, 0.18)',
                        outline: `${Math.max(1, 2 / view.z)}px ${m.out ? 'dashed #d97706' : 'solid #0d9488'}`,
                        pointerEvents: 'none',
                      }}
                    >
                      <div className="absolute left-0 top-0" style={{ transform: `translate(0, -100%) scale(${1 / view.z})`, transformOrigin: '0 100%', pointerEvents: live ? 'auto' : 'none' }}>
                        {pill}
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={`mark-${m.id}`} className="absolute z-[5]" style={{ left: m.x * size.w, top: m.y * size.h, transform: `translate(-50%, -50%) scale(${1 / view.z})`, transformOrigin: '50% 50%', pointerEvents: live ? 'auto' : 'none' }}>
                    {pill}
                  </div>
                )
              })}
          {size &&
            hits &&
            !dismissed &&
            hits
              .filter((h) => h.page === page)
              .map((h, i) => {
                const on = hit === h
                return (
                  <div
                    key={`hit-${i}`}
                    aria-hidden
                    className={`pointer-events-none absolute z-[4] rounded-sm ${on ? 'animate-pulse' : ''}`}
                    style={{
                      left: h.x * size.w,
                      top: h.y * size.h,
                      width: h.w * size.w,
                      height: h.h * size.h,
                      backgroundColor: on ? 'rgba(250, 204, 21, 0.55)' : 'rgba(250, 204, 21, 0.35)',
                      outline: `${Math.max(1, (on ? 2.5 : 1.5) / view.z)}px solid ${on ? '#ca8a04' : '#eab308'}`,
                      outlineOffset: `${1 / view.z}px`,
                    }}
                  />
                )
              })}
          {size && (zones?.some((z) => z.page === page) || poly.length > 0 || (ghostLine && ghostLine.length > 1) || objects?.some((o) => o.page === page && o.geometry === 'line')) && (
            <svg className="pointer-events-none absolute left-0 top-0" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden>
              {zones
                ?.filter((z) => z.page === page)
                .map((z) => {
                  const c = zoneColor?.(z) ?? '#475569'
                  const sel = z.id === selectedZoneId
                  const hov = z.id === hoverZone
                  return (
                    <polygon
                      key={z.id}
                      points={z.points.map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')}
                      fill={c}
                      fillOpacity={sel ? 0.55 : hov ? 0.48 : 0.3}
                      stroke={sel ? '#111827' : c}
                      strokeWidth={sel ? 3 : hov ? 2.5 : 1.5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
              {objects
                ?.filter((o) => o.page === page && o.geometry === 'line')
                .map((o) => {
                  const t = objectType(o.type_code, 'line')
                  const sel = o.id === selectedObjectId
                  const pts = (drag && drag.id === o.id ? drag.points : o.points).map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')
                  return (
                    <g key={o.id}>
                      {sel && <polyline points={pts} fill="none" stroke="#111827" strokeOpacity={0.35} strokeWidth={(t.width ?? 2.5) + 6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={o.status === 'defect' ? OBJECT_STATUS_COLORS.defect : objectColor(t, o.color)}
                        strokeWidth={t.width ?? 2.5}
                        strokeDasharray={o.status === 'planned' ? '2 5' : t.dash}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )
                })}
              {ghostLine && ghostLine.length > 1 && (
                <>
                  <polyline points={ghostLine.map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')} fill="none" stroke="#b45309" strokeWidth={3} strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  {ghostLine.map(([px, py], i) => (
                    <circle key={i} cx={px * size.w} cy={py * size.h} r={4.5 / view.z} fill="#fff" stroke="#b45309" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  ))}
                </>
              )}
              {poly.length > 0 && objectDraw === 'line' && (
                <>
                  <polyline points={poly.map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')} fill="none" stroke="#1d4ed8" strokeWidth={3} strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  {poly.map(([px, py], i) => (
                    <circle key={i} cx={px * size.w} cy={py * size.h} r={4.5 / view.z} fill="#fff" stroke="#1d4ed8" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  ))}
                </>
              )}
              {poly.length > 0 && !objectDraw && (
                <>
                  <polygon points={poly.map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')} fill="#2563eb" fillOpacity={0.18} stroke="#1d4ed8" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                  {poly.map(([px, py], i) => (
                    <circle key={i} cx={px * size.w} cy={py * size.h} r={(i === 0 ? 7 : 4.5) / view.z} fill={i === 0 ? '#1d4ed8' : '#fff'} stroke="#1d4ed8" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  ))}
                </>
              )}
            </svg>
          )}
          {size &&
            zones
              ?.filter((z) => z.page === page && polygonArea(z.points) * size.w * size.h * view.z * view.z > 1100)
              .map((z) => {
                const [cx, cy] = centroid(z.points)
                return (
                  <div
                    key={`label-${z.id}`}
                    className="pointer-events-none absolute z-[3] whitespace-nowrap text-xs font-semibold text-slate-900"
                    style={{ left: cx * size.w, top: cy * size.h, transform: `translate(-50%, -50%) scale(${1 / view.z})`, transformOrigin: '50% 50%', textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff' }}
                  >
                    {zoneShortName(z)}
                  </div>
                )
              })}
          {size &&
            objects
              ?.filter((o) => o.page === page && o.geometry === 'point')
              .map((o) => {
                const t = objectType(o.type_code, 'point')
                const Icon = objectIcon(t, o.variant)
                const color = objectColor(t, o.color)
                const caption = [o.label, ...specTexts(t, o.specs)].filter(Boolean).join(' · ')
                const sel = o.id === selectedObjectId
                const ring = OBJECT_STATUS_COLORS[o.status]
                const [ox, oy] = (drag && drag.id === o.id ? drag.points : o.points)[0]!
                const v = objectVariant(t, o.variant)
                const fov = t.directional ? (o.variant ? v?.fov : 90) : undefined
                const sz = o.size || 1
                const R = 46 * sz
                const half = Math.min(fov ?? 0, 359) / 2
                const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
                const wedge =
                  fov === undefined
                    ? null
                    : fov >= 360
                      ? `M ${R} 0 A ${R} ${R} 0 1 1 ${R - 0.01} 0 Z`
                      : `M ${R} ${R} L ${R + R * Math.cos(rad(-half))} ${R + R * Math.sin(rad(-half))} A ${R} ${R} 0 0 1 ${R + R * Math.cos(rad(half))} ${R + R * Math.sin(rad(half))} Z`
                const canMove = !!objectsEditable && sel && !drawing && mode === 'view'
                return (
                  <div
                    key={o.id}
                    className="absolute"
                    style={{ left: ox * size.w, top: oy * size.h, transform: `translate(-50%, -50%) scale(${1 / view.z})`, transformOrigin: '50% 50%', zIndex: sel ? 6 : 3, pointerEvents: drawing || mode !== 'view' ? 'none' : 'auto' }}
                  >
                    {wedge && (
                      <svg width={2 * R} height={2 * R} viewBox={`0 0 ${2 * R} ${2 * R}`} className="pointer-events-none absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) rotate(${o.rotation}deg)` }} aria-hidden>
                        <path d={wedge} fill={color} fillOpacity={sel ? 0.3 : 0.18} stroke={color} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray={fov! >= 360 ? '4 3' : undefined} />
                      </svg>
                    )}
                    <button
                      type="button"
                      aria-label={`${t.name}${o.label ? ` ${o.label}` : ''}`}
                      title={`${t.name}${v ? ` (${v.name})` : ''}${caption ? ` · ${caption}` : ''}`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (!canMove || e.button !== 0) return
                        e.currentTarget.setPointerCapture(e.pointerId)
                        setDrag({ id: o.id, index: null, points: o.points, sx: e.clientX, sy: e.clientY, moved: false })
                      }}
                      onPointerMove={dragMove}
                      onPointerUp={(e) => {
                        e.stopPropagation()
                        dragEnd()
                      }}
                      onPointerCancel={() => setDrag(null)}
                      onClick={(e) => {
                        e.stopPropagation()
                        onObjectSelect?.(o.id)
                        onSelect(null)
                        onZoneSelect?.(null)
                      }}
                      className={`relative flex items-center justify-center rounded-full text-white shadow-md outline-none focus-visible:ring-4 focus-visible:ring-ring ${sel ? 'scale-125' : ''} ${canMove ? 'cursor-move touch-none' : ''}`}
                      style={{
                        width: 28 * sz,
                        height: 28 * sz,
                        backgroundColor: color,
                        boxShadow: `0 0 0 ${sel ? 4 : 2.5}px ${ring}${sel ? '' : 'cc'}, 0 1px 4px rgba(0,0,0,.35)`,
                        borderStyle: o.status === 'planned' ? 'dashed' : 'solid',
                      }}
                    >
                      {Icon && <Icon aria-hidden style={{ width: 16 * sz, height: 16 * sz }} />}
                    </button>
                    {caption && (sel || view.z >= 1) && (
                      <span
                        className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-semibold leading-4 text-slate-900 shadow-sm"
                        style={{ marginTop: 6 + (sz - 1) * 8 }}
                      >
                        {caption}
                      </span>
                    )}
                  </div>
                )
              })}
          {size &&
            objectsEditable &&
            mode === 'view' &&
            !drawing &&
            objects
              ?.filter((o) => o.id === selectedObjectId && o.page === page && o.geometry === 'line')
              .flatMap((o) =>
                (drag && drag.id === o.id ? drag.points : o.points).map(([vx, vy], i) => (
                  <div
                    key={`${o.id}-v${i}`}
                    className="absolute z-[7]"
                    style={{ left: vx * size.w, top: vy * size.h, transform: `translate(-50%, -50%) scale(${1 / view.z})`, transformOrigin: '50% 50%' }}
                  >
                    <button
                      type="button"
                      aria-label={tr('Вершина {{n}}: перетащите', { n: i + 1 })}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (e.button !== 0) return
                        e.currentTarget.setPointerCapture(e.pointerId)
                        setDrag({ id: o.id, index: i, points: o.points, sx: e.clientX, sy: e.clientY, moved: false })
                      }}
                      onPointerMove={dragMove}
                      onPointerUp={(e) => {
                        e.stopPropagation()
                        dragEnd()
                      }}
                      onPointerCancel={() => setDrag(null)}
                      onClick={(e) => e.stopPropagation()}
                      className="block size-4 cursor-move touch-none rounded-full border-2 border-foreground bg-white shadow outline-none focus-visible:ring-4 focus-visible:ring-ring"
                    />
                  </div>
                )),
              )}
          {pins.map((p) => {
            const t = p.task!
            const tone = pinTone(t)
            const selected = p.id === selectedId
            const n = pinNumber(p)
            const select = (e: React.SyntheticEvent) => {
              e.stopPropagation()
              onSelect(p.id)
            }
            const isArea = p.x2 !== null && p.y2 !== null
            const badge = (
              <button
                type="button"
                aria-label={`${t.key}: ${t.title} (${tone.label})`}
                title={`${t.key} · ${t.title}`}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={select}
                className={`relative flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums shadow-md outline-none ring-2 ring-white focus-visible:ring-4 focus-visible:ring-ring ${tone.className} ${selected ? 'scale-125 ring-4 ring-foreground/70' : ''}`}
              >
                {n}
                {!isArea && <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-inherit" aria-hidden />}
              </button>
            )
            if (isArea) {
              // область: рамка с заливкой, номер — на левом верхнем углу
              const border = Math.max(1.5, (selected ? 3.5 : 2) / view.z)
              return (
                <div
                  key={p.id}
                  className="absolute"
                  style={{
                    left: Number(p.x) * size!.w,
                    top: Number(p.y) * size!.h,
                    width: (Number(p.x2) - Number(p.x)) * size!.w,
                    height: (Number(p.y2) - Number(p.y)) * size!.h,
                    border: `${border}px ${selected ? 'solid' : 'dashed'} ${tone.color}`,
                    backgroundColor: `${tone.color}${selected ? '33' : '1f'}`,
                    pointerEvents: mode === 'view' ? 'auto' : 'none',
                    zIndex: selected ? 5 : 2,
                  }}
                  onPointerDown={mode === 'view' ? (e) => e.stopPropagation() : undefined}
                  onPointerUp={mode === 'view' ? (e) => e.stopPropagation() : undefined}
                  onClick={mode === 'view' ? select : undefined}
                >
                  <div className="absolute left-0 top-0" style={{ transform: `translate(-${border}px, -100%) scale(${1 / view.z})`, transformOrigin: '0 100%', pointerEvents: 'auto' }}>
                    {badge}
                  </div>
                </div>
              )
            }
            return (
              <div
                key={p.id}
                className="absolute"
                style={{ left: Number(p.x) * size!.w, top: Number(p.y) * size!.h, transform: `translate(-50%, -100%) scale(${1 / view.z})`, transformOrigin: '50% 100%', zIndex: selected ? 5 : 2 }}
              >
                {badge}
              </div>
            )
          })}
          {pending && pending.x2 === undefined && (
            <div className="pointer-events-none absolute z-10" style={{ left: pending.x * size!.w, top: pending.y * size!.h, transform: `translate(-50%, -100%) scale(${1 / view.z})`, transformOrigin: '50% 100%' }}>
              <span className="block size-7 animate-pulse rounded-full border-2 border-dashed border-foreground bg-signal/60" aria-label={tr('Новая отметка')} />
            </div>
          )}
          {[pending && pending.x2 !== undefined ? { x: pending.x, y: pending.y, x2: pending.x2, y2: pending.y2! } : null, draft].map(
            (r, i) =>
              r && (
                <div
                  key={i}
                  className="pointer-events-none absolute z-10 bg-signal/25"
                  style={{
                    left: r.x * size!.w,
                    top: r.y * size!.h,
                    width: (r.x2 - r.x) * size!.w,
                    height: (r.y2 - r.y) * size!.h,
                    border: `${Math.max(1.5, 2 / view.z)}px dashed #111`,
                  }}
                  aria-label={tr('Новая область')}
                />
              ),
          )}
        </div>
      )}

      {size && (
        <Minimap
          size={size}
          view={view}
          box={boxSize}
          source={isPdf ? canvas : null}
          imageUrl={isPdf ? null : url}
          rendered={rendered}
          pins={pins}
          selectedId={selectedId}
          onCenter={centerOn}
        />
      )}

      {highlight && words && !drawing && mode === 'view' && !dismissed && isPdf && (
        <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border bg-card/95 p-1 pl-3 text-xs shadow" role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          {!searchDone ? (
            <span className="py-1">{tr('Ищем «{{q}}» на листах…', { q: words })}</span>
          ) : hits && hits.length > 0 ? (
            <>
              <span className="py-1 tabular-nums">{tr('«{{q}}»: {{i}} из {{n}}, лист {{p}}', { q: words, i: Math.min(active, hits.length - 1) + 1, n: hits.length, p: hit?.page ?? page })}</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Предыдущее совпадение')} onClick={() => goHit(active - 1)}>
                <ChevronLeft />
              </Button>
              <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Следующее совпадение')} onClick={() => goHit(active + 1)}>
                <ChevronRight />
              </Button>
            </>
          ) : (
            <span className="py-1">{tr('«{{q}}» на листах не найдено: у этого PDF нет текстового слоя (скан) или слова в нём нет.', { q: words })}</span>
          )}
          <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать подсветку')} onClick={() => setDismissed(true)}>
            <X />
          </Button>
        </div>
      )}

      {mode !== 'view' && (
        <div
          className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <div className="inline-flex rounded-lg border bg-card p-0.5 shadow" role="group" aria-label={tr('Чем отметить')}>
            <Button size="sm" variant={tool === 'point' ? 'secondary' : 'ghost'} aria-pressed={tool === 'point'} onClick={() => onTool('point')}>
              <MapPin />{tr('Точка')}</Button>
            <Button size="sm" variant={tool === 'area' ? 'secondary' : 'ghost'} aria-pressed={tool === 'area'} onClick={() => onTool('area')}>
              <Square />{tr('Область')}</Button>
          </div>
          <span className="rounded-md bg-card/95 px-2 py-1 text-xs shadow">{tool === 'point' ? tr('Нажмите на место на плане') : tr('Обведите область, удерживая кнопку')}</span>
        </div>
      )}

      {placeMark && (
        <div className="absolute left-3 top-3 z-20 max-w-[calc(100%-1.5rem)]" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span className="rounded-md bg-card/95 px-2 py-1 text-xs shadow">{placeMark.hint}</span>
        </div>
      )}

      {drawing && (
        <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span className="rounded-md bg-card/95 px-2 py-1 text-xs shadow">{objectDraw ? objectHint : zoneHint}</span>
          {polyMode && (
            <div className="inline-flex rounded-lg border bg-card p-0.5 shadow">
              <Button size="sm" variant="ghost" disabled={poly.length < minPoly} onClick={finishPoly}>
                {tr('Готово')}
              </Button>
              <Button size="sm" variant="ghost" disabled={poly.length === 0} onClick={undoPoint}>
                {tr('Убрать точку')}
              </Button>
            </div>
          )}
          <Button size="sm" variant="secondary" className="shadow" onClick={cancelDraw}>
            {tr('Отмена')}
          </Button>
        </div>
      )}

      {pages > 1 && (
        <div
          className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card/95 p-1 shadow"
          role="group"
          aria-label={tr('Страницы плана')}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <Button size="icon" variant="ghost" className="size-8 rounded-full" disabled={page <= 1} aria-label={tr('Предыдущая страница')} onClick={() => onPage(page - 1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-14 text-center text-sm tabular-nums" aria-live="polite">
            {page} / {pages}
          </span>
          <Button size="icon" variant="ghost" className="size-8 rounded-full" disabled={page >= pages} aria-label={tr('Следующая страница')} onClick={() => onPage(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <Button size="icon" variant="secondary" className="shadow" aria-label={tr('Приблизить')} onClick={() => box.current && zoomAt(1.4, box.current.clientWidth / 2, box.current.clientHeight / 2)}>
          <Plus />
        </Button>
        <Button size="icon" variant="secondary" className="shadow" aria-label={tr('Отдалить')} onClick={() => box.current && zoomAt(1 / 1.4, box.current.clientWidth / 2, box.current.clientHeight / 2)}>
          <Minus />
        </Button>
        <Button size="icon" variant="secondary" className="shadow" aria-label={tr('Вписать в экран')} onClick={fit}>
          <Maximize2 />
        </Button>
      </div>
    </div>
  )
}

/** Миникарта: появляется, когда план увеличен так, что виден не весь лист. Рамка — видимая часть; нажатие и перетаскивание двигают вид. */
function Minimap({
  size,
  view,
  box,
  source,
  imageUrl,
  rendered,
  pins,
  selectedId,
  onCenter,
}: {
  size: { w: number; h: number }
  view: View
  box: { w: number; h: number }
  source: React.RefObject<HTMLCanvasElement | null> | null
  imageUrl: string | null
  rendered: number
  pins: PinRow[]
  selectedId: string | null
  onCenter: (fx: number, fy: number) => void
}) {
  const thumb = useRef<HTMLCanvasElement>(null)
  const maxW = box.w > 0 && box.w < 520 ? 88 : 168
  const k = Math.min(maxW / size.w, (maxW * 0.75) / size.h)
  const w = Math.max(1, Math.round(size.w * k))
  const h = Math.max(1, Math.round(size.h * k))

  // видимая часть листа в долях страницы
  const vx = -view.x / view.z / size.w
  const vy = -view.y / view.z / size.h
  const vw = box.w / view.z / size.w
  const vh = box.h / view.z / size.h
  const zoomedIn = box.w > 0 && (vw < 0.94 || vh < 0.94)

  useEffect(() => {
    const src = source?.current
    const dst = thumb.current
    if (!zoomedIn || !src || !dst || src.width === 0) return
    const ctx = dst.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, dst.width, dst.height)
    ctx.drawImage(src, 0, 0, dst.width, dst.height)
  }, [source, rendered, zoomedIn, w, h])

  const dragging = useRef(false)
  const jump = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onCenter(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }

  if (!zoomedIn) return null

  const rx = Math.max(0, vx)
  const ry = Math.max(0, vy)
  const rw = Math.min(1, vx + vw) - rx
  const rh = Math.min(1, vy + vh) - ry

  return (
    <div
      role="img"
      aria-label={tr('Миникарта: нажмите или перетащите рамку, чтобы перейти к другой части плана')}
      className="absolute bottom-3 left-3 z-20 cursor-pointer touch-none overflow-hidden rounded-md border bg-white shadow-md ring-1 ring-black/5"
      style={{ width: w, height: h }}
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        jump(e)
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        if (dragging.current) jump(e)
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        dragging.current = false
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    >
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} className="size-full select-none" /> : <canvas ref={thumb} width={w} height={h} className="size-full" />}
      {pins.map((p) => {
        const t = p.task
        if (!t) return null
        const sel = p.id === selectedId
        return (
          <span
            key={p.id}
            className={`pointer-events-none absolute rounded-full ring-1 ring-white ${sel ? 'size-2.5' : 'size-1.5'}`}
            style={{ left: `${Number(p.x) * 100}%`, top: `${Number(p.y) * 100}%`, transform: 'translate(-50%, -50%)', backgroundColor: pinTone(t).color }}
          />
        )
      })}
      <span
        className="pointer-events-none absolute border-2 border-blue-600 bg-blue-600/15"
        style={{ left: `${rx * 100}%`, top: `${ry * 100}%`, width: `${Math.max(rw, 0) * 100}%`, height: `${Math.max(rh, 0) * 100}%` }}
      />
    </div>
  )
}
