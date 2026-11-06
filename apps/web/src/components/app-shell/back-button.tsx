import { useCanGoBack, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { tr } from '@/lib/tr'

/**
 * Кнопка «Назад» на страницах-карточках (план, документ, задача, совещание, обход): возвращает туда, откуда пришли
 * (например, на этаж, с которого открыли чертёж), а не в общий список. Если страницу открыли по прямой ссылке или
 * обновили, возвращаться некуда — показывается обычная ссылка на список (`fallback`).
 */
export function BackButton({ fallback }: { fallback: ReactNode }) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  if (!canGoBack) return <>{fallback}</>
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => router.history.back()}>
      <ChevronLeft />
      {tr('Назад')}
    </Button>
  )
}
