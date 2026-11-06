import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage } from '@/lib/i18n'

/** Компактный переключатель языка для экранов без меню пользователя (вход, приглашение). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  return (
    <div role="group" aria-label={t('language')} className={`flex items-center gap-1 text-sm ${className ?? ''}`}>
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLanguage(l.code)}
          aria-pressed={i18n.language === l.code}
          className="min-h-8 rounded-md px-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
