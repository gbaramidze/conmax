import { tr } from '@/lib/tr'
import { Paperclip, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes } from '@/features/activity/api'

/** Предпросмотр выбранного файла: фото — миниатюрой, остальное — именем. */
export function PickedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith('image/')
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isImage) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, isImage])

  return (
    <li className="relative">
      {isImage && url ? (
        <img src={url} alt={file.name} className="size-20 rounded-lg border object-cover" />
      ) : (
        <span className="flex h-9 items-center gap-1 rounded-md border px-2 text-xs">
          <Paperclip className="size-3" />
          {file.name} · {formatBytes(file.size)}
        </span>
      )}
      <button
        type="button"
        aria-label={tr('Убрать файл {{name}}', { name: file.name })}
        className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border bg-card shadow-soft hover:bg-accent"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </button>
    </li>
  )
}
