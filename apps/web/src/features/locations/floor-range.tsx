import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { floorIdsInRange, floorsUnder, locationLabel, locationsQuery, type LocationRow } from '@/features/locations/api'
import { tr } from '@/lib/tr'

/** Кнопка «Этажи с … по …»: чертёж типового этажа привязывается ко всей группе этажей за одно действие. */
export function FloorRangeButton({ projectId, onPick, disabled }: { projectId: string; onPick: (ids: string[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled} onClick={() => setOpen(true)}>
        <Layers /> {tr('Этажи с … по …')}
      </Button>
      {open && <FloorRangeDialog projectId={projectId} onClose={() => setOpen(false)} onPick={(ids) => { onPick(ids); setOpen(false) }} />}
    </>
  )
}

function FloorRangeDialog({ projectId, onClose, onPick }: { projectId: string; onClose: () => void; onPick: (ids: string[]) => void }) {
  const { data: rows = [] } = useQuery(locationsQuery(projectId))
  // корпуса и секции, внутри которых есть этажи
  const parents = useMemo(() => rows.filter((r) => (r.kind === 'building' || r.kind === 'section') && floorsUnder(rows, r).length > 0), [rows])
  const [parentId, setParentId] = useState('')
  const parent: LocationRow | undefined = parents.find((p) => p.id === parentId) ?? parents[0]
  const floors = parent ? floorsUnder(rows, parent) : []
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const f1 = from === '' ? (floors[0]?.sort ?? 0) : Number(from)
  const f2 = to === '' ? (floors[floors.length - 1]?.sort ?? 0) : Number(to)
  const ids = parent && Number.isInteger(f1) && Number.isInteger(f2) && f1 <= f2 ? floorIdsInRange(rows, parent, f1, f2) : []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Привязать к этажам диапазоном')}</DialogTitle>
          <DialogDescription>{tr('Например, чертёж типового этажа: этажи с 3 по 8 одним действием.')}</DialogDescription>
        </DialogHeader>
        {parents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('В структуре проекта пока нет корпусов с этажами.')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fr-parent">{tr('Корпус или секция')}</Label>
              <Select value={parent?.id ?? ''} onValueChange={(v) => { setParentId(v); setFrom(''); setTo('') }}>
                <SelectTrigger id="fr-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parents.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {locationLabel(p.path, rows)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{tr('Этажи')}</span>
              <div className="flex items-center gap-2">
                <Input type="number" inputMode="numeric" value={from} placeholder={String(floors[0]?.sort ?? '')} aria-label={tr('С этажа')} onChange={(e) => setFrom(e.target.value)} />
                <span className="text-muted-foreground">—</span>
                <Input type="number" inputMode="numeric" value={to} placeholder={String(floors[floors.length - 1]?.sort ?? '')} aria-label={tr('По этаж')} onChange={(e) => setTo(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                {ids.length > 0 ? tr('Будет привязано этажей: {{n}}', { n: ids.length }) : tr('В этом диапазоне нет этажей')}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="button" disabled={ids.length === 0} onClick={() => onPick(ids)}>
            {tr('Привязать этажи ({{n}})', { n: ids.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
