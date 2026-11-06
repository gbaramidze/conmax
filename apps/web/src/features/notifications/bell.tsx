import { tr } from '@/lib/tr'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/auth-provider'
import { announceReminder } from '@/features/chat/notify'
import { markRead, notificationCountsQuery } from '@/features/notifications/api'
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
          payload: { link?: string; project_code?: string; entity_key?: string; last_text?: string }
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
            const code = n.payload.project_code
            if (n.payload.link) open(n.payload.link)
            else if (n.entity_type === 'task' && code && n.payload.entity_key) open(`/projects/${code}/tasks/${n.payload.entity_key}`)
            else if (n.entity_type === 'document' && code && n.entity_id) open(`/projects/${code}/document/${n.entity_id}`)
            else if (n.entity_type === 'meeting' && code && n.entity_id) open(`/projects/${code}/meeting/${n.entity_id}`)
            else open('/inbox?tab=all')
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

/** Колокольчик для верхней панели на телефоне. */
export function NotificationBell() {
  const badge = useNotificationBadge()
  return (
    <Link
      to="/inbox"
      search={{ tab: 'all' }}
      aria-label={badge > 0 ? tr('Уведомления, непрочитанных: {{badge}}', { badge }) : tr('Уведомления')}
      className="relative flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="size-5" />
      {badge > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-signal ring-2 ring-background" aria-hidden />}
    </Link>
  )
}
