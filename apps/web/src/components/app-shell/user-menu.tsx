import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bell, Languages, LogOut, Monitor, Moon, ShieldCheck, Sun, UserRound, Lock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { meQuery } from '@/features/auth/api'
import { useAuth } from '@/features/auth/auth-provider'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { UserAvatar } from '@/features/profile/avatar'
import { LANGUAGES, setLanguage } from '@/lib/i18n'
import { getThemeMode, setThemeMode, type ThemeMode } from '@/features/theme/theme'

/** Меню пользователя: профиль компании, настройки, тема, выход. `header` — тёмная верхняя панель десктопа, `topbar` — телефон. */
export function UserMenu({ variant }: { variant: 'header' | 'topbar' }) {
  const { data: me } = useSuspenseQuery(meQuery)
  const { signOut } = useAuth()
  const { t, i18n } = useTranslation()
  const { data: tenantPerms } = useQuery(myTenantPermissionsQuery)
  const [mode, setMode] = useState<ThemeMode>(getThemeMode())

  const pick = (m: ThemeMode) => {
    setThemeMode(m)
    setMode(m)
  }

  const avatar = <UserAvatar name={me.full_name} path={me.avatar_path} className="size-8 text-xs" />

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'header' ? (
          <button
            type="button"
            aria-label={t('userMenu')}
            className="ml-1 flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {avatar}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('userMenu')}
            className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {avatar}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{me.full_name}</span>
          <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
          {me.tenant?.name && <span className="block truncate text-xs text-muted-foreground">{me.tenant.name}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/personal" search={{}}>
            <Lock /> {t('personal')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserRound /> {t('profile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings/notifications">
            <Bell /> {t('notifications')}
          </Link>
        </DropdownMenuItem>
        {tenantPerms?.includes('admin.roles') && (
          <DropdownMenuItem asChild>
            <Link to="/roles" search={{}}>
              <ShieldCheck /> {t('roles')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('theme')}</DropdownMenuLabel>
        {(
          [
            ['light', t('light'), Sun],
            ['dark', t('dark'), Moon],
            ['system', t('system'), Monitor],
          ] as const
        ).map(([value, label, Icon]) => (
          <DropdownMenuItem key={value} onSelect={(e) => { e.preventDefault(); pick(value) }} aria-checked={mode === value} role="menuitemradio">
            <Icon /> {label}
            {mode === value && <span className="ml-auto size-2 rounded-full bg-signal" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          <Languages className="size-3.5" /> {t('language')}
        </DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={(e) => { e.preventDefault(); setLanguage(l.code) }} aria-checked={i18n.language === l.code} role="menuitemradio">
            {l.label}
            {i18n.language === l.code && <span className="ml-auto size-2 rounded-full bg-signal" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
