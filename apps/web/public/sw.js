// Service worker нужен для системных уведомлений о сообщениях чата: на Android Chrome без него они не показываются,
// а push (Web Push) приходит сюда даже когда приложение закрыто. Ничего не кэширует и запросы не перехватывает.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Push с сервера: { title, body, tag, url, image, badge }. Тот же tag, что у уведомления из открытой страницы, поэтому дубль заменяется.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    (async () => {
      // Число на значке иконки (чат + почта), если человек включил его в профиле; 0 — убрать
      if (typeof data.badge === 'number' && 'setAppBadge' in self.navigator) {
        await (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {})
        // Открытая (или свёрнутая) страница знает число точнее (письмо могли уже прочитать) — пусть перечитает и поставит своё
        const open = await self.clients.matchAll({ type: 'window' })
        for (const w of open) w.postMessage({ type: 'badge' })
      }
      // Приложение открыто и в фокусе — человек и так видит сообщение (подсказка поверх страницы), системное уведомление не нужно.
      // Исключение — Apple: Safari требует показывать уведомление на каждый push и иначе отзывает подписку.
      const isApple = /iPhone|iPad|iPod/.test(self.navigator.userAgent)
      if (!isApple) {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return
      }
      await self.registration.showNotification(data.title || 'CONMAX', {
        body: data.body || '',
        tag: data.tag || 'chat',
        renotify: true,
        icon: '/icon-192.png',
        // Фото заметки с площадки (только Android/десктоп Chrome; где не поддерживается — просто не показывается)
        image: data.image || undefined,
        data: { url: data.url || '/' },
      })
    })(),
  )
})

// Нажатие на уведомление: вернуть открытую вкладку приложения и перейти в переписку, иначе открыть новую
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
