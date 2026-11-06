import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteSchedule, inspectionErrorText, runSchedule, saveSchedule, type InspectionSchedule } from '@/features/inspections/api'
import { daysBetweenIso, type PlaceInfo } from '@/features/inspections/stats'
import { locationLabel, type LocationRow } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { organizationsListQuery } from '@/features/volumes/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const PRESETS = [7, 14, 30, 90]

const dateFmt = () => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
const fmt = (iso: string) => dateFmt().format(new Date(`${iso}T12:00:00`))

interface Props {
  projectId: string
  code: string
  schedules: InspectionSchedule[]
  places: PlaceInfo[]
  locations: LocationRow[]
  canConduct: boolean
  today: string
}

/** Расписание повторных инспекций: по каждому месту — период, ближайший срок и когда проверяли в последний раз. */
export function SchedulesTab({ projectId, code, schedules, places, locations, canConduct, today }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<InspectionSchedule | 'new' | null>(null)
  const lastByPlace = new Map(places.map((p) => [p.id, p.lastDate]))

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['inspection-schedules', projectId] }), queryClient.invalidateQueries({ queryKey: ['inspections'] })])

  const run = useMutation({
    mutationFn: (id: string) => runSchedule(id),
    onSuccess: async (reportId) => {
      await refresh()
      void navigate({ to: '/projects/$code/inspection/$id', params: { code, id: reportId } })
    },
    onError: (e) => toast.error(inspectionErrorText(e)),
  })
  const toggle = useMutation({
    mutationFn: (s: InspectionSchedule) =>
      saveSchedule(projectId, { id: s.id, locationId: s.location_id, contractorId: s.contractor_org_id, title: s.title, periodDays: s.period_days, nextDue: s.next_due, active: !s.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(inspectionErrorText(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: refresh,
    onError: (e) => toast.error(inspectionErrorText(e)),
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          {tr('Для места можно задать период: когда срок наступает, создаётся новый отчёт-черновик с тем же местом, подрядчиком и схемой, а инспектору приходит уведомление.')}
        </p>
        {canConduct && (
          <Button className="ml-auto min-h-11 sm:min-h-9" onClick={() => setEditing('new')}>
            <Plus /> {tr('Новое расписание')}
          </Button>
        )}
      </div>

      {schedules.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          <CalendarClock className="size-5" aria-hidden />
          {canConduct ? tr('Расписаний пока нет. Добавьте место и период, например «каждые 14 дней».') : tr('Расписаний пока нет.')}
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {schedules.map((s) => {
            const last = lastByPlace.get(s.location_id) ?? null
            const late = s.active && s.next_due < today
            const left = daysBetweenIso(today, s.next_due)
            return (
              <li key={s.id} className={cn('flex flex-wrap items-start gap-x-4 gap-y-2 p-3', !s.active && 'opacity-70')}>
                <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
                  <span className="font-medium">{s.title || (s.location ? locationLabel(s.location.path, locations) : '')}</span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {s.title && s.location && <span>{locationLabel(s.location.path, locations)}</span>}
                    {s.contractor && <span>{s.contractor.name}</span>}
                    <span>{tr('каждые {{n}} дн.', { n: s.period_days })}</span>
                    {s.inspector && <span>{tr('инспектор: {{name}}', { name: s.inspector.full_name })}</span>}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm tabular-nums">
                  <span className={cn(late && 'font-semibold text-red-700 dark:text-red-300')}>
                    {!s.active ? tr('Выключено') : late ? tr('Просрочено с {{d}}', { d: fmt(s.next_due) }) : tr('Срок: {{d}}', { d: fmt(s.next_due) })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.active && !late && (left === 0 ? tr('сегодня') : tr('через {{n}} дн.', { n: left }))}
                    {s.active && !late ? ' · ' : ''}
                    {last ? tr('проверяли {{d}}', { d: fmt(last) }) : tr('ещё не проверяли')}
                  </span>
                </div>
                {canConduct && (
                  <div className="flex flex-wrap items-center gap-1">
                    <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={run.isPending} onClick={() => run.mutate(s.id)}>
                      <Play /> {tr('Провести сейчас')}
                    </Button>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:min-h-8">
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={s.active} disabled={toggle.isPending} onChange={() => toggle.mutate(s)} />
                      {tr('Включено')}
                    </label>
                    <Button type="button" size="icon" variant="ghost" aria-label={tr('Изменить расписание')} title={tr('Изменить расписание')} onClick={() => setEditing(s)}>
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={tr('Удалить расписание')}
                      title={tr('Удалить расписание')}
                      onClick={() => window.confirm(tr('Удалить расписание? Уже созданные отчёты останутся.')) && remove.mutate(s.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && <ScheduleDialog projectId={projectId} today={today} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ScheduleDialog({ projectId, today, existing, onClose }: { projectId: string; today: string; existing: InspectionSchedule | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: orgs } = useQuery(organizationsListQuery)
  const orgOptions: SearchOption[] = (orgs ?? []).map((o) => ({ value: o.id, label: o.name }))
  const [placeId, setPlaceId] = useState<string | null>(existing?.location_id ?? null)
  const [title, setTitle] = useState(existing?.title ?? '')
  const [orgId, setOrgId] = useState(existing?.contractor_org_id ?? '')
  const [period, setPeriod] = useState(String(existing?.period_days ?? 14))
  const [nextDue, setNextDue] = useState(existing?.next_due ?? today)

  const days = Number(period)
  const valid = !!placeId && Number.isInteger(days) && days >= 1 && days <= 365 && !!nextDue

  const save = useMutation({
    mutationFn: () => saveSchedule(projectId, { id: existing?.id, locationId: placeId, contractorId: orgId || null, title: title.trim(), periodDays: days, nextDue, active: existing?.active ?? true }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['inspection-schedules', projectId] }), queryClient.invalidateQueries({ queryKey: ['inspections'] })])
      onClose()
    },
    onError: (e) => toast.error(inspectionErrorText(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? tr('Расписание инспекций') : tr('Новое расписание')}</DialogTitle>
          <DialogDescription>{tr('Когда срок наступит, система создаст черновик отчёта по этому месту и предупредит инспектора.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{tr('Место (этаж, зона, помещение)')}</Label>
            <LocationPicker projectId={projectId} value={placeId} onChange={setPlaceId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sch-title">{tr('Название отчётов')}</Label>
            <Input id="sch-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('По умолчанию — название места')} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sch-period">{tr('Повторять каждые, дней')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="sch-period" type="number" inputMode="numeric" min={1} max={365} value={period} onChange={(e) => setPeriod(e.target.value)} className="w-24" />
              {PRESETS.map((p) => (
                <Button key={p} type="button" size="sm" variant={Number(period) === p ? 'secondary' : 'outline'} aria-pressed={Number(period) === p} className="min-h-11 sm:min-h-8" onClick={() => setPeriod(String(p))}>
                  {p}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sch-due">{tr('Ближайший срок')}</Label>
              <DatePicker id="sch-due" value={nextDue} onChange={setNextDue} clearable={false} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr('Подрядчик')}</Label>
              <SearchSelect value={orgId} onChange={setOrgId} options={orgOptions} noneLabel={tr('Как в прошлом отчёте')} ariaLabel={tr('Подрядчик')} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
