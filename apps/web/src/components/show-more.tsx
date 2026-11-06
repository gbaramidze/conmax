import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { tr } from '@/lib/tr'

/**
 * Длинный список показывается порциями: сначала `step` строк, дальше по кнопке «Показать ещё». Страница на телефоне не вытягивается
 * на десятки экранов и не строит сотни строк сразу. При смене фильтров (`resetKey`) список возвращается к первой порции.
 */
export function useShowMore<T>(items: T[], step = 40, resetKey?: unknown): { shown: T[]; more: ReactNode } {
  const [count, setCount] = useState(step)
  useEffect(() => setCount(step), [resetKey, step])
  const shown = items.slice(0, count)
  const rest = items.length - shown.length
  const more =
    rest > 0 ? (
      <Button type="button" variant="outline" className="h-12 w-full sm:h-9 sm:w-auto sm:self-center" onClick={() => setCount((c) => c + step)}>
        {tr('Показать ещё ({{n}} из {{rest}})', { n: Math.min(step, rest), rest })}
      </Button>
    ) : null
  return { shown, more }
}
