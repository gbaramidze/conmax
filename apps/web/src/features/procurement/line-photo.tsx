import { useQuery } from '@tanstack/react-query'
import { Camera, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { signedUrlQuery, uploadProjectFile } from '@/features/activity/api'
import { ImageViewer } from '@/features/activity/image-viewer'
import { useAuth } from '@/features/auth/auth-provider'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import type { LinePhoto } from './api'

/** Миниатюра фото позиции; по нажатию — просмотр на весь экран */
export function LinePhotoThumb({ photo, preview, className }: { photo: LinePhoto; preview?: string; className?: string }) {
  const { data: url } = useQuery({ ...signedUrlQuery(photo.storage_key), enabled: !preview && !!photo.storage_key })
  const [viewing, setViewing] = useState(false)
  const src = preview ?? url
  return (
    <>
      <button
        type="button"
        onClick={() => (photo.storage_key ? setViewing(true) : preview && window.open(preview, '_blank', 'noopener'))}
        title={photo.name}
        aria-label={tr('Фото позиции: {{name}}', { name: photo.name })}
        className={cn('relative size-10 shrink-0 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        {src ? <img src={src} alt="" loading="lazy" className="size-full object-cover" /> : <Loader2 className="m-auto size-4 animate-spin text-muted-foreground" aria-hidden />}
      </button>
      {viewing && <ImageViewer files={[{ name: photo.name, size_bytes: photo.size, storage_key: photo.storage_key }]} onClose={() => setViewing(false)} />}
    </>
  )
}

/**
 * Фото позиции в форме заявки: снять камерой или выбрать из галереи, чтобы закупщик видел, какую именно модель купить.
 * Файл загружается сразу (в файлы проекта), в позицию попадает его id.
 */
export function LinePhotoPicker({ projectId, value, onChange }: { projectId: string; value: LinePhoto | null | undefined; onChange: (v: LinePhoto | null) => void }) {
  const { tenantId } = useAuth()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | undefined>()
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  const pick = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(tr('Нужна картинка: фото или скриншот модели.'))
      return
    }
    setBusy(true)
    try {
      const id = await uploadProjectFile(projectId, tenantId!, file)
      setPreview(URL.createObjectURL(file))
      onChange({ file_id: id, name: file.name, mime: file.type, size: file.size, storage_key: '' })
    } catch {
      toast.error(tr('Не удалось загрузить фото. Попробуйте ещё раз.'))
    } finally {
      setBusy(false)
    }
  }

  if (value) {
    return (
      <span className="relative inline-flex shrink-0">
        <LinePhotoThumb photo={value} preview={preview} />
        <button
          type="button"
          aria-label={tr('Убрать фото')}
          onClick={() => {
            setPreview(undefined)
            onChange(null)
          }}
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </span>
    )
  }
  return (
    <label
      title={tr('Фото модели')}
      className={cn('grid size-10 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed text-muted-foreground hover:bg-muted hover:text-foreground', busy && 'pointer-events-none opacity-60')}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
      <span className="sr-only">{tr('Добавить фото модели')}</span>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void pick(f)
        }}
      />
    </label>
  )
}
