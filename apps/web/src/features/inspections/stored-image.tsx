import { useQuery } from '@tanstack/react-query'
import { signedUrlQuery } from '@/features/activity/api'
import { cn } from '@/lib/utils'

/** Картинка из хранилища по ключу файла. Пока ссылка получается, показывает пустую рамку того же размера. */
export function StoredImage({ storageKey, alt, className, onClick }: { storageKey: string; alt: string; className?: string; onClick?: () => void }) {
  const { data: url } = useQuery(signedUrlQuery(storageKey))
  const image = url ? <img src={url} alt={alt} loading="lazy" className={cn('block h-full w-full object-cover', !onClick && className)} /> : null
  if (!onClick) return image ?? <span className={cn('block animate-pulse bg-muted', className)} aria-hidden />
  return (
    <button type="button" onClick={onClick} aria-label={alt} className={cn('block overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      {image ?? <span className="block size-full animate-pulse bg-muted" aria-hidden />}
    </button>
  )
}
