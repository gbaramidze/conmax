import { useSyncExternalStore } from 'react'

/**
 * Свёрнута ли боковая панель на десктопе. Запоминается в браузере: свернул в почте — так и останется, пока не развернёшь.
 * Кнопка — в верхней панели; сочетание Ctrl + \ (как в Outlook и редакторах кода).
 */
const KEY = 'buildos.sidebar.hidden'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let hidden = read()

export function setSidebarHidden(next: boolean): void {
  hidden = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    /* приватный режим: просто не запомним */
  }
  for (const l of listeners) l()
}

export const toggleSidebar = () => setSidebarHidden(!hidden)

export function useSidebarHidden(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => hidden,
    () => false,
  )
}
