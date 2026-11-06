import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { BottomNav, TopBar } from '@/components/app-shell/mobile-nav'
import { DesktopHeader } from '@/components/app-shell/desktop-header'
import { Sidebar } from '@/components/app-shell/sidebar'
import { meQuery } from '@/features/auth/api'
import { useChatRealtime, usePresencePing } from '@/features/chat/presence'
import { useNotificationsRealtime } from '@/features/notifications/bell'
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
  return (
    <div className="min-h-svh lg:pl-56 print:!pl-0">
      <Sidebar />
      <DesktopHeader />
      <TopBar />
      <main className="mx-auto w-full max-w-[80rem] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6 print:!max-w-none print:!p-0">
        <Outlet />
      </main>
      <BottomNav />
      <CommandPalette />
    </div>
  )
}
