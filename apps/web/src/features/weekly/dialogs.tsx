import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { projectMembersQuery } from '@/features/projects/api'
import { activitiesQuery, linksQuery } from '@/features/schedule/api'
import { fmtDate } from '@/features/schedule/model'
import { organizationsListQuery } from '@/features/volumes/api'
import { REASON_LABELS, SELECTABLE_REASONS, type CommitmentRow, type Reason } from './api'
import { constraintsQuery, isOpenConstraint } from './lookahead-api'

const NONE = '__none__'

/** Работы графика, которые идут на этой неделе, ещё не завершены и не включены в план. */
export function AddFromScheduleDialog({
  projectId,
  weekStart,
  weekEnd,
  plannedActivityIds,
  busy,
  onClose,
  onAdd,
}: {
  projectId: string
  weekStart: string
  weekEnd: string
  plannedActivityIds: Set<string>
  busy: boolean
  onClose: () => void
  onAdd: (activityIds: string[]) => void
}) {
  const { data: activities = [], isLoading } = useQuery(activitiesQuery(projectId))
  const { data: links = [] } = useQuery(linksQuery(projectId))
  const { data: locations = [] } = useQuery(locationsQuery(projectId))
  const { data: orgs = [] } = useQuery(organizationsListQuery)
  const { data: constraints = [] } = useQuery(constraintsQuery(projectId))
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs])

  // готовность — как в базе: предшественник «окончание → начало» не завершён и не заканчивается до начала недели
  const notReady = useMemo(() => {
    const set = new Set<string>()
    for (const l of links) {
      if (l.type !== 'FS') continue
      const p = byId.get(l.predecessor_id)
      if (p && p.percent_complete < 100 && (p.finish_date ?? '9999-12-31') >= weekStart) set.add(l.successor_id)
    }
    return set
  }, [links, byId, weekStart])

  // открытые ограничения look-ahead по работам
  const openConstraints = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of constraints) if (isOpenConstraint(c)) map.set(c.activity_id, (map.get(c.activity_id) ?? 0) + 1)
    return map
  }, [constraints])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return activities
      .filter((a) => a.kind === 'task' && a.percent_complete < 100 && !plannedActivityIds.has(a.id))
      .filter((a) => a.start_date && a.finish_date && a.start_date <= weekEnd && a.finish_date >= weekStart)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.is_critical) - Number(a.is_critical) || (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  }, [activities, plannedActivityIds, weekStart, weekEnd, query])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[88svh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('Работы из графика')}</DialogTitle>
          <DialogDescription>{tr('Идущие на этой неделе и не завершённые. Критические — выше; отметка «не готова» значит, что предыдущая работа ещё не закончена.')}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Найти работу')} aria-label={tr('Найти работу')} className="pl-9" />
        </div>
        <ul className="-mx-1 min-h-48 flex-1 divide-y overflow-y-auto rounded-md border">
          {candidates.length === 0 && (
            <li className="p-6 text-center text-sm text-muted-foreground">
              {isLoading ? tr('Загружаем график…') : activities.length === 0 ? tr('В графике пока нет работ.') : tr('Нет подходящих работ: всё уже в плане, завершено или не попадает на эту неделю.')}
            </li>
          )}
          {candidates.map((a) => {
            const loc = a.location_id ? locById.get(a.location_id) : null
            return (
              <li key={a.id}>
                <label className="flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/50">
                  <input type="checkbox" className="mt-1 size-4" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(a.start_date)} – {fmtDate(a.finish_date)}
                      {a.percent_complete > 0 && tr(' · готово {{v1}}%', { v1: Math.round(a.percent_complete) })}
                      {loc && ` · ${locationLabel(loc.path, locations)}`}
                      {a.contractor_org_id && orgById.get(a.contractor_org_id) && ` · ${orgById.get(a.contractor_org_id)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {a.is_critical && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">{tr('критическая')}</span>}
                    {notReady.has(a.id) && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">{tr('не готова')}</span>}
                    {openConstraints.has(a.id) && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">{tr('ограничения:')}{' '}{openConstraints.get(a.id)}</span>
                    )}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        {[...picked].some((id) => notReady.has(id) || openConstraints.has(id)) && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">{tr('Среди выбранных есть работы с неснятыми ограничениями или незавершённым предшественником. Их можно взять в план, но в аналитике они будут считаться «не готовыми к старту».')}</p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="button" disabled={picked.size === 0 || busy} onClick={() => onAdd([...picked])}>
            {busy ? tr('Добавляем…') : picked.size > 0 ? tr('Добавить в план ({{size}})', { size: picked.size }) : tr('Добавить в план')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface CommitmentFormValue {
  title: string
  note: string
  locationId: string | null
  organizationId: string | null
  responsibleId: string | null
}

/** Свободный пункт плана недели или правка существующего обязательства. */
export function CommitmentDialog({
  projectId,
  initial,
  busy,
  onClose,
  onSave,
}: {
  projectId: string
  initial: CommitmentRow | null
  busy: boolean
  onClose: () => void
  onSave: (v: CommitmentFormValue) => void
}) {
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const { data: orgs = [] } = useQuery(organizationsListQuery)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [locationId, setLocationId] = useState<string | null>(initial?.location_id ?? null)
  const [org, setOrg] = useState(initial?.organization_id ?? NONE)
  const [who, setWho] = useState(initial?.responsible_id ?? NONE)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? tr('Обязательство') : tr('Свободный пункт плана')}</DialogTitle>
          <DialogDescription>{tr('Что бригада берётся сделать на этой неделе. Итог отмечается в конце недели.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && !busy)
              onSave({ title: title.trim(), note, locationId, organizationId: org === NONE ? null : org, responsibleId: who === NONE ? null : who })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-title">{tr('Что делаем')}</Label>
            <Input id="cm-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={tr('Например, залить плиту перекрытия 5 этажа')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{tr('Место')}</Label>
            <LocationPicker projectId={projectId} value={locationId} onChange={setLocationId} placeholder={tr('Выберите этаж или помещение')} />
            {locationId && (
              <button type="button" className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setLocationId(null)}>{tr('Убрать место')}</button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cm-org">{tr('Подрядчик')}</Label>
              <Select value={org} onValueChange={setOrg}>
                <SelectTrigger id="cm-org" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Не указан')}</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cm-who">{tr('Ответственный')}</Label>
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger id="cm-who" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Не назначен')}</SelectItem>
                  {members
                    .filter((m) => m.user)
                    .map((m) => (
                      <SelectItem key={m.user!.id} value={m.user!.id}>
                        {m.user!.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cm-note">{tr('Пояснение')}</Label>
            <Textarea id="cm-note" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} placeholder={tr('Объём, захватка, условия')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {busy ? tr('Сохраняем…') : tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Причина невыполнения: обязательна. */
export function ReasonDialog({
  commitment,
  busy,
  onClose,
  onSave,
}: {
  commitment: CommitmentRow
  busy: boolean
  onClose: () => void
  onSave: (reason: Reason, note: string) => void
}) {
  const [reason, setReason] = useState<Reason | ''>(commitment.reason && commitment.reason !== 'not_specified' ? commitment.reason : '')
  const [note, setNote] = useState(commitment.reason_note ?? '')

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Почему не сделано')}</DialogTitle>
          <DialogDescription>{commitment.title}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason && !busy) onSave(reason, note)
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{tr('Главная причина')}</legend>
            {SELECTABLE_REASONS.map((r) => (
              <label key={r} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/50">
                <input type="radio" name="reason" className="size-4" checked={reason === r} onChange={() => setReason(r)} />
                <span className="text-sm">{REASON_LABELS[r]}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rs-note">{tr('Подробности')}</Label>
            <Textarea id="rs-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={tr('Необязательно')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!reason || busy}>
              {busy ? tr('Сохраняем…') : tr('Не выполнено')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
