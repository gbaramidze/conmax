import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { GROUPS, resetSignalRule, RULE_LABELS, setSignalRule, signalErrorText, signalRulesQuery, type RuleSetting } from '@/features/signals/api'
import { tr } from '@/lib/tr'

// Подписи параметров: «правило.параметр». Единицы — в самой подписи.
const PARAM_LABELS = (): Record<string, string> => ({
  'task_blocked.hours': tr('Заблокирована дольше, часов'),
  'schedule_stale.days': tr('Нет факта дольше, дней'),
  'milestone_slip.warn_days': tr('Сдвиг вехи больше, дней (предупреждение)'),
  'milestone_slip.high_days': tr('Сдвиг вехи больше, дней (важно)'),
  'spi_low_sustained.spi': tr('SPI(t) ниже'),
  'cpi_low_sustained.cpi': tr('CPI ниже'),
  'forecast_divergence.days': tr('Расхождение прогнозов больше, дней'),
  'ppc_low.percent': tr('PPC ниже, %'),
  'lookahead_not_ready.ready_percent': tr('Готово менее, % работ'),
  'commitment_unready.unready_percent': tr('Неготовых больше, % обязательств'),
  'overdue_cluster.count': tr('Просрочено задач больше (предупреждение)'),
  'overdue_cluster.high_count': tr('Просрочено задач больше (важно)'),
  'unassigned_tasks.count': tr('Задач без исполнителя больше'),
  'unassigned_tasks.days': tr('Без исполнителя дольше, дней'),
  'minutes_late.hours': tr('Протокол не опубликован дольше, часов'),
  'rfi_sla_breach.days': tr('RFI без ответа дольше, дней'),
  'eac_over_budget.warn_pct': tr('Прогноз выше бюджета на, % (предупреждение)'),
  'eac_over_budget.high_pct': tr('Прогноз выше бюджета на, % (важно)'),
  'eac_over_budget.critical_pct': tr('Прогноз выше бюджета на, % (критично)'),
  'tcpi_unrealistic.tcpi': tr('TCPI выше'),
  'costs_not_recorded.days': tr('Факт затрат не вносился дольше, дней'),
  'activity_without_budget.coverage_percent': tr('Бюджет закреплён за работами менее, %'),
})

const EXTRA_LABELS = (): Record<string, string> => ({
  weather_risk: tr('Опасная погода'),
  notify_signals: tr('Уведомлять о важных сигналах'),
  agenda_signals_high: tr('Добавлять важные сигналы в повестку совещаний'),
})

const EXTRA_HINTS = (): Record<string, string> => ({
  notify_signals: tr('Тем, кто управляет сигналами проекта, приходит уведомление о новом важном или критическом сигнале.'),
  agenda_signals_high: tr('В оперативное и еженедельное совещание при создании добавляется пункт со списком важных сигналов.'),
})

const sections = () => [
  ...Object.values(GROUPS).map((g) => ({ label: g.label, rules: g.rules as readonly string[] })),
  { label: tr('Погода'), rules: ['weather_risk'] as readonly string[] },
  { label: tr('Уведомления и повестка'), rules: ['notify_signals', 'agenda_signals_high'] as readonly string[] },
]

function errorText(e: unknown): string {
  const message = (e as { message?: string })?.message ?? ''
  if (message.includes('param_out_of_range')) return tr('Значение вне допустимых границ.')
  if (message.includes('params_inconsistent')) return tr('Порог «важно» должен быть выше порога предупреждения.')
  return signalErrorText(e, tr('Не удалось сохранить настройку.'))
}

/** Правила сигналов проекта: включить или выключить, поменять пороги. Правка — тем, у кого право управлять сигналами. */
export function RulesSheet({ projectId, canManage, onClose }: { projectId: string; canManage: boolean; onClose: () => void }) {
  const { data: rules } = useQuery(signalRulesQuery(projectId))
  const byRule = new Map((rules ?? []).map((r) => [r.rule, r]))

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{tr('Правила сигналов проекта')}</SheetTitle>
          <SheetDescription>
            {canManage
              ? tr('Включайте нужные правила и подстраивайте пороги под проект. После изменения сигналы пересчитываются сразу.')
              : tr('Пороги и включённые правила этого проекта. Менять их может руководитель проекта.')}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          {!rules && <p className="text-sm text-muted-foreground">{tr('Загружаем правила…')}</p>}
          {rules &&
            sections().map((s) => (
              <section key={s.label} aria-label={s.label}>
                <h3 className="mb-2 text-sm font-semibold">{s.label}</h3>
                <ul className="flex flex-col divide-y rounded-lg border bg-card">
                  {s.rules.map((r) => {
                    const setting = byRule.get(r)
                    return setting ? <RuleRow key={r} projectId={projectId} setting={setting} canManage={canManage} /> : null
                  })}
                </ul>
              </section>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function RuleRow({ projectId, setting, canManage }: { projectId: string; setting: RuleSetting; canManage: boolean }) {
  const queryClient = useQueryClient()
  const labels = PARAM_LABELS()
  const name = RULE_LABELS[setting.rule] ?? EXTRA_LABELS()[setting.rule] ?? setting.rule
  const hint = EXTRA_HINTS()[setting.rule]
  const keys = Object.keys(setting.params)
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, String(setting.params[k]!.value)])))
  const [busy, setBusy] = useState(false)
  const dirty = keys.some((k) => Number(draft[k]) !== setting.params[k]!.value)
  const overridden = !setting.enabled || keys.some((k) => setting.params[k]!.value !== setting.params[k]!.default)

  const run = async (action: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await action()
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['signals'] }), queryClient.invalidateQueries({ queryKey: ['signal-rules', projectId] })])
      toast.success(ok)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const params = () => Object.fromEntries(keys.map((k) => [k, Number(draft[k])]))

  return (
    <li className="flex flex-col gap-2 p-3">
      <label className="flex min-h-10 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--primary)]"
          checked={setting.enabled}
          disabled={!canManage || busy}
          onChange={(e) => void run(() => setSignalRule(projectId, setting.rule, e.target.checked, params()), e.target.checked ? tr('Правило включено') : tr('Правило выключено'))}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{name}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
      </label>
      {keys.length > 0 && (
        <div className="grid gap-2 pl-7 sm:grid-cols-2">
          {keys.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {labels[`${setting.rule}.${k}`] ?? k}
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={setting.params[k]!.min}
                max={setting.params[k]!.max}
                value={draft[k]}
                disabled={!canManage || busy || !setting.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                aria-label={labels[`${setting.rule}.${k}`] ?? k}
                className="h-9 text-sm text-foreground"
              />
              <span>
                {tr('по умолчанию {{v}}, допустимо {{min}}–{{max}}', { v: setting.params[k]!.default, min: setting.params[k]!.min, max: setting.params[k]!.max })}
              </span>
            </label>
          ))}
        </div>
      )}
      {canManage && (dirty || overridden) && (
        <div className="flex gap-2 pl-7">
          {dirty && (
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => setSignalRule(projectId, setting.rule, setting.enabled, params()), tr('Порог сохранён'))}>
              {tr('Сохранить')}
            </Button>
          )}
          {overridden && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => resetSignalRule(projectId, setting.rule), tr('Возвращено значение по умолчанию'))}>
              <RotateCcw /> {tr('По умолчанию')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
