import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'

const dayFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
const fmt = (iso: string | null) => (iso ? dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

interface DatesEvent {
  id: string
  occurred_at: string
  changes: { from_start: string | null; to_start: string | null; from_finish: string | null; to_finish: string | null; reason: string | null; shift_days: number; shifted_activities: number }
  actor: { full_name: string } | null
}

const ERRORS: Record<string, string> = {
  reason_required: tr('Укажите основание: почему меняются сроки.'),
  bad_dates: tr('Окончание не может быть раньше начала.'),
  '42501': tr('Менять сроки проекта могут руководитель проекта и администратор организации.'),
}

/** Сроки проекта: плановые начало и окончание, основание изменения, сдвиг работ графика, история изменений. */
export function ProjectDatesDialog({ projectId, start, finish, canEdit, onClose }: { projectId: string; start: string | null; finish: string | null; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [from, setFrom] = useState(start ?? '')
  const [to, setTo] = useState(finish ?? '')
  const [reason, setReason] = useState('')
  const [shift, setShift] = useState(true)
  const [busy, setBusy] = useState(false)

  const { data: history = [] } = useQuery({
    queryKey: ['project-dates-history', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_events')
        .select('id, occurred_at, changes, actor:users!actor_id(full_name)')
        .eq('entity_type', 'project')
        .eq('entity_id', projectId)
        .eq('event_type', 'dates_changed')
        .order('occurred_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as unknown as DatesEvent[]
    },
  })

  const hadDates = !!start || !!finish
  const changed = from !== (start ?? '') || to !== (finish ?? '')
  const delta = start && from ? diffDays(start, from) : 0
  const bad = !!from && !!to && to < from
  const valid = changed && !bad && (!hadDates || reason.trim().length > 0)
  const summary = useMemo(() => (delta === 0 ? null : delta > 0 ? tr('Начало сдвигается на {{delta}} дн. позже', { delta }) : tr('Начало сдвигается на {{v1}} дн. раньше', { v1: -delta })), [delta])

  const save = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('set_project_dates', {
        p_project: projectId,
        p_start: (from || null) as never,
        p_finish: (to || null) as never,
        p_reason: (reason.trim() || null) as never,
        p_shift_schedule: shift && delta !== 0,
      })
      if (error) throw error
      await Promise.all([qc.invalidateQueries({ queryKey: ['projects'] }), qc.invalidateQueries({ queryKey: ['project-dates-history', projectId] }), qc.invalidateQueries({ queryKey: ['schedule'] })])
      toast.success(tr('Сроки проекта сохранены'))
      onClose()
    } catch (e) {
      const m = e as { message?: string; code?: string }
      const key = Object.keys(ERRORS).find((k) => m.message?.startsWith(k)) ?? m.code
      toast.error((key && ERRORS[key]) || tr('Не удалось сохранить сроки.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Сроки проекта')}</DialogTitle>
          <DialogDescription>{tr('Плановые начало и окончание строительства. От даты начала считается график, поэтому изменение фиксируется с основанием.')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pd-from">{tr('Начало')}</Label>
              <DatePicker id="pd-from" value={from} disabled={!canEdit} onChange={(v) => setFrom(v)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pd-to">{tr('Окончание')}</Label>
              <DatePicker id="pd-to" value={to} min={from || undefined} disabled={!canEdit} onChange={(v) => setTo(v)} />
            </div>
          </div>
          {bad && <p className="text-sm text-red-700 dark:text-red-300">{tr('Окончание не может быть раньше начала.')}</p>}
          {canEdit && hadDates && changed && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pd-reason">{tr('Основание')}</Label>
                <Textarea id="pd-reason" value={reason} rows={2} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder={tr('Например, перенос поставки арматуры, решение заказчика, допсоглашение')} />
              </div>
              {delta !== 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4" checked={shift} onChange={(e) => setShift(e.target.checked)} />
                  <span>
                    <span className="font-medium">{tr('Сдвинуть работы графика вместе с началом.')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {summary}{tr(': даты «начать не раньше», «начать точно» и «закончить не позже» у работ графика сдвинутся на то же число дней, график пересчитается. Базовый план не меняется — создайте новый на экране «График», если сдвиг утверждён.')}</span>
                  </span>
                </label>
              )}
            </>
          )}
          {!canEdit && <p className="text-sm text-muted-foreground">{tr('Менять сроки проекта могут руководитель проекта и администратор организации.')}</p>}

          <section aria-labelledby="pd-history">
            <h3 id="pd-history" className="mb-1.5 text-sm font-semibold">{tr('История изменений')}</h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr('Изменений пока не было.')}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="font-medium">
                      {fmt(h.changes.from_start)} – {fmt(h.changes.from_finish)} → {fmt(h.changes.to_start)} – {fmt(h.changes.to_finish)}
                    </span>
                    {h.changes.reason && <span className="text-muted-foreground">{h.changes.reason}</span>}
                    <span className="text-xs text-muted-foreground">
                      {h.actor?.full_name ?? '—'}, {new Date(h.occurred_at).toLocaleString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {h.changes.shifted_activities > 0 && tr(' · сдвинуто работ графика: {{shifted_activities}} (на {{shift_days}} дн.)', { shifted_activities: h.changes.shifted_activities, shift_days: h.changes.shift_days })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {canEdit ? tr('Отмена') : tr('Закрыть')}
          </Button>
          {canEdit && (
            <Button type="button" disabled={busy || !valid} onClick={save}>
              {busy ? tr('Сохраняем…') : tr('Сохранить')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
