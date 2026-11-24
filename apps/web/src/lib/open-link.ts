/**
 * Открытие ссылок из чужого содержимого (письма): свои адреса — переходом внутри приложения,
 * чужие — в браузере. В установленном приложении (PWA) чужая ссылка не должна открывать новое окно приложения.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Приложение запущено как установленное (PWA), а не во вкладке браузера */
export function isStandaloneApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

/**
 * Ссылка ведёт в это же приложение. Кроме точного совпадения адреса считаем своими «локальные» синонимы
 * с тем же портом: письма уведомлений собирают ссылку из APP_URL (например, адрес в сети 192.168…),
 * а приложение может быть открыто по localhost.
 */
export function internalPath(href: string): string | null {
  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const here = window.location
  const same =
    url.origin === here.origin ||
    (url.port === here.port && (LOOPBACK.has(url.hostname) || isPrivateHost(url.hostname)) && (LOOPBACK.has(here.hostname) || isPrivateHost(here.hostname)))
  if (!same) return null
  // служебные адреса (API Supabase через прокси, файлы из public) — не страницы приложения
  if (/^\/(supabase|pdfjs|email)\//.test(url.pathname)) return null
  return url.pathname + url.search + url.hash
}

function isPrivateHost(host: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Чужая ссылка — в браузер. На компьютере (Chrome, Edge) клик по ссылке с target=_blank из окна приложения
 * открывает обычную вкладку браузера, а window.open с параметрами или всплывающее окно из iframe —
 * новое окно приложения; поэтому кликаем ссылку в самом документе приложения.
 * На iPhone в установленном приложении ссылка открывается во встроенном просмотре — отдаём её в Safari.
 */
export function openExternal(href: string): void {
  if (isStandaloneApp() && isIOS() && /^https?:\/\//i.test(href)) {
    window.location.href = `x-safari-${href}`
    return
  }
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer nofollow'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
}
