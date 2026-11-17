import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { formatBytes, signedUrlQuery } from '@/features/activity/api'

export interface ViewerFile {
  name: string
  storage_key: string
  size_bytes?: number
}

/**
 * Просмотр фото прямо в приложении (а не в новой вкладке): на весь экран, стрелки и свайп листают фото той же заметки или комментария,
 * Esc или крестик закрывают, «Открыть оригинал» — исходный файл в отдельной вкладке (если нужен зум браузера или сохранение).
 */
export function ImageViewer({ files, start = 0, onClose }: { files: ViewerFile[]; start?: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), files.length - 1))
  const file = files[index]
  const { data: url } = useQuery(signedUrlQuery(file.storage_key))
  const touch = useRef<{ x: number; y: number } | null>(null)

  const go = (d: number) => setIndex((i) => (i + d + files.length) % files.length)
  // следующее фото подгружаем заранее, чтобы листание не мигало
  const next = files[(index + 1) % files.length]
  useQuery({ ...signedUrlQuery(next.storage_key), enabled: files.length > 1 })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="h-[100svh] max-h-[100svh] w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 bg-black/95 p-0 text-white ring-0 sm:h-[96svh] sm:max-h-[96svh] sm:w-[96vw] sm:max-w-none sm:rounded-xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') go(-1)
          if (e.key === 'ArrowRight') go(1)
        }}
      >
        <DialogTitle className="sr-only">{file.name}</DialogTitle>
        <DialogDescription className="sr-only">{tr('Фото {{n}} из {{total}}', { n: index + 1, total: files.length })}</DialogDescription>

        <div
          className="relative flex h-full w-full touch-pan-y items-center justify-center"
          onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
          onTouchEnd={(e) => {
            const t = touch.current
            touch.current = null
            if (!t || files.length < 2) return
            const dx = e.changedTouches[0].clientX - t.x
            const dy = e.changedTouches[0].clientY - t.y
            // горизонтальный свайп листает; вертикальный и короткий — нет
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
          }}
        >
          {url ? <img key={file.storage_key} src={url} alt={file.name} className="max-h-full max-w-full select-none object-contain" draggable={false} /> : <span className="text-sm text-white/70" role="status">{tr('Загружаем…')}</span>}

          <DialogClose asChild>
            <Button type="button" variant="secondary" size="icon" className="absolute right-3 top-3 z-10 bg-white/15 text-white hover:bg-white/30" aria-label={tr('Закрыть')}>
              <X />
            </Button>
          </DialogClose>

          {files.length > 1 && (
            <>
              <Button type="button" variant="secondary" size="icon" className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/15 text-white hover:bg-white/30" onClick={() => go(-1)} aria-label={tr('Предыдущее')}>
                <ChevronLeft />
              </Button>
              <Button type="button" variant="secondary" size="icon" className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/15 text-white hover:bg-white/30" onClick={() => go(1)} aria-label={tr('Следующее')}>
                <ChevronRight />
              </Button>
            </>
          )}

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8 text-sm">
            <span className="min-w-0 truncate text-white/90">
              {files.length > 1 && <span className="mr-2 tabular-nums text-white/70">{index + 1} / {files.length}</span>}
              {file.name}
              {file.size_bytes !== undefined && <span className="ml-2 text-white/60">{formatBytes(file.size_bytes)}</span>}
            </span>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-white/90 underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-white/60">
                <ExternalLink className="size-4" aria-hidden />
                {tr('Открыть оригинал')}
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
