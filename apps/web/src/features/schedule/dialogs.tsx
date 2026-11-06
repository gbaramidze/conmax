import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { flattenDisciplines, type DisciplineRow } from '@/features/disciplines/api'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import type { Activity, ActivityKind } from '@/features/schedule/api'

const NONE = '__none__'

export function NewActivityDialog({
  kind,
  groups,
  defaultParent,
  busy,
  onClose,
  onCreate,
}: {
  kind: ActivityKind
  groups: Activity[]
  defaultParent: string | null
  busy: boolean
  onClose: () => void
  onCreate: (v: { name: string; kind: ActivityKind; durationDays: number; parentId: string | null }) => void
}) {
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('5')
  const [parent, setParent] = useState(defaultParent ?? NONE)
  const title = kind === 'milestone' ? tr('Новая веха') : kind === 'summary' ? tr('Новая группа работ') : tr('Новая работа')

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{tr('Сроки рассчитываются по зависимостям; их можно добавить в карточке работы.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !busy) onCreate({ name: name.trim(), kind, durationDays: kind === 'task' ? Math.max(1, Math.round(Number(duration) || 1)) : 0, parentId: parent === NONE ? null : parent })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="na-name">{tr('Название')}</Label>
            <Input id="na-name" value={name} maxLength={300} onChange={(e) => setName(e.target.value)} autoFocus placeholder={kind === 'milestone' ? tr('Например, сдача каркаса') : tr('Например, армирование перекрытия')} />
          </div>
          {kind === 'task' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="na-dur">{tr('Длительность, рабочих дней')}</Label>
              <Input id="na-dur" type="number" min={1} max={5000} value={duration} onChange={(e) => setDuration(e.target.value)} className="sm:w-40" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="na-parent">{tr('Входит в группу')}</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger id="na-parent" className="w-full">
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
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy ? tr('Создаём…') : tr('Создать')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** «Работа × этажи»: цепочка одинаковых работ по выбранным местам с лагом между ними (поточное производство). */
export function GenerateDialog({
  projectId,
  groups,
  disciplines,
  busy,
  onClose,
  onGenerate,
}: {
  projectId: string
  groups: Activity[]
  disciplines: DisciplineRow[]
  busy: boolean
  onClose: () => void
  onGenerate: (v: { name: string; locationIds: string[]; durationDays: number; lagDays: number; chain: boolean; parentId: string | null; disciplineId: string | null }) => void
}) {
  const { data: locations } = useQuery(locationsQuery(projectId))
  const [name, setName] = useState('')
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [duration, setDuration] = useState('5')
  const [lag, setLag] = useState('0')
  const [chain, setChain] = useState(true)
  const [parent, setParent] = useState(NONE)
  const [discipline, setDiscipline] = useState(NONE)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Работа по этажам')}</DialogTitle>
          <DialogDescription>{tr('Создаст группу и по работе на каждое выбранное место. Работы можно связать цепочкой: следующий этаж начинается после предыдущего.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && locationIds.length > 0 && !busy)
              onGenerate({
                name: name.trim(),
                locationIds,
                durationDays: Math.max(1, Math.round(Number(duration) || 1)),
                lagDays: Math.round(Number(lag) || 0),
                chain,
                parentId: parent === NONE ? null : parent,
                disciplineId: discipline === NONE ? null : discipline,
              })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="g-name">{tr('Название работы')}</Label>
            <Input id="g-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus placeholder={tr('Например, монолит перекрытия')} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Места')}</Label>
            {locationIds.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {locationIds.map((id) => {
                  const loc = locations?.find((l) => l.id === id)
                  return (
                    <li key={id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-xs">
                      <span className="ident">{loc?.path}</span>
                      <span className="text-muted-foreground">{loc && locations ? locationLabel(loc.path, locations) : ''}</span>
                      <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={tr('Убрать место')} onClick={() => setLocationIds((p) => p.filter((x) => x !== id))}>
                        <X />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            <LocationPicker
              projectId={projectId}
              value={null}
              placeholder={locationIds.length > 0 ? tr('Добавить ещё место') : tr('Выбрать этаж или секцию')}
              onChange={(id) => setLocationIds((p) => (p.includes(id) || p.length >= 200 ? p : [...p, id]))}
            />
            <p className="text-xs text-muted-foreground">{tr('Порядок работ — по порядку мест в структуре проекта.')}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-dur">{tr('Длительность на место, раб. дн.')}</Label>
              <Input id="g-dur" type="number" min={1} max={5000} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-lag">{tr('Сдвиг между местами, раб. дн.')}</Label>
              <Input id="g-lag" type="number" value={lag} disabled={!chain} onChange={(e) => setLag(e.target.value)} />
            </div>
          </div>
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={chain} onChange={(e) => setChain(e.target.checked)} />
            <span>{tr('Связать цепочкой «окончание → начало»')}<span className="block text-xs text-muted-foreground">{tr('Без цепочки все работы начнутся одновременно.')}</span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-parent">{tr('Внутри группы')}</Label>
              <Select value={parent} onValueChange={setParent}>
                <SelectTrigger id="g-parent" className="w-full">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-disc">{tr('Направление')}</Label>
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger id="g-disc" className="w-full">
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
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!name.trim() || locationIds.length === 0 || busy}>
              {busy ? tr('Создаём…') : locationIds.length > 0 ? tr('Создать работ: {{length}}', { length: locationIds.length }) : tr('Создать')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BaselineDialog({ number, busy, onClose, onCreate }: { number: number; busy: boolean; onClose: () => void; onCreate: (name: string, reason: string) => void }) {
  const [name, setName] = useState(`BL${number}`)
  const [reason, setReason] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Зафиксировать базовый план')}</DialogTitle>
          <DialogDescription>{tr('Сохранится копия текущих дат. Дальше график можно двигать, а базовый план останется для сравнения.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !busy) onCreate(name.trim(), reason.trim())
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="bl-name">{tr('Название')}</Label>
            <Input id="bl-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bl-reason">{tr('Основание')}</Label>
            <Textarea id="bl-reason" rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder={tr('Например, график утверждён на заседании 20.10')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy ? tr('Сохраняем…') : tr('Зафиксировать')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
