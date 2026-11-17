export type ThemeMode = 'light' | 'dark' | 'system'

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem('theme')
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', mode)
  } catch {
    // хранилище недоступно (приватный режим) — тема применится только на эту сессию
  }
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  // системная строка телефона (и адресная строка браузера) — в цвет фона страницы
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101214' : '#f2f3f1')
}
