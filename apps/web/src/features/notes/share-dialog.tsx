import { tr } from '@/lib/tr'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatBytes, signedUrlQuery } from '@/features/activity/api'
import { schemeImageQuery } from '@/features/inspections/scheme-image'
import { buildNotesPdf, type NotesPdfInput } from '@/features/notes/pdf'

type State = { status: 'building'; done: number } | { status: 'ready'; file: File; pages: number } | { status: 'error' }

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * «Поделиться заметками»: собирает PDF по текущему списку (с учётом всех фильтров) и отдаёт его системному окну отправки
 * (на телефоне — почта, WhatsApp, Telegram и т.д.; в браузерах с поддержкой — тоже). Где отправка файлов недоступна, остаётся «Скачать».
 * PDF готовится заранее, а «Отправить» нажимается отдельно: браузеры разрешают окно отправки только сразу после нажатия пользователя.
 */
export function NotesShareDialog({ open, onClose, input }: { open: boolean; onClose: () => void; input: Omit<NotesPdfInput, 'urlOf' | 'schemeUrl' | 'onProgress'> }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>({ status: 'building', done: 0 })
  const inputRef = useRef(input)
  inputRef.current = input

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'building', done: 0 })
    const data = inputRef.current
    buildNotesPdf({
      ...data,
      urlOf: (key) => queryClient.fetchQuery(signedUrlQuery(key)),
      schemeUrl: (source) => queryClient.fetchQuery(schemeImageQuery(source)),
      onProgress: (done) => !cancelled && setState({ status: 'building', done }),
    })
      .then(({ blob, pages }) => {
        if (cancelled) return
        const stamp = new Date().toISOString().slice(0, 10)
        const file = new File([blob], `${safeName(`${tr('Заметки')} ${data.projectCode} ${stamp}`)}.pdf`, { type: 'application/pdf' })
        setState({ status: 'ready', file, pages })
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, queryClient])

  const total = input.items.length
  const file = state.status === 'ready' ? state.file : null
  const canShareFile = !!file && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: file.name.replace(/\.pdf$/, ''), text: tr('Заметки с площадки: {{n}}', { n: total }) })
    } catch (e) {
      // закрыть окно отправки без выбора — не ошибка
      if ((e as DOMException)?.name !== 'AbortError') toast.error(tr('Не удалось открыть отправку. Скачайте PDF и отправьте его сами.'))
    }
  }
  const download = () => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Поделиться заметками')}</DialogTitle>
          <DialogDescription>{tr('PDF со всеми заметками из текущего списка: {{n}}. Условия отбора указаны в шапке отчёта.', { n: total })}</DialogDescription>
        </DialogHeader>

        {state.status === 'building' && (
          <div className="flex flex-col gap-2 py-2" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-signal transition-[width]" style={{ width: `${total > 0 ? Math.round((state.done / total) * 100) : 10}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">{tr('Собираем PDF: {{done}} из {{total}}', { done: state.done, total })}</p>
          </div>
        )}

        {state.status === 'error' && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{tr('Не удалось сформировать PDF. Попробуйте ещё раз.')}</p>}

        {file && state.status === 'ready' && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-signal/25">
              <FileText className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{tr('{{pages}} стр.', { pages: state.pages })} · {formatBytes(file.size)}</p>
            </div>
          </div>
        )}

        {file && !canShareFile && <p className="text-xs text-muted-foreground">{tr('Этот браузер не умеет отправлять файлы. Скачайте PDF и отправьте его сами.')}</p>}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {tr('Закрыть')}
          </Button>
          <Button type="button" variant={canShareFile ? 'outline' : 'default'} disabled={!file} onClick={download}>
            <Download />
            {tr('Скачать PDF')}
          </Button>
          {canShareFile && (
            <Button type="button" onClick={() => void share()}>
              <Share2 />
              {tr('Отправить')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
