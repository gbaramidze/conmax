import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useAuth } from '@/features/auth/auth-provider'
import { announceMessage, isAttended, registerWorker, watchAttention, type IncomingMessage } from '@/features/chat/notify'
import { PRESENCE_PING_MS, pingPresence, presenceQuery } from '@/features/chat/api'
import { currentLocale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/** Пока вкладка открыта и видна, раз в полминуты отмечаемся в приложении: так другие видят нас «в сети». */
export function usePresencePing(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== 'visible') return
      pingPresence()
        .then(() => queryClient.invalidateQueries({ queryKey: ['presence'] }))
        .catch(() => {}) // отметка не критична: пропустим и повторим через полминуты
    }
    ping()
    const timer = setInterval(ping, PRESENCE_PING_MS)
    document.addEventListener('visibilitychange', ping)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [queryClient])
}

/**
 * Сообщения доходят через Realtime по тем же правилам доступа, что и чтение: чужие каналы сюда не приходят.
 * О новом сообщении от другого человека сообщаем, если он не смотрит в эту переписку: подсказка, системное уведомление, звук, число в заголовке вкладки.
 */
export function useChatRealtime(): void {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { session } = useAuth()
  const me = session?.user.id
  const location = useRouterState({ select: (s) => s.location })
  const locationRef = useRef(location)
  locationRef.current = location

  useEffect(() => {
    registerWorker()
    return watchAttention()
  }, [])

  useEffect(() => {
    const open = (channelId: string) => void navigate({ to: '/chat', search: { channel: channelId } })
    const channel = supabase
      .channel('chat-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (payload) => {
        void queryClient.invalidateQueries({ queryKey: ['chat'] })
        if (payload.eventType !== 'INSERT') return
        const msg = payload.new as IncomingMessage
        if (msg.author_id === me) return
        const here = locationRef.current
        const viewing = here.pathname.replace(/\/$/, '') === '/chat' && (here.search as { channel?: string }).channel === msg.channel_id
        if (viewing && isAttended()) return
        void announceMessage(msg, open).catch(() => {})
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_attachments' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['chat', 'messages'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['chat', 'messages'] })
      })
      // меня добавили в группу или убрали из неё
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_channel_members' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['chat'] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, navigate, me])
}

export interface OnlineState {
  online: boolean
  /** Когда последний раз был в проекте (если был недавно); для «в сети» — тоже заполнено. */
  seenAt: Date | null
}

/** Состояние «в сети» по человеку. Те, кого я не вправе видеть, в ответ сервера не попадают — для них «не в сети». */
export function useOnline(): (userId: string | null | undefined) => OnlineState {
  const { data } = useQuery(presenceQuery)
  return (userId) => {
    const row = userId ? data?.get(userId) : undefined
    return { online: !!row?.online, seenAt: row ? new Date(row.seen_at) : null }
  }
}

/** Подпись: «В сети», «Был в сети 14:20», «Был в сети 27 окт.» или пусто, если давно не заходил. */
export function presenceText(state: OnlineState): string {
  if (state.online) return tr('В сети')
  if (!state.seenAt) return ''
  const sameDay = state.seenAt.toDateString() === new Date().toDateString()
  const fmt = sameDay
    ? new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit' })
    : new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
  return tr('Был(а) в сети: {{when}}', { when: fmt.format(state.seenAt) })
}

/** Зелёная точка «в сети»; для не в сети — серое кольцо (видно, что индикатор есть, но человек не здесь). */
export function OnlineDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={online ? tr('В сети') : tr('Не в сети')}
      className={cn('inline-block size-2.5 shrink-0 rounded-full ring-2 ring-background', online ? 'bg-emerald-500' : 'bg-muted-foreground/40', className)}
    />
  )
}
