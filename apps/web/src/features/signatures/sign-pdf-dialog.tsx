import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, PenLine, Signature, Trash2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { meQuery } from '@/features/auth/api'
import { mySignaturesQuery, saveMySignature, SignError, signErrorText, type Signed } from '@/features/signatures/api'
import { SignaturePadDialog } from '@/features/signatures/signature-pad'
import { STAMP_RATIO, type Placement } from '@/features/signatures/stamp'
import { useNear, usePageCanvas, usePdfDoc, type PdfDoc } from '@/lib/pdf-view'
import { tr } from '@/lib/tr'

/**
 * Подписать PDF: нажмите на лист там, где должна стоять подпись — появится штамп «eSigned by». Штампов может быть
 * несколько (например, на каждой странице): все они — одна подпись с одним кодом. Штамп можно перетащить, растянуть
 * за угол, убрать; стрелки на клавиатуре сдвигают выбранный штамп. «Подписать» вшивает штампы в файл.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const MIN_W = 0.16
const MAX_W = 0.75
const DEFAULT_W = 0.34

type Stamp = Placement & { id: number }

export function SignPdfDialog({
  blob,
  fileName,
  onClose,
  onSigned,
  note,
}: {
  blob: Blob
  fileName: string
  onClose: () => void
  /** Что сделать с подписанным файлом; ошибка — остаёмся в окне */
  onSigned: (signed: Signed) => Promise<void>
  /** Пояснение над листами: сообщение того, кто просил подписать */
  note?: string
}) {
  const queryClient = useQueryClient()
  const { data: saved = [], isPending: savedPending } = useQuery(mySignaturesQuery)
  const { data: me } = useQuery(meQuery)
  const [drawn, setDrawn] = useState<string | null>(null)
  // по умолчанию — последняя сохранённая подпись; другую можно выбрать или нарисовать
  const image = drawn ?? saved[0]?.image ?? null
  const [pad, setPad] = useState(false)
  const { doc, failed } = usePdfDoc(blob)
  const [stamps, setStamps] = useState<Stamp[]>([])
  const [active, setActive] = useState<number | null>(null)
  const nextId = useRef(1)
  const [busy, setBusy] = useState(false)

  // ширину области листов меряем, когда она появилась (окно монтирует содержимое позже первого эффекта)
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.current.observe(el)
    setWidth(el.clientWidth)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])

  const total = doc?.numPages ?? 0
  const pageWidth = Math.max(260, Math.min(900, width - 32))
  const needPad = !savedPending && !image

  const add = useCallback((p: Placement) => {
    const id = nextId.current++
    setStamps((list) => [...list, { ...p, id }])
    setActive(id)
  }, [])
  const update = useCallback((id: number, p: Placement) => setStamps((list) => list.map((s) => (s.id === id ? { ...p, id } : s))), [])
  const remove = useCallback((id: number) => setStamps((list) => list.filter((s) => s.id !== id)), [])

  // тот же штамп в том же месте — на всех страницах, где его ещё нет
  const copyToAll = () => {
    const src = stamps.find((s) => s.id === active) ?? stamps[stamps.length - 1]
    if (!src) return
    const have = new Set(stamps.map((s) => s.page))
    const extra: Stamp[] = []
    for (let i = 0; i < total; i++) if (!have.has(i)) extra.push({ ...src, page: i, id: nextId.current++ })
    setStamps((list) => [...list, ...extra])
  }

  async function sign() {
    if (!stamps.length || !image || busy) return
    setBusy(true)
    try {
      const { stampPdf, sha256 } = await import('@/features/signatures/stamp')
      const source = await blob.arrayBuffer()
      const hashBefore = await sha256(source)
      // у каждого штампа — свой код
      const marks = stamps.map((s) => ({ ...s, code: crypto.randomUUID() }))
      let bytes: Uint8Array
      try {
        bytes = await stampPdf(source.slice(0), marks, { name: me?.full_name ?? '', signedAt: new Date(), image })
      } catch (e) {
        throw /encrypt/i.test(String((e as Error)?.message ?? e)) ? new SignError('encrypted') : e
      }
      await onSigned({ codes: marks.map((m) => m.code), pages: marks.map((m) => m.page + 1), bytes, hashBefore, hashAfter: await sha256(bytes) })
    } catch (e) {
      toast.error(signErrorText(e, tr('Не удалось подписать документ. Попробуйте ещё раз.')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[100svh] max-h-[100svh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[94svh] sm:max-h-[94svh] sm:w-[94vw] sm:max-w-none sm:rounded-xl"
      >
        <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-2 py-1.5 sm:px-3">
          <Signature className="size-5 shrink-0 text-primary" aria-hidden />
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{tr('Подписать: {{name}}', { name: fileName })}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Поставьте электронную подпись на лист документа')}</DialogDescription>
          {image && (
            <button
              type="button"
              onClick={() => setPad(true)}
              title={tr('Изменить подпись')}
              className="flex h-9 shrink-0 items-center gap-2 rounded-md border bg-white px-2 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={image} alt={tr('Ваша подпись')} className="h-6 max-w-24 object-contain" />
              <PenLine className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label={tr('Закрыть')} onClick={onClose} disabled={busy}>
            <X />
          </Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {note && <span className="w-full text-sm text-foreground">{note}</span>}
          <span className="min-w-0 flex-1">
            {stamps.length === 0
              ? tr('Нажмите на лист там, где должна стоять подпись.')
              : tr('Подпись можно поставить и на другие листы. Штамп перетаскивается, за угол — растягивается.')}
          </span>
          {stamps.length > 0 && total > 1 && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={copyToAll}>
              <Copy />
              {tr('На все страницы')}
            </Button>
          )}
        </div>

        <div ref={measure} className="min-h-0 flex-1 overflow-auto bg-muted/40">
          {failed && <p className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{tr('Не удалось открыть PDF.')}</p>}
          {!doc && !failed && <p className="grid h-full place-items-center text-sm text-muted-foreground">{tr('Открываем файл…')}</p>}
          {doc && width > 0 && (
            <div className="flex flex-col items-center gap-3 px-4 py-4">
              {Array.from({ length: total }, (_, i) => (
                <SignPage
                  key={i}
                  doc={doc}
                  index={i}
                  width={pageWidth}
                  stamps={stamps.filter((s) => s.page === i)}
                  active={active}
                  image={image}
                  name={me?.full_name ?? ''}
                  onAdd={add}
                  onUpdate={update}
                  onRemove={remove}
                  onActivate={setActive}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t bg-card px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground max-sm:hidden">
            {stamps.length > 1
              ? tr('Штампов: {{n}} — у каждого будет свой код проверки.', { n: stamps.length })
              : tr('Простая электронная подпись: в штамп попадут ваше имя, дата и код, по которому подпись проверяется.')}
          </p>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="max-sm:flex-1">
            {tr('Отмена')}
          </Button>
          <Button type="button" onClick={() => void sign()} disabled={!doc || !image || !stamps.length || busy} className="max-sm:flex-1">
            {busy ? <Loader2 className="animate-spin" /> : <Signature />}
            {busy ? tr('Подписываем…') : tr('Подписать')}
          </Button>
        </div>
      </DialogContent>
      {(pad || needPad) && (
        <SignaturePadDialog
          saved={saved}
          current={image}
          onPick={(png) => {
            setDrawn(png)
            setPad(false)
          }}
          onClose={() => (image ? setPad(false) : onClose())}
          onDone={async (png, remember) => {
            setDrawn(png)
            setPad(false)
            if (remember) {
              try {
                await saveMySignature(png)
                await queryClient.invalidateQueries({ queryKey: mySignaturesQuery.queryKey })
                toast.success(tr('Подпись сохранена в «Мои подписи»'))
              } catch (e) {
                toast.error(signErrorText(e, tr('Подпись не запомнилась, но этот документ подписать можно.')))
              }
            }
          }}
        />
      )}
    </Dialog>
  )
}

const SignPage = memo(function SignPage({
  doc,
  index,
  width,
  stamps,
  active,
  image,
  name,
  onAdd,
  onUpdate,
  onRemove,
  onActivate,
}: {
  doc: PdfDoc
  index: number
  width: number
  stamps: Stamp[]
  active: number | null
  image: string | null
  name: string
  onAdd: (p: Placement) => void
  onUpdate: (id: number, p: Placement) => void
  onRemove: (id: number) => void
  onActivate: (id: number) => void
}) {
  const { ref, near } = useNear('600px 0px', index < 2)
  const { canvas, ratio } = usePageCanvas(doc, index + 1, width, near || stamps.length > 0)
  const height = width * ratio
  // высота штампа в долях высоты листа
  const hOf = (w: number) => (w * STAMP_RATIO) / ratio
  const dragged = useRef(false)
  // отпускание после перетаскивания штампа не должно ставить новый штамп на лист
  const markDragged = useCallback(() => {
    dragged.current = true
    window.setTimeout(() => (dragged.current = false), 0)
  }, [])

  // нажатие на свободное место листа — новый штамп центром в эту точку
  const putAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragged.current || e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const w = DEFAULT_W
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    onAdd({ page: index, w, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - hOf(w) / 2, 0, 1 - hOf(w)) })
  }

  return (
    <div
      ref={ref}
      className="relative shrink-0 cursor-copy bg-white shadow-sm ring-1 ring-black/10"
      style={{ width, height }}
      onPointerUp={putAt}
    >
      <canvas ref={canvas} className="block h-full w-full" aria-label={tr('Страница {{n}}', { n: index + 1 })} />
      <span className="pointer-events-none absolute -left-1 top-1 -translate-x-full text-[10px] tabular-nums text-muted-foreground max-sm:hidden">{index + 1}</span>
      {stamps.map((s) => (
        <StampBox
          key={s.id}
          stamp={s}
          active={active === s.id}
          width={width}
          height={height}
          hOf={hOf}
          image={image}
          name={name}
          onDragEnd={markDragged}
          onUpdate={(p) => onUpdate(s.id, p)}
          onRemove={() => onRemove(s.id)}
          onActivate={() => onActivate(s.id)}
        />
      ))}
    </div>
  )
})

function StampBox({
  stamp,
  active,
  width,
  height,
  hOf,
  image,
  name,
  onDragEnd,
  onUpdate,
  onRemove,
  onActivate,
}: {
  stamp: Stamp
  active: boolean
  width: number
  height: number
  hOf: (w: number) => number
  image: string | null
  name: string
  onDragEnd: () => void
  onUpdate: (p: Placement) => void
  onRemove: () => void
  onActivate: () => void
}) {
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; start: Placement } | null>(null)
  const start = (mode: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, start: stamp }
    onActivate()
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    const dx = (e.clientX - d.x) / width
    const dy = (e.clientY - d.y) / height
    if (d.mode === 'move') onUpdate({ ...d.start, x: clamp(d.start.x + dx, 0, 1 - d.start.w), y: clamp(d.start.y + dy, 0, 1 - hOf(d.start.w)) })
    else {
      const w = clamp(d.start.w + dx, MIN_W, Math.min(MAX_W, 1 - d.start.x))
      onUpdate({ ...d.start, w, y: clamp(d.start.y, 0, 1 - hOf(w)) })
    }
  }
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    drag.current = null
    onDragEnd()
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      return onRemove()
    }
    const step = e.shiftKey ? 0.05 : 0.01
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    onUpdate({ ...stamp, x: clamp(stamp.x + m[0], 0, 1 - stamp.w), y: clamp(stamp.y + m[1], 0, 1 - hOf(stamp.w)) })
  }
  const px = stamp.w * width
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={tr('Штамп подписи: стрелки сдвигают, Delete — убрать')}
      onKeyDown={nudge}
      onFocus={onActivate}
      onPointerDown={start('move')}
      onPointerMove={move}
      onPointerUp={end}
      className={`absolute cursor-move touch-none rounded-sm outline-offset-2 ${active ? 'outline-2 outline-primary' : 'outline-1 outline-primary/40 outline-dashed'}`}
      style={{ left: `${stamp.x * 100}%`, top: `${stamp.y * 100}%`, width: px, height: px * STAMP_RATIO }}
    >
      <StampPreview scale={px / 220} image={image} name={name} />
      <button
        type="button"
        aria-label={tr('Убрать штамп')}
        title={tr('Убрать штамп')}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="absolute -right-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full border bg-white text-muted-foreground shadow hover:text-destructive"
      >
        <Trash2 className="size-3" aria-hidden />
      </button>
      <span
        aria-hidden
        onPointerDown={start('resize')}
        onPointerMove={move}
        onPointerUp={end}
        className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-primary shadow"
      />
    </div>
  )
}

/** Как будет выглядеть штамп (тот же рисунок, что вшивается в PDF; код появится при подписании). */
function StampPreview({ scale, image, name }: { scale: number; image: string | null; name: string }) {
  const [today] = useState(() => new Date().toLocaleDateString())
  return (
    <div className="pointer-events-none origin-top-left select-none" style={{ width: 220, height: 220 * STAMP_RATIO, transform: `scale(${scale})` }}>
      <div className="relative h-full w-full bg-white/70">
        <div className="absolute inset-x-0 bottom-[5px] top-[4.5px] rounded-[1px] border-[1.2px] border-[#54c740]" />
        <span className="absolute left-[4px] top-0 bg-white px-[3px] text-[9px] font-bold leading-[9px] text-[#33404f]">eSigned by:</span>
        <span className="absolute left-[6px] right-[6px] top-[11px] truncate text-[7.2px] leading-[9px] text-[#33404f]">{name}:</span>
        <span className="absolute left-[6px] right-[6px] top-[19.5px] truncate text-[6.4px] leading-[8px] text-[#33404f]/70">{tr('код появится при подписании')}</span>
        {image && <img src={image} alt="" className="absolute inset-x-[6px] bottom-[16px] top-[28px] m-auto max-h-[48px] object-contain" />}
        <span className="absolute bottom-[11px] left-[6px] text-[6.5px] leading-[7px] text-[#33404f]">{today}</span>
        <span className="absolute bottom-0 right-[4px] bg-white px-[3px] text-[7.2px] leading-[9px] text-[#33404f]">
          Certified by <b className="text-[9px]">CONMAX</b>
        </span>
      </div>
    </div>
  )
}
