import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { weatherQuery, weatherSummary } from '@/features/weather/api'
import { addDays } from '@/features/weekly/api'
import { approveDailyLog, dailyLogsQuery, LOG_STATUS_LABELS, LOG_STATUS_STYLES, progressErrorText, reopenDailyLog, saveDailyLog, submitDailyLog, type DailyLog } from './api'

const todayIso = () => new Date().toLocaleDateString('sv')
const dayFmt = new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
const fmt = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00`))

type Form = Omit<DailyLog, 'id' | 'log_date' | 'status' | 'approved_at'>
const empty = (): Form => ({ weather: '', temperature_c: null, work_stopped: false, stop_reason: '', manpower: [], equipment: [], works: '', events: '', visitors: '', notes: '' })
const toForm = (l: DailyLog | undefined, base?: DailyLog): Form =>
  l
    ? { weather: l.weather ?? '', temperature_c: l.temperature_c, work_stopped: l.work_stopped, stop_reason: l.stop_reason ?? '', manpower: l.manpower, equipment: l.equipment, works: l.works ?? '', events: l.events ?? '', visitors: l.visitors ?? '', notes: l.notes ?? '' }
    : { ...empty(), manpower: base?.manpower ?? [], equipment: base?.equipment ?? [] }

/** Журнал дня: погода, люди, техника, выполненные работы, события. Черновик → отправлен → утверждён. */
export function JournalTab({ projectId, canWrite, canApprove }: { projectId: string; canWrite: boolean; canApprove: boolean }) {
  const qc = useQueryClient()
  const { data: logs = [] } = useQuery(dailyLogsQuery(projectId))
  const { data: weather = [] } = useQuery(weatherQuery(projectId))
  const today = todayIso()
  const [date, setDate] = useState(today)
  const current = useMemo(() => logs.find((l) => l.log_date === date), [logs, date])
  const [form, setForm] = useState<Form>(() => toForm(current))
  const [busy, setBusy] = useState(false)
  useEffect(() => setForm(toForm(current)), [current, date])

  const locked = !!current && current.status !== 'draft'
  const editable = canWrite && !locked
  const refresh = () => qc.invalidateQueries({ queryKey: ['progress', 'logs', projectId] })
  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      toast.success(ok)
    } catch (e) {
      toast.error(progressErrorText(e, tr('Не удалось выполнить действие. Повторите попытку.')))
    } finally {
      setBusy(false)
    }
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const copyYesterday = () => {
    const prev = logs.find((l) => l.log_date < date)
    if (!prev) return toast.info(tr('Прежних журналов пока нет'))
    setForm((f) => ({ ...f, manpower: prev.manpower, equipment: prev.equipment }))
    toast.success(tr('Численность и техника скопированы за {{v1}}', { v1: fmt(prev.log_date) }))
  }
  const dayWeather = weather.find((w) => w.day === date)
  const fillWeather = () => {
    if (!dayWeather) return
    setForm((f) => ({ ...f, weather: weatherSummary(dayWeather), temperature_c: dayWeather.tmax !== null && dayWeather.tmin !== null ? Math.round((dayWeather.tmax + dayWeather.tmin) / 2) : f.temperature_c }))
    toast.success(tr('Погода подставлена из прогноза'))
  }
  const save = () => run(() => saveDailyLog(projectId, date, { ...form, temperature_c: form.temperature_c }), tr('Журнал сохранён'))

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside aria-label={tr('Дни')} className="flex flex-col gap-2">
        <DatePicker  value={date} max={addDays(today, 1)} onChange={(v) => v && setDate(v)} aria-label={tr('Дата журнала')} clearable={false} />
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto lg:max-h-[60svh]">
          {logs.slice(0, 40).map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => setDate(l.log_date)} aria-current={l.log_date === date ? 'true' : undefined} className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted ${l.log_date === date ? 'bg-muted font-medium' : ''}`}>
                <span>{fmt(l.log_date)}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${LOG_STATUS_STYLES[l.status]}`}>{LOG_STATUS_LABELS[l.status]}</span>
              </button>
            </li>
          ))}
          {logs.length === 0 && <li className="px-2 text-sm text-muted-foreground">{tr('Журналов пока нет.')}</li>}
        </ul>
      </aside>

      <section aria-label={tr('Журнал за {{date}}', { date })} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr('Журнал за')}{' '}{fmt(date)} {current && <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${LOG_STATUS_STYLES[current.status]}`}>{LOG_STATUS_LABELS[current.status]}</span>}
          </h3>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {dayWeather && (
                <Button variant="outline" size="sm" onClick={fillWeather}>{tr('Подставить погоду')}</Button>
              )}
              <Button variant="outline" size="sm" onClick={copyYesterday}>
                <Copy />{tr('Копировать людей и технику')}</Button>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label={tr('Погода')} id="jl-weather">
            <Input id="jl-weather" value={form.weather ?? ''} maxLength={200} disabled={!editable} onChange={(e) => set('weather', e.target.value)} placeholder={tr('Ясно, ветер слабый')} />
          </Field>
          <Field label={tr('Температура, °C')} id="jl-temp">
            <Input id="jl-temp" type="number" value={form.temperature_c ?? ''} min={-60} max={60} disabled={!editable} onChange={(e) => set('temperature_c', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={form.work_stopped} disabled={!editable} onChange={(e) => set('work_stopped', e.target.checked)} />{tr('Работы остановлены')}</label>
        {form.work_stopped && (
          <Field label={tr('Причина остановки')} id="jl-stop">
            <Input id="jl-stop" value={form.stop_reason ?? ''} maxLength={500} disabled={!editable} onChange={(e) => set('stop_reason', e.target.value)} placeholder={tr('Например, штормовой ветер')} />
          </Field>
        )}

        <Rows
          title={tr('Люди на площадке')}
          rows={form.manpower}
          disabled={!editable}
          add={() => set('manpower', [...form.manpower, { organization: '', profession: '', count: 1 }])}
          remove={(i) => set('manpower', form.manpower.filter((_, k) => k !== i))}
          columns={[
            { key: 'organization', label: tr('Организация'), width: 'flex-1', text: true },
            { key: 'profession', label: tr('Профессия'), width: 'flex-1', text: true },
            { key: 'count', label: tr('Человек'), width: 'w-24', number: true },
          ]}
          onChange={(i, k, v) => set('manpower', form.manpower.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))}
          total={tr('Всего: {{v1}} чел.', { v1: form.manpower.reduce((s, r) => s + (Number(r.count) || 0), 0) })}
        />
        <Rows
          title={tr('Техника')}
          rows={form.equipment}
          disabled={!editable}
          add={() => set('equipment', [...form.equipment, { name: '', count: 1, hours: null }])}
          remove={(i) => set('equipment', form.equipment.filter((_, k) => k !== i))}
          columns={[
            { key: 'name', label: tr('Машина или механизм'), width: 'flex-1', text: true },
            { key: 'count', label: tr('Единиц'), width: 'w-24', number: true },
            { key: 'hours', label: tr('Часов'), width: 'w-24', number: true },
          ]}
          onChange={(i, k, v) => set('equipment', form.equipment.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))}
        />

        <Field label={tr('Выполненные работы')} id="jl-works">
          <Textarea id="jl-works" value={form.works ?? ''} rows={3} maxLength={4000} disabled={!editable} onChange={(e) => set('works', e.target.value)} placeholder={tr('Что сделано за день, на каких этажах и захватках')} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={tr('События и происшествия')} id="jl-events">
            <Textarea id="jl-events" value={form.events ?? ''} rows={2} maxLength={4000} disabled={!editable} onChange={(e) => set('events', e.target.value)} />
          </Field>
          <Field label={tr('Посетители и проверки')} id="jl-visitors">
            <Textarea id="jl-visitors" value={form.visitors ?? ''} rows={2} maxLength={2000} disabled={!editable} onChange={(e) => set('visitors', e.target.value)} />
          </Field>
        </div>
        <Field label={tr('Заметки')} id="jl-notes">
          <Textarea id="jl-notes" value={form.notes ?? ''} rows={2} maxLength={4000} disabled={!editable} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <Button variant="outline" disabled={busy} onClick={save}>{tr('Сохранить черновик')}</Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const id = await saveDailyLog(projectId, date, form)
                    await submitDailyLog(id)
                  }, tr('Журнал отправлен'))
                }
              >{tr('Отправить')}</Button>
            </>
          )}
          {current?.status === 'submitted' && canApprove && (
            <Button disabled={busy} onClick={() => run(() => approveDailyLog(current.id), tr('Журнал утверждён'))}>{tr('Утвердить')}</Button>
          )}
          {current && current.status !== 'draft' && canApprove && (
            <Button variant="ghost" disabled={busy} onClick={() => run(() => reopenDailyLog(current.id), tr('Журнал возвращён в работу'))}>{tr('Вернуть в работу')}</Button>
          )}
          {!canWrite && <p className="text-sm text-muted-foreground">{tr('Журнал ведут прорабы и мастера. У вас доступ на просмотр.')}</p>}
        </div>
      </section>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

interface Col {
  key: string
  label: string
  width: string
  text?: boolean
  number?: boolean
}
function Rows<T extends object>({ title, rows, columns, add, remove, onChange, disabled, total }: { title: string; rows: T[]; columns: Col[]; add: () => void; remove: (i: number) => void; onChange: (i: number, key: string, value: string | number | null) => void; disabled: boolean; total?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          {title} {total && <span className="font-normal text-muted-foreground">· {total}</span>}
        </h4>
        {!disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={add}>
            <Plus />{tr('Строка')}</Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tr('Не заполнено.')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              {columns.map((c) => (
                <Input
                  key={c.key}
                  aria-label={`${title}: ${c.label}`}
                  placeholder={c.label}
                  type={c.number ? 'number' : 'text'}
                  min={c.number ? 0 : undefined}
                  disabled={disabled}
                  className={`h-9 min-w-28 ${c.width}`}
                  value={String((r as Record<string, unknown>)[c.key] ?? '')}
                  onChange={(e) => onChange(i, c.key, c.number ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
                />
              ))}
              {!disabled && (
                <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать строку')} onClick={() => remove(i)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
