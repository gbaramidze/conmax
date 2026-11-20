import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { OfficeViewer } from '@/features/documents/office-viewer'
import { OFFICE_MAX_BYTES, officeKind, type OfficeKind } from '@/features/documents/office'
import { downloadAttachment, mailAttachmentQuery, mailErrorText, type MailAttachment } from '@/features/mail/api'
import { tr } from '@/lib/tr'

/**
 * Просмотр вложений письма прямо в почте, без скачивания: фото, PDF (pdf.js — тот же, что у документов), Word (.docx),
 * Excel и CSV, текст. Файл приходит через функцию почты и разбирается в браузере, никуда больше не отправляется.
 * Стрелки (и клавиши ← →) листают просматриваемые вложения письма, «Скачать» сохраняет файл.
 */

type Look = { kind: 'image' } | { kind: 'pdf' } | { kind: 'office'; office: OfficeKind }

const PDF_MAX_BYTES = 30 * 1024 * 1024

/** Что можно показать на экране; остальное — только скачать. */
export function viewable(a: MailAttachment): Look | null {
  const name = a.name.toLowerCase()
  const type = (a.content_type || '').toLowerCase()
  if (type.startsWith('image/') && !/svg|tiff/.test(type)) return { kind: 'image' }
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return { kind: 'image' }
  if ((type === 'application/pdf' || name.endsWith('.pdf')) && a.size <= PDF_MAX_BYTES) return { kind: 'pdf' }
  const office = officeKind(a.name, a.content_type)
  if (office && a.size <= OFFICE_MAX_BYTES) return { kind: 'office', office }
  return null
}

export function AttachmentViewer({ messageId, files, start, onClose }: { messageId: string; files: MailAttachment[]; start: number; onClose: () => void }) {
  const list = useMemo(() => files.filter((f) => viewable(f)), [files])
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((f) => f.id === files[start]?.id)))
  const file = list[index]
  const look = file ? viewable(file) : null
  const { data: blob, isPending, error } = useQuery({ ...mailAttachmentQuery(messageId, file ?? files[0]), enabled: !!file })
  const go = (d: number) => setIndex((i) => (i + d + list.length) % list.length)

  if (!file || !look) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100svh] max-h-[100svh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[94svh] sm:max-h-[94svh] sm:w-[94vw] sm:max-w-none sm:rounded-xl"
        onKeyDown={(e) => {
          if (list.length < 2 || (e.target as HTMLElement).closest('input, textarea')) return
          if (e.key === 'ArrowLeft') go(-1)
          if (e.key === 'ArrowRight') go(1)
        }}
      >
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
          {list.length > 1 && (
            <>
              <Button type="button" variant="ghost" size="icon" aria-label={tr('Предыдущее вложение')} onClick={() => go(-1)}>
                <ChevronLeft />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {index + 1} / {list.length}
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label={tr('Следующее вложение')} onClick={() => go(1)}>
                <ChevronRight />
              </Button>
            </>
          )}
          <DialogTitle className="min-w-0 flex-1 truncate px-2 text-sm font-medium">{file.name}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Просмотр вложения письма')}</DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void downloadAttachment(messageId, file, blob).catch((e) => toast.error(mailErrorText(e)))}
          >
            <Download />
            <span className="max-sm:sr-only">{tr('Скачать')}</span>
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={tr('Закрыть')} onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="relative min-h-0 flex-1 bg-muted/40">
          {isPending && <p className="grid h-full place-items-center text-sm text-muted-foreground">{tr('Открываем файл…')}</p>}
          {error && <p className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{mailErrorText(error)}</p>}
          {blob && look.kind === 'image' && <ImageView key={file.id} blob={blob} name={file.name} />}
          {blob && look.kind === 'pdf' && <PdfView key={file.id} blob={blob} />}
          {blob && look.kind === 'office' && (
            <div className="h-full bg-card">
              <OfficeViewer key={file.id} blob={blob} cacheKey={`mail:${messageId}:${file.id}`} name={file.name} kind={look.office} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useObjectUrl(blob: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

function ImageView({ blob, name }: { blob: Blob; name: string }) {
  const url = useObjectUrl(blob)
  return <div className="grid h-full place-items-center overflow-auto p-2">{url && <img src={url} alt={name} className="max-h-full max-w-full object-contain" />}</div>
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> }
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas?: HTMLCanvasElement }) => { promise: Promise<void>; cancel: () => void }
}

/** PDF постранично: страницы рисуются, когда до них докрутили; масштаб — по ширине окна, кнопки «−» / «+». */
function PdfView({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let alive = true
    let loaded: PdfDoc | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true })
        loaded = (await task.promise) as unknown as PdfDoc
        if (alive) setDoc(loaded)
        else void loaded.destroy()
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
      if (loaded) void loaded.destroy()
    }
  }, [blob])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pageWidth = Math.max(240, Math.min(1100, width - 32) * zoom)
  return (
    <div ref={box} className="h-full overflow-auto">
      {failed && <p className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{tr('Не удалось открыть PDF. Скачайте файл и откройте его в программе.')}</p>}
      {!doc && !failed && <p className="grid h-full place-items-center text-sm text-muted-foreground">{tr('Открываем файл…')}</p>}
      {doc && width > 0 && (
        <div className="flex flex-col items-center gap-3 px-4 py-4">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPageView key={i} doc={doc} n={i + 1} width={pageWidth} />
          ))}
        </div>
      )}
      {doc && (
        <div className="sticky bottom-3 left-0 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border bg-card px-1 py-0.5 shadow-md">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Уменьшить')} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
              <Minus />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Увеличить')} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
              <Plus />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function PdfPageView({ doc, n, width }: { doc: PdfDoc; n: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(n <= 2)
  const [ratio, setRatio] = useState(1.414)

  useEffect(() => {
    const el = holder.current
    if (!el || visible) return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

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

  return (
    <div ref={holder} className="bg-white shadow-sm ring-1 ring-black/10" style={{ width, height: width * ratio }}>
      <canvas ref={canvas} className="block h-full w-full" aria-label={tr('Страница {{n}}', { n })} />
    </div>
  )
}
