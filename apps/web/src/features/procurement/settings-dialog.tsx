import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { saveSettings, type ProcurementSettings } from './api'
import { field } from './request-form'

/** Пороги согласования (п. 7) и сроки шагов в рабочих днях (п. 13.1) — общие для компании */
export function ProcurementSettingsDialog({ settings, onClose }: { settings: ProcurementSettings; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [v, setV] = useState({
    tier1_limit: String(settings.tier1_limit),
    tier2_limit: String(settings.tier2_limit),
    sla_stock: String(settings.sla_stock),
    sla_sourcing: String(settings.sla_sourcing),
    sla_approval: String(settings.sla_approval),
    sla_committee: String(settings.sla_committee),
    sla_confirm: String(settings.sla_confirm),
    pay_procurement_head: settings.pay_procurement_head === null ? '' : String(settings.pay_procurement_head),
    pay_projects_director: settings.pay_projects_director === null ? '' : String(settings.pay_projects_director),
    pay_finance_director: settings.pay_finance_director === null ? '' : String(settings.pay_finance_director),
    pay_director: settings.pay_director === null ? '' : String(settings.pay_director),
    pay_owner: settings.pay_owner === null ? '' : String(settings.pay_owner),
  })
  const n = (s: string) => Number(s.replace(',', '.').replace(/\s/g, ''))
  const t1 = n(v.tier1_limit)
  const t2 = n(v.tier2_limit)
  const opt = (x: string) => (x.trim() === '' ? null : n(x))
  const valid =
    t1 > 0 &&
    t2 > t1 &&
    Object.entries(v).every(([k, x]) => (k.startsWith('sla') ? Number.isInteger(n(x)) && n(x) >= 0 && n(x) <= 60 : k.startsWith('pay') ? x.trim() === '' || (Number.isFinite(n(x)) && n(x) >= 0) : true))
  const save = useMutation({
    mutationFn: () =>
      saveSettings({ tier1_limit: t1, tier2_limit: t2, sla_stock: n(v.sla_stock), sla_sourcing: n(v.sla_sourcing), sla_approval: n(v.sla_approval), sla_committee: n(v.sla_committee), sla_confirm: n(v.sla_confirm),
        pay_procurement_head: opt(v.pay_procurement_head) ?? 0,
        pay_projects_director: opt(v.pay_projects_director) ?? 0,
        pay_finance_director: opt(v.pay_finance_director) ?? 0,
        pay_director: opt(v.pay_director) ?? 0,
        pay_owner: opt(v.pay_owner),
      }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['procurement-settings'] }), queryClient.invalidateQueries({ queryKey: ['requests'] }), queryClient.invalidateQueries({ queryKey: ['request'] })])
      toast.success(tr('Настройки закупок сохранены'))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось сохранить. Второй порог должен быть больше первого.')),
  })
  const num = (key: keyof typeof v, label: string, hint?: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`ps-${key}`} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input id={`ps-${key}`} inputMode="decimal" value={v[key]} onChange={(e) => setV((x) => ({ ...x, [key]: e.target.value }))} className={cn(field, 'h-10 tabular-nums')} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Пороги и сроки закупок')}</DialogTitle>
          <DialogDescription>{tr('Общие для всех проектов компании. По порогу закупщик видит, кого звать согласовывать; по срокам — когда шаг просрочен и пора напомнить.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{tr('Пороги суммы, ₾ с НДС')}</legend>
            {num('tier1_limit', tr('Уровень 1 — до'), tr('глава закупок + главный инженер или прораб'))}
            {num('tier2_limit', tr('Уровень 2 — до'), tr('+ руководитель проекта и директор; выше — комитет'))}
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{tr('Сроки шагов, рабочих дней')}</legend>
            {num('sla_stock', tr('Взять в работу и проверить склад'))}
            {num('sla_sourcing', tr('Собрать предложения'))}
            {num('sla_approval', tr('Согласование'))}
            {num('sla_committee', tr('Согласование комитетом'))}
            {num('sla_confirm', tr('Подтверждение инициатора'))}
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{tr('Цепочка оплаты: кто подключается от суммы платежа, ₾')}</legend>
            <p className="text-xs text-muted-foreground sm:col-span-2">{tr('Платёж согласуют по очереди. Бухгалтер — всегда первым. Остальные — если сумма не меньше указанной.')}</p>
            {num('pay_procurement_head', tr('Руководитель закупок — от'))}
            {num('pay_projects_director', tr('Директор проектов — от'))}
            {num('pay_finance_director', tr('Финансовый директор — от'))}
            {num('pay_director', tr('Директор — от'))}
            {num('pay_owner', tr('Учредитель — от'), tr('пусто — только когда на платеже отмечено «нужен учредитель»'))}
          </fieldset>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
