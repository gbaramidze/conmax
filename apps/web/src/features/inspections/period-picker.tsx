import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import type { DateRange } from '@/features/inspections/stats'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

export interface PeriodPreset {
  id: string
  label: string
  range: DateRange
}

const same = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to

/**
 * Выбор периода: быстрые варианты и «Свой период» с двумя датами «с» и «по» (включительно).
 * Значение хранит вызывающий; какой вариант включён, понятно по совпадению с быстрыми.
 */
export function PeriodPicker({ value, onChange, presets, label }: { value: DateRange; onChange: (r: DateRange) => void; presets: PeriodPreset[]; label: string }) {
  const matched = presets.find((p) => same(p.range, value))
  const [customOpen, setCustomOpen] = useState(false)
  const custom = !matched || customOpen

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={label} className="flex w-full flex-wrap overflow-hidden rounded-lg border bg-card sm:w-auto sm:flex-nowrap">
        {[...presets.map((p) => ({ id: p.id, label: p.label, on: !custom && matched?.id === p.id, pick: () => { setCustomOpen(false); onChange(p.range) } })), { id: 'custom', label: tr('Свой период'), on: custom, pick: () => setCustomOpen(true) }].map((b, i) => (
          <Button key={b.id} type="button" variant={b.on ? 'secondary' : 'ghost'} aria-pressed={b.on} className={cn('min-h-11 flex-1 rounded-none px-3 sm:min-h-9 sm:flex-none', i > 0 && 'border-l')} onClick={b.pick}>
            {b.label}
          </Button>
        ))}
      </div>
      {custom && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{tr('С')}</span>
            <DatePicker value={value.from ?? ''} max={value.to ?? undefined} onChange={(v) => onChange({ from: v || null, to: value.to })} aria-label={tr('Период с даты')} placeholder={tr('любая дата')} className="w-44" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{tr('по')}</span>
            <DatePicker value={value.to ?? ''} min={value.from ?? undefined} onChange={(v) => onChange({ from: value.from, to: v || null })} aria-label={tr('Период по дату')} placeholder={tr('любая дата')} className="w-44" />
          </label>
        </div>
      )}
    </div>
  )
}
