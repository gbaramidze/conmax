import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eraser, ImageUp, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { deleteMySignature, mySignaturesQuery, type MySignature } from '@/features/signatures/api'
import { tr } from '@/lib/tr'

/**
 * Рисование подписи пальцем, стилусом или мышью (или картинка с подписью). Результат — PNG с прозрачным фоном,
 * обрезанный по рисунку: так он аккуратно ложится в штамп.
 */

const W = 560
const H = 220
/** Цвета пера: синий — как ручкой, тёмно-синий, чёрный, фиолетовый */
const INKS = [
  { color: '#1d4ed8', label: () => tr('Синий') },
  { color: '#1f3a5f', label: () => tr('Тёмно-синий') },
  { color: '#111827', label: () => tr('Чёрный') },
  { color: '#6d28d9', label: () => tr('Фиолетовый') },
]
const INK_KEY = 'signature-ink'

/** Обрезает прозрачные края и уменьшает до 600 px по ширине. */
function trimmed(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const px = ctx.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (px[(y * width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const m = 6
  x0 = Math.max(0, x0 - m)
  y0 = Math.max(0, y0 - m)
  x1 = Math.min(width - 1, x1 + m)
  y1 = Math.min(height - 1, y1 + m)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const scale = Math.min(1, 600 / w)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(w * scale))
  out.height = Math.max(1, Math.round(h * scale))
  out.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

/** Картинка с подписью (скан, фото на белом): белый фон делаем прозрачным, остальное — как есть. */
async function fromImage(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1200 / bmp.width)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * scale))
  c.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const img = ctx.getImageData(0, 0, c.width, c.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3
    if (lum > 215) img.data[i + 3] = 0
  }
  ctx.putImageData(img, 0, 0)
  return trimmed(c)
}

export function SignaturePadDialog({
  saved = [],
  current,
  onPick,
  onClose,
  onDone,
}: {
  /** «Мои подписи» — выбрать сохранённую вместо рисования */
  saved?: MySignature[]
  current?: string | null
  onPick?: (png: string) => void
  onClose: () => void
  onDone: (png: string, remember: boolean) => void | Promise<void>
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: deleteMySignature,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mySignaturesQuery.queryKey }),
    onError: () => toast.error(tr('Не удалось удалить подпись. Попробуйте ещё раз.')),
  })
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ink, setInk] = useState<string>(() => {
    try {
      return INKS.some((i) => i.color === localStorage.getItem(INK_KEY)) ? localStorage.getItem(INK_KEY)! : INKS[0].color
    } catch {
      return INKS[0].color
    }
  })
  const upload = useRef<HTMLInputElement>(null)

  // новый цвет — и для уже нарисованного: перекрашиваем росчерки, фон остаётся прозрачным
  const pickInk = (color: string) => {
    setInk(color)
    try {
      localStorage.setItem(INK_KEY, color)
    } catch {
      /* не запомнили — не страшно */
    }
    const c = canvas.current
    if (!c || empty) return
    const ctx = c.getContext('2d')!
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.restore()
  }

  // холст настраивается, когда появляется (окно монтирует содержимое позже первого эффекта)
  const attach = useCallback((c: HTMLCanvasElement | null) => {
    canvas.current = c
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width === W * dpr && c.height === H * dpr) return
    c.width = W * dpr
    c.height = H * dpr
    c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  const clear = () => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.restore()
    setEmpty(true)
  }

  async function finish(png: string | null) {
    if (!png) return void toast.error(tr('Подпись пустая — нарисуйте её или загрузите картинку.'))
    setBusy(true)
    try {
      await onDone(png, remember)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      {/* росчерк, начатый у края рамки, не должен закрывать окно */}
      <DialogContent className="sm:max-w-xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{tr('Ваша подпись')}</DialogTitle>
          <DialogDescription>{tr('Распишитесь в рамке пальцем, стилусом или мышью — или загрузите картинку с подписью.')}</DialogDescription>
        </DialogHeader>
        {saved.length > 0 && (
          <section aria-label={tr('Мои подписи')} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">{tr('Мои подписи')}</h3>
            <ul className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <li key={s.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onPick?.(s.image)}
                    aria-pressed={current === s.image}
                    title={tr('Подписать этой подписью')}
                    className={`flex h-14 w-32 items-center justify-center rounded-lg border bg-white p-1.5 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring ${current === s.image ? 'border-primary ring-2 ring-primary/30' : ''}`}
                  >
                    <img src={s.image} alt={tr('Сохранённая подпись')} className="max-h-full max-w-full object-contain" />
                  </button>
                  <button
                    type="button"
                    aria-label={tr('Удалить подпись')}
                    title={tr('Удалить подпись')}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(s.id)}
                    className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border bg-white text-muted-foreground shadow-sm hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <p className="pt-1 text-xs text-muted-foreground">{tr('Или нарисуйте новую:')}</p>
          </section>
        )}
        <div className="relative overflow-hidden rounded-lg border bg-white">
          <canvas
            ref={attach}
            aria-label={tr('Поле для подписи')}
            className="block aspect-[56/22] w-full cursor-crosshair touch-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              last.current = point(e)
            }}
            onPointerMove={(e) => {
              if (!drawing.current || !last.current) return
              const ctx = e.currentTarget.getContext('2d')!
              const p = point(e)
              ctx.strokeStyle = ink
              ctx.lineCap = 'round'
              ctx.lineJoin = 'round'
              // нажим: стилус даёт pressure, мышь — 0.5
              ctx.lineWidth = 1.6 + (e.pressure || 0.5) * 2.4
              ctx.beginPath()
              ctx.moveTo(last.current.x, last.current.y)
              ctx.lineTo(p.x, p.y)
              ctx.stroke()
              last.current = p
              if (empty) setEmpty(false)
            }}
            onPointerUp={() => {
              drawing.current = false
              last.current = null
            }}
            onPointerCancel={() => {
              drawing.current = false
              last.current = null
            }}
          />
          <span aria-hidden className="pointer-events-none absolute inset-x-8 bottom-[22%] border-b border-dashed border-slate-300" />
          {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">{tr('Распишитесь здесь')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={tr('Цвет подписи')} className="flex items-center gap-1.5 pr-1">
            {INKS.map((i) => (
              <button
                key={i.color}
                type="button"
                role="radio"
                aria-checked={ink === i.color}
                aria-label={i.label()}
                title={i.label()}
                onClick={() => pickInk(i.color)}
                className={`size-7 rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${ink === i.color ? 'border-foreground' : 'border-transparent'}`}
              >
                <span className="block size-full rounded-full border-2 border-white" style={{ background: i.color }} />
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clear} disabled={empty}>
            <Eraser />
            {tr('Очистить')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => upload.current?.click()}>
            <ImageUp />
            {tr('Загрузить картинку')}
          </Button>
          <input
            ref={upload}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void fromImage(f).then(finish).catch(() => toast.error(tr('Не удалось прочитать картинку.')))
            }}
          />
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            {tr('Запомнить как мою подпись')}
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tr('Отмена')}
          </Button>
          <Button type="button" disabled={empty || busy} onClick={() => void finish(canvas.current ? trimmed(canvas.current) : null)}>
            {tr('Готово')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
