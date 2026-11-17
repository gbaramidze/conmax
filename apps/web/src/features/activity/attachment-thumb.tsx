import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Paperclip } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatBytes, openFile, signedUrlQuery } from '@/features/activity/api'
import { ImageViewer } from '@/features/activity/image-viewer'

interface FileInfo {
  name: string
  mime: string
  size_bytes: number
  storage_key: string
}

/**
 * Фото — миниатюрой: по нажатию открывается просмотр в приложении (на весь экран, без новой вкладки). Если передан `group`
 * (все файлы заметки или комментария), в просмотре можно листать остальные фото. Прочие файлы — строкой с именем и размером.
 */
export function AttachmentThumb({ file, group }: { file: FileInfo; group?: FileInfo[] }) {
  const isImage = file.mime.startsWith('image/')
  const { data: url } = useQuery({ ...signedUrlQuery(file.storage_key), enabled: isImage })
  const [viewing, setViewing] = useState(false)
  const open = () => openFile(file.storage_key).catch(() => toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.')))

  if (isImage) {
    const images = (group ?? [file]).filter((f) => f.mime.startsWith('image/'))
    const start = Math.max(0, images.findIndex((f) => f.storage_key === file.storage_key))
    return (
      <>
        <button
          type="button"
          onClick={() => setViewing(true)}
          title={`${file.name} · ${formatBytes(file.size_bytes)}`}
          className="relative size-24 overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-28"
        >
          {url ? (
            <img src={url} alt={file.name} loading="lazy" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs text-muted-foreground">{tr('Фото…')}</span>
          )}
        </button>
        {viewing && <ImageViewer files={images} start={start} onClose={() => setViewing(false)} />}
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      className="flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
    >
      <Paperclip className="size-3.5" />
      {file.name} · {formatBytes(file.size_bytes)}
    </button>
  )
}
