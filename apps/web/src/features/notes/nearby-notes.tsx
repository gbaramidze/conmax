import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import { useMemo } from 'react'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { notePhotos, notesNearby, notesQuery, noteAddresseeName } from '@/features/notes/api'

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
const SHOWN = 3

/**
 * Подсказка в форме заметки: что уже записано в этом самом месте (комната — заметки комнаты, этаж — заметки этажа).
 * Если такая заметка есть, не нужно писать вторую. Показывает до трёх открытых заметок и сколько ещё и сколько закрытых.
 */
export function NearbyNotes({ projectId, code, locationId, onNavigate }: { projectId: string; code: string | undefined; locationId: string | null; onNavigate: () => void }) {
  const { data: notes } = useQuery({ ...notesQuery(projectId), enabled: !!locationId })
  const { data: locations = [] } = useQuery(locationsQuery(projectId))
  const near = useMemo(() => (notes ? notesNearby(notes, locations, locationId) : null), [notes, locations, locationId])
  if (!near) return null
  const placeName = locationLabel(near.scope.path, locations)
  const shown = near.open.slice(0, SHOWN)
  const rest = near.open.length - shown.length

  return (
    <section aria-label={tr('Заметки в этом месте')} className="flex flex-col gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
      <p className="flex items-start gap-2 text-sm font-medium">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <span>
          {near.open.length > 0
            ? tr('Здесь уже есть открытые заметки: {{n}}. Проверьте, нет ли такой же.', { n: near.open.length })
            : tr('Открытых заметок здесь нет, закрытых: {{n}}.', { n: near.closed })}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">{placeName}</p>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shown.map((n) => {
            const who = noteAddresseeName(n)
            return (
              <li key={n.comment_id} className="rounded-md bg-card px-2.5 py-2 text-sm">
                <span className="line-clamp-2 break-words">{n.comment?.body_text || tr('Фото без текста')}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{dateFmt.format(new Date(n.created_at))}</span>
                  {who && <span>→ {who}</span>}
                  {notePhotos(n).length > 0 && <span>{tr('фото: {{n}}', { n: notePhotos(n).length })}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        {rest > 0 && <span>{tr('И ещё {{n}}', { n: rest })}</span>}
        {near.open.length > 0 && near.closed > 0 && <span>{tr('закрытых: {{n}}', { n: near.closed })}</span>}
        {code && (
          <Link
            to="/projects/$code/notes"
            params={{ code }}
            search={{ filter: 'all', org: 'any', who: 'any', author: 'any', location: near.scope.id, period: 'all', photo: false }}
            onClick={onNavigate}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {tr('Открыть все заметки места')}
          </Link>
        )}
      </p>
    </section>
  )
}
