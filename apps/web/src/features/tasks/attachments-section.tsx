import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Paperclip, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { attachFiles, deleteAttachment, entityAttachmentsQuery, formatBytes, MAX_FILE_BYTES, openFile, signedUrlQuery, type EntityRef } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'

/** Все файлы задачи в одном месте: и прикреплённые прямо к ней, и из комментариев. Добавить можно кнопкой, камерой или перетаскиванием. */
export function AttachmentsSection({
  entity,
  projectId,
  canAdd,
  canManage,
}: {
  entity: EntityRef
  projectId: string
  canAdd: boolean
  canManage: boolean
}) {
  const { tenantId, session } = useAuth()
  const queryClient = useQueryClient()
  const { data: items, isPending } = useQuery(entityAttachmentsQuery(entity))
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['attachments'] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])

  const upload = useMutation({
    mutationFn: async (picked: File[]) => {
      const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES)
      if (tooBig.length > 0) toast.error(tr('Файл больше 150 МБ не загрузить: {{v1}}', { v1: tooBig.map((f) => f.name).join(', ') }))
      const files = picked.filter((f) => f.size <= MAX_FILE_BYTES)
      if (files.length === 0) return []
      return attachFiles({ entity, projectId, tenantId: tenantId!, files })
    },
    onSuccess: async (failed) => {
      await refresh()
      if (failed.length > 0) toast.error(tr('Не удалось загрузить: {{v1}}', { v1: failed.join(', ') }))
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteAttachment(id),
    onSuccess: refresh,
    onError: () => toast.error(tr('Не удалось удалить вложение.')),
  })

  const pick = (list: FileList | null, input: HTMLInputElement | null) => {
    if (list && list.length > 0) upload.mutate(Array.from(list))
    if (input) input.value = ''
  }

  if (isPending) return null
  const list = (items ?? []).filter((a) => a.file)
  if (list.length === 0 && !canAdd) return null

  const images = list.filter((a) => a.file!.mime.startsWith('image/'))
  const others = list.filter((a) => !a.file!.mime.startsWith('image/'))

  return (
    <section
      className={`flex flex-col gap-3 rounded-lg ${dragOver ? 'outline-2 outline-dashed outline-ring' : ''}`}
      aria-label={tr('Вложения')}
      onDragOver={(e) => {
        if (!canAdd) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canAdd) return
        e.preventDefault()
        setDragOver(false)
        pick(e.dataTransfer.files, null)
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="size-4 text-muted-foreground" aria-hidden />{tr('Вложения')}{list.length > 0 ? ` · ${list.length}` : ''}
        </h3>
        {canAdd && (
          <div className="flex gap-2">
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => pick(e.target.files, fileInput.current)} />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files, cameraInput.current)} />
            <Button type="button" size="sm" variant="outline" className="md:hidden" disabled={upload.isPending} onClick={() => cameraInput.current?.click()}>
              <Camera />{tr('Снять')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              <Upload /> {upload.isPending ? tr('Загружаем…') : tr('Загрузить')}
            </Button>
          </div>
        )}
      </div>

      {list.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">{tr('Перетащите файлы сюда или нажмите «Загрузить». Фото сжимаются на устройстве.')}</p>
      )}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a) => (
            <li key={a.id} className="group relative">
              <Thumb file={a.file!} />
              {(canManage || a.created_by === session?.user.id) && (
                <DeleteButton name={a.file!.name} pending={remove.isPending} onConfirm={() => remove.mutate(a.id)} className="absolute right-1 top-1 bg-background/90" />
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {others.map((a) => (
            <li key={a.id} className="flex min-h-12 items-center gap-2 px-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col items-start py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => openFile(a.file!.storage_key).catch(() => toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.')))}
              >
                <span className="w-full truncate text-sm font-medium">{a.file!.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(a.file!.size_bytes)}
                  {a.creator ? ` · ${a.creator.full_name}` : ''}
                </span>
              </button>
              {(canManage || a.created_by === session?.user.id) && (
                <DeleteButton name={a.file!.name} pending={remove.isPending} onConfirm={() => remove.mutate(a.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Thumb({ file }: { file: { name: string; storage_key: string; size_bytes: number } }) {
  const { data: url } = useQuery(signedUrlQuery(file.storage_key))
  return (
    <button
      type="button"
      title={`${file.name} · ${formatBytes(file.size_bytes)}`}
      onClick={() => openFile(file.storage_key).catch(() => toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.')))}
      className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {url ? <img src={url} alt={file.name} loading="lazy" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-xs text-muted-foreground">{tr('Фото…')}</span>}
    </button>
  )
}

function DeleteButton({ name, pending, onConfirm, className = '' }: { name: string; pending: boolean; onConfirm: () => void; className?: string }) {
  const [asking, setAsking] = useState(false)
  if (asking) {
    return (
      <span className={`flex items-center gap-1 rounded-md ${className}`}>
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={onConfirm}>{tr('Удалить')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>{tr('Нет')}</Button>
      </span>
    )
  }
  return (
    <Button type="button" size="icon" variant="ghost" className={`md:size-8 ${className}`} aria-label={tr('Удалить вложение {{name}}', { name })} title={tr('Удалить')} onClick={() => setAsking(true)}>
      <Trash2 />
    </Button>
  )
}
