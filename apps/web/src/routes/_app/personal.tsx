import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Lock, Pin, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { personalItemQuery, personalNotesQuery, type PersonalItem } from '@/features/personal/api'
import { EventDialog, NoteDialog } from '@/features/personal/dialogs'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Index» с вкладками: личный календарь и заметки. Всё видно только владельцу.
export const Route = createFileRoute('/_app/personal')({
  validateSearch: z.object({
    tab: z.enum(['calendar', 'notes']).optional().catch(undefined),
    /** id записи, открытой для правки (ссылка из календаря) */
    item: z.string().optional().catch(undefined),
    view: z.enum(['month', 'week', 'day', 'agenda']).optional().catch(undefined),
    d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
    types: z.string().optional().catch(undefined),
  }),
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(personalNotesQuery),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем личное…')}</p>,
  component: PersonalPage,
})

const dateFmt = () => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })

function PersonalPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { session } = useAuth()
  const tab = search.tab ?? 'calendar'
  const setSearch = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const [creatingEvent, setCreatingEvent] = useState<string | null>(null)
  const { data: openItem } = useQuery({ ...personalItemQuery(search.item ?? ''), enabled: !!search.item })

  const tabButton = (value: 'calendar' | 'notes', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setSearch({ tab: value, item: undefined })}
      className={cn('min-h-10 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === value ? 'bg-background shadow-soft' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Lock className="size-5 text-muted-foreground" aria-hidden /> {tr('Личное')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{tr('Ваши заметки и события. Их видите только вы: ни руководитель, ни администратор.')}</p>
      </div>

      <div role="tablist" aria-label={tr('Раздел личного')} className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        {tabButton('calendar', tr('Календарь'))}
        {tabButton('notes', tr('Заметки'))}
      </div>

      {tab === 'calendar' ? (
        <CalendarPage
          only={['personal']}
          userId={session!.user.id}
          permissions={[]}
          search={search}
          setSearch={(patch) => setSearch(patch)}
          onCreateOwn={(date) => setCreatingEvent(date)}
        />
      ) : (
        <NotesTab />
      )}

      {creatingEvent && <EventDialog item={null} date={creatingEvent} onClose={() => setCreatingEvent(null)} />}
      {tab === 'calendar' && search.item && openItem && <EventDialog key={openItem.id} item={openItem} onClose={() => setSearch({ item: undefined })} />}
    </div>
  )
}

function NotesTab() {
  const { data: notes } = useSuspenseQuery(personalNotesQuery)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<PersonalItem | 'new' | null>(null)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return notes.filter((n) => !needle || `${n.title} ${n.body}`.toLowerCase().includes(needle))
  }, [notes, q])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск по заметкам')} aria-label={tr('Поиск по заметкам')} className="pl-9" />
        </div>
        <Button type="button" onClick={() => setEditing('new')}>
          <Plus /> {tr('Заметка')}
        </Button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {notes.length === 0 ? tr('Заметок пока нет. Запишите то, что не должно потеряться: напоминания, телефоны, мысли по объекту.') : tr('Ничего не нашли.')}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setEditing(n)}
                className="flex h-full w-full flex-col gap-1.5 rounded-lg border bg-card p-4 text-left shadow-soft outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words font-medium">{n.title}</span>
                  {n.pinned && <Pin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={tr('Закреплена')} />}
                </span>
                {n.body && <span className="line-clamp-6 whitespace-pre-wrap break-words text-sm text-muted-foreground">{n.body}</span>}
                <span className="mt-auto pt-1 text-xs text-muted-foreground">{dateFmt().format(new Date(n.updated_at))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <NoteDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
