import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@/components/app-shell/brand'
import { LanguageSwitcher } from '@/components/app-shell/language-switcher'

/** Паттерн «Форма (вход)»: на десктопе — тёмная панель с продуктом слева и форма справа; на телефоне — только форма. */
export function AuthLayout({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { t } = useTranslation('auth')
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <span className="text-lg font-semibold tracking-tight text-white">BuildOS</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-white">{t('tagline')}</p>
          <p className="mt-4 text-sidebar-muted">{t('taglineSub')}</p>
        </div>
        {/* сигнальная лента: единственный декоративный элемент */}
        <div
          aria-hidden
          className="h-3 w-full rounded-sm"
          style={{ background: 'repeating-linear-gradient(135deg, #ffc20e 0 14px, #14181b 14px 28px)' }}
        />
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-9" />
            <span className="text-lg font-semibold tracking-tight">BuildOS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-6">{children}</div>
          <LanguageSwitcher className="mt-8 justify-center" />
        </div>
      </main>
    </div>
  )
}
