import { useQuery } from '@tanstack/react-query'
import type { MouseEvent } from 'react'
import { STATUS_STYLE, type ItemStatus } from '@/features/inspections/api'
import { schemeImageQuery, type SchemeSource } from '@/features/inspections/scheme-image'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

export interface SchemeMarker {
  id: string
  /** Подпись точки, например «1.1» */
  label: string
  x: number
  y: number
  status: ItemStatus | null
}

/**
 * Схема места с точками замечаний. Точки лежат поверх картинки в долях её ширины и высоты, поэтому остаются на месте при любом
 * размере экрана. С `onPick` по схеме можно нажать, чтобы поставить точку (в `draft` показывается ещё не сохранённая).
 */
export function SchemeView({
  source,
  alt,
  markers,
  draft,
  activeId,
  onPick,
  onOpen,
  maxHeightClass = 'max-h-96',
}: {
  source: SchemeSource
  alt: string
  markers: SchemeMarker[]
  draft?: { x: number; y: number } | null
  activeId?: string
  onPick?: (point: { x: number; y: number }) => void
  onOpen?: () => void
  maxHeightClass?: string
}) {
  const { data: url, isError } = useQuery(schemeImageQuery(source))

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    onPick({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) })
  }

  if (isError) return <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{tr('Не удалось показать схему. Попробуйте открыть страницу заново.')}</p>
  if (!url) return <div className="h-48 w-full animate-pulse rounded-md bg-muted" role="status" aria-label={tr('Рисуем схему…')} />

  return (
    <div className="flex justify-center rounded-md border bg-white">
      <div className={cn('relative inline-block max-w-full select-none', onPick && 'cursor-crosshair', onOpen && !onPick && 'cursor-zoom-in')} onClick={onPick ? pick : onOpen}>
        <img src={url} alt={alt} draggable={false} className={cn('block h-auto w-auto max-w-full', maxHeightClass)} />
        {markers.map((m) => (
          <span
            key={m.id}
            className={cn(
              'pointer-events-none absolute grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white px-1 text-[10px] font-semibold leading-none shadow',
              m.status ? STATUS_STYLE[m.status].on : 'bg-slate-500 text-white',
              activeId === m.id && 'ring-2 ring-foreground',
            )}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            title={m.label}
          >
            {m.label}
          </span>
        ))}
        {draft && (
          <span
            className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-signal shadow ring-2 ring-foreground"
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
            aria-label={tr('Новая точка')}
          />
        )}
      </div>
    </div>
  )
}
