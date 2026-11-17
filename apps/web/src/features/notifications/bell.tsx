import { tr, trData } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/auth-provider'
import { announceReminder, NotifyPrompt } from '@/features/chat/notify'
import {
  markAllRead,
  markRead,
  notificationCountsQuery,
  notificationUrl,
  recentNotificationsQuery,
  type NotificationRow,
} from '@/features/notifications/api'
import { showNotificationPopup } from '@/features/notifications/popup'
import { supabase } from '@/lib/supabase'

/** Число для значка: высокий приоритет + назначено + упоминания. */
export function useNotificationBadge(): number {
  const { data: counts } = useQuery(notificationCountsQuery)
  return counts?.badge ?? 0
}

/** Realtime-подписка на свои уведомления. Подключается один раз в каркасе приложения. */
export function useNotificationsRealtime(): void {
  const { session } = useAuth()
  const uid = session!.user.id
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (payload) => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        // задачи и замечания инспекций обновляются сразу, когда по ним пришло уведомление
        void queryClient.invalidateQueries({ queryKey: ['inspection-tasks'] })
        void queryClient.invalidateQueries({ queryKey: ['inspection'] })
        void queryClient.invalidateQueries({ queryKey: ['inspection-stats'] })
        if (payload.eventType === 'DELETE') return
        const n = payload.new as {
          id: string
          event_type: string
          entity_type: string | null
          entity_id: string | null
          title: string
          body: string | null
          priority: string
          read_at: string | null
          archived_at: string | null
          snoozed_until: string | null
          updated_at: string
          payload: NotificationRow['payload'] & { last_text?: string }
        }
        // прочитали в списке или на другом устройстве — окно с ним больше не нужно
        if (n.read_at || n.archived_at) {
          toast.dismiss(n.id)
          return
        }
        const open = (to: string) => {
          const u = new URL(to, window.location.origin)
          void navigate({ to: u.pathname as never, search: Object.fromEntries(u.searchParams) as never })
        }
        // напоминание о событии за 10 минут: заметное уведомление с переходом к событию
        if (payload.eventType === 'INSERT' && n.event_type.endsWith('.reminder')) {
          const link = n.payload.link ?? (n.entity_type === 'meeting' && n.payload.project_code ? `/projects/${n.payload.project_code}/meeting/${n.entity_id}` : '/inbox?tab=all')
          void announceReminder({ id: n.id, title: n.title, body: n.body, url: link }, () => open(link))
          return
        }
        // Новое уведомление или свежее обновление сгруппированного (в течение 15 секунд) показываем окном сверху, которое висит до реакции
        const fresh = payload.eventType === 'INSERT' || (!n.snoozed_until && Date.now() - new Date(n.updated_at).getTime() < 15_000)
        if (!fresh || n.event_type.endsWith('.reminder')) return
        // у сгруппированного уведомления тело — сводка, а свежий текст события лежит в last_text
        showNotificationPopup({ ...n, body: n.payload.last_text ?? n.body }, {
          onOpen: () => {
            void markRead([n.id]).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
            open(notificationUrl(n))
          },
        })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [uid, queryClient, navigate])
}

export function BadgeCount({ value, className = '' }: { value: number; className?: string }) {
  if (value <= 0) return null
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-signal px-1.5 text-xs font-semibold leading-5 text-signal-foreground ${className}`}
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

function ago(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' })
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

/**
 * Колокольчик: по нажатию открывает окошко с пятью последними уведомлениями, из него можно перейти к объекту,
 * отметить всё прочитанным или открыть полный список. Одинаков на компьютере и на телефоне, отличается только кнопкой.
 */
export function NotificationsPopover({ variant }: { variant: 'header' | 'mobile' }) {
  const badge = useNotificationBadge()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { data: items, isPending, isError } = useQuery({ ...recentNotificationsQuery, enabled: open })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  const readAll = useMutation({
    mutationFn: () => markAllRead('all'),
    onSuccess: refresh,
    onError: () => toast.error(tr('Не удалось отметить прочитанным. Попробуйте ещё раз.')),
  })

  function go(n: NotificationRow) {
    setOpen(false)
    if (!n.read_at) void markRead([n.id]).then(refresh).catch(() => undefined)
    const u = new URL(notificationUrl(n), window.location.origin)
    void navigate({ to: u.pathname as never, search: Object.fromEntries(u.searchParams) as never })
  }

  const label = badge > 0 ? tr('Уведомления, непрочитанных: {{badge}}', { badge }) : tr('Уведомления')
  const unreadShown = (items ?? []).some((n) => !n.read_at)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === 'header' ? (
          <button
            type="button"
            aria-label={label}
            className="relative ml-1 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="size-5" />
            <BadgeCount value={badge} className="absolute -right-1 -top-1 min-w-4 px-1 text-[11px] leading-4" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={label}
            className="relative flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="size-5" />
            {badge > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-signal ring-2 ring-background" aria-hidden />}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">{tr('Уведомления')}</h2>
          <Button size="sm" variant="ghost" disabled={!unreadShown || readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCheck />{tr('Прочитать всё')}</Button>
        </div>

        {isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{tr('Загружаем уведомления…')}</p>
        ) : isError ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{tr('Не удалось загрузить уведомления. Попробуйте ещё раз.')}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{tr('Здесь пока тихо. Уведомления появятся, когда вас назначат на задачу или упомянут в комментарии.')}</p>
        ) : (
          <ul className="flex max-h-[min(30rem,62vh)] flex-col divide-y overflow-y-auto">
            {items.map((n) => {
              const unread = !n.read_at
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => go(n)}
                    className={`flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${unread ? 'bg-signal/[0.06]' : ''}`}
                  >
                    <span
                      role="img"
                      aria-label={unread ? tr('Не прочитано') : tr('Прочитано')}
                      className={`mt-1.5 size-2.5 shrink-0 rounded-full ${unread ? 'bg-signal ring-2 ring-signal/30' : 'bg-transparent'}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={`line-clamp-1 text-sm ${unread ? 'font-semibold' : 'font-medium'}`}>{trData(n.title)}</span>
                      {n.body && <span className="line-clamp-2 text-sm text-muted-foreground">{trData(n.body)}</span>}
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <time dateTime={n.updated_at}>{ago(n.updated_at)}</time>
                        {n.payload.project_code && <span className="ident">{n.payload.project_code}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <NotifyPrompt className="border-t" message={tr('Включите push, чтобы уведомления приходили, даже когда приложение закрыто')} />
        <Link
          to="/inbox"
          search={{ tab: 'all' }}
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center justify-center border-t text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {tr('Все уведомления')}
        </Link>
      </PopoverContent>
    </Popover>
  )
}

/** Колокольчик для верхней панели на телефоне. */
export function NotificationBell() {
  return <NotificationsPopover variant="mobile" />
}
