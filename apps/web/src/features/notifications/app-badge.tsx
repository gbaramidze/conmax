import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeAlert } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { chatUnreadQuery } from '@/features/chat/api'
import { mailAccountQuery, mailUnreadQuery } from '@/features/mail/api'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Число на значке иконки приложения: непрочитанные сообщения чата + непрочитанные во «Входящих» Outlook.
 * Включается в профиле (`user_notification_settings.app_badge`, по умолчанию выключено). Пока приложение открыто или свёрнуто,
 * значок ставит страница; когда закрыто — push приносит свежее число (send-push → `app_badge_counts`), его ставит service worker.
 * Значок есть только у установленного приложения (экран «Домой», «Установить» в Chrome/Edge).
 */

export const appBadgeSupported = () => typeof navigator !== 'undefined' && 'setAppBadge' in navigator

export const appBadgeQuery = queryOptions({
  queryKey: ['app-badge-setting'],
  queryFn: async (): Promise<boolean> => {
    const { data, error } = await supabase.from('user_notification_settings').select('app_badge').maybeSingle()
    if (error) throw error
    return data?.app_badge ?? false
  },
})

async function saveAppBadge(on: boolean): Promise<void> {
  const { error } = await supabase.from('user_notification_settings').upsert({ app_badge: on } as never, { onConflict: 'user_id' })
  if (error) throw error
}

function setBadge(n: number) {
  if (!appBadgeSupported()) return
  void (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {})
}

/** Держит число на значке в каркасе приложения: обновляется вместе со счётчиками в меню. */
export function useAppBadge() {
  const { data: on } = useQuery(appBadgeQuery)
  const { data: chatUnread } = useQuery({ ...chatUnreadQuery, enabled: !!on })
  const { data: tenantPerms } = useQuery(myTenantPermissionsQuery)
  const canMail = !!tenantPerms?.includes('mail.connect')
  const { data: mailAccount } = useQuery({ ...mailAccountQuery, enabled: !!on && canMail })
  const { data: mailUnread } = useQuery(mailUnreadQuery(!!on && canMail && !!mailAccount))
  const total = on ? (chatUnread ?? 0) + (mailUnread ?? 0) : 0
  useEffect(() => setBadge(total), [total])
  // выход из аккаунта: чужое число на иконке не оставляем
  useEffect(() => () => setBadge(0), [])
}

/** Карточка в профиле: переключатель «Число на значке приложения». */
export function AppBadgeSection({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const { data: on = false, isPending } = useQuery(appBadgeQuery)
  const supported = appBadgeSupported()
  const save = useMutation({
    mutationFn: saveAppBadge,
    onMutate: (next) => queryClient.setQueryData(appBadgeQuery.queryKey, next),
    onError: (_e, next) => {
      queryClient.setQueryData(appBadgeQuery.queryKey, !next)
      toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: appBadgeQuery.queryKey }),
  })

  return (
    <section className={className} aria-labelledby="app-badge-title">
      <div className="flex items-start gap-3">
        <BadgeAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="app-badge-title" className="text-base font-semibold">
            {tr('Число на значке приложения')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr('Показывать на иконке приложения, сколько непрочитанных: сообщения чата и письма во «Входящих» вместе.')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {supported
              ? tr('Работает в установленном приложении: на экране «Домой» телефона или установленном из Chrome / Edge на компьютере.')
              : tr('Этот браузер не умеет показывать число на иконке. Установите приложение из Chrome, Edge или Safari.')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="app-badge-title"
          disabled={isPending || save.isPending}
          onClick={() => save.mutate(!on)}
          className={cn(
            'relative mt-0.5 h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
            on ? 'bg-primary' : 'bg-muted-foreground/40',
          )}
        >
          <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]', on ? 'left-[18px]' : 'left-0.5')} />
        </button>
      </div>
    </section>
  )
}
