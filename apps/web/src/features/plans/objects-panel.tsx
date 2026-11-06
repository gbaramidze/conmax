import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Ruler, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { OBJECT_COLORS, OBJECT_STATUS_COLORS, OBJECT_STATUS_LABELS, OBJECT_TYPES, objectColor, objectIcon, objectType, objectVariant, specTexts, type ObjectStatus, type ObjectType } from '@/features/plans/object-types'
import { formatMeters, pathWidths, type PlanObject } from '@/features/plans/objects'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const STATUSES = Object.keys(OBJECT_STATUS_LABELS) as ObjectStatus[]

const COMPASS: { deg: number; Icon: typeof ArrowUp; label: string }[] = [
  { deg: 315, Icon: ArrowUpLeft, label: tr('вверх-влево') },
  { deg: 0, Icon: ArrowUp, label: tr('вверх') },
  { deg: 45, Icon: ArrowUpRight, label: tr('вверх-вправо') },
  { deg: 270, Icon: ArrowLeft, label: tr('влево') },
  { deg: -1, Icon: ArrowUp, label: '' },
  { deg: 90, Icon: ArrowRight, label: tr('вправо') },
  { deg: 225, Icon: ArrowDownLeft, label: tr('вниз-влево') },
  { deg: 180, Icon: ArrowDown, label: tr('вниз') },
  { deg: 135, Icon: ArrowDownRight, label: tr('вниз-вправо') },
]

/** Значок объекта: у подтипа свой, цвет — свой или цвет типа; у трассы — полоска цвета. */
function Swatch({ t, variant, color, className }: { t: ObjectType; variant?: string | null; color?: string | null; className?: string }) {
  const Icon = objectIcon(t, variant)
  const c = objectColor(t, color)
  return Icon ? (
    <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-full text-white', className)} style={{ background: c }}>
      <Icon className="size-3.5" />
    </span>
  ) : (
    <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center', className)}>
      <span className="block h-1 w-5 rounded" style={{ background: c }} />
    </span>
  )
}

export interface ObjectPatch {
  label: string
  status: ObjectStatus
  notes: string
  variant: string | null
  rotation: number
  size: number
  color: string | null
  specs: Record<string, string | number>
}

export interface ObjectsPanelProps {
  objects: PlanObject[]
  canEdit: boolean
  hiddenTypes: Set<string>
  onToggleType: (code: string) => void
  /** Тип, который ставим сейчас */
  armedType: string | null
  onArm: (code: string | null) => void
  /** Подтип, с которым ставим выбранный тип (камера Dome, Bullet…) */
  armedVariant: string | null
  onArmVariant: (code: string | null) => void
  selected: PlanObject | null
  onSelect: (id: string | null) => void
  onSave: (o: PlanObject, patch: ObjectPatch) => void
  /** Показать правку на плане сразу, до сохранения (null — убрать) */
  onPreview: (o: PlanObject, patch: Pick<ObjectPatch, 'variant' | 'rotation' | 'size' | 'color' | 'specs'> | null) => void
  onDelete: (o: PlanObject) => void
  busy: boolean
  /** Текущая страница, метров в ширине её листа (null — масштаб не задан) и пропорции листа (высота / ширина) */
  page: number
  scale: number | null
  aspect: number
  /** Масштаб: идёт ли рисование отрезка, готовый отрезок ждёт длины */
  calibrating: boolean
  calibReady: boolean
  onCalibStart: () => void
  onCalibCancel: () => void
  onCalibApply: (meters: number) => void
  onScaleReset: () => void
}

/** Вкладка «Слои» боковой панели плана: масштаб, что показывать, что поставить и карточка выбранного объекта. */
export function ObjectsPanel(p: ObjectsPanelProps) {
  const armedT = p.armedType ? OBJECT_TYPES.find((t) => t.code === p.armedType) : undefined
  const lengthOf = (o: PlanObject) => (p.scale && o.geometry === 'line' && o.page === p.page ? pathWidths(o.points, p.aspect) * p.scale : null)
  const present = useMemo(() => {
    const m = new Map<string, { t: ObjectType; total: number; defect: number; meters: number }>()
    for (const o of p.objects) {
      const cur = m.get(o.type_code) ?? { t: objectType(o.type_code, o.geometry), total: 0, defect: 0, meters: 0 }
      cur.total += 1
      if (o.status === 'defect') cur.defect += 1
      cur.meters += p.scale && o.geometry === 'line' && o.page === p.page ? pathWidths(o.points, p.aspect) * p.scale : 0
      m.set(o.type_code, cur)
    }
    return [...m.values()].sort((a, b) => a.t.name.localeCompare(b.t.name))
  }, [p.objects, p.scale, p.aspect, p.page])
  const sorted = useMemo(
    () => [...p.objects].sort((a, b) => objectType(a.type_code, a.geometry).name.localeCompare(objectType(b.type_code, b.geometry).name) || a.label.localeCompare(b.label, undefined, { numeric: true })),
    [p.objects],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
      <h2 className="text-sm font-semibold">
        {tr('Слои на плане')} <span className="font-normal text-muted-foreground">{p.objects.length}</span>
      </h2>

      {p.selected && (
        <ObjectCard key={p.selected.id} o={p.selected} canEdit={p.canEdit} busy={p.busy} length={lengthOf(p.selected)} scaleKnown={!!p.scale} onSave={p.onSave} onPreview={p.onPreview} onDelete={p.onDelete} />
      )}

      <ScaleBox {...p} />

      {p.canEdit && (
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-3" aria-label={tr('Поставить на план')}>
          <h3 className="text-sm font-semibold">{tr('Поставить на план')}</h3>
          {(['point', 'line'] as const).map((g) => (
            <div key={g} className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{g === 'point' ? tr('Точкой: нажмите на плане') : tr('Трассой: нажимайте вершины, «Готово» завершает')}</p>
              <ul className="grid grid-cols-2 gap-1">
                {OBJECT_TYPES.filter((t) => t.geometry === g).map((t) => {
                  const on = p.armedType === t.code
                  return (
                    <li key={t.code}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => p.onArm(on ? null : t.code)}
                        className={cn('flex min-h-10 w-full items-center gap-1.5 rounded-md border px-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', on && 'border-primary bg-primary/10 font-medium')}
                      >
                        <Swatch t={t} />
                        <span className="min-w-0 flex-1 leading-tight">{t.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {armedT?.variants && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{tr('Какой вид ставим: {{name}}', { name: armedT.name })}</p>
              <div className="flex flex-wrap gap-1" role="group" aria-label={tr('Вид')}>
                {[{ code: '', name: tr('Любой') }, ...armedT.variants].map((v) => (
                  <button
                    key={v.code}
                    type="button"
                    aria-pressed={(p.armedVariant ?? '') === v.code}
                    onClick={() => p.onArmVariant(v.code || null)}
                    className={cn('flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', (p.armedVariant ?? '') === v.code && 'border-primary bg-primary/10 font-medium')}
                  >
                    {'Icon' in v && v.Icon && <v.Icon aria-hidden className="size-4 shrink-0" />}
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {present.length > 0 && (
        <section className="flex flex-col gap-1" aria-label={tr('Показывать слои')}>
          <h3 className="text-xs text-muted-foreground">{tr('Показывать')}</h3>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {present.map(({ t, total, defect, meters }) => (
              <li key={t.code}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 px-3 py-1 text-sm">
                  <input type="checkbox" className="size-4" checked={!p.hiddenTypes.has(t.code)} onChange={() => p.onToggleType(t.code)} />
                  <Swatch t={t} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {defect > 0 && <span className="shrink-0 text-xs text-red-700 dark:text-red-300">{tr('дефектов: {{n}}', { n: defect })}</span>}
                  {meters > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMeters(meters)}</span>}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{total}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sorted.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{p.canEdit ? tr('Объектов на плане пока нет. Выберите, что ставить, и нажмите на плане.') : tr('На плане пока нет объектов.')}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" aria-label={tr('Объекты плана')}>
          {sorted.map((o) => {
            const t = objectType(o.type_code, o.geometry)
            const v = objectVariant(t, o.variant)
            const len = lengthOf(o)
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => p.onSelect(o.id)}
                  className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50', o.id === p.selected?.id && 'bg-signal/15', p.hiddenTypes.has(o.type_code) && 'opacity-50')}
                >
                  <Swatch t={t} variant={o.variant} color={o.color} />
                  <span className="min-w-0 flex-1 truncate">
                    {t.name}
                    {v ? <span className="text-muted-foreground"> {v.name.replace(/\s*\(.*\)$/, '').toLowerCase()}</span> : null}
                    {o.label ? <span className="text-muted-foreground"> · {o.label}</span> : null}
                    {specTexts(t, o.specs).length > 0 ? <span className="text-muted-foreground"> · {specTexts(t, o.specs).join(', ')}</span> : null}
                  </span>
                  {len !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMeters(len)}</span>}
                  <span aria-label={OBJECT_STATUS_LABELS[o.status]} title={OBJECT_STATUS_LABELS[o.status]} className="size-2.5 shrink-0 rounded-full" style={{ background: OBJECT_STATUS_COLORS[o.status] }} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Масштаб листа: по одной известной длине (коридор, пролёт между осями) считаются длины трасс и площади зон. */
function ScaleBox(p: ObjectsPanelProps) {
  const [meters, setMeters] = useState('')
  const value = Number(meters.replace(',', '.'))
  const valid = Number.isFinite(value) && value > 0
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3" aria-label={tr('Масштаб плана')}>
      <div className="flex items-center gap-2">
        <Ruler className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{tr('Масштаб плана')}</h3>
        <span className="text-xs text-muted-foreground">{p.scale ? tr('задан: в ширине листа {{n}}', { n: formatMeters(p.scale) }) : tr('не задан')}</span>
      </div>
      {!p.scale && !p.calibrating && !p.calibReady && <p className="text-xs text-muted-foreground">{tr('Обведите известную длину, например коридор или пролёт между осями, и введите её в метрах: тогда у трасс появится длина, а у зон площадь.')}</p>}
      {p.calibrating && <p className="rounded-md bg-signal/15 px-2 py-1.5 text-xs">{tr('Нажмите на плане начало и конец известной длины, затем «Готово».')}</p>}
      {p.calibReady && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) {
              p.onCalibApply(value)
              setMeters('')
            }
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="scale-m" className="text-xs text-muted-foreground">
              {tr('Длина этого отрезка, м')}
            </label>
            <input id="scale-m" inputMode="decimal" value={meters} onChange={(e) => setMeters(e.target.value)} autoFocus className="h-9 rounded-md border bg-background px-2 text-sm" />
          </div>
          <Button type="submit" size="sm" disabled={!valid || p.busy}>
            {tr('Применить')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={p.onCalibCancel}>
            {tr('Отмена')}
          </Button>
        </form>
      )}
      {p.canEdit && !p.calibReady && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={p.calibrating ? 'secondary' : 'outline'} onClick={p.calibrating ? p.onCalibCancel : p.onCalibStart}>
            {p.calibrating ? tr('Отмена') : p.scale ? tr('Задать заново') : tr('Задать по известной длине')}
          </Button>
          {p.scale && !p.calibrating && (
            <Button size="sm" variant="ghost" disabled={p.busy} onClick={p.onScaleReset}>
              {tr('Сбросить масштаб')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function ObjectCard({
  o,
  canEdit,
  busy,
  length,
  scaleKnown,
  onSave,
  onPreview,
  onDelete,
}: {
  o: PlanObject
  canEdit: boolean
  busy: boolean
  length: number | null
  scaleKnown: boolean
  onSave: ObjectsPanelProps['onSave']
  onPreview: ObjectsPanelProps['onPreview']
  onDelete: ObjectsPanelProps['onDelete']
}) {
  const t = objectType(o.type_code, o.geometry)
  const [label, setLabel] = useState(o.label)
  const [status, setStatus] = useState<ObjectStatus>(o.status)
  const [notes, setNotes] = useState(o.notes)
  const [variant, setVariant] = useState<string | null>(o.variant)
  const [rotation, setRotation] = useState(o.rotation)
  const [size, setSize] = useState(o.size)
  const [color, setColor] = useState<string | null>(o.color)
  const [specs, setSpecs] = useState<Record<string, string | number>>(o.specs)
  const specsKey = JSON.stringify(o.specs)
  // объект обновился на сервере (чужая правка или перенос) — подтягиваем значения
  useEffect(() => {
    setLabel(o.label)
    setStatus(o.status)
    setNotes(o.notes)
    setVariant(o.variant)
    setRotation(o.rotation)
    setSize(o.size)
    setColor(o.color)
    setSpecs(o.specs)
  }, [o.label, o.status, o.notes, o.variant, o.rotation, o.size, o.color, specsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const specsNow = JSON.stringify(specs)
  const clean = label === o.label && status === o.status && notes === o.notes && variant === o.variant && rotation === o.rotation && size === o.size && color === o.color && specsNow === specsKey
  // подтип, направление, размер, цвет и характеристики видны на плане сразу, до сохранения
  useEffect(() => {
    onPreview(o, { variant, rotation, size, color, specs })
    return () => onPreview(o, null)
  }, [variant, rotation, size, color, specsNow]) // eslint-disable-line react-hooks/exhaustive-deps
  const setSpec = (key: string, raw: string) =>
    setSpecs((cur) => {
      const next = { ...cur }
      if (raw === '') delete next[key]
      else {
        const f = t.specs?.find((s) => s.key === key)
        // из списка берём значение как есть (число остаётся числом), введённое руками — числом, если оно число
        const fromList = f?.options?.find((opt) => String(opt) === raw)
        next[key] = fromList ?? (Number.isFinite(Number(raw.replace(',', '.'))) && raw.trim() !== '' ? Number(raw.replace(',', '.')) : raw)
      }
      return next
    })

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft">
      <div className="flex items-center gap-2">
        <Swatch t={t} variant={variant} color={color} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {t.name} <span className="font-normal text-muted-foreground">· {t.geometry === 'point' ? tr('точка') : tr('трасса')}</span>
        </p>
      </div>
      {o.geometry === 'line' && (
        <p className="text-xs text-muted-foreground">{length !== null ? tr('Длина: {{n}}', { n: formatMeters(length) }) : scaleKnown ? tr('Длина считается на листе, где проведена трасса.') : tr('Длина появится, когда задан масштаб плана.')}</p>
      )}
      {canEdit ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="obj-label" className="text-xs text-muted-foreground">
              {tr('Обозначение')}
            </label>
            <input id="obj-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={tr('Например, К-12 или ЩР-3')} className="h-9 rounded-md border bg-background px-2 text-sm" />
          </div>
          {t.variants && (
            <div className="flex flex-col gap-1">
              <span id="obj-variant-l" className="text-xs text-muted-foreground">
                {tr('Вид')}
              </span>
              <div className="flex flex-wrap gap-1" role="group" aria-labelledby="obj-variant-l">
                {[{ code: '', name: tr('Не указан'), Icon: undefined }, ...t.variants].map((v) => (
                  <button
                    key={v.code}
                    type="button"
                    aria-pressed={(variant ?? '') === v.code}
                    onClick={() => setVariant(v.code || null)}
                    className={cn('flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', (variant ?? '') === v.code && 'border-primary bg-primary/10 font-medium')}
                  >
                    {v.Icon && <v.Icon aria-hidden className="size-4 shrink-0" />}
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {t.specs && t.specs.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {t.specs.map((f) => (
                <div key={f.key} className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={`obj-spec-${f.key}`} className="text-xs text-muted-foreground">
                    {f.label}
                    {f.unit ? `, ${f.unit}` : ''}
                  </label>
                  {f.options ? (
                    <select id={`obj-spec-${f.key}`} value={specs[f.key] === undefined ? '' : String(specs[f.key])} onChange={(e) => setSpec(f.key, e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                      <option value="">—</option>
                      {f.options.map((opt) => (
                        <option key={String(opt)} value={String(opt)}>
                          {String(opt)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input id={`obj-spec-${f.key}`} inputMode="decimal" maxLength={10} value={specs[f.key] === undefined ? '' : String(specs[f.key])} onChange={(e) => setSpec(f.key, e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span id="obj-color-l" className="text-xs text-muted-foreground">
              {tr('Цвет')}
            </span>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="obj-color-l">
              <button
                type="button"
                aria-pressed={color === null}
                title={tr('Цвет типа')}
                aria-label={tr('Цвет типа')}
                onClick={() => setColor(null)}
                className={cn('grid size-7 place-items-center rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring', color === null ? 'border-foreground' : 'border-transparent')}
              >
                <span className="block size-5 rounded-full" style={{ background: t.color }} />
              </button>
              {OBJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn('grid size-7 place-items-center rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring', color === c ? 'border-foreground' : 'border-transparent')}
                >
                  <span className="block size-5 rounded-full" style={{ background: c }} />
                </button>
              ))}
            </div>
          </div>
          {t.directional && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="obj-rot" className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{tr('Направление')}</span>
                <span className="tabular-nums">{Math.round(rotation)}°</span>
              </label>
              <div className="flex items-center gap-3">
                <input id="obj-rot" type="range" min={0} max={355} step={5} value={Math.min(rotation, 355)} onChange={(e) => setRotation(Number(e.target.value))} className="min-w-0 flex-1" />
                <div className="grid shrink-0 grid-cols-3 gap-0.5" role="group" aria-label={tr('Стороны света')}>
                  {COMPASS.map((c) =>
                    c.deg < 0 ? (
                      <span key="mid" className="size-7" aria-hidden />
                    ) : (
                      <button
                        key={c.deg}
                        type="button"
                        title={c.label}
                        aria-label={c.label}
                        aria-pressed={Math.round(rotation) === c.deg}
                        onClick={() => setRotation(c.deg)}
                        className={cn('grid size-7 place-items-center rounded border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', Math.round(rotation) === c.deg && 'border-primary bg-primary/10')}
                      >
                        <c.Icon className="size-3.5" />
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
          )}
          {o.geometry === 'point' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="obj-size" className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{tr('Размер значка')}</span>
                <span className="tabular-nums">{Math.round(size * 100)}%</span>
              </label>
              <input id="obj-size" type="range" min={50} max={300} step={10} value={Math.round(size * 100)} onChange={(e) => setSize(Number(e.target.value) / 100)} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="obj-status" className="text-xs text-muted-foreground">
              {tr('Состояние')}
            </label>
            <select id="obj-status" value={status} onChange={(e) => setStatus(e.target.value as ObjectStatus)} className="h-9 rounded-md border bg-background px-2 text-sm">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OBJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="obj-notes" className="text-xs text-muted-foreground">
              {tr('Заметка')}
            </label>
            <textarea id="obj-notes" value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
          </div>
          <p className="text-xs text-muted-foreground">{o.geometry === 'point' ? tr('Перенести: потяните значок на плане.') : tr('Изменить трассу: потяните белые точки на вершинах.')}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={busy || clean} onClick={() => onSave(o, { label: label.trim(), status, notes: notes.trim(), variant, rotation, size, color, specs })}>
              {tr('Сохранить')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(o)}>
              <Trash2 /> {tr('Убрать')}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {o.label ? `${o.label} · ` : ''}
          {OBJECT_STATUS_LABELS[o.status]}
          {o.notes ? ` · ${o.notes}` : ''}
        </p>
      )}
    </div>
  )
}
