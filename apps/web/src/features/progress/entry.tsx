import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search, Settings2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { activitiesQuery, type Activity } from '@/features/schedule/api'
import { fmtDate } from '@/features/schedule/model'
import { addDays } from '@/features/weekly/api'
import { decideProgress, METHOD_LABELS, progressEntriesQuery, progressErrorText, reportProgress, setProgressMethod, type ProgressEntry, type ProgressMethod } from './api'

const todayIso = () => new Date().toLocaleDateString('sv')

/** Ввод факта по работам: что идёт сейчас, что должно было начаться и что просрочено. Ввод зависит от метода работы. */
export function ProgressEntryTab({ projectId, canReport, canApprove, canMethod }: { projectId: string; canReport: boolean; canApprove: boolean; canMethod: boolean }) {
  const qc = useQueryClient()
  const { data: activities = [], isLoading } = useQuery(activitiesQuery(projectId))
  const { data: entries = [] } = useQuery(progressEntriesQuery(projectId))
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'now' | 'all'>('now')
  const [methodFor, setMethodFor] = useState<Activity | null>(null)

  const today = todayIso()
  const horizon = addDays(today, 14)
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return activities
      .filter((a) => a.kind === 'task' || a.kind === 'milestone')
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .filter((a) => (scope === 'all' ? true : a.percent_complete < 100 && !!a.start_date && a.start_date <= horizon && (a.finish_date ?? '9999') >= addDays(today, -30)))
      .sort((x, y) => (x.start_date ?? '').localeCompare(y.start_date ?? '') || x.name.localeCompare(y.name, currentLocale()))
  }, [activities, query, scope, horizon, today])
  const pending = entries.filter((e) => e.status === 'pending')
  const byActivity = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities])
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['progress'] }), qc.invalidateQueries({ queryKey: ['schedule'] }), qc.invalidateQueries({ queryKey: ['budget'] })])

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && (
        <section aria-labelledby="pending" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <h3 id="pending" className="mb-2 text-sm font-semibold">{tr('Ожидают подтверждения:')}{' '}{pending.length}
          </h3>
          <ul className="flex flex-col gap-2">
            {pending.map((e) => (
              <PendingRow key={e.id} entry={e} activity={byActivity.get(e.activity_id)} canApprove={canApprove} onDone={refresh} />
            ))}
          </ul>
          {!canApprove && <p className="mt-2 text-xs text-muted-foreground">{tr('Подтверждает ПТО или прораб. До подтверждения запись не меняет процент работы.')}</p>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Найти работу')} aria-label={tr('Найти работу')} className="pl-9" />
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as 'now' | 'all')}>
          <SelectTrigger className="w-56" aria-label={tr('Какие работы показывать')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="now">{tr('Идут и ближайшие 2 недели')}</SelectItem>
            <SelectItem value="all">{tr('Все работы')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!canReport && <p className="text-sm text-muted-foreground">{tr('Факт вносят прорабы, мастера и ПТО. У вас доступ только на просмотр.')}</p>}

      {list.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{isLoading ? tr('Загружаем график…') : tr('Нет подходящих работ. Выберите «Все работы» или проверьте график.')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.map((a) => (
            <ActivityRow key={a.id} activity={a} canReport={canReport} canMethod={canMethod} today={today} onSaved={refresh} onMethod={() => setMethodFor(a)} last={entries.find((e) => e.activity_id === a.id && e.status !== 'rejected')} />
          ))}
        </ul>
      )}

      {methodFor && <MethodDialog activity={methodFor} onClose={() => setMethodFor(null)} onSaved={async () => { setMethodFor(null); await refresh() }} />}
    </div>
  )
}

function ActivityRow({ activity: a, canReport, canMethod, today, onSaved, onMethod, last }: { activity: Activity; canReport: boolean; canMethod: boolean; today: string; onSaved: () => Promise<unknown>; onMethod: () => void; last?: ProgressEntry }) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const late = !!a.finish_date && a.finish_date < today && a.percent_complete < 100

  const send = async (v: number, text = note) => {
    setBusy(true)
    try {
      await reportProgress({ activityId: a.id, date, value: v, note: text })
      await onSaved()
      toast.success(tr('Факт записан'))
      setValue('')
      setNote('')
    } catch (e) {
      toast.error(progressErrorText(e, tr('Не удалось записать факт. Повторите попытку.')))
    } finally {
      setBusy(false)
    }
  }
  const num = Number(value.replace(',', '.'))
  const valid = value.trim() !== '' && Number.isFinite(num) && num >= 0

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{a.name}</p>
        <p className="text-xs text-muted-foreground">
          {fmtDate(a.start_date)} – {fmtDate(a.finish_date)}
          {late && <span className="text-red-700 dark:text-red-300">{tr('· просрочена')}</span>}
          {a.is_critical && tr(' · критическая')}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-2 w-40 max-w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(a.percent_complete)} aria-valuemin={0} aria-valuemax={100} aria-label={tr('Выполнено {{v1}}%', { v1: Math.round(a.percent_complete) })}>
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${a.percent_complete}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(a.percent_complete)}%
            {a.progress_method === 'quantity' && a.plan_quantity ? tr(' · план {{plan_quantity}} {{v2}}', { plan_quantity: a.plan_quantity, v2: a.quantity_unit ?? '' }) : ''}
          </span>
          {canMethod && (
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={tr('Метод ввода: {{v1}}', { v1: METHOD_LABELS[a.progress_method] })} title={tr('Метод: {{v1}}', { v1: METHOD_LABELS[a.progress_method] })} onClick={onMethod}>
              <Settings2 className="size-3.5" />
            </button>
          )}
        </div>
        {last && (
          <p className="mt-1 text-xs text-muted-foreground">{tr('Последняя запись:')}{' '}{fmtDate(last.entry_date)}, {Math.round(last.percent)}%{last.author ? `, ${last.author.full_name}` : ''}
            {last.status === 'pending' ? tr(' (ждёт подтверждения)') : ''}
            {last.note ? ` — ${last.note}` : ''}
          </p>
        )}
      </div>

      {canReport && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <DatePicker  value={date} max={today} onChange={(v) => setDate(v)} aria-label={tr('Дата записи')} className="h-9 w-36" clearable={false} />
          {(a.progress_method === 'manual' || a.progress_method === 'quantity') && (
            <>
              <Input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={a.progress_method === 'manual' ? tr('% выполнено') : tr('{{unit}} накопленно', { unit: a.quantity_unit ?? tr('объём') })}
                aria-label={a.progress_method === 'manual' ? tr('Процент выполнения') : tr('Накопленный объём')}
                className="h-9 w-32 text-right tabular-nums"
              />
              {(a.progress_method === 'manual' || (valid && num < a.percent_complete)) && (
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={tr('Комментарий')} aria-label={tr('Комментарий')} className="h-9 w-44" />
              )}
              <Button size="sm" disabled={busy || !valid || (a.progress_method === 'manual' && !note.trim())} onClick={() => send(num)}>
                <Check />{tr('Записать')}</Button>
            </>
          )}
          {a.progress_method === 'zero_hundred' && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => send(0, '')}>{tr('Начата')}</Button>
              <Button size="sm" disabled={busy} onClick={() => send(100, '')}>
                <Check />{tr('Закончена')}</Button>
            </>
          )}
          {a.progress_method === 'fifty_fifty' && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => send(0, '')}>{tr('Начата')}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => send(50, '')}>
                50%
              </Button>
              <Button size="sm" disabled={busy} onClick={() => send(100, '')}>
                <Check />{tr('Закончена')}</Button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function PendingRow({ entry: e, activity, canApprove, onDone }: { entry: ProgressEntry; activity?: Activity; canApprove: boolean; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const decide = async (ok: boolean) => {
    setBusy(true)
    try {
      await decideProgress(e.id, ok, '')
      await onDone()
      toast.success(ok ? tr('Запись подтверждена') : tr('Запись отклонена'))
    } catch (err) {
      toast.error(progressErrorText(err, tr('Не удалось сохранить решение.')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-md bg-background/70 p-2.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm">
        <span className="font-medium">{activity?.name ?? tr('Работа')}</span>: {Math.round(activity?.percent_complete ?? 0)}% → <span className="font-semibold tabular-nums">{Math.round(e.percent)}%</span>
        <span className="block text-xs text-muted-foreground">
          {e.author?.full_name ?? '—'}, {fmtDate(e.entry_date)}
          {e.note ? ` — ${e.note}` : ''}
        </span>
      </p>
      {canApprove && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide(true)}>
            <Check />{tr('Подтвердить')}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(false)}>
            <X />{tr('Отклонить')}</Button>
        </div>
      )}
    </li>
  )
}

function MethodDialog({ activity, onClose, onSaved }: { activity: Activity; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [method, setMethod] = useState<ProgressMethod>(activity.progress_method)
  const [qty, setQty] = useState(activity.plan_quantity ? String(activity.plan_quantity) : '')
  const [unit, setUnit] = useState(activity.quantity_unit ?? '')
  const [busy, setBusy] = useState(false)
  const quantity = Number(qty.replace(',', '.'))
  const ok = method !== 'quantity' || (Number.isFinite(quantity) && quantity > 0)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Как вводить факт')}</DialogTitle>
          <DialogDescription>{activity.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pm-method">{tr('Метод')}</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as ProgressMethod)}>
              <SelectTrigger id="pm-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METHOD_LABELS) as ProgressMethod[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {METHOD_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {method === 'quantity' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pm-qty">{tr('Плановый объём')}</Label>
                <Input id="pm-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pm-unit">{tr('Единица')}</Label>
                <Input id="pm-unit" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} placeholder={tr('м³, м², т')} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {method === 'manual' && tr('Процент вводится вручную, комментарий обязателен.')}
            {method === 'quantity' && tr('Вводится накопленный объём; процент считается как объём к плану.')}
            {method === 'zero_hundred' && tr('Работа считается невыполненной (0%), пока не отмечена «Закончена».')}
            {method === 'fifty_fifty' && tr('После отметки «Начата» работа считается выполненной на 50%, после «Закончена» — на 100%.')}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
          <Button
            type="button"
            disabled={busy || !ok}
            onClick={async () => {
              setBusy(true)
              try {
                await setProgressMethod(activity.id, method, method === 'quantity' ? quantity : null, unit)
                await onSaved()
                toast.success(tr('Метод ввода сохранён'))
              } catch (e) {
                toast.error(progressErrorText(e, tr('Не удалось сохранить метод.')))
                setBusy(false)
              }
            }}
          >{tr('Сохранить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
