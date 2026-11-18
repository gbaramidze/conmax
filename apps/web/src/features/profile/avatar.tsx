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

// Подложки инициалов: насыщенные тона (оттенки 700), белые буквы на них читаются с контрастом не ниже 4.5:1
// и на светлой, и на тёмной теме.
const AVATAR_COLORS = [
  '#b91c1c', // красный
  '#c2410c', // оранжевый
  '#a16207', // охра
  '#4d7c0f', // салатовый
  '#15803d', // зелёный
  '#0f766e', // бирюзовый
  '#0369a1', // голубой
  '#1d4ed8', // синий
  '#4338ca', // индиго
  '#7e22ce', // фиолетовый
  '#a21caf', // пурпурный
  '#be185d', // розовый
]

/** Цвет подложки по имени и фамилии: у одного человека он везде один и тот же, у разных людей — обычно разный. */
function avatarColor(name: string): string {
  const key = name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  if (!key || key === '?') return '#57534e'
  let h = 5381
  for (const ch of key) h = ((h << 5) + h + ch.codePointAt(0)!) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!
}

/** Круглый аватар: фото, если есть, иначе инициалы на цветной подложке (цвет — по имени). Размер задаёт `className`. */
export function UserAvatar({ name, path, className = 'size-8 text-xs' }: { name: string; path?: string | null; className?: string }) {
  const { data: url } = useAvatarUrl(path)
  if (path && url) {
    return <img src={url} alt="" loading="lazy" className={cn('shrink-0 rounded-full bg-muted object-cover', className)} />
  }
  return (
    <span
      aria-hidden
      style={{ backgroundColor: avatarColor(name) }}
      className={cn('flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', className)}
    >
      {initials(name)}
    </span>
  )
}
