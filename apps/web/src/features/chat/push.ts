import { supabase } from '@/lib/supabase'

/**
 * Push о новых сообщениях, когда приложение закрыто (Web Push).
 * Устройство подписывается через service worker и отправляет подписку в базу; сервер (Edge Function send-push) шлёт push на каждое сообщение.
 * Работает в Android Chrome и в установленном на экран «Домой» приложении на iPhone (iOS 16.4+); в обычной вкладке Safari его нет.
 */

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** iPhone/iPad: push доступен только после добавления приложения на экран «Домой». */
export function needsHomeScreenInstall(): boolean {
  if (typeof navigator === 'undefined') return false
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return apple && !standalone
}

function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === b[i])

/**
 * Подписать это устройство и сохранить подписку за вошедшим человеком. Безопасно вызывать при каждом запуске:
 * уже есть подписка с тем же ключом — она просто подтверждается (если устройством пользовались под другим человеком, подписка переходит к текущему).
 * Ничего не делает, если разрешение на уведомления не выдано или сервер не настроен (нет ключа VAPID).
 */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const { data: publicKey } = await supabase.rpc('push_public_key')
  if (!publicKey) return
  const key = keyToBytes(publicKey)

  await navigator.serviceWorker.register('/sw.js')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  // ключ сервера сменился — старая подписка уже не подойдёт
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return
  await supabase.rpc('push_subscribe', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  })
}

/** При выходе из приложения: убрать подписку этого устройства за вошедшим, чтобы его сообщения не приходили следующему человеку на этом телефоне. */
export async function dropPushSubscription(): Promise<void> {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) await supabase.rpc('push_unsubscribe', { p_endpoint: subscription.endpoint })
}
