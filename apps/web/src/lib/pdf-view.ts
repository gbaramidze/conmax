import { useEffect, useRef, useState } from 'react'

/**
 * Показ PDF в браузере (pdf.js): загрузка документа, отрисовка страницы в canvas, ленивый показ страниц.
 * Общее для просмотра вложений и окна подписи.
 */

export type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> }
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas?: HTMLCanvasElement }) => { promise: Promise<void>; cancel: () => void }
}

/** Документ из файла. Закрывается через задачу загрузки: у документа в pdf.js 6 своего destroy нет. */
export function usePdfDoc(blob: Blob) {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let task: { destroy?: () => Promise<void> } | null = null
    const close = () => void task?.destroy?.().catch(() => {})
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        const loading = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true })
        task = loading as unknown as { destroy?: () => Promise<void> }
        const loaded = (await loading.promise) as unknown as PdfDoc
        if (alive) setDoc(loaded)
        else close()
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
      close()
    }
  }, [blob])
  return { doc, failed }
}

/** Рисует страницу PDF в canvas нужной ширины, когда `visible`; ratio — высота к ширине. */
export function usePageCanvas(doc: PdfDoc, n: number, width: number, visible: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ratio, setRatio] = useState(1.414)
  useEffect(() => {
    if (!visible) return
    let task: { promise: Promise<void>; cancel: () => void } | null = null
    let alive = true
    void doc.getPage(n).then((page) => {
      if (!alive || !canvas.current) return
      const base = page.getViewport({ scale: 1 })
      setRatio(base.height / base.width)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      const c = canvas.current
      c.width = Math.floor(viewport.width)
      c.height = Math.floor(viewport.height)
      const ctx = c.getContext('2d')
      if (!ctx) return
      task = page.render({ canvasContext: ctx, viewport, canvas: c })
      task.promise.catch(() => {})
    })
    return () => {
      alive = false
      task?.cancel()
    }
  }, [doc, n, width, visible])
  return { canvas, ratio }
}

/** Становится true, когда элемент подошёл к видимой области (и остаётся true). */
export function useNear(margin: string, initial = false) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  return { ref, near }
}
