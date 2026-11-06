// Service worker нужен только для системных уведомлений о сообщениях чата (на Android Chrome без него они не показываются).
// Ничего не кэширует и запросы не перехватывает.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
