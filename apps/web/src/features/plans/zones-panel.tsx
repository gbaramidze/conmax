import { Link } from '@tanstack/react-router'
import { Check, Circle, CornerDownRight, ExternalLink, Pencil, Plus, Square, Spline, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { LOCATION_KIND_LABELS, locationLabel, PURPOSE_LABELS, PURPOSES, type LocationKind, type LocationPurpose, type LocationRow } from '@/features/locations/api'
import { areaWidths, formatSquareMeters } from '@/features/plans/objects'
import { PURPOSE_COLORS, ZONE_MODE_LABELS, zoneColor, zoneShortName, type PlanZone, type ZoneColorMode } from '@/features/plans/zones'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const pct = (z: PlanZone) => (z.ffe_total > 0 ? Math.round((100 * z.ffe_installed) / z.ffe_total) : null)

export interface ZonesPanelProps {
  code: string
  locations: LocationRow[]
  zones: PlanZone[]
  canManage: boolean
  colorMode: ZoneColorMode
  onColorMode: (m: ZoneColorMode) => void
  showZones: boolean
  onShowZones: (v: boolean) => void
  selected: PlanZone | null
  onSelect: (z: PlanZone | null) => void
  /** Место, чью зону рисуем сейчас */
  armedId: string | null
  onArm: (id: string | null) => void
  tool: 'rect' | 'poly'
  onTool: (t: 'rect' | 'poly') => void
  /** Место, внутри которого размечаем (этаж для помещений, корпус для этажей…) */
  parentId: string | null
  onParent: (id: string | null) => void
  parentOptions: { id: string; label: string }[]
  /** Места внутри выбранного: их зоны рисуем по очереди */
  candidates: LocationRow[]
  typeColor: (name: string | null) => string
  onDelete: (z: PlanZone) => void
  busy: boolean
  /** Текущий лист, метров в его ширине (null — масштаб не задан) и пропорции листа: из них считается площадь зоны */
  page: number
  scale: number | null
  aspect: number
  /** Типы номеров проекта: зона типа обводится на плане этажа, тип выбирается после обводки (ONE BEDROOM, KING 1…) */
  roomTypes: { id: string; name: string }[]
  /** Сменить тип у готовой зоны типа */
  onChangeType: (z: PlanZone, typeId: string) => void
  /** Режим «обвести зону типа номера»: обвели, потом выбрали тип */
  typeDraw: boolean
  /** Выбранный для обводки тип (null — тип спросим после обводки) */
  typeArmId: string | null
  onTypeDraw: (on: boolean, typeId?: string | null) => void
  /** Сменить назначение помещения (квартира, машино-место…) */
  onSetPurpose: (z: PlanZone, purpose: LocationPurpose) => void
  /** Размечать внутри выбранного места: санузел, прихожая и балкон квартиры */
  onEnter: (z: PlanZone) => void
  /** Создать место внутри выбранного и сразу обвести его */
  onCreatePlace: (input: { name: string; kind: 'room' | 'zone'; purpose: LocationPurpose | null }) => void
  parentKind: LocationKind | null
  /** План привязан к нескольким этажам (типовой): номер обводится один раз и ставится на все этажи группы */
  typical: { floors: { id: string; label: string }[]; viewFloorId: string; onViewFloor: (id: string) => void; applyAll: boolean; onApplyAll: (v: boolean) => void } | null
}

const ROOM_NAMES = [tr('Санузел'), tr('Прихожая'), tr('Балкон'), tr('Кухня'), tr('Спальня'), tr('Гостиная'), tr('Коридор'), tr('Лоджия'), tr('Гардеробная')]

/** Добавить место внутри выбранного: название, вид (помещение или зона внутри помещения) и назначение. */
function PlaceForm({ parentKind, busy, onCreate }: { parentKind: LocationKind | null; busy: boolean; onCreate: ZonesPanelProps['onCreatePlace'] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'room' | 'zone'>('room')
  const [purpose, setPurpose] = useState<LocationPurpose>('apartment')
  // внутри помещения (квартиры) место — это его зона: санузел, прихожая, балкон
  const inside = parentKind === 'room'
  const k = inside ? 'zone' : kind
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> {tr('Добавить место внутри')}
      </Button>
    )
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border bg-background p-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) {
          onCreate({ name: name.trim(), kind: k, purpose: k === 'room' ? purpose : null })
          setName('')
        }
      }}
    >
      {inside && (
        <>
          <p className="text-xs text-muted-foreground">{tr('Часть помещения: выберите название или введите своё.')}</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label={tr('Частые названия')}>
            {ROOM_NAMES.map((n) => (
              <button key={n} type="button" onClick={() => setName(n)} className="min-h-8 rounded-md border px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                {n}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="place-name" className="text-xs text-muted-foreground">
          {tr('Название')}
        </label>
        <input id="place-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={inside ? tr('Например, Санузел') : tr('Например, Квартира 1305')} className="h-9 rounded-md border bg-background px-2 text-sm" autoFocus />
      </div>
      {!inside && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="place-kind" className="text-xs text-muted-foreground">
              {tr('Что это')}
            </label>
            <select id="place-kind" value={kind} onChange={(e) => setKind(e.target.value as 'room' | 'zone')} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="room">{LOCATION_KIND_LABELS.room}</option>
              <option value="zone">{LOCATION_KIND_LABELS.zone}</option>
            </select>
          </div>
          {kind === 'room' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="place-purpose" className="text-xs text-muted-foreground">
                {tr('Назначение')}
              </label>
              <select id="place-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as LocationPurpose)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {PURPOSES.map((x) => (
                  <option key={x} value={x}>
                    {PURPOSE_LABELS[x]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {tr('Добавить и обвести')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {tr('Закрыть')}
        </Button>
      </div>
    </form>
  )
}

/** Вкладка «Зоны» боковой панели плана: раскраска, разметка помещений (для управляющих структурой) и сведения о выбранной зоне. */
export function ZonesPanel(p: ZonesPanelProps) {
  // что размечаем: тип номера (по умолчанию) или конкретное помещение
  const [what, setWhat] = useState<'type' | 'place'>('type')
  const children = p.candidates
  const zonedIds = useMemo(() => new Set(p.zones.map((z) => z.location_id)), [p.zones])
  const todo = children.filter((c) => !zonedIds.has(c.id))
  const armed = p.locations.find((l) => l.id === p.armedId)
  const types = useMemo(() => [...new Set(p.zones.map((z) => z.type_name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [p.zones])

  const purposes = useMemo(() => [...new Set(p.zones.map((z) => z.purpose ?? 'other'))].sort(), [p.zones])
  const legend: [string, string][] =
    p.colorMode === 'ffe'
      ? [
          ['#94a3b8', tr('нет мебели или не начато')],
          ['#f59e0b', tr('установлена частично')],
          ['#16a34a', tr('установлена вся')],
        ]
      : p.colorMode === 'tasks'
        ? [
            ['#94a3b8', tr('задач нет')],
            ['#f59e0b', tr('есть открытые')],
            ['#dc2626', tr('есть просроченные')],
          ]
        : p.colorMode === 'type'
          ? types.map((t) => [p.typeColor(t), t] as [string, string])
          : p.colorMode === 'purpose'
            ? purposes.map((x) => [PURPOSE_COLORS[x] ?? '#94a3b8', PURPOSE_LABELS[x as LocationPurpose] ?? x] as [string, string])
            : []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {tr('Зоны на плане')} <span className="font-normal text-muted-foreground">{p.zones.length}</span>
        </h2>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5" checked={p.showZones} onChange={(e) => p.onShowZones(e.target.checked)} />
          {tr('показывать')}
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="zone-mode" className="text-xs text-muted-foreground">
          {tr('Раскраска')}
        </label>
        <select id="zone-mode" value={p.colorMode} onChange={(e) => p.onColorMode(e.target.value as ZoneColorMode)} className="h-9 rounded-md border bg-background px-2 text-sm">
          {(Object.keys(ZONE_MODE_LABELS) as ZoneColorMode[]).map((m) => (
            <option key={m} value={m}>
              {ZONE_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {legend.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label={tr('Легенда')}>
            {legend.map(([c, label]) => (
              <li key={label} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: c }} />
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.selected && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft">
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: zoneColor(p.selected, p.colorMode, p.typeColor) }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{p.selected.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {p.selected.kind === 'room_type' ? tr('Зона типа номера') : (LOCATION_KIND_LABELS[p.selected.kind as keyof typeof LOCATION_KIND_LABELS] ?? p.selected.kind)}
                {p.selected.type_name && p.selected.kind !== 'room_type' ? ` · ${p.selected.type_name}` : ''}
              </p>
              {p.scale && p.selected.page === p.page && (
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{tr('Площадь по плану: {{n}}', { n: formatSquareMeters(areaWidths(p.selected.points, p.aspect) * p.scale * p.scale) })}</p>
              )}
              {p.selected.kind === 'room_type' ? (
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {p.selected.ffe_total > 0 ? tr('в составе типа: {{n}} шт', { n: p.selected.ffe_total }) : tr('состав типа не задан')}
                  {' · '}
                  {tr('номеров этого типа: {{n}}', { n: p.selected.rooms ?? 0 })}
                </p>
              ) : (
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {p.selected.ffe_total > 0 ? `${tr('мебель')} ${p.selected.ffe_installed}/${p.selected.ffe_total}` : tr('мебель не задана')}
                {' · '}
                {p.selected.tasks_open > 0 ? tr('открытых задач: {{n}}', { n: p.selected.tasks_open }) : tr('открытых задач нет')}
                {p.selected.tasks_overdue > 0 && <span className="text-red-700 dark:text-red-300"> {tr('(просрочено {{n}})', { n: p.selected.tasks_overdue })}</span>}
              </p>
              )}
            </div>
          </div>
          {p.canManage && p.selected.kind === 'room_type' && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tr('Тип номера')}</span>
              <SearchSelect
                value={p.roomTypes.find((t) => t.name === p.selected!.type_name)?.id ?? ''}
                onChange={(v) => v && p.onChangeType(p.selected!, v)}
                options={p.roomTypes.map((t) => ({ value: t.id, label: t.name }))}
                ariaLabel={tr('Тип номера')}
                disabled={p.busy}
              />
            </div>
          )}
          {p.canManage && p.selected.kind === 'room' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="zone-purpose" className="text-xs text-muted-foreground">
                {tr('Назначение')}
              </label>
              <select
                id="zone-purpose"
                value={p.selected.purpose ?? ''}
                disabled={p.busy}
                onChange={(e) => e.target.value && p.onSetPurpose(p.selected!, e.target.value as LocationPurpose)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {!p.selected.purpose && <option value="">{tr('Не указано')}</option>}
                {PURPOSES.map((x) => (
                  <option key={x} value={x}>
                    {PURPOSE_LABELS[x]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {p.selected.kind === 'room_type' ? (
            <div className="flex flex-wrap gap-1.5">
              <Button asChild size="sm" variant="secondary">
                <Link to="/projects/$code/ffe" params={{ code: p.code }} search={{ tab: 'types', type: p.selected.location_id }}>
                  <ExternalLink /> {tr('Открыть тип')}
                </Link>
              </Button>
              {p.canManage && (
                <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => p.onDelete(p.selected!)}>
                  <Trash2 /> {tr('Убрать зону')}
                </Button>
              )}
            </div>
          ) : (
          <div className="flex flex-wrap gap-1.5">
            <Button asChild size="sm" variant="secondary">
              <Link to="/projects/$code/locations/$path" params={{ code: p.code, path: p.selected.path }}>
                <ExternalLink /> {tr('Открыть место')}
              </Link>
            </Button>
            {p.canManage && (
              <>
                <Button size="sm" variant="outline" onClick={() => p.onEnter(p.selected!)}>
                  <CornerDownRight /> {tr('Разметить внутри')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => p.onArm(p.selected!.location_id)}>
                  <Pencil /> {tr('Перерисовать')}
                </Button>
                <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => p.onDelete(p.selected!)}>
                  <Trash2 /> {tr('Убрать зону')}
                </Button>
              </>
            )}
          </div>
          )}
        </div>
      )}

      {p.canManage && (
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-3" aria-label={tr('Разметка зон')}>
          <h3 className="text-sm font-semibold">{tr('Разметка')}</h3>
          {p.roomTypes.length > 0 && (
            <div className="inline-flex w-fit rounded-lg border p-0.5" role="group" aria-label={tr('Что размечаем')}>
              <Button
                size="sm"
                variant={what === 'type' ? 'secondary' : 'ghost'}
                aria-pressed={what === 'type'}
                onClick={() => {
                  setWhat('type')
                  p.onArm(null)
                }}
              >
                {tr('Типы номеров')}
              </Button>
              <Button
                size="sm"
                variant={what === 'place' ? 'secondary' : 'ghost'}
                aria-pressed={what === 'place'}
                onClick={() => {
                  setWhat('place')
                  p.onTypeDraw(false)
                }}
              >
                {tr('Конкретные номера')}
              </Button>
            </div>
          )}
          {p.typical && (
            <div className="flex flex-col gap-1.5 rounded-md bg-muted/60 p-2">
              <p className="text-xs">{tr('Типовой план: этажи {{n}}', { n: p.typical.floors.map((f) => f.label.replace(/^\D+/, '')).join(', ') })}</p>
              <label htmlFor="zone-floor" className="text-xs text-muted-foreground">
                {tr('Показать зоны этажа')}
              </label>
              <select id="zone-floor" value={p.typical.viewFloorId} onChange={(e) => p.typical!.onViewFloor(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {p.typical.floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 size-3.5" checked={p.typical.applyAll} onChange={(e) => p.typical!.onApplyAll(e.target.checked)} />
                <span>{tr('Обвести один раз для всех этажей: такой же номер на других этажах получит ту же зону')}</span>
              </label>
            </div>
          )}
          {what === 'type' && p.roomTypes.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">{tr('Выберите тип и обведите на плане все номера этого типа. Или обведите номер, а тип выберите потом.')}</p>
              <div className="inline-flex w-fit rounded-lg border p-0.5" role="group" aria-label={tr('Чем обводить')}>
                <Button size="sm" variant={p.tool === 'rect' ? 'secondary' : 'ghost'} aria-pressed={p.tool === 'rect'} onClick={() => p.onTool('rect')}>
                  <Square /> {tr('Прямоугольник')}
                </Button>
                <Button size="sm" variant={p.tool === 'poly' ? 'secondary' : 'ghost'} aria-pressed={p.tool === 'poly'} onClick={() => p.onTool('poly')}>
                  <Spline /> {tr('Многоугольник')}
                </Button>
              </div>
              <Button size="sm" variant={p.typeDraw && !p.typeArmId ? 'default' : 'outline'} aria-pressed={p.typeDraw && !p.typeArmId} className="w-fit" onClick={() => p.onTypeDraw(!(p.typeDraw && !p.typeArmId), null)}>
                <Pencil /> {p.typeDraw && !p.typeArmId ? tr('Готово') : tr('Обвести, тип выберу потом')}
              </Button>
              <ul className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto" aria-label={tr('Типы номеров')}>
                {p.roomTypes.map((t) => {
                  const on = p.typeDraw && p.typeArmId === t.id
                  const drawn = p.zones.filter((z) => z.kind === 'room_type' && z.type_name === t.name).length
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => p.onTypeDraw(!on, on ? null : t.id)}
                        aria-pressed={on}
                        className={cn('flex min-h-10 w-full items-center gap-2 rounded-md border px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', on && 'border-primary bg-primary/10 font-medium')}
                      >
                        <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: p.typeColor(t.name) }} />
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {drawn > 0 && <span className="text-xs tabular-nums text-muted-foreground">{drawn}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {p.typeDraw && (
                <p className="rounded-md bg-signal/15 px-2 py-1.5 text-xs">
                  {p.typeArmId
                    ? tr('Обводите на плане номера типа «{{name}}»: каждый обведённый сохраняется сразу.', { name: p.roomTypes.find((t) => t.id === p.typeArmId)?.name ?? '' })
                    : tr('Обведите номер на плане, затем выберите его тип.')}
                </p>
              )}
            </>
          ) : (
            <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="zone-parent" className="text-xs text-muted-foreground">
              {tr('Размечаем места внутри')}
            </label>
            <select id="zone-parent" value={p.parentId ?? ''} onChange={(e) => p.onParent(e.target.value || null)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">{tr('Выберите место…')}</option>
              {p.parentOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex w-fit rounded-lg border p-0.5" role="group" aria-label={tr('Чем обводить')}>
            <Button size="sm" variant={p.tool === 'rect' ? 'secondary' : 'ghost'} aria-pressed={p.tool === 'rect'} onClick={() => p.onTool('rect')}>
              <Square /> {tr('Прямоугольник')}
            </Button>
            <Button size="sm" variant={p.tool === 'poly' ? 'secondary' : 'ghost'} aria-pressed={p.tool === 'poly'} onClick={() => p.onTool('poly')}>
              <Spline /> {tr('Многоугольник')}
            </Button>
          </div>
          {p.parentId && children.length === 0 && <p className="text-xs text-muted-foreground">{tr('Внутри этого места пока ничего нет.')}</p>}
          {p.parentId && <PlaceForm key={p.parentId} parentKind={p.parentKind} busy={p.busy} onCreate={p.onCreatePlace} />}
          {children.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{tr('Нарисовано {{n}} из {{total}}', { n: children.length - todo.length, total: children.length })}</span>
                <Button size="sm" variant="outline" disabled={todo.length === 0} onClick={() => p.onArm(todo[0]!.id)}>
                  {tr('Следующее без зоны')}
                </Button>
              </div>
              <ul className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto" aria-label={tr('Места для разметки')}>
                {children.map((c) => {
                  const done = zonedIds.has(c.id)
                  const on = c.id === p.armedId
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => p.onArm(on ? null : c.id)}
                        aria-pressed={on}
                        className={cn('flex min-h-9 w-full items-center gap-1.5 rounded-md border px-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', on && 'border-primary bg-primary/10 font-medium')}
                      >
                        {done ? <Check className="size-3.5 shrink-0 text-emerald-600" aria-label={tr('нарисована')} /> : <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-label={tr('не нарисована')} />}
                        <span className="truncate">{zoneShortName(c)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {armed && (
            <p className="rounded-md bg-signal/15 px-2 py-1.5 text-xs">
              {p.tool === 'rect' ? tr('Обведите «{{name}}» на плане: нажмите, потяните и отпустите.', { name: armed.name }) : tr('Нажимайте вершины «{{name}}» на плане, замкните фигуру у первой точки или кнопкой «Готово».', { name: armed.name })}
            </p>
          )}
            </>
          )}
        </section>
      )}

      {p.zones.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {p.canManage ? tr('Зон на плане пока нет. Выберите место для разметки выше и обведите его на плане.') : tr('На плане пока нет зон.')}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" aria-label={tr('Зоны этого плана')}>
          {p.zones.map((z) => (
            <li key={z.id}>
              <button
                type="button"
                onClick={() => p.onSelect(z)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50', z.id === p.selected?.id && 'bg-signal/15')}
              >
                <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: zoneColor(z, p.colorMode, p.typeColor) }} />
                <span className="min-w-0 flex-1 truncate" title={locationLabel(z.path, p.locations)}>
                  {z.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {pct(z) !== null ? `${pct(z)}%` : '—'}
                  {z.tasks_open > 0 && <span className={cn('ml-2', z.tasks_overdue > 0 && 'text-red-700 dark:text-red-300')}>{z.tasks_open}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
