import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { projectCurrencyQuery, symbolOf } from '@/features/projects/currency'
import { setDisplayCurrency, setProjectMoney, useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/** Сообщает показу сумм валюту и курс открытого проекта. Один раз на проект, рядом с экраном. */
export function useSyncProjectMoney(projectId: string) {
  const { data } = useQuery(projectCurrencyQuery(projectId))
  useEffect(() => {
    if (data) setProjectMoney(data.code, data.rate)
  }, [data])
}

/**
 * Переключатель показа сумм ₾ / $: все суммы на экране пересчитываются по курсу проекта. Виден, когда курс указан;
 * иначе подсказывает, где его задать. Вводятся суммы всегда в валюте, указанной у поля.
 */
export function CurrencySwitch({ className }: { className?: string }) {
  const { code, canSwitch, base } = useDisplayCurrency()
  if (!canSwitch) {
    return <p className={cn('text-xs text-muted-foreground', className)}>{tr('Суммы в {{cur}}. Чтобы переключать лари и доллар, укажите курс в карточке проекта.', { cur: symbolOf(base) })}</p>
  }
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <span id="display-currency-label" className="text-xs text-muted-foreground">
        {tr('Показывать суммы в')}
      </span>
      <div role="group" aria-labelledby="display-currency-label" className="inline-flex overflow-hidden rounded-md border">
        {(['GEL', 'USD'] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={code === c}
            onClick={() => setDisplayCurrency(c)}
            className={cn('min-h-9 min-w-11 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', code === c ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
          >
            {symbolOf(c)}
          </button>
        ))}
      </div>
    </div>
  )
}
