import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ImagePlus, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { addImageVersion, deleteImageVersion, imageUrlsQuery, imageVersionsQuery, restoreImageVersion, type EntityImage } from '@/features/renders/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/** История версий изображения: загрузить новую, вернуть прежнюю текущей, удалить прежнюю. Текущая версия — та, что видна в галерее и на плитках. */
export function VersionsDialog({ projectId, image, canEdit, onClose, onChanged }: { projectId: string; image: EntityImage; canEdit: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const { tenantId } = useAuth()
  const { data: versions = [] } = useQuery(imageVersionsQuery(image.id))
  const { data: urls } = useQuery(imageUrlsQuery(versions.map((v) => v.file.storage_key)))
  const input = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState<number | null>(null)

  const done = async () => void (await onChanged())
  const upload = useMutation({
    mutationFn: (file: File) => addImageVersion(projectId, tenantId!, image.id, file, note),
    onSuccess: async () => {
      setNote('')
      toast.success(tr('Новая версия загружена'))
      await done()
    },
    onError: () => toast.error(tr('Не удалось загрузить версию. Попробуйте ещё раз.')),
  })
  const restore = useMutation({
    mutationFn: (no: number) => restoreImageVersion(image.id, no),
    onSuccess: done,
    onError: () => toast.error(tr('Не удалось вернуть версию.')),
  })
  const remove = useMutation({
    mutationFn: (no: number) => deleteImageVersion(image.id, no),
    onSuccess: async () => {
      setConfirm(null)
      await done()
    },
    onError: () => toast.error(tr('Не удалось удалить версию.')),
  })
  const fmt = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('Версии: {{name}}', { name: image.caption ?? image.file.name })}</DialogTitle>
          <DialogDescription>{tr('В галерее и на плитках показывается текущая версия. Прежние хранятся, пока вы их не удалите.')}</DialogDescription>
        </DialogHeader>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={tr('Что изменилось (необязательно)')} aria-label={tr('Что изменилось')} className="min-w-48 flex-1" />
            <Button type="button" disabled={upload.isPending} onClick={() => input.current?.click()}>
              <ImagePlus /> {upload.isPending ? tr('Загружаем…') : tr('Загрузить новую версию')}
            </Button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) upload.mutate(f)
              }}
            />
          </div>
        )}

        <ul className="flex flex-col gap-2" aria-label={tr('История версий')}>
          {versions.map((v) => {
            const current = v.file.id === image.file_id
            return (
              <li key={v.id} className={cn('flex items-center gap-3 rounded-lg border p-2', current && 'border-primary bg-primary/5')}>
                <a href={urls?.get(v.file.storage_key)} target="_blank" rel="noreferrer" className="block h-14 w-20 shrink-0 overflow-hidden rounded-md border bg-muted" aria-label={tr('Открыть версию {{n}} в новой вкладке', { n: v.version_no })}>
                  {urls?.get(v.file.storage_key) && <img src={urls.get(v.file.storage_key)} alt="" loading="lazy" className="size-full object-cover" />}
                </a>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                    {tr('Версия {{n}}', { n: v.version_no })}
                    {current && (
                      <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium">
                        <Check className="size-3" aria-hidden /> {tr('текущая')}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {fmt.format(new Date(v.created_at))}
                    {v.creator ? ` · ${v.creator.full_name}` : ''}
                    {` · ${v.file.name}`}
                  </p>
                  {v.note && <p className="truncate text-xs">{v.note}</p>}
                </div>
                {canEdit && !current && (
                  <div className="flex shrink-0 items-center gap-1">
                    {confirm === v.version_no ? (
                      <>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(null)}>
                          {tr('Отмена')}
                        </Button>
                        <Button type="button" size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(v.version_no)}>
                          {tr('Удалить')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(v.version_no)} title={tr('Сделать эту версию текущей')}>
                          <RotateCcw /> <span className="hidden sm:inline">{tr('Вернуть')}</span>
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={tr('Удалить версию {{n}}', { n: v.version_no })} onClick={() => setConfirm(v.version_no)}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
