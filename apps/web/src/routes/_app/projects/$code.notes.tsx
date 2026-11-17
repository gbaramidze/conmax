import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ClipboardPen, HardHat, Lock, RotateCcw, Search, User, X } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { MobileFilters } from '@/components/mobile-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AttachmentThumb } from '@/features/activity/attachment-thumb'
import { meQuery } from '@/features/auth/api'
import { orgMembersQuery, orgOverviewQuery } from '@/features/contractors/api'
import { FieldNoteSheet } from '@/features/locations/field-note'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationSelect } from '@/features/locations/location-select'
import {
  activeScopeCount,
  computeNoteStats,
  DEFAULT_NOTE_PARAMS,
  isStale,
  matchesScope,
  matchesStatus,
  noteAddresseeName,
  NOTE_FILTER_LABELS,
  NOTE_FILTERS,
  NOTE_PERIOD_LABELS,
  NOTE_PERIODS,
  notePhotos,
  notesQuery,
  setNoteStatus,
  type NoteContext,
  type NoteParams,
  type NoteRow,
} from '@/features/notes/api'
import { NoteStatsPanel, type StatPick } from '@/features/notes/stats-panel'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { cn } from '@/lib/utils'

// Состояние фильтров живёт в адресе: ссылкой на «открытые заметки подрядчика X» можно поделиться
const searchSchema = z.object({
  filter: z.enum(NOTE_FILTERS).catch('open'),
  org: z.string().catch('any'), // 'any' | 'none' | id организации-адресата
  who: z.string().catch('any'), // 'any' | 'none' | id сотрудника-адресата
  author: z.string().catch('any'),
  location: z.string().catch('any'), // 'any' | id места (с вложенными)
  period: z.enum(NOTE_PERIODS).catch('all'),
  photo: z.boolean().catch(false),
})
type Search = z.infer<typeof searchSchema>

export const Route = createFileRoute('/_app/projects/$code/notes')({
  validateSearch: searchSchema,
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(notesQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      queryClient.ensureQueryData(meQuery),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем заметки…')}</p>,
  component: NotesPage,
})

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const ANY = 'any'
const NONE = 'none'

function NoteCard({
  n,
  code,
  locationPath,
  locationName,
  canToggle,
  stale,
  onToggle,
  pending,
}: {
  n: NoteRow
  code: string
  locationPath: string | null
  locationName: string
  canToggle: boolean
  stale: boolean
  onToggle: () => void
  pending: boolean
}) {
  const photos = notePhotos(n)
  const addressee = noteAddresseeName(n)
  const done = n.status === 'done'
  return (
    <li className={cn('flex flex-col gap-2.5 rounded-lg border bg-card p-3.5 shadow-soft', done && 'bg-muted/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium">
          {locationPath ? (
            <Link to="/projects/$code/locations/$path" params={{ code, path: locationPath }} className="underline-offset-4 hover:underline">
              {locationName}
            </Link>
          ) : (
            locationName
          )}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
            done ? 'bg-green-500/10 text-green-700 dark:text-green-300' : stale ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
          )}
        >
          {done ? tr('Закрыта') : stale ? tr('Висит долго') : tr('Открыта')}
        </span>
      </div>

      {n.comment?.body_text && <p className="whitespace-pre-line break-words text-[15px] leading-snug">{n.comment.body_text}</p>}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((f) => (
            <li key={f.id}>
              <AttachmentThumb file={f} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{n.author?.full_name ?? '—'}</span>
        <span>{dateFmt.format(new Date(n.created_at))}</span>
        {addressee && (
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-foreground">
            {n.org ? <HardHat className="size-3" aria-hidden /> : <User className="size-3" aria-hidden />}
            {addressee}
          </span>
        )}
        {n.comment?.visibility === 'internal' && (
          <span className="inline-flex items-center gap-1" title={tr('Видна только своим, не подрядчикам и заказчику')}>
            <Lock className="size-3" aria-hidden />
            {tr('внутренняя')}
          </span>
        )}
        {n.task && (
          <Link to="/projects/$code/task/$key" params={{ code, key: n.task.key }} className="ident font-medium text-foreground underline underline-offset-4">
            {n.task.key}
          </Link>
        )}
        {done && n.resolved_at && <span>{tr('закрыта {{d}}', { d: dateFmt.format(new Date(n.resolved_at)) })}</span>}
      </div>

      {canToggle && (
        <Button type="button" variant={done ? 'outline' : 'default'} size="lg" className="self-start max-sm:w-full" disabled={pending} onClick={onToggle}>
          {done ? <RotateCcw /> : <Check />}
          {done ? tr('Вернуть в работу') : tr('Закрыть')}
        </Button>
      )}
    </li>
  )
}

function NotesPage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()

  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: notes } = useSuspenseQuery(notesQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: members = [] } = useQuery(orgMembersQuery(p.id))
  const { data: orgs = [] } = useQuery(orgOverviewQuery(p.id))

  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const setSearch = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const canNote = permissions.includes('comment.create')
  const canModerate = permissions.includes('comment.delete.any')
  const ctx: NoteContext = useMemo(() => ({ me: me.id, myOrg: me.organization_id, now: Date.now(), locations }), [me.id, me.organization_id, locations, notes]) // eslint-disable-line react-hooks/exhaustive-deps
  const params: NoteParams = { ...DEFAULT_NOTE_PARAMS, ...search, q }

  // Условия без статуса → статистика и числа на чипах; со статусом → список
  const scoped = useMemo(() => notes.filter((n) => matchesScope(n, params, ctx)), [notes, search.org, search.who, search.author, search.location, search.period, search.photo, q, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => computeNoteStats(scoped, ctx), [scoped, ctx])
  const counts = useMemo(() => Object.fromEntries(NOTE_FILTERS.map((f) => [f, scoped.filter((n) => matchesStatus(n, f, ctx)).length])) as Record<(typeof NOTE_FILTERS)[number], number>, [scoped, ctx])
  const shown = useMemo(() => scoped.filter((n) => matchesStatus(n, search.filter, ctx)), [scoped, search.filter, ctx])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  const toggle = useMutation({
    mutationFn: (n: NoteRow) => setNoteStatus(n.comment_id, n.status === 'open'),
    onSuccess: (_, n) => {
      toast.success(n.status === 'open' ? tr('Заметка закрыта') : tr('Заметка снова в работе'))
      return queryClient.invalidateQueries({ queryKey: ['notes', p.id] })
    },
    onError: () => toast.error(tr('Не удалось изменить заметку. Попробуйте ещё раз.')),
  })

  const extras = activeScopeCount(params)
  const reset = () => {
    setQ('')
    setSearch({ org: ANY, who: ANY, author: ANY, location: ANY, period: 'all', photo: false })
  }
  const pick = (s: StatPick) => {
    if (s.kind === 'floor') setSearch({ location: s.key === 'none' ? ANY : s.key })
    else if (s.kind === 'author') setSearch({ author: s.key })
    else if (s.key === 'none') setSearch({ org: NONE, who: NONE })
    else if (s.key.startsWith('o:')) setSearch({ org: s.key.slice(2), who: ANY })
    else setSearch({ who: s.key.slice(2), org: ANY })
  }

  const people = members.filter((m) => m.user).sort((a, b) => a.user!.full_name.localeCompare(b.user!.full_name))
  const selectCls = 'h-11 w-full text-base md:h-9 md:text-sm sm:w-auto sm:min-w-44'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Заметки')}</h1>
          <p className="text-sm text-muted-foreground max-sm:hidden">{tr('Фото и пара слов с площадки: к месту, сотруднику или подрядчику. Отдельно от задач.')}</p>
        </div>
        {canNote && (
          <Button onClick={() => setNewOpen(true)} className="shrink-0">
            <ClipboardPen />
            {tr('Заметка')}
          </Button>
        )}
      </div>

      <NoteStatsPanel stats={stats} storageKey={`notes-stats-tab:${p.id}`} onPick={pick} onStale={() => setSearch({ filter: 'stale' })} />

      {/* Статус: на компьютере чипы с числами; на телефоне они занимали бы две строки, поэтому там список выбора рядом с поиском */}
      <div role="group" aria-label={tr('Фильтр заметок')} className="flex flex-wrap gap-1.5 max-sm:hidden">
        {NOTE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={search.filter === f}
            onClick={() => setSearch({ filter: f })}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:px-3',
              search.filter === f ? 'border-primary bg-primary font-medium text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {NOTE_FILTER_LABELS[f]}
            <span className="tabular-nums opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex gap-2 sm:contents">
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск')} aria-label={tr('Поиск по заметкам')} className="h-11 pl-9 text-base md:h-9 md:text-sm" />
        </div>
        <Select value={search.filter} onValueChange={(v) => setSearch({ filter: v as Search['filter'] })}>
          <SelectTrigger aria-label={tr('Фильтр заметок')} className="h-11 w-auto min-w-36 shrink-0 text-base sm:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTE_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {NOTE_FILTER_LABELS[f]} · {counts[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
        <MobileFilters activeCount={extras}>
          <Select value={search.org} onValueChange={(v) => setSearch({ org: v })}>
            <SelectTrigger aria-label={tr('Подрядчик')} className={selectCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ANY}>{tr('Все подрядчики')}</SelectItem>
              <SelectItem value={NONE}>{tr('Без подрядчика')}</SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.organization_id} value={o.organization_id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={search.who} onValueChange={(v) => setSearch({ who: v })}>
            <SelectTrigger aria-label={tr('Сотрудник')} className={selectCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ANY}>{tr('Все сотрудники')}</SelectItem>
              <SelectItem value={NONE}>{tr('Без сотрудника')}</SelectItem>
              {people.map((m) => (
                <SelectItem key={m.user!.id} value={m.user!.id}>
                  {m.user!.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={search.author} onValueChange={(v) => setSearch({ author: v })}>
            <SelectTrigger aria-label={tr('Автор')} className={selectCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ANY}>{tr('Все авторы')}</SelectItem>
              {people.map((m) => (
                <SelectItem key={m.user!.id} value={m.user!.id}>
                  {m.user!.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <LocationSelect projectId={p.id} value={search.location === ANY ? null : search.location} onChange={(id) => setSearch({ location: id ?? ANY })} noneLabel={tr('Все места')} ariaLabel={tr('Место')} className={selectCls} />
          <Select value={search.period} onValueChange={(v) => setSearch({ period: v as Search['period'] })}>
            <SelectTrigger aria-label={tr('Период')} className={selectCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTE_PERIODS.map((x) => (
                <SelectItem key={x} value={x}>
                  {NOTE_PERIOD_LABELS[x]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-9">
            <input type="checkbox" className="size-5 md:size-4" checked={search.photo} onChange={(e) => setSearch({ photo: e.target.checked })} />
            {tr('Только с фото')}
          </label>
        </MobileFilters>
        {(extras > 0 || q) && (
          <Button type="button" variant="ghost" onClick={reset} className="self-start">
            <X />
            {tr('Сбросить')}
          </Button>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-soft">
          <p className="font-medium">{tr('Заметок пока нет')}</p>
          <p className="max-w-prose text-sm text-muted-foreground">{tr('На площадке нажмите кнопку с камерой, выберите «Заметка с фото», место и кому она адресована. Здесь появятся все заметки со статусами и статистикой.')}</p>
          {canNote && (
            <Button onClick={() => setNewOpen(true)}>
              <ClipboardPen />
              {tr('Добавить заметку')}
            </Button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-soft">
          {tr('По этим условиям заметок нет.')}
          <Button type="button" variant="outline" onClick={() => { reset(); setSearch({ filter: 'all' }) }}>
            {tr('Показать все')}
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((n) => {
            const loc = locById.get(n.location_id)
            return (
              <NoteCard
                key={n.comment_id}
                n={n}
                code={code}
                locationPath={loc?.path ?? null}
                locationName={locationLabel(loc?.path, locations)}
                stale={isStale(n, ctx.now)}
                canToggle={canModerate || n.author_id === me.id || n.addressee_user_id === me.id || (!!n.addressee_org_id && n.addressee_org_id === me.organization_id)}
                pending={toggle.isPending && toggle.variables?.comment_id === n.comment_id}
                onToggle={() => toggle.mutate(n)}
              />
            )
          })}
        </ul>
      )}

      {newOpen && (
        <Suspense fallback={null}>
          <FieldNoteSheet projectId={p.id} open={newOpen} onOpenChange={setNewOpen} />
        </Suspense>
      )}
    </div>
  )
}
