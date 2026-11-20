import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  Forward,
  Reply,
  ReplyAll,
  Signature,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FolderInput,
  Loader2,
  MapIcon,
  Minus,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Printer,
  X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { FileTypeIcon } from '@/components/file-type-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OfficeViewer, officePrintHtml } from '@/features/documents/office-viewer'
import { OFFICE_MAX_BYTES, officeKind, type OfficeKind } from '@/features/documents/office'
import { downloadAttachment, mailAttachmentQuery, mailErrorText, type ComposeMode, type MailAttachment } from '@/features/mail/api'
import { SaveToDocumentsDialog } from '@/features/mail/save-to-documents'
import { useAuth } from '@/features/auth/auth-provider'
import { recordSignature } from '@/features/signatures/api'
import { SignPdfDialog } from '@/features/signatures/sign-pdf-dialog'
import { usePageCanvas, useNear, usePdfDoc, type PdfDoc } from '@/lib/pdf-view'
import { printHtml, printImage, printPdf } from '@/lib/print-file'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Просмотр вложений письма прямо в почте, без скачивания: фото, PDF (pdf.js — тот же, что у документов), Word (.docx),
 * Excel и CSV, текст. Файл приходит через функцию почты и разбирается в браузере, никуда больше не отправляется.
 * Стрелки (и клавиши ← →) листают просматриваемые вложения письма; «Печать», «Скачать» и «В документы» (сохранить
 * в папку документов проекта). У PDF — миниатюры страниц слева, номер страницы и мини-карта видимой части листа.
 */

type Look = { kind: 'image' } | { kind: 'pdf' } | { kind: 'office'; office: OfficeKind }

const PDF_MAX_BYTES = 30 * 1024 * 1024

/** Что можно показать на экране; остальное — только скачать. */
export function viewable(a: Pick<MailAttachment, 'name' | 'content_type' | 'size'>): Look | null {
  const name = a.name.toLowerCase()
  const type = (a.content_type || '').toLowerCase()
  if (type.startsWith('image/') && !/svg|tiff/.test(type)) return { kind: 'image' }
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return { kind: 'image' }
  if ((type === 'application/pdf' || name.endsWith('.pdf')) && a.size <= PDF_MAX_BYTES) return { kind: 'pdf' }
  const office = officeKind(a.name, a.content_type)
  if (office && a.size <= OFFICE_MAX_BYTES) return { kind: 'office', office }
  return null
}

async function printFile(blob: Blob, file: MailAttachment, look: Look) {
  if (look.kind === 'pdf') return printPdf(blob)
  if (look.kind === 'image') return printImage(blob, file.name)
  return printHtml(file.name, await officePrintHtml(blob, file.name, look.office))
}

export function AttachmentViewer({
  messageId,
  files,
  start,
  subject,
  onComposeWith,
  onClose,
}: {
  messageId: string
  files: MailAttachment[]
  start: number
  /** Тема письма — в примечание, если файл сохранят в документы */
  subject?: string
  /** Ответить / переслать с подписанным файлом (нет — письмо ещё не открыто или отправлять нельзя) */
  onComposeWith?: (mode: ComposeMode, file: File) => void
  onClose: () => void
}) {
  const { tenantId } = useAuth()
  const list = useMemo(() => files.filter((f) => viewable(f)), [files])
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((f) => f.id === files[start]?.id)))
  const file = list[index]
  const look = file ? viewable(file) : null
  const { data: blob, isPending, error } = useQuery({ ...mailAttachmentQuery(messageId, file ?? files[0]), enabled: !!file })
  const go = (d: number) => setIndex((i) => (i + d + list.length) % list.length)
  const [printing, setPrinting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState<{ file: File; codes: string[] } | null>(null)

  async function print() {
    if (!blob || !file || !look || printing) return
    setPrinting(true)
    try {
      await printFile(blob, file, look)
    } catch {
      toast.error(tr('Не удалось подготовить файл к печати. Скачайте его и распечатайте из программы.'))
    } finally {
      setPrinting(false)
    }
  }

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
          <FileTypeIcon name={file.name} mime={file.content_type} className="ml-1 size-7" />
          <DialogTitle className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium">{file.name}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Просмотр вложения письма')}</DialogDescription>
          {look.kind === 'pdf' && (
            <Button type="button" variant="ghost" size="sm" disabled={!blob} onClick={() => setSigning(true)} title={tr('Поставить электронную подпись')}>
              <Signature />
              <span className="max-md:sr-only">{tr('Подписать')}</span>
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => setSaving(true)} title={tr('Сохранить в документы проекта')}>
            <FolderInput />
            <span className="max-md:sr-only">{tr('В документы')}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!blob || printing} onClick={() => void print()}>
            {printing ? <Loader2 className="animate-spin" /> : <Printer />}
            <span className="max-md:sr-only">{tr('Печать')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void downloadAttachment(messageId, file, blob).catch((e) => toast.error(mailErrorText(e)))}
          >
            <Download />
            <span className="max-md:sr-only">{tr('Скачать')}</span>
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
      {saving && <SaveToDocumentsDialog messageId={messageId} attachment={file} blob={blob} subject={subject} onClose={() => setSaving(false)} />}
      {signing && blob && (
        <SignPdfDialog
          blob={blob}
          fileName={file.name}
          onClose={() => setSigning(false)}
          onSigned={async (s) => {
            await recordSignature(file.name, s, tenantId!)
            const base = file.name.replace(/\.pdf$/i, '')
            setSigned({ file: new File([s.bytes as BlobPart], `${base} (signed).pdf`, { type: 'application/pdf' }), codes: s.codes })
            setSigning(false)
          }}
        />
      )}
      {signed && (
        <SignedDialog
          signed={signed}
          messageId={messageId}
          subject={subject}
          onCompose={
            onComposeWith
              ? (mode) => {
                  onComposeWith(mode, signed.file)
                  setSigned(null)
                  onClose()
                }
              : undefined
          }
          onClose={() => setSigned(null)}
        />
      )}
    </Dialog>
  )
}

/** Подписанный PDF: ответить с ним, переслать, сохранить в документы или скачать. */
function SignedDialog({
  signed,
  messageId,
  subject,
  onCompose,
  onClose,
}: {
  signed: { file: File; codes: string[] }
  messageId: string
  subject?: string
  onCompose?: (mode: ComposeMode) => void
  onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const download = () => {
    const href = URL.createObjectURL(signed.file)
    const a = document.createElement('a')
    a.href = href
    a.download = signed.file.name
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-green-600" aria-hidden />
            {tr('Документ подписан')}
          </DialogTitle>
          <DialogDescription>{tr('Подписанный PDF готов. Отправьте его ответом, перешлите или сохраните.')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2.5">
          <FileTypeIcon name={signed.file.name} className="size-9" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{signed.file.name}</span>
            {signed.codes.length === 1 ? (
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{tr('Код подписи: {{code}}', { code: signed.codes[0] })}</span>
            ) : (
              <span className="block text-[11px] text-muted-foreground">{tr('Штампов: {{n}}, у каждого свой код проверки', { n: signed.codes.length })}</span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {onCompose ? (
            <>
              <Button onClick={() => onCompose('reply')}>
                <Reply />
                {tr('Ответить')}
              </Button>
              <Button variant="outline" onClick={() => onCompose('replyAll')}>
                <ReplyAll />
                {tr('Ответить всем')}
              </Button>
              <Button variant="outline" onClick={() => onCompose('forward')}>
                <Forward />
                {tr('Переслать')}
              </Button>
            </>
          ) : (
            <p className="col-span-2 text-xs text-muted-foreground">{tr('Чтобы ответить с подписанным файлом, откройте письмо и подпишите вложение оттуда.')}</p>
          )}
          <Button variant="outline" onClick={() => setSaving(true)}>
            <FolderInput />
            {tr('В документы')}
          </Button>
          <Button variant="outline" onClick={download}>
            <Download />
            {tr('Скачать')}
          </Button>
        </div>
        {saving && (
          <SaveToDocumentsDialog
            messageId={messageId}
            attachment={{ id: `signed-${signed.codes[0]}`, name: signed.file.name, content_type: 'application/pdf', size: signed.file.size }}
            blob={signed.file}
            subject={subject}
            onClose={() => setSaving(false)}
          />
        )}
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

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
/** Видимая часть листа в долях страницы (0…1) — для рамки на мини-карте. */
type Visible = { x0: number; x1: number; y0: number; y1: number }

const THUMB_WIDTH = 112
const MAP_WIDTH = 132
const MINIMAP_KEY = 'pdf-viewer-minimap'
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const wideScreen = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches

/**
 * PDF постранично: страницы рисуются, когда до них докрутили. Слева — миниатюры (нажатие — перейти к странице),
 * сверху — номер страницы и масштаб, в углу — мини-карта: текущий лист и рамка видимой части, её можно тащить.
 */
export function PdfView({ blob }: { blob: Blob }) {
  const { doc, failed } = usePdfDoc(blob)
  const [zoom, setZoom] = useState(1)
  const [sidebar, setSidebar] = useState(wideScreen)
  // мини-карту можно выключить галочкой — выбор запоминается в этом браузере
  const [minimap, setMinimap] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const toggleMinimap = (on: boolean) => {
    setMinimap(on)
    try {
      localStorage.setItem(MINIMAP_KEY, on ? 'on' : 'off')
    } catch {
      /* не запомнили — не страшно */
    }
  }
  const [current, setCurrent] = useState(1)
  const [visible, setVisible] = useState<Visible>({ x0: 0, x1: 1, y0: 0, y1: 1 })
  const box = useRef<HTMLDivElement>(null)
  const pages = useRef<(HTMLDivElement | null)[]>([])
  const register = useCallback((n: number, el: HTMLDivElement | null) => {
    pages.current[n - 1] = el
  }, [])
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pageWidth = Math.max(240, Math.min(1100, width - 32) * zoom)
  const total = doc?.numPages ?? 0
  // миниатюры и переход по страницам — только когда страниц больше одной
  const multi = total > 1

  // Какая страница сейчас главная (её верх выше трети окна) и какая её часть видна — по прокрутке
  const measure = useCallback(() => {
    const el = box.current
    if (!el || !total) return
    const mark = el.scrollTop + el.clientHeight / 3
    let n = 1
    for (let i = 0; i < total; i++) {
      const p = pages.current[i]
      if (p && p.offsetTop <= mark) n = i + 1
    }
    setCurrent(n)
    const p = pages.current[n - 1]
    if (p) {
      const w = p.offsetWidth
      const h = p.offsetHeight
      setVisible({
        x0: clamp((el.scrollLeft - p.offsetLeft) / w),
        x1: clamp((el.scrollLeft + el.clientWidth - p.offsetLeft) / w),
        y0: clamp((el.scrollTop - p.offsetTop) / h),
        y1: clamp((el.scrollTop + el.clientHeight - p.offsetTop) / h),
      })
    }
  }, [total])

  const frame = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measure)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // При смене масштаба остаёмся на том же месте документа
  const anchor = useRef<{ top: number; left: number } | null>(null)
  const changeZoom = (next: number) => {
    const el = box.current
    if (el) anchor.current = { top: el.scrollTop / Math.max(1, el.scrollHeight), left: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth) }
    setZoom(next)
  }
  useLayoutEffect(() => {
    const el = box.current
    if (el && anchor.current) {
      el.scrollTop = anchor.current.top * el.scrollHeight
      el.scrollLeft = anchor.current.left * el.scrollWidth - el.clientWidth / 2
      anchor.current = null
    }
    measure()
  }, [pageWidth, measure])

  const goTo = (n: number) => {
    const p = pages.current[clamp(n, 1, total) - 1]
    const el = box.current
    if (p && el) el.scrollTo({ top: p.offsetTop - 12 })
  }

  // Мини-карта: нажатие или перетаскивание переносит видимую часть в эту точку листа
  const mapDrag = useRef(false)
  const moveTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = box.current
    const p = pages.current[current - 1]
    if (!el || !p) return
    const r = e.currentTarget.getBoundingClientRect()
    const fx = clamp((e.clientX - r.left) / r.width)
    const fy = clamp((e.clientY - r.top) / r.height)
    el.scrollTo({ left: p.offsetLeft + fx * p.offsetWidth - el.clientWidth / 2, top: p.offsetTop + fy * p.offsetHeight - el.clientHeight / 2 })
  }

  // мини-карта нужна, когда лист не помещается целиком
  const partial = visible.y1 - visible.y0 < 0.98 || visible.x1 - visible.x0 < 0.98

  if (failed) return <p className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{tr('Не удалось открыть PDF. Скачайте файл и откройте его в программе.')}</p>
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-1.5">
        {multi && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-pressed={sidebar}
              aria-label={sidebar ? tr('Скрыть миниатюры страниц') : tr('Показать миниатюры страниц')}
              title={sidebar ? tr('Скрыть миниатюры страниц') : tr('Показать миниатюры страниц')}
              onClick={() => setSidebar((s) => !s)}
            >
              {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Предыдущая страница')} disabled={current <= 1} onClick={() => goTo(current - 1)}>
              <ChevronUp />
            </Button>
            <PageInput key={current} current={current} total={total} onGo={goTo} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Следующая страница')} disabled={current >= total} onClick={() => goTo(current + 1)}>
              <ChevronDown />
            </Button>
          </>
        )}
        <span className="flex-1" />
        {doc && (
          <>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Уменьшить')} disabled={zoom <= 0.5} onClick={() => changeZoom(Math.max(0.5, +(zoom - 0.25).toFixed(2)))}>
              <Minus />
            </Button>
            <span className="w-11 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Увеличить')} disabled={zoom >= 4} onClick={() => changeZoom(Math.min(4, +(zoom + 0.25).toFixed(2)))}>
              <Plus />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('По ширине окна')} title={tr('По ширине окна')} disabled={zoom === 1} onClick={() => changeZoom(1)}>
              <MoveHorizontal />
            </Button>
            <span className="mx-1 h-5 w-px bg-border max-sm:hidden" aria-hidden />
            <label className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-sm:hidden">
              <input type="checkbox" checked={minimap} onChange={(e) => toggleMinimap(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />
              <MapIcon className="size-3.5" aria-hidden />
              {tr('Мини-карта')}
            </label>
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {doc && multi && sidebar && (
          <nav aria-label={tr('Страницы')} className="w-[9.5rem] shrink-0 overflow-y-auto border-r bg-card/60 px-3 py-3">
            <ol className="flex flex-col gap-3">
              {Array.from({ length: total }, (_, i) => (
                <li key={i}>
                  <PdfThumb doc={doc} n={i + 1} active={current === i + 1} onGo={goTo} />
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div ref={box} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto">
          {!doc && <p className="grid h-full place-items-center text-sm text-muted-foreground">{tr('Открываем файл…')}</p>}
          {doc && width > 0 && (
            <div className="flex w-max min-w-full flex-col items-center gap-3 px-4 py-4">
              {Array.from({ length: total }, (_, i) => (
                <PdfPageView key={i} doc={doc} n={i + 1} width={pageWidth} register={register} />
              ))}
            </div>
          )}
        </div>

        {doc && minimap && partial && (
          <div className="absolute bottom-3 right-5 z-10 rounded-lg border bg-card/95 p-1.5 shadow-lg backdrop-blur max-sm:hidden">
            <p className="mb-1 px-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{tr('Страница {{n}}', { n: current })}</p>
            <div
              role="presentation"
              title={tr('Перетащите рамку, чтобы перейти к другой части листа')}
              className="relative cursor-crosshair touch-none select-none"
              onPointerDown={(e) => {
                mapDrag.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                moveTo(e)
              }}
              onPointerMove={(e) => {
                if (mapDrag.current) moveTo(e)
              }}
              onPointerUp={() => {
                mapDrag.current = false
              }}
              onPointerCancel={() => {
                mapDrag.current = false
              }}
            >
              <MiniPage key={current} doc={doc} n={current} />
              <span
                aria-hidden
                className="pointer-events-none absolute rounded-[2px] border-2 border-primary bg-primary/10"
                style={{ left: `${visible.x0 * 100}%`, width: `${(visible.x1 - visible.x0) * 100}%`, top: `${visible.y0 * 100}%`, height: `${(visible.y1 - visible.y0) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Номер страницы: можно вписать нужную и нажать Enter. */
function PageInput({ current, total, onGo }: { current: number; total: number; onGo: (n: number) => void }) {
  const [value, setValue] = useState(String(current))
  const submit = () => {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n)) onGo(n)
    else setValue(String(current))
  }
  return (
    <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
      <input
        value={value}
        inputMode="numeric"
        aria-label={tr('Номер страницы')}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        onBlur={() => setValue(String(current))}
        onFocus={(e) => e.currentTarget.select()}
        className="h-7 w-10 rounded-md border bg-background text-center text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span>/ {total}</span>
    </span>
  )
}

const PdfThumb = memo(function PdfThumb({ doc, n, active, onGo }: { doc: PdfDoc; n: number; active: boolean; onGo: (n: number) => void }) {
  const { ref, near } = useNear('300px 0px', n <= 6)
  const { canvas, ratio } = usePageCanvas(doc, n, THUMB_WIDTH, near)
  const button = useRef<HTMLButtonElement>(null)
  // текущая страница всегда видна в списке миниатюр
  useEffect(() => {
    if (active) button.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div ref={ref}>
      <button
        ref={button}
        type="button"
        onClick={() => onGo(n)}
        aria-current={active ? 'page' : undefined}
        aria-label={tr('Страница {{n}}', { n })}
        className="group flex w-full flex-col items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn('block overflow-hidden rounded-sm bg-white shadow-sm ring-1 transition-shadow', active ? 'ring-2 ring-primary' : 'ring-black/10 group-hover:ring-primary/50')}
          style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * ratio }}
        >
          <canvas ref={canvas} className="block h-full w-full" />
        </span>
        <span className={cn('text-[11px] tabular-nums', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>{n}</span>
      </button>
    </div>
  )
})

function MiniPage({ doc, n }: { doc: PdfDoc; n: number }) {
  const { canvas, ratio } = usePageCanvas(doc, n, MAP_WIDTH, true)
  return (
    <span className="block overflow-hidden rounded-sm bg-white ring-1 ring-black/10" style={{ width: MAP_WIDTH, height: MAP_WIDTH * ratio }}>
      <canvas ref={canvas} className="block h-full w-full" />
    </span>
  )
}

const PdfPageView = memo(function PdfPageView({ doc, n, width, register }: { doc: PdfDoc; n: number; width: number; register: (n: number, el: HTMLDivElement | null) => void }) {
  const { ref, near } = useNear('600px 0px', n <= 2)
  const { canvas, ratio } = usePageCanvas(doc, n, width, near)
  return (
    <div
      ref={(el) => {
        ref.current = el
        register(n, el)
      }}
      className="shrink-0 bg-white shadow-sm ring-1 ring-black/10"
      style={{ width, height: width * ratio }}
    >
      <canvas ref={canvas} className="block h-full w-full" aria-label={tr('Страница {{n}}', { n })} />
    </div>
  )
})
