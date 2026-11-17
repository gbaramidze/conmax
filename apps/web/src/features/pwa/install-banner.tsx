import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { tr } from '@/lib/tr'

/**
 * Подсказка «установите приложение» вверху страницы на телефоне и планшете, пока CONMAX открыт в обычной вкладке браузера.
 * Android/Chrome: кнопка «Установить» вызывает системное окно установки. iPhone/iPad и прочие браузеры: короткая инструкция.
 * После установки (открыто как приложение) и на компьютере не показывается; «Закрыть» прячет подсказку на 7 дней.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'install-banner-dismissed'
const DISMISS_DAYS = 7

// Событие приходит один раз и рано, поэтому ловим его сразу при загрузке модуля, а не при показе подсказки
let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return !!at && Date.now() - at < DISMISS_DAYS * 24 * 3600 * 1000
  } catch {
    return false
  }
}

export function InstallBanner() {
  const [, rerender] = useState(0)
  const [hidden, setHidden] = useState(dismissedRecently)

  useEffect(() => {
    const update = () => rerender((n) => n + 1)
    listeners.add(update)
    return () => void listeners.delete(update)
  }, [])

  // только сенсорные устройства (телефон, планшет): на компьютере приложение ставить незачем
  if (hidden || isStandalone() || !window.matchMedia('(pointer: coarse)').matches) return null

  function close() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // без хранилища подсказка вернётся при следующем открытии — не страшно
    }
    setHidden(true)
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    if (outcome === 'accepted') setHidden(true)
    else rerender((n) => n + 1)
  }

  const hint = deferred
    ? tr('Быстрый доступ с экрана телефона, уведомления и работа на весь экран')
    : isApple()
      ? tr('Нажмите «Поделиться» и выберите «На экран Домой»')
      : tr('Откройте меню браузера (⋮) и выберите «Установить приложение»')

  return (
    <div role="region" aria-label={tr('Установка приложения')} className="print:!hidden flex items-center gap-2 bg-primary py-1.5 pl-4 pr-1 text-primary-foreground lg:hidden">
      <Download className="size-5 shrink-0 text-signal" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">{tr('Установите CONMAX как приложение')}</p>
        <p className="text-xs leading-snug opacity-80">{hint}</p>
      </div>
      {deferred && (
        <Button size="sm" className="h-11 shrink-0 bg-signal px-4 text-signal-foreground hover:bg-signal/90" onClick={() => void install()}>
          {tr('Установить')}
        </Button>
      )}
      <button
        type="button"
        aria-label={tr('Закрыть')}
        onClick={close}
        className="grid size-11 shrink-0 place-items-center rounded-md outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-signal"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
