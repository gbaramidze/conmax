import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { flattenTree, locationsQuery } from '@/features/locations/api'

const NONE = '__none__'

/** Выбор локации из дерева проекта (отступ = уровень вложенности). `value`/`onChange` — id или null. */
export function LocationSelect({
  projectId,
  value,
  onChange,
  disabled,
  className,
  noneLabel = tr('Без локации'),
  ariaLabel = tr('Локация'),
  size = 'default',
}: {
  size?: 'default' | 'sm'
  projectId: string
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  className?: string
  noneLabel?: string
  ariaLabel?: string
}) {
  const { data: rows } = useQuery(locationsQuery(projectId))
  const nodes = useMemo(() => flattenTree(rows ?? []), [rows])

  return (
    <Select value={value ?? NONE} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger aria-label={ariaLabel} size={size} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {nodes.map((n) => (
          <SelectItem key={n.id} value={n.id}>
            <span style={{ paddingLeft: n.depth * 12 }}>
              <span className="ident text-muted-foreground">{n.code}</span> {n.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
