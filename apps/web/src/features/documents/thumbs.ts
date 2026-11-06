import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'

/** Ширина миниатюры в пикселях: хватает для плотного экрана в строке реестра и для крупного просмотра при наведении. */
const WIDTH = 640

export const thumbPath = (storageKey: string) => `${storageKey}.thumb.jpg`

/** Для каких файлов миниатюра рисуется в браузере: PDF и обычные картинки. */
export const canThumb = (mime: string | null | undefined) => mime === 'application/pdf' || /^image\/(png|jpe?g|webp|gif)$/.test(mime ?? '')

export const thumbUrlQuery = (storageKey: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['doc-thumb', storageKey],
    enabled,
    retry: false,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(thumbPath(storageKey), 3600)
      if (error) throw error
      return data.signedUrl
    },
  })

async function pdfFirstPage(blob: Blob): Promise<HTMLCanvasElement> {
  // pdf.js тяжёлый: подгружаем его только когда миниатюру действительно надо нарисовать
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    return canvas
  } finally {
    void task.destroy()
  }
}

async function imageCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, WIDTH / bmp.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * k))
  canvas.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas
}

export interface ThumbSource {
  fileId: string
  storageKey: string
  mime: string
}

async function render(src: ThumbSource): Promise<void> {
  const { data: blob, error } = await supabase.storage.from(FILES_BUCKET).download(src.storageKey)
  if (error || !blob) throw error ?? new Error('download')
  const canvas = src.mime === 'application/pdf' ? await pdfFirstPage(blob) : await imageCanvas(blob)
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
  if (!jpeg) throw new Error('toBlob')
  const { error: upErr } = await supabase.storage.from(FILES_BUCKET).upload(thumbPath(src.storageKey), jpeg, { contentType: 'image/jpeg' })
  // уже загружена другим окном — не беда, остаётся отметить
  if (upErr && !/exists|duplicate/i.test(upErr.message)) throw upErr
  const { error: markErr } = await supabase.rpc('file_thumb_mark', { p_file: src.fileId })
  if (markErr) throw markErr
}

// Рисуем по одной, чтобы реестр на сотни документов не съел память и канал; неудачный файл не пробуем повторно до перезагрузки
let queue: Promise<unknown> = Promise.resolve()
const attempted = new Set<string>()

/** Нарисовать и сохранить миниатюру файла. Возвращает true, если она теперь есть. */
export function generateThumb(src: ThumbSource): Promise<boolean> {
  if (attempted.has(src.storageKey)) return Promise.resolve(false)
  attempted.add(src.storageKey)
  const job = queue.then(() => render(src)).then(
    () => true,
    () => false,
  )
  queue = job
  return job
}
