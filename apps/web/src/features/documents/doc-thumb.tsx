import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DocumentRow } from '@/features/documents/api'
import { FileKindBadge } from '@/features/documents/file-kind'
import { canThumb, generateThumb, thumbUrlQuery } from '@/features/documents/thumbs'
import { cn } from '@/lib/utils'

interface Peek {
  left: number
  top: number
  w: number
}

/**
 * Миниатюра первой страницы документа в реестре. Пока её нет — метка типа файла (PDF, DWG…).
 * Рисуется только для строк, попавших на экран; у документа без миниатюры её создаёт тот, кто вправе комментировать в проекте.
 * При наведении мышью рядом открывается крупный просмотр: справа от миниатюры, а если не помещается — слева.
 */
export type ThumbDoc = Pick<DocumentRow, 'thumb_file_id' | 'thumb_source_key' | 'thumb_source_mime' | 'has_thumb' | 'file_name' | 'file_mime'>

export function DocThumb({ d, canGenerate, className }: { d: ThumbDoc; canGenerate: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [seen, setSeen] = useState(false)
  const [made, setMade] = useState(false)
  const [broken, setBroken] = useState(false)
  const [peek, setPeek] = useState<Peek | null>(null)
  const key = d.thumb_source_key
  const ready = (d.has_thumb || made) && !!key

  useEffect(() => {
    const el = box.current
    if (!el || seen) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    if (!seen || ready || !canGenerate || !key || !d.thumb_file_id || !canThumb(d.thumb_source_mime)) return
    let off = false
    void generateThumb({ fileId: d.thumb_file_id, storageKey: key, mime: d.thumb_source_mime! }).then((ok) => !off && ok && setMade(true))
    return () => {
      off = true
    }
  }, [seen, ready, canGenerate, key, d.thumb_file_id, d.thumb_source_mime])

  const { data: url } = useQuery(thumbUrlQuery(key ?? '', seen && ready && !broken))

  const hide = () => {
    window.clearTimeout(timer.current)
    setPeek(null)
  }
  // прокрутка и уход со страницы закрывают просмотр, чтобы он не «зависал» над списком
  useEffect(() => {
    if (!peek) return
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [peek])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const show = (e: React.PointerEvent) => {
    // на сенсорном экране наведения нет: там миниатюра открывается вместе с документом
    if (e.pointerType !== 'mouse' || !url || broken) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = box.current
      if (!el) return
      const img = el.querySelector('img')
      const r = el.getBoundingClientRect()
      const ratio = img && img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1.4
      let w = Math.min(480, window.innerWidth * 0.45)
      let h = w * ratio
      const maxH = window.innerHeight * 0.8
      if (h > maxH) {
        h = maxH
        w = h / ratio
      }
      let left = r.right + 12
      if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 12)
      const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8)
      setPeek({ left, top, w })
    }, 180)
  }

  return (
    <div ref={box} onPointerEnter={show} onPointerLeave={hide} className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40', className)}>
      {url && !broken ? (
        <img src={url} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} className="size-full bg-white object-cover object-top" />
      ) : (
        <FileKindBadge name={d.file_name} mime={d.file_mime} />
      )}
      {peek &&
        url &&
        createPortal(
          <img
            src={url}
            alt=""
            aria-hidden
            className="pointer-events-none fixed z-[70] rounded-lg border bg-white shadow-2xl"
            style={{ left: peek.left, top: peek.top, width: peek.w }}
          />,
          document.body,
        )}
    </div>
  )
}
