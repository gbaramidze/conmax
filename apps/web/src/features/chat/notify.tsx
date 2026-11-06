import { BellRing } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { tr, trData } from '@/lib/tr'

/**
 * Уведомления о новых сообщениях, пока приложение открыто (вкладка свёрнута, в фоне или на другой странице):
 * всплывающая подсказка поверх страницы, системное уведомление ОС (если разрешено), короткий звук, число в заголовке вкладки.
 * Уведомления, когда приложение закрыто совсем, потребуют push-сервера — это отдельный этап.
 */

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

const originalTitle = typeof document !== 'undefined' ? document.title : 'CONMAX'
let unseen = 0

function renderTitle() {
  document.title = unseen > 0 ? `(${unseen}) ${originalTitle}` : originalTitle
}

/** Окно в фокусе и вкладка видна — человек смотрит на приложение. */
export const isAttended = () => document.visibilityState === 'visible' && document.hasFocus()

/** Пока окно не в фокусе, считаем непросмотренное и показываем число в заголовке вкладки. */
export function countUnseen(): void {
  if (isAttended()) return
  unseen += 1
  renderTitle()
}

/** Системное уведомление ОС (если разрешено): через service worker, а без него — обычное. Нажатие возвращает в приложение и вызывает `open`. */
export async function showSystemNotification(o: { title: string; body: string; tag: string; url: string }, open: () => void): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const options: NotificationOptions & { renotify?: boolean } = { body: o.body, tag: o.tag, renotify: true, icon: '/favicon.svg', data: { url: o.url } }
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (registration) {
    await registration.showNotification(o.title, options)
  } else {
    const n = new Notification(o.title, options)
    n.onclick = () => {
      window.focus()
      open()
      n.close()
    }
  }
}

/**
 * Напоминание о событии календаря за 10 минут («Через 10 мин: …»): поверх страницы, если смотрят на приложение (с кнопкой и звуком),
 * иначе системное уведомление и число в заголовке вкладки. Остаётся на экране дольше обычных подсказок.
 */
export async function announceReminder(n: { id: string; title: string; body: string | null; url: string }, open: () => void): Promise<void> {
  if (isAttended()) {
    beep()
    toast(trData(n.title), { id: `reminder-${n.id}`, description: n.body ? trData(n.body) : undefined, duration: 30_000, action: { label: tr('Открыть'), onClick: open } })
    return
  }
  countUnseen()
  await showSystemNotification({ title: trData(n.title), body: trData(n.body ?? ''), tag: `reminder-${n.id}`, url: n.url }, open)
}

/** Сбрасывает число в заголовке, когда человек вернулся в приложение. */
export function watchAttention(): () => void {
  const reset = () => {
    if (isAttended() && unseen !== 0) {
      unseen = 0
      renderTitle()
    }
  }
  window.addEventListener('focus', reset)
  document.addEventListener('visibilitychange', reset)
  return () => {
    window.removeEventListener('focus', reset)
    document.removeEventListener('visibilitychange', reset)
  }
}

export function registerWorker(): void {
  if ('serviceWorker' in navigator && notificationsSupported() && Notification.permission === 'granted') {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
}

export async function enableChatNotifications(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission()
  registerWorker()
  return permission
}

export function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.04
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    setTimeout(() => void ctx.close(), 400)
  } catch {
    // звук необязателен: браузер мог не разрешить его до первого касания страницы
  }
}

interface ChannelInfo {
  id: string
  kind: 'project' | 'discipline' | 'org' | 'group' | 'direct'
  name: string | null
  project: { code: string } | null // у личных переписок и групп проекта нет
  organization: { name: string } | null
  discipline: { code: string; name: string } | null
}

async function describeAttachment(messageId: string): Promise<string> {
  const { data } = await supabase.from('chat_attachments').select('kind').eq('message_id', messageId).limit(1)
  const kind = (data as { kind: string }[] | null)?.[0]?.kind
  if (kind === 'voice') return `🎤 ${tr('Голосовое сообщение')}`
  if (kind === 'image') return `📷 ${tr('Фото')}`
  return `📎 ${tr('Файл')}`
}

export interface IncomingMessage {
  id: string
  channel_id: string
  author_id: string
  body: string
}

/** Показать, что пришло сообщение: подсказка поверх страницы, если смотрят на приложение, иначе системное уведомление. */
export async function announceMessage(msg: IncomingMessage, open: (channelId: string) => void): Promise<void> {
  const attended = isAttended()
  if (!attended) {
    unseen += 1
    renderTitle()
  }

  const [{ data: channelRow }, { data: author }] = await Promise.all([
    supabase
      .from('chat_channels')
      .select('id, kind, name, project:projects(code), organization:organizations(name), discipline:disciplines(code, name)')
      .eq('id', msg.channel_id)
      .maybeSingle(),
    supabase.from('users').select('full_name').eq('id', msg.author_id).maybeSingle(),
  ])
  const channel = channelRow as unknown as ChannelInfo | null
  if (!channel) return

  const who = author?.full_name ?? tr('Участник')
  const where = channel.project?.code ? ` · ${channel.project.code}` : ''
  const heading =
    channel.kind === 'direct'
      ? who
      : channel.kind === 'project'
        ? `${tr('Вся команда')}${where}`
        : channel.kind === 'org'
          ? `${channel.organization?.name ?? tr('Организация')}${where}`
          : channel.kind === 'discipline'
            ? `${channel.discipline?.code ?? ''} · ${channel.discipline?.name ?? tr('Направление')}${where}`
            : (channel.name ?? tr('Группа'))

  let preview = msg.body.trim()
  if (!preview) {
    await new Promise((resolve) => setTimeout(resolve, 500)) // вложения записываются сразу после сообщения
    preview = await describeAttachment(msg.id)
  }
  const text = preview.length > 140 ? `${preview.slice(0, 140)}…` : preview
  const body = channel.kind === 'direct' ? text : `${who.split(' ')[0]}: ${text}`

  if (attended) {
    beep()
    toast(heading, { id: `chat-${channel.id}`, description: body, action: { label: tr('Открыть'), onClick: () => open(channel.id) } })
    return
  }
  await showSystemNotification({ title: heading, body, tag: `chat-${channel.id}`, url: `/chat?channel=${channel.id}` }, () => open(channel.id))
}

/** Полоска в списке чатов: предложить включить системные уведомления или объяснить, почему они не приходят. */
export function NotifyPrompt() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (notificationsSupported() ? Notification.permission : 'unsupported'))
  useEffect(() => {
    if (permission === 'granted') registerWorker()
  }, [permission])
  if (permission === 'unsupported' || permission === 'granted') return null
  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
      <BellRing className="size-4 shrink-0 text-muted-foreground" />
      {permission === 'default' ? (
        <>
          <span className="min-w-0 flex-1">{tr('Получайте уведомления о сообщениях, когда чат свёрнут')}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void enableChatNotifications().then(setPermission)}>
            {tr('Включить')}
          </Button>
        </>
      ) : (
        <span className="min-w-0 flex-1">{tr('Уведомления заблокированы в браузере. Разрешите их в настройках сайта.')}</span>
      )}
    </div>
  )
}
