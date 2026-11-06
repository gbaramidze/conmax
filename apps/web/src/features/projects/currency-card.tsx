import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CURRENCY_SYMBOLS, currencyNames, projectCurrencyQuery } from '@/features/projects/currency'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/**
 * Валюты проекта. Основная (лари или доллар) — в ней хранятся и считаются бюджет, итоги, риски и заявки. Курс (лари за 1 доллар)
 * нужен, чтобы вести договоры и затраты в другой валюте и переключать показ сумм ₾/$. Менять вправе тот, кто правит проект.
 * Смена основной валюты числа не пересчитывает, поэтому выбирать её стоит до ввода сумм; смена курса прошлые записи не трогает.
 */
export function CurrencyCard({ projectId, code, canEdit }: { projectId: string; code: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const { data } = useQuery(projectCurrencyQuery(projectId))
  const current = data?.code ?? 'GEL'
  const currentRate = data?.rate ?? null
  const names = currencyNames()
  const [value, setValue] = useState<string | null>(null)
  const [rate, setRate] = useState<string | null>(null)
  const chosen = value ?? current
  const rateText = rate ?? (currentRate === null ? '' : String(currentRate))
  const rateNum = rateText.trim() === '' ? null : Number(rateText.replace(',', '.'))
  const rateOk = rateNum === null || (Number.isFinite(rateNum) && rateNum > 0)
  const dirty = chosen !== current || (rateNum ?? null) !== currentRate
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('projects').update({ currency: chosen, fx_rate: rateNum }).eq('id', projectId)
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-currency', projectId] }), queryClient.invalidateQueries({ queryKey: ['projects', code] })])
      setValue(null)
      setRate(null)
      toast.success(tr('Валюты проекта сохранены'))
    },
    onError: () => toast.error(tr('Не удалось сохранить валюты. Возможно, у вас нет права править проект.')),
  })
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4" aria-label={tr('Валюты проекта')}>
      <h2 className="text-sm font-semibold">{tr('Валюты проекта')}</h2>
      <p className="max-w-prose text-xs text-muted-foreground">
        {tr('Основная валюта — та, в которой считаются бюджет и итоги. Укажите курс, и договоры и затраты можно будет вводить в другой валюте, а суммы на экране переключать между лари и долларом. Смена курса прошлые записи не пересчитывает.')}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="project-currency" className="text-xs text-muted-foreground">
              {tr('Основная валюта')}
            </label>
            <select id="project-currency" value={chosen} onChange={(e) => setValue(e.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
              {Object.keys(names).map((c) => (
                <option key={c} value={c}>
                  {c} {CURRENCY_SYMBOLS[c] ?? ''} — {names[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="project-fx" className="text-xs text-muted-foreground">
              {tr('Курс: лари за 1 доллар')}
            </label>
            <input id="project-fx" inputMode="decimal" value={rateText} onChange={(e) => setRate(e.target.value)} placeholder="2,70" className="h-10 w-32 rounded-md border bg-background px-3 text-sm tabular-nums" />
          </div>
          <Button size="sm" disabled={save.isPending || !dirty || !rateOk} onClick={() => save.mutate()}>
            {tr('Сохранить')}
          </Button>
          {!rateOk && <p className="w-full text-xs text-destructive">{tr('Курс должен быть положительным числом.')}</p>}
        </div>
      ) : (
        <p className="text-sm">
          {current} {CURRENCY_SYMBOLS[current] ?? ''} {names[current] ? `— ${names[current]}` : ''}
          {currentRate !== null && <span className="text-muted-foreground tabular-nums">{` · ${tr('курс')} ${currentRate}`}</span>}
        </p>
      )}
    </section>
  )
}
