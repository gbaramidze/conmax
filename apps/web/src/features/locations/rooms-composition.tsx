import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  floorsUnder,
  orderKey,
  PURPOSE_LABELS,
  PURPOSES,
  roomSummary,
  setLocationPurpose,
  summaryText,
  type LocationPurpose,
  type LocationRow,
} from '@/features/locations/api'
import { FloorBoard } from '@/features/locations/floor-board'
import { tr } from '@/lib/tr'

/**
 * Состав помещений места: у корпуса и секции — этажи со сводкой («6 ном. · 2 комм.»),
 * у этажа — список помещений с назначением; выбранным можно сменить назначение разом.
 */
export function RoomsComposition({ projectId, code, loc, rows, canManage }: { projectId: string; code: string; loc: LocationRow; rows: LocationRow[]; canManage: boolean }) {
  const queryClient = useQueryClient()
  const summary = useMemo(() => roomSummary(rows), [rows])
  const rooms = useMemo(
    () => rows.filter((r) => r.kind === 'room' && r.parent_id === loc.id).sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code, undefined, { numeric: true })),
    [rows, loc.id],
  )
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)
  const [purpose, setPurpose] = useState<LocationPurpose>('apartment')

  const change = useMutation({
    mutationFn: () => setLocationPurpose(projectId, [...picked], purpose),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
      toast.success(tr('Назначение изменено у помещений: {{count_}}', { count_: count }))
      setPicked(new Set())
    },
    onError: () => toast.error(tr('Не удалось изменить назначение. Проверьте права и попробуйте ещё раз.')),
  })

  if (loc.kind === 'room') return null

  if (loc.kind !== 'floor') {
    const floors = floorsUnder(rows, loc)
    const total = summary.get(loc.path)
    if (floors.length === 0) return null
    return (
      <section className="flex flex-col gap-2" aria-label={tr('Состав помещений')}>
        <h3 className="text-sm font-semibold">{tr('Состав помещений')}</h3>
        <p className="text-sm text-muted-foreground">{total ? tr('Всего: {{summary}}', { summary: summaryText(total) }) : tr('Помещений пока нет. Создайте их кнопкой «Создать помещения» в структуре проекта.')}</p>
        <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
          {floors.map((f) => (
            <li key={f.id}>
              <Link to="/projects/$code/locations/$path" params={{ code, path: f.path }} className="flex min-h-11 items-center gap-2 px-3 hover:bg-muted/50">
                <span className="ident text-muted-foreground">{f.code}</span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{summaryText(summary.get(f.path)) || '—'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const allPicked = rooms.length > 0 && picked.size === rooms.length
  return (
    <section className="flex flex-col gap-2" aria-label={tr('Состав помещений')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{tr('Состав помещений')}</h3>
        <span className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{summaryText(summary.get(loc.path))}</span>
          {canManage && rooms.length > 0 && (
            <Button type="button" size="sm" variant={selecting ? 'secondary' : 'outline'} onClick={() => { setSelecting(!selecting); setPicked(new Set()) }}>
              {selecting ? tr('Готово') : tr('Выбрать')}
            </Button>
          )}
        </span>
      </div>
      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('На этаже пока нет помещений.')}</p>
      ) : (
        <>
          {canManage && selecting && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(rooms.map((r) => r.id)) : new Set())} />
                {tr('Выбрать все')}
              </label>
              <Select value={purpose} onValueChange={(v) => setPurpose(v as LocationPurpose)}>
                <SelectTrigger size="sm" className="w-52" aria-label={tr('Назначение')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PURPOSE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={picked.size === 0 || change.isPending} onClick={() => change.mutate()}>
                {tr('Назначить выбранным ({{n}})', { n: picked.size })}
              </Button>
            </div>
          )}
          <FloorBoard
            projectId={projectId}
            floorId={loc.id}
            code={code}
            selecting={canManage && selecting}
            picked={picked}
            onToggle={(id) =>
              setPicked((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
          />
        </>
      )}
    </section>
  )
}
