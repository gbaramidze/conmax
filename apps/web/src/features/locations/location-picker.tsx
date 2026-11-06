import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, MapPin, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { flattenTree, LOCATION_KIND_LABELS, locationLabel, locationsQuery, type LocationNode } from '@/features/locations/api'

const RECENT_LIMIT = 4

function recentKey(projectId: string) {
  return `recent-locations:${projectId}`
}

export function readRecentLocations(projectId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey(projectId)) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function rememberLocation(projectId: string, id: string): void {
  try {
    const next = [id, ...readRecentLocations(projectId).filter((x) => x !== id)].slice(0, RECENT_LIMIT)
    localStorage.setItem(recentKey(projectId), JSON.stringify(next))
  } catch {
    // хранилище недоступно — «недавние» просто не запомнятся
  }
}

/**
 * Выбор места проводником: корпус → секция → этаж → помещение. Крупные строки под палец,
 * поиск по номеру или названию по всему дереву, «недавние» места сверху.
 * Нужен вместо выпадающего списка, когда в проекте сотни и тысячи помещений.
 */
export function LocationPicker({
  projectId,
  value,
  onChange,
  placeholder = tr('Выберите место'),
}: {
  projectId: string
  value: string | null
  onChange: (id: string) => void
  placeholder?: string
}) {
  const { data: rows = [] } = useQuery(locationsQuery(projectId))
  const nodes = useMemo(() => flattenTree(rows), [rows])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, LocationNode[]>()
    for (const n of nodes) map.set(n.parent_id, [...(map.get(n.parent_id) ?? []), n])
    return map
  }, [nodes])

  const [open, setOpen] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null) // null — корень
  const [query, setQuery] = useState('')

  const selected = value ? byId.get(value) : null
  const current = currentId ? byId.get(currentId) : null
  const recent = useMemo(() => readRecentLocations(projectId).map((id) => byId.get(id)).filter((n): n is LocationNode => !!n), [projectId, byId, open])

  const q = query.trim().toLowerCase()
  const searchResults = useMemo(
    () => (q ? nodes.filter((n) => n.code.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)).slice(0, 50) : []),
    [q, nodes],
  )

  const pick = (n: LocationNode) => {
    onChange(n.id)
    rememberLocation(projectId, n.id)
    setOpen(false)
    setQuery('')
  }

  const openPicker = () => {
    // начинаем с родителя выбранного места, чтобы соседи были под рукой
    setCurrentId(selected?.parent_id ?? null)
    setQuery('')
    setOpen(true)
  }

  const Row = ({ n }: { n: LocationNode }) => {
    const kids = childrenOf.get(n.id)?.length ?? 0
    return (
      <li className="flex items-stretch">
        <button
          type="button"
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 text-left hover:bg-muted/60 focus-visible:bg-muted/60"
          onClick={() => (kids > 0 && !q ? setCurrentId(n.id) : pick(n))}
        >
          <span className="ident w-14 shrink-0 text-muted-foreground">{n.code}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{n.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {q ? locationLabel(n.path, rows) : `${LOCATION_KIND_LABELS[n.kind]}${kids ? tr(' · внутри: {{kids}}', { kids }) : ''}`}
            </span>
          </span>
          {kids > 0 && !q && <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
        </button>
        {kids > 0 && !q && (
          <button
            type="button"
            aria-label={tr('Выбрать {{name}}', { name: n.name })}
            className="flex w-14 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={() => pick(n)}
          >
            <Check className="size-5" />
          </button>
        )}
      </li>
    )
  }

  const list = q ? searchResults : (childrenOf.get(currentId) ?? [])

  return (
    <>
      <Button type="button" variant="outline" className="h-auto min-h-11 w-full min-w-0 max-w-full justify-start gap-2 whitespace-normal py-2 text-left font-normal" onClick={openPicker}>
        <MapPin className="shrink-0 text-muted-foreground" />
        {selected ? (
          <span className="min-w-0 flex-1 break-words">
            <span className="ident mr-2 text-muted-foreground">{selected.path}</span>
            <span>{locationLabel(selected.path, rows)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[88svh] sm:mx-auto sm:max-w-lg">
          <SheetHeader className="gap-1 border-b p-4 pr-14">
            <SheetTitle>{tr('Выберите место')}</SheetTitle>
            <SheetDescription>{tr('Откройте корпус и этаж или найдите по номеру помещения.')}</SheetDescription>
          </SheetHeader>

          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={tr('Поиск места')}
                placeholder={tr('Номер или название: 512, этаж 5')}
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {!q && (
            <div className="flex items-center gap-1 border-b px-2 py-1.5 text-sm">
              <Button type="button" size="sm" variant="ghost" disabled={!current} onClick={() => setCurrentId(current?.parent_id ?? null)}>
                <ChevronLeft />{tr('Выше')}</Button>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{current ? locationLabel(current.path, rows) : tr('Весь проект')}</span>
              {current && (
                <Button type="button" size="sm" onClick={() => pick(current)}>{tr('Выбрать это')}</Button>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!q && !current && recent.length > 0 && (
              <div className="border-b p-3">
                <p className="mb-2 text-xs text-muted-foreground">{tr('Недавние')}</p>
                <div className="flex flex-wrap gap-2">
                  {recent.map((n) => (
                    <Button key={n.id} type="button" size="sm" variant="outline" onClick={() => pick(n)}>
                      <span className="ident">{n.path}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {list.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">{q ? tr('Ничего не нашли. Проверьте номер.') : tr('Здесь пока нет вложенных мест.')}</p>
            ) : (
              <ul className="divide-y">
                {list.map((n) => (
                  <Row key={n.id} n={n} />
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
