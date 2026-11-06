import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Armchair, BedDouble } from 'lucide-react'
import { useMemo } from 'react'
import { FFE_STATUS_DOT, FFE_STATUS_LABELS, FFE_STATUSES, ffeOverviewQuery, roomSpecsQuery, roomTypesQuery } from '@/features/ffe/api'
import { locationsQuery } from '@/features/locations/api'
import { tr } from '@/lib/tr'

/** Цвет типа номера: семейство (KING, TWIN, ONE BEDROOM…) задаёт оттенок, номер в названии — светлоту. */
export function typeColor(name: string): string {
  const n = name.toUpperCase()
  const hue = n.includes('KING') ? 212 : n.includes('TWIN') ? 150 : n.includes('ONE BEDROOM') ? 32 : n.includes('TWO BEDROOM') ? 18 : n.includes('JUNIOR') ? 268 : n.includes('ADA') ? 195 : n.includes('PRESID') ? 350 : 220
  const no = Number(/(\d+)\s*$/.exec(n)?.[1] ?? 1)
  return `hsl(${hue} 62% ${Math.max(32, 62 - (no - 1) * 7)}%)`
}

/** Номера объекта: сколько всего, каких типов, как они распределены по этажам и сколько мебели в них. */
export function RoomsOverview({ projectId, code }: { projectId: string; code: string }) {
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const { data: specs } = useSuspenseQuery(roomSpecsQuery(projectId))
  const { data: typeData } = useSuspenseQuery(roomTypesQuery(projectId))
  const { data: overview } = useSuspenseQuery(ffeOverviewQuery(projectId))

  const model = useMemo(() => {
    const rooms = locations.filter((l) => l.kind === 'room')
    const typeNameById = new Map(typeData.types.map((t) => [t.id, t.name]))
    const typeOfRoom = new Map<string, string>()
    for (const s of specs) if (s.type_id && typeNameById.has(s.type_id)) typeOfRoom.set(s.location_id, typeNameById.get(s.type_id)!)
    const byType = new Map<string, number>()
    for (const r of rooms) {
      const t = typeOfRoom.get(r.id) ?? ''
      byType.set(t, (byType.get(t) ?? 0) + 1)
    }
    const floors = locations.filter((l) => l.kind === 'floor').sort((a, b) => b.sort - a.sort)
    const perFloor = new Map<string, Map<string, number>>()
    for (const r of rooms) {
      const parent = locations.find((l) => l.id === r.parent_id)
      if (!parent) continue
      const m = perFloor.get(parent.id) ?? new Map<string, number>()
      const t = typeOfRoom.get(r.id) ?? ''
      m.set(t, (m.get(t) ?? 0) + 1)
      perFloor.set(parent.id, m)
    }
    const typePieces = new Map<string, number>()
    for (const [typeId, pieces] of Object.entries(overview.by_type)) typePieces.set(typeNameById.get(typeId) ?? '', pieces)
    const totals = { planned: 0, ordered: 0, delivered: 0, installed: 0, total: 0 }
    for (const s of FFE_STATUSES) {
      totals[s] = overview.by_status[s] ?? 0
      totals.total += totals[s]
    }
    return { rooms, byType, floors: floors.filter((f) => perFloor.has(f.id)), perFloor, typePieces, typed: rooms.filter((r) => typeOfRoom.has(r.id)).length, totals }
  }, [locations, specs, typeData.types, overview])

  if (model.rooms.length === 0) return null
  const typeList = [...model.byType.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], undefined, { numeric: true })))
  const maxPerFloor = Math.max(1, ...[...model.perFloor.values()].map((m) => [...m.values()].reduce((s, n) => s + n, 0)))
  const installedPct = model.totals.total > 0 ? Math.round((model.totals.installed / model.totals.total) * 100) : 0

  return (
    <section className="flex flex-col gap-4" aria-label={tr('Номера и мебель')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BedDouble className="size-5 text-muted-foreground" aria-hidden /> {tr('Номера и мебель')}
        </h2>
        <Link to="/projects/$code/ffe" params={{ code }} search={{}} className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
          <Armchair className="size-4" aria-hidden /> {tr('Ведомость мебели')}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={tr('Номеров всего')} value={model.rooms.length} />
        <Tile label={tr('Типов номеров')} value={typeList.filter(([t]) => t).length} hint={model.typed < model.rooms.length ? tr('без типа: {{n}}', { n: model.rooms.length - model.typed }) : undefined} />
        <Tile label={tr('Единиц мебели')} value={model.totals.total} />
        <div className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 shadow-soft">
          <span className="text-xs text-muted-foreground">{tr('Установлено')}</span>
          <span className="text-xl font-semibold tabular-nums">{installedPct}%</span>
          <span className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={FFE_STATUSES.map((s) => `${FFE_STATUS_LABELS[s]}: ${model.totals[s]}`).join(', ')}>
            {FFE_STATUSES.map((s) => (model.totals[s] > 0 ? <span key={s} className={FFE_STATUS_DOT[s]} style={{ width: `${(model.totals[s] / model.totals.total) * 100}%` }} /> : null))}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
          <h3 className="border-b px-3 py-2 text-sm font-semibold">{tr('По типам')}</h3>
          <ul className="max-h-[28rem] divide-y overflow-y-auto text-sm">
            {typeList.map(([t, n]) => (
              <li key={t || 'none'} className="flex items-center gap-2 px-3 py-1.5">
                <span className="size-3 shrink-0 rounded-sm" style={{ background: t ? typeColor(t) : 'var(--muted)' }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t || tr('Без типа')}</span>
                <span className="w-10 text-right font-medium tabular-nums">{n}</span>
                <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{tr('{{n}} шт. мебели', { n: model.typePieces.get(t) ?? 0 })}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
          <h3 className="border-b px-3 py-2 text-sm font-semibold">{tr('По этажам')}</h3>
          <ul className="max-h-[28rem] divide-y overflow-y-auto text-sm">
            {model.floors.map((f) => {
              const m = model.perFloor.get(f.id)!
              const n = [...m.values()].reduce((s, x) => s + x, 0)
              const parts = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
              return (
                <li key={f.id}>
                  <Link
                    to="/projects/$code/locations/$path"
                    params={{ code, path: f.path }}
                    className="flex min-h-9 items-center gap-2 px-3 hover:bg-muted/50"
                    title={parts.map(([t, c]) => `${t || tr('Без типа')}: ${c}`).join('\n')}
                  >
                    <span className="w-16 shrink-0 text-muted-foreground">{f.name.replace(/^Этаж\s*/i, '') || f.code}</span>
                    <span className="w-8 shrink-0 text-right font-medium tabular-nums">{n}</span>
                    <span className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted" style={{ maxWidth: `${(n / maxPerFloor) * 100}%` }} aria-hidden>
                      {parts.map(([t, c]) => (
                        <span key={t || 'none'} style={{ width: `${(c / n) * 100}%`, background: t ? typeColor(t) : 'var(--muted-foreground)' }} />
                      ))}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 shadow-soft">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}
