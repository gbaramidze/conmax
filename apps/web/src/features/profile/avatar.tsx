import { useQuery } from '@tanstack/react-query'
import { AVATARS_BUCKET } from '@/features/profile/api'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/** Ссылка на фото из закрытого хранилища живёт час; в кэше держим меньше, чтобы не показать просроченную. */
function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['avatar-url', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrl(path!, 3600)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })
}

/** Круглый аватар: фото, если есть, иначе инициалы. Размер и цвет подложки задаёт `className`. */
export function UserAvatar({ name, path, className = 'size-8 text-xs' }: { name: string; path?: string | null; className?: string }) {
  const { data: url } = useAvatarUrl(path)
  if (path && url) {
    return <img src={url} alt="" loading="lazy" className={cn('shrink-0 rounded-full bg-muted object-cover', className)} />
  }
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full bg-signal font-semibold text-signal-foreground', className)}>
      {initials(name)}
    </span>
  )
}
