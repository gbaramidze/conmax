import { queryOptions, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/** Валюты проекта: код → знак. Только лари и доллар: проект ведётся в одной из них, вторая используется по курсу. */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  GEL: '₾',
  USD: '$',
}

export const currencyNames = (): Record<string, string> => ({
  GEL: tr('Грузинский лари'),
  USD: tr('Доллар США'),
})

export const symbolOf = (code: string) => CURRENCY_SYMBOLS[code] ?? code

/** Другая валюта из пары лари/доллар. */
export const otherCurrency = (code: string) => (code === 'GEL' ? 'USD' : 'GEL')

export interface ProjectCurrency {
  /** Основная валюта проекта: в ней хранятся и считаются все итоги. */
  code: string
  /** Курс: лари за 1 доллар; пусто, пока не указан. */
  rate: number | null
}

export const projectCurrencyQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-currency', projectId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProjectCurrency> => {
      const { data, error } = await supabase.from('projects').select('currency, fx_rate').eq('id', projectId).maybeSingle()
      if (error) throw error
      const code = (data?.currency as string | undefined)?.trim()
      return { code: code === 'USD' ? 'USD' : 'GEL', rate: data?.fx_rate === null || data?.fx_rate === undefined ? null : Number(data.fx_rate) }
    },
  })

/** Основная валюта проекта для подписей полей ввода: код («GEL»), знак («₾») и курс. Пока валюта не загрузилась, показываются лари. */
export function useProjectCurrency(projectId: string): { code: string; symbol: string; rate: number | null } {
  const { data } = useQuery(projectCurrencyQuery(projectId))
  const code = data?.code ?? 'GEL'
  return { code, symbol: symbolOf(code), rate: data?.rate ?? null }
}
