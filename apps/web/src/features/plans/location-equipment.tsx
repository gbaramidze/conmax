import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LocationRow } from '@/features/locations/api'
import { locationEquipmentQuery } from '@/features/plans/equipment-api'
import { OBJECT_STATUS_COLORS, OBJECT_STATUS_LABELS, objectType, objectVariant, specTexts } from '@/features/plans/object-types'
import { tr } from '@/lib/tr'

/**
 * «Оборудование на планах» в карточке места: камеры, щиты, гидранты и другое, что стоит в этом помещении (или внутри этажа).
 * Помещение определяет база по зонам плана; нет объектов — раздел не показывается. Под аккордеоном, чтобы не загромождать карточку.
 */
export function LocationEquipment({ projectId, code, loc, rows }: { projectId: string; code: string; loc: LocationRow; rows: LocationRow[] }) {
  const [open, setOpen] = useState(false)
  const ids = useMemo(() => rows.filter((r) => r.id === loc.id || r.path.startsWith(`${loc.path}.`)).map((r) => r.id), [rows, loc])
  const { data } = useQuery(locationEquipmentQuery(projectId, ids))
  if (!data || data.length === 0) return null

  const defects = data.filter((o) => o.status === 'defect').length
  const byId = new Map(rows.map((r) => [r.id, r]))

  return (
    <section className="rounded-lg border bg-card" aria-label={tr('Оборудование на планах')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-2 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 text-sm font-medium">{tr('Оборудование на планах')}</span>
        {defects > 0 && <span className="text-xs text-red-700 dark:text-red-300">{tr('дефектов: {{n}}', { n: defects })}</span>}
        <span className="text-xs tabular-nums text-muted-foreground">{data.length}</span>
      </button>
      {open && (
        <ul className="divide-y border-t">
          {data.map((o) => {
            const t = objectType(o.type_code, o.geometry)
            const v = objectVariant(t, o.variant)
            const specs = specTexts(t, o.specs)
            const place = o.location_id && o.location_id !== loc.id ? byId.get(o.location_id) : null
            return (
              <li key={o.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: OBJECT_STATUS_COLORS[o.status] }} title={OBJECT_STATUS_LABELS[o.status]} />
                  <span className="min-w-0 flex-1">
                    {t.name}
                    {v ? <span className="text-muted-foreground"> · {v.name}</span> : null}
                    {o.label ? <span className="ident text-muted-foreground"> · {o.label}</span> : null}
                  </span>
                  <Link to="/projects/$code/plan/$id" params={{ code, id: o.document_id }} search={{ page: o.page, obj: o.id }} className="shrink-0 text-xs underline underline-offset-2">
                    {tr('На плане')}
                  </Link>
                </div>
                {(specs.length > 0 || place) && (
                  <p className="pl-4 text-xs text-muted-foreground">
                    {[place?.name, ...specs].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
