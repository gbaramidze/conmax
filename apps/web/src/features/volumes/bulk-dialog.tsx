import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { roomSpecsQuery, roomTypesQuery } from '@/features/ffe/api'
import { locationsQuery } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { createWorkItemsBulk, locationsWithItem, organizationsListQuery } from '@/features/volumes/api'
import { NewOrganizationButton } from '@/features/volumes/new-organization'
import { tr } from '@/lib/tr'

type Target = 'rooms' | 'floors'

/**
 * Одна и та же работа на много мест сразу: например, «Монтаж мебели» на все номера типа KING 2 на этажах 3–12,
 * по 1 шт. на каждый номер, с общими сроками. Места, где такая позиция уже есть, пропускаются.
 */
export function BulkItemDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const queryClient = useQueryClient()
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(projectId))
  const { data: typeData } = useQuery(roomTypesQuery(projectId))
  const { data: specs } = useQuery(roomSpecsQuery(projectId))
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])

  const [scopeId, setScopeId] = useState<string | null>(null)
  const [target, setTarget] = useState<Target>('rooms')
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState(tr('шт.'))
  const [qty, setQty] = useState('1')
  const [weight, setWeight] = useState('')
  const [start, setStart] = useState('')
  const [finish, setFinish] = useState('')
  const [contractor, setContractor] = useState('')
  const [discipline, setDiscipline] = useState('')

  const scope = locations.find((l) => l.id === scopeId)
  const { data: already = new Set<string>() } = useQuery({ queryKey: ['work-items-with', projectId, name.trim().toLowerCase()], queryFn: () => locationsWithItem(projectId, name), enabled: name.trim().length >= 2 })

  const typeOf = useMemo(() => new Map((specs ?? []).map((s) => [s.location_id, s.type_id])), [specs])
  const f1 = from === '' ? -Infinity : Number(from)
  const f2 = to === '' ? Infinity : Number(to)
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  const candidates = useMemo(() => {
    if (!scope) return []
    const inScope = locations.filter((l) => l.kind === target.slice(0, -1) && (l.path === scope.path || l.path.startsWith(scope.path + '.')))
    return inScope.filter((l) => {
      const floor = l.kind === 'floor' ? l : byId.get(l.parent_id ?? '')
      const no = floor?.sort ?? 0
      if (no < f1 || no > f2) return false
      if (target === 'rooms' && types.size > 0 && !types.has(typeOf.get(l.id) ?? '')) return false
      return true
    })
  }, [scope, locations, target, byId, f1, f2, types, typeOf])
  const targets = candidates.filter((l) => !already.has(l.id))
  const skipped = candidates.length - targets.length

  const qtyNum = Number(qty.replace(',', '.'))
  const weightNum = weight.trim() === '' ? null : Number(weight.replace(',', '.'))
  const bad = !name.trim() || !unit.trim() || !(qtyNum > 0) || (weightNum !== null && !(weightNum > 0)) || (start && finish && finish < start) || targets.length === 0

  const save = useMutation({
    mutationFn: () =>
      createWorkItemsBulk({
        projectId,
        locationIds: targets.map((l) => l.id),
        disciplineId: discipline || null,
        contractorId: contractor || null,
        name: name.trim(),
        unit: unit.trim(),
        plannedQty: qtyNum,
        weight: weightNum,
        plannedStart: start || null,
        plannedFinish: finish || null,
      }),
    onSuccess: async (n) => {
      await onDone()
      await queryClient.invalidateQueries({ queryKey: ['work-items-with'] })
      toast.success(tr('Создано позиций: {{n}}', { n }))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось создать позиции. Проверьте права и данные.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="flex max-h-[92svh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{tr('Позиция на много мест')}</DialogTitle>
          <DialogDescription>{tr('Одна и та же работа с одинаковым объёмом и сроками на каждый выбранный номер или этаж.')}</DialogDescription>
        </DialogHeader>
        <form
          id="bulk-item-form"
          className="grid min-h-0 flex-1 gap-x-8 gap-y-4 overflow-y-auto pr-1 md:grid-cols-2 md:items-start"
          onSubmit={(e) => {
            e.preventDefault()
            if (!bad && !save.isPending) save.mutate()
          }}
        >
          <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{tr('Где (корпус, секция или этаж)')}</Label>
            <LocationPicker projectId={projectId} value={scopeId} onChange={setScopeId} placeholder={tr('Выберите, где создать позиции')} />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{tr('На каждый')}</legend>
            <div className="flex gap-2">
              {(
                [
                  ['rooms', tr('номер')],
                  ['floors', tr('этаж')],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={target === v}
                  onClick={() => setTarget(v)}
                  className={`min-h-9 rounded-full border px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${target === v ? 'border-foreground bg-muted font-medium' : 'text-muted-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {target === 'rooms' && (typeData?.types.length ?? 0) > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{tr('Только номера типа (пусто — любые)')}</legend>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {typeData!.types.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={types.has(t.id)}
                    onClick={() =>
                      setTypes((prev) => {
                        const next = new Set(prev)
                        if (next.has(t.id)) next.delete(t.id)
                        else next.add(t.id)
                        return next
                      })
                    }
                    className={`min-h-8 rounded-full border px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${types.has(t.id) ? 'border-foreground bg-muted font-medium' : 'text-muted-foreground'}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{tr('Этажи (необязательно)')}</span>
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="numeric" value={from} aria-label={tr('С этажа')} onChange={(e) => setFrom(e.target.value)} placeholder={tr('с')} />
              <span className="text-muted-foreground">—</span>
              <Input type="number" inputMode="numeric" value={to} aria-label={tr('По этаж')} onChange={(e) => setTo(e.target.value)} placeholder={tr('по')} />
            </div>
          </div>

          </div>

          <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bi-name">{tr('Работа')}</Label>
            <Input id="bi-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={tr('Например, монтаж мебели')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bi-qty">{tr('Объём на каждое место')}</Label>
              <Input id="bi-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bi-unit">{tr('Ед. изм.')}</Label>
              <Input id="bi-unit" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bi-start">{tr('Начало')}</Label>
              <DatePicker id="bi-start" value={start} onChange={(v) => setStart(v)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bi-finish">{tr('Окончание')}</Label>
              <DatePicker id="bi-finish" value={finish} min={start || undefined} onChange={(v) => setFinish(v)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bi-weight">{tr('Вес на каждое место (необязательно)')}</Label>
            <Input id="bi-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="bi-contractor">{tr('Подрядчик')}</Label>
                <NewOrganizationButton projectId={projectId} onCreated={setContractor} />
              </div>
              <select id="bi-contractor" value={contractor} onChange={(e) => setContractor(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">{tr('Свои силы / не указан')}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bi-discipline">{tr('Направление')}</Label>
              <select id="bi-discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">{tr('Без направления')}</option>
                {disciplines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {' '.repeat(d.depth * 2)}
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          </div>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm md:col-span-2">
            {scope ? tr('Будет создано позиций: {{n}}', { n: targets.length }) : tr('Выберите, где создать позиции.')}
            {skipped > 0 && <span className="text-muted-foreground"> · {tr('уже есть и пропущено: {{n}}', { n: skipped })}</span>}
          </p>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="bulk-item-form" disabled={!!bad || save.isPending}>
            {save.isPending ? tr('Создаём…') : tr('Создать ({{n}})', { n: targets.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
