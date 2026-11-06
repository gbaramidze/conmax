import { Eraser } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { tr } from '@/lib/tr'

export interface SignaturePadHandle {
  /** PNG с прозрачным фоном; пусто, если ничего не нарисовано. */
  toBlob: () => Promise<Blob | null>
  isEmpty: () => boolean
}

/**
 * Поле для подписи пальцем или мышью. Рисует на canvas, поэтому работает и на телефоне;
 * жест не прокручивает страницу (`touch-action: none`).
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number }>(function SignaturePad({ height = 160 }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)
  const emptyRef = useRef(true)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const w = c.clientWidth
    c.width = Math.round(w * ratio)
    c.height = Math.round(height * ratio)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [height])

  useImperativeHandle(ref, () => ({
    isEmpty: () => emptyRef.current,
    toBlob: () => new Promise((resolve) => (emptyRef.current || !canvas.current ? resolve(null) : canvas.current.toBlob((b) => resolve(b), 'image/png'))),
  }))

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clear = () => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.restore()
    emptyRef.current = true
    setEmpty(true)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvas}
        role="img"
        aria-label={tr('Поле для подписи')}
        style={{ height, touchAction: 'none' }}
        className="w-full cursor-crosshair rounded-md border bg-white"
        onPointerDown={(e) => {
          const ctx = e.currentTarget.getContext('2d')
          if (!ctx) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const { x, y } = point(e)
          ctx.beginPath()
          ctx.moveTo(x, y)
          // точка от одиночного касания
          ctx.lineTo(x + 0.01, y + 0.01)
          ctx.stroke()
          emptyRef.current = false
          setEmpty(false)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = e.currentTarget.getContext('2d')
          if (!ctx) return
          const { x, y } = point(e)
          ctx.lineTo(x, y)
          ctx.stroke()
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{tr('Распишитесь в рамке. Подпись необязательна: достаточно имени.')}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={empty}>
          <Eraser /> {tr('Стереть')}
        </Button>
      </div>
    </div>
  )
})
