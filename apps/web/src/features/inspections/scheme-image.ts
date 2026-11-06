import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'

/** Файл схемы: картинка или PDF (первая страница). */
export interface SchemeSource {
  storageKey: string
  mime: string
}

async function renderPdfFirstPage(blob: Blob, width: number): Promise<Blob> {
  // pdf.js тяжёлый: подгружаем его, только когда схему из PDF действительно надо показать
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    // планы бывают огромными (A0): ограничиваем и ширину, и высоту, чтобы канвас не вышел за пределы браузера
    const scale = Math.min(width / base.width, (width * 1.6) / base.height)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!out) throw new Error('toBlob')
    return out
  } finally {
    void task.destroy()
  }
}

/**
 * Адрес картинки схемы. Для обычной картинки это временная ссылка на файл, для PDF — страница, нарисованная в браузере
 * (результат запоминается, повторно PDF не разбирается). Точки замечаний лежат в долях ширины и высоты, поэтому не зависят от `width`.
 */
export const schemeImageQuery = (src: SchemeSource | null, width = 1600) =>
  queryOptions({
    queryKey: ['scheme-image', src?.storageKey ?? '', src?.mime === 'application/pdf' ? width : 0],
    enabled: !!src,
    staleTime: src?.mime === 'application/pdf' ? Infinity : 45 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async (): Promise<string> => {
      if (src!.mime === 'application/pdf') {
        // отрисованная страница хранится в кэше браузера (Cache API): большой чертёж рисуется один раз, дальше показ мгновенный
        const cacheKey = `/__scheme/${encodeURIComponent(src!.storageKey)}/${width}`
        const cache = typeof caches !== 'undefined' ? await caches.open('inspection-schemes-v1').catch(() => null) : null
        const hit = await cache?.match(cacheKey).catch(() => undefined)
        if (hit) return URL.createObjectURL(await hit.blob())
        const { data: blob, error } = await supabase.storage.from(FILES_BUCKET).download(src!.storageKey)
        if (error || !blob) throw error ?? new Error('download')
        const jpeg = await renderPdfFirstPage(blob, width)
        void cache?.put(cacheKey, new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } })).catch(() => undefined)
        return URL.createObjectURL(jpeg)
      }
      const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(src!.storageKey, 3600)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })
