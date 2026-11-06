import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { flattenDisciplines, type DisciplineRow } from '@/features/disciplines/api'
import { locationLabel, type LocationRow } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { projectMembersQuery } from '@/features/projects/api'
import {
  CONSTRAINT_LABELS,
  LINK_LABELS,
  LINK_SHORT,
  type Activity,
  type ActivityPatch,
  type ConstraintType,
  type LinkType,
  type ScheduleLink,
} from '@/features/schedule/api'
import { fmtDate } from '@/features/schedule/model'
import { organizationsListQuery } from '@/features/volumes/api'

const NONE = '__none__'

/** Панель выбранной работы: параметры, связи, фактическое выполнение. Каждое поле сохраняется сразу после изменения. */
export function ActivityPanel({
  projectId,
  activity,
  activities,
  links,
  disciplines,
  locations,
  canEdit,
  onClose,
  onPatch,
  onAddLink,
  onChangeLink,
  onRemoveLink,
  onDelete,
}: {
  projectId: string
  activity: Activity | null
  activities: Activity[]
  links: ScheduleLink[]
  disciplines: DisciplineRow[]
  locations: LocationRow[]
  canEdit: boolean
  onClose: () => void
  onPatch: (id: string, patch: ActivityPatch) => Promise<unknown>
  onAddLink: (input: { predecessorId: string; successorId: string; type: LinkType; lagDays: number }) => Promise<unknown>
  onChangeLink: (id: string, patch: { type?: LinkType; lag_days?: number }) => Promise<unknown>
  onRemoveLink: (id: string) => Promise<unknown>
  onDelete: (a: Activity) => Promise<unknown>
}) {
  return (
    <Sheet open={!!activity} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
        {activity && (
          <PanelBody
            key={activity.id}
            projectId={projectId}
            a={activity}
            activities={activities}
            links={links}
            disciplines={disciplines}
            locations={locations}
            canEdit={canEdit}
            onPatch={onPatch}
            onAddLink={onAddLink}
            onChangeLink={onChangeLink}
            onRemoveLink={onRemoveLink}
            onDelete={onDelete}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PanelBody({
  projectId,
  a,
  activities,
  links,
  disciplines,
  locations,
  canEdit,
  onPatch,
  onAddLink,
  onChangeLink,
  onRemoveLink,
  onDelete,
}: {
  projectId: string
  a: Activity
  activities: Activity[]
  links: ScheduleLink[]
  disciplines: DisciplineRow[]
  locations: LocationRow[]
  canEdit: boolean
  onPatch: (id: string, patch: ActivityPatch) => Promise<unknown>
  onAddLink: (input: { predecessorId: string; successorId: string; type: LinkType; lagDays: number }) => Promise<unknown>
  onChangeLink: (id: string, patch: { type?: LinkType; lag_days?: number }) => Promise<unknown>
  onRemoveLink: (id: string) => Promise<unknown>
  onDelete: (a: Activity) => Promise<unknown>
}) {
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const { data: orgs } = useQuery(organizationsListQuery)
  const [name, setName] = useState(a.name)
  const [duration, setDuration] = useState(String(a.duration_days))
  const [percent, setPercent] = useState(String(Math.round(a.percent_complete)))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newPred, setNewPred] = useState(NONE)
  const [newType, setNewType] = useState<LinkType>('FS')
  const [newLag, setNewLag] = useState('0')

  const byId = useMemo(() => new Map(activities.map((x) => [x.id, x])), [activities])
  const preds = links.filter((l) => l.successor_id === a.id)
  const succs = links.filter((l) => l.predecessor_id === a.id)
  const isSummary = a.kind === 'summary'

  // группы, в которые можно переместить работу: любые, кроме неё самой и её потомков
  const groups = useMemo(() => {
    const children = new Map<string, string[]>()
    for (const x of activities) if (x.parent_id) children.set(x.parent_id, [...(children.get(x.parent_id) ?? []), x.id])
    const banned = new Set<string>([a.id])
    const stack = [a.id]
    while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!banned.has(c)) (banned.add(c), stack.push(c))
    return activities.filter((x) => x.kind === 'summary' && !banned.has(x.id))
  }, [activities, a.id])

  const candidates = activities.filter((x) => x.kind !== 'summary' && x.id !== a.id && !preds.some((l) => l.predecessor_id === x.id))

  const save = (patch: ActivityPatch) => onPatch(a.id, patch).catch(() => undefined)

  return (
    <div className="flex flex-col gap-5 p-5">
      <SheetHeader className="p-0">
        <SheetTitle className="pr-8 text-base leading-snug">{a.name}</SheetTitle>
        <SheetDescription>
          {a.start_date ? `${fmtDate(a.start_date)} — ${fmtDate(a.finish_date)}` : tr('Даты ещё не рассчитаны')}
          {a.total_float !== null && tr(' · резерв {{total_float}} дн.', { total_float: a.total_float })}
          {a.is_critical && tr(' · критический путь')}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="act-name">{tr('Название')}</Label>
        <Input id="act-name" value={name} disabled={!canEdit} maxLength={300} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== a.name && void save({ name: name.trim() })} />
      </div>

      {!isSummary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="act-kind">{tr('Вид')}</Label>
            <Select value={a.kind} disabled={!canEdit} onValueChange={(v) => void save({ kind: v as 'task' | 'milestone' })}>
              <SelectTrigger id="act-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">{tr('Работа')}</SelectItem>
                <SelectItem value="milestone">{tr('Веха')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {a.kind === 'task' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="act-dur">{tr('Длительность, раб. дн.')}</Label>
              <Input
                id="act-dur"
                type="number"
                min={1}
                max={5000}
                value={duration}
                disabled={!canEdit}
                onChange={(e) => setDuration(e.target.value)}
                onBlur={() => {
                  const n = Math.max(1, Math.round(Number(duration) || 1))
                  setDuration(String(n))
                  if (n !== a.duration_days) void save({ duration_days: n })
                }}
              />
            </div>
          )}
        </div>
      )}

      {!isSummary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="act-cons">{tr('Ограничение по дате')}</Label>
            <Select
              value={a.constraint_type}
              disabled={!canEdit}
              onValueChange={(v) => void save({ constraint_type: v as ConstraintType, constraint_date: v === 'asap' ? null : (a.constraint_date ?? a.start_date ?? new Date().toLocaleDateString('sv')) })}
            >
              <SelectTrigger id="act-cons" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONSTRAINT_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {a.constraint_type !== 'asap' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="act-cdate">{tr('Дата')}</Label>
              <DatePicker id="act-cdate" disabled={!canEdit} value={a.constraint_date ?? ''} onChange={(v) => v && void save({ constraint_date: v })} clearable={false} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="act-parent">{tr('Входит в группу')}</Label>
        <Select value={a.parent_id ?? NONE} disabled={!canEdit} onValueChange={(v) => void save({ parent_id: v === NONE ? null : v })}>
          <SelectTrigger id="act-parent" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>{tr('Верхний уровень')}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isSummary && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="act-disc">{tr('Направление')}</Label>
              <Select value={a.discipline_id ?? NONE} disabled={!canEdit} onValueChange={(v) => void save({ discipline_id: v === NONE ? null : v })}>
                <SelectTrigger id="act-disc" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Не указано')}</SelectItem>
                  {flattenDisciplines(disciplines).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span style={{ paddingLeft: d.depth * 10 }}>
                        <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="act-org">{tr('Подрядчик')}</Label>
              <Select value={a.contractor_org_id ?? NONE} disabled={!canEdit} onValueChange={(v) => void save({ contractor_org_id: v === NONE ? null : v })}>
                <SelectTrigger id="act-org" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Не указан')}</SelectItem>
                  {(orgs ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="act-resp">{tr('Ответственный')}</Label>
            <Select value={a.responsible_id ?? NONE} disabled={!canEdit} onValueChange={(v) => void save({ responsible_id: v === NONE ? null : v })}>
              <SelectTrigger id="act-resp" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>{tr('Не назначен')}</SelectItem>
                {(members ?? []).map((m) => (m.user ? <SelectItem key={m.user.id} value={m.user.id}>{m.user.full_name}</SelectItem> : null))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Место')}</Label>
            {a.location_id ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{locationLabel(locations.find((l) => l.id === a.location_id)?.path ?? '', locations) || '—'}</span>
                {canEdit && (
                  <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={tr('Убрать место')} onClick={() => void save({ location_id: null })}>
                    <X />
                  </Button>
                )}
              </div>
            ) : canEdit ? (
              <LocationPicker projectId={projectId} value={null} placeholder={tr('Выбрать этаж, секцию или помещение')} onChange={(id) => void save({ location_id: id })} />
            ) : (
              <p className="text-sm text-muted-foreground">{tr('Не указано')}</p>
            )}
          </div>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{tr('Фактическое выполнение')}</legend>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="act-pct">{tr('Готово, %')}</Label>
                <Input
                  id="act-pct"
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canEdit}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  onBlur={() => {
                    const n = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)))
                    setPercent(String(n))
                    if (n !== Math.round(a.percent_complete)) void save({ percent_complete: n })
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="act-as">{tr('Начата')}</Label>
                <DatePicker id="act-as" disabled={!canEdit} value={a.actual_start ?? ''} onChange={(v) => void save({ actual_start: v || null })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="act-af">{tr('Закончена')}</Label>
                <DatePicker id="act-af" disabled={!canEdit} value={a.actual_finish ?? ''} onChange={(v) => void save({ actual_finish: v || null })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{tr('Фактические даты закрепляют работу, а следующие за ней сдвигаются.')}</p>
          </fieldset>

          <section className="flex flex-col gap-3" aria-label={tr('Зависимости')}>
            <h3 className="text-sm font-semibold">{tr('Зависит от')}</h3>
            {preds.length === 0 && <p className="text-sm text-muted-foreground">{tr('Не зависит от других работ.')}</p>}
            <ul className="flex flex-col gap-2">
              {preds.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <span className="min-w-0 flex-1 truncate text-sm" title={byId.get(l.predecessor_id)?.name}>
                    {byId.get(l.predecessor_id)?.name ?? '—'}
                  </span>
                  <Select value={l.type} disabled={!canEdit} onValueChange={(v) => void onChangeLink(l.id, { type: v as LinkType })}>
                    <SelectTrigger size="sm" className="w-28" aria-label={tr('Тип связи')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(LINK_LABELS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {LINK_SHORT[v as LinkType]} · {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={tr('Сдвиг, раб. дн.')}
                    title={tr('Сдвиг в рабочих днях (можно отрицательный)')}
                    type="number"
                    className="h-8 w-16"
                    disabled={!canEdit}
                    defaultValue={l.lag_days}
                    onBlur={(e) => {
                      const n = Math.round(Number(e.target.value) || 0)
                      if (n !== l.lag_days) void onChangeLink(l.id, { lag_days: n })
                    }}
                  />
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать связь')} onClick={() => void onRemoveLink(l.id)}>
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={newPred} onValueChange={setNewPred}>
                  <SelectTrigger size="sm" aria-label={tr('Предшествующая работа')} className="min-w-0 flex-1">
                    <SelectValue placeholder={tr('Добавить зависимость…')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE} disabled>{tr('Выберите работу')}</SelectItem>
                    {candidates.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={newType} onValueChange={(v) => setNewType(v as LinkType)}>
                  <SelectTrigger size="sm" className="w-20" aria-label={tr('Тип новой связи')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LINK_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {LINK_SHORT[v as LinkType]} · {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input aria-label={tr('Сдвиг новой связи, раб. дн.')} type="number" className="h-8 w-16" value={newLag} onChange={(e) => setNewLag(e.target.value)} />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={newPred === NONE}
                  onClick={async () => {
                    try {
                      await onAddLink({ predecessorId: newPred, successorId: a.id, type: newType, lagDays: Math.round(Number(newLag) || 0) })
                      setNewPred(NONE)
                      setNewLag('0')
                      toast.success(tr('Зависимость добавлена'))
                    } catch {
                      /* текст ошибки показывает вызывающий */
                    }
                  }}
                >{tr('Добавить')}</Button>
              </div>
            )}
            {succs.length > 0 && (
              <>
                <h3 className="mt-1 text-sm font-semibold">{tr('От неё зависят')}</h3>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {succs.map((l) => (
                    <li key={l.id}>
                      {LINK_SHORT[l.type]} → {byId.get(l.successor_id)?.name ?? '—'}
                      {l.lag_days !== 0 && tr(' ({{v1}}{{lag_days}} дн.)', { v1: l.lag_days > 0 ? '+' : '', lag_days: l.lag_days })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}

      {a.start_date && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/40 p-3 text-sm">
          <dt className="text-muted-foreground">{tr('Раннее начало')}</dt>
          <dd>{fmtDate(a.start_date)}</dd>
          <dt className="text-muted-foreground">{tr('Раннее окончание')}</dt>
          <dd>{fmtDate(a.finish_date)}</dd>
          <dt className="text-muted-foreground">{tr('Позднее начало')}</dt>
          <dd>{fmtDate(a.late_start)}</dd>
          <dt className="text-muted-foreground">{tr('Позднее окончание')}</dt>
          <dd>{fmtDate(a.late_finish)}</dd>
          <dt className="text-muted-foreground">{tr('Общий резерв')}</dt>
          <dd>{a.total_float ?? '—'}{tr('дн.')}</dd>
          {a.free_float !== null && (
            <>
              <dt className="text-muted-foreground">{tr('Свободный резерв')}</dt>
              <dd>{a.free_float}{tr('дн.')}</dd>
            </>
          )}
        </dl>
      )}

      {canEdit && (
        <div className="flex gap-2 border-t pt-4">
          {confirmDelete ? (
            <>
              <Button variant="destructive" onClick={() => void onDelete(a)}>
                {isSummary ? tr('Удалить группу и вложенные') : tr('Удалить работу')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{tr('Не удалять')}</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 />{tr('Удалить')}</Button>
          )}
        </div>
      )}
    </div>
  )
}
