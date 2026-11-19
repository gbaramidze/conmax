import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { BottomNav, TopBar } from '@/components/app-shell/mobile-nav'
import { DesktopHeader } from '@/components/app-shell/desktop-header'
import { Sidebar } from '@/components/app-shell/sidebar'
import { toggleSidebar, useSidebarHidden } from '@/components/app-shell/sidebar-state'
import { meQuery } from '@/features/auth/api'
import { useChatRealtime, usePresencePing } from '@/features/chat/presence'
import { useNotificationsRealtime } from '@/features/notifications/bell'
import { InstallBanner } from '@/features/pwa/install-banner'
import { CommandPalette } from '@/features/search/command-palette'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    if (context.auth.status === 'signed_out' || context.auth.status === 'mfa_required') throw redirect({ to: '/login' })
    if (context.auth.status === 'no_tenant') throw redirect({ to: '/onboarding' })
    // Приглашённый пользователь сначала задаёт пароль
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me.status === 'invited') throw redirect({ to: '/set-password' })
  },
  component: AppLayout,
})

/**
 * Каркас: на десктопе (≥1024px) — компактная тёмная боковая панель с навигацией и светлая верхняя панель
 * (поиск, создание, уведомления, профиль); на телефоне и планшете — верхняя панель и нижняя навигация.
 * Рамка приложения на всю ширину; ограничение ширины — только у основного содержимого.
 */
function AppLayout() {
  useNotificationsRealtime()
  useChatRealtime()
  usePresencePing()
  const sidebarHidden = useSidebarHidden()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Доски проекта занимают всю ширину экрана: колонки уходят вправо, как в Trello
  const fullBleed = /^\/projects\/[^/]+\/boards\/?$/.test(pathname)
  // Почта на десктопе — приложение во весь экран под верхней панелью (папки · письма · письмо), без полей
  const app = pathname === '/mail'

  // Ctrl + \ — свернуть или развернуть боковую панель
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={cn('min-h-svh print:!pl-0', sidebarHidden ? 'lg:pl-0' : 'lg:pl-56')}>
      <Sidebar hidden={sidebarHidden} />
      <DesktopHeader />
      <InstallBanner />
      <TopBar />
      <main
        className={cn(
          'mx-auto w-full px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6 print:!max-w-none print:!p-0',
          fullBleed || app ? 'max-w-none' : 'max-w-[80rem]',
          app && 'lg:!p-0',
        )}
      >
        <Outlet />
      </main>
      <BottomNav />
      <CommandPalette />
    </div>
  )
}
