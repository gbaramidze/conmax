import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ClipboardPen, HardHat, Lock, MapPin, MessageSquare, RotateCcw, Search, Share2, User, X } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { MobileFilters } from '@/components/mobile-filters'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AttachmentThumb } from '@/features/activity/attachment-thumb'
import { meQuery } from '@/features/auth/api'
import { orgMembersQuery, orgOverviewQuery } from '@/features/contractors/api'
import { UserAvatar } from '@/features/profile/avatar'
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
import { NotesShareDialog } from '@/features/notes/share-dialog'
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
  from: z.string().catch(''), // свой период: ГГГГ-ММ-ДД
  to: z.string().catch(''),
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
  // «Корпус 1 › Секция 1 › Этаж 6 › King 2»: родители приглушены, само место — заголовок карточки
  const parts = locationName.split(' › ')
  const placeName = parts[parts.length - 1]
  const parents = parts.slice(0, -1).join(' › ')
  return (
    <li
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-l-4 bg-card p-4 shadow-soft',
        done ? 'border-l-green-500/70 bg-muted/30' : stale ? 'border-l-amber-500' : 'border-l-signal',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {parents && <p className="truncate text-xs text-muted-foreground">{parents}</p>}
          <p className="text-base font-semibold leading-snug">
            {locationPath ? (
              <Link to="/projects/$code/locations/$path" params={{ code, path: locationPath }} className="underline-offset-4 hover:underline">
                {placeName}
              </Link>
            ) : (
              placeName
            )}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            done ? 'bg-green-500/10 text-green-800 dark:text-green-300' : stale ? 'bg-amber-500/15 text-amber-900 dark:text-amber-300' : 'bg-muted text-foreground',
          )}
        >
          <span aria-hidden className={cn('size-1.5 rounded-full', done ? 'bg-green-600' : stale ? 'bg-amber-500' : 'bg-signal ring-1 ring-black/20')} />
          {done ? tr('Закрыта') : stale ? tr('Висит долго') : tr('Открыта')}
        </span>
      </div>

      {n.comment?.body_text && <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">{n.comment.body_text}</p>}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((f) => (
            <li key={f.id}>
              <AttachmentThumb file={f} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <UserAvatar name={n.author?.full_name ?? '?'} className="size-5 text-[9px]" />
          <span className="truncate text-foreground">{n.author?.full_name ?? '—'}</span>
        </span>
        <time dateTime={n.created_at}>{dateFmt.format(new Date(n.created_at))}</time>
        {addressee && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground">
            {n.org ? <HardHat className="size-3" aria-hidden /> : <User className="size-3" aria-hidden />}
            {addressee}
          </span>
        )}
        {n.scheme_x !== null && (
          <span className="inline-flex items-center gap-1" title={tr('Точка отмечена на схеме')}>
            <MapPin className="size-3" aria-hidden />
            {tr('на схеме')}
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

      <div className={cn('mt-auto grid gap-2 border-t pt-3 sm:flex sm:justify-end', canToggle ? 'grid-cols-2' : 'grid-cols-1')}>
        <Button asChild variant="outline">
          <Link to="/projects/$code/note/$id" params={{ code, id: n.comment_id }}>
            <MessageSquare />
            {tr('Открыть')}
          </Link>
        </Button>
        {canToggle && (
          <Button type="button" variant={done ? 'outline' : 'default'} disabled={pending} onClick={onToggle}>
            {done ? <RotateCcw /> : <Check />}
            {done ? tr('Вернуть в работу') : tr('Закрыть')}
          </Button>
        )}
      </div>
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
  const [shareOpen, setShareOpen] = useState(false)
  const setSearch = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const canNote = permissions.includes('comment.create')
  const canModerate = permissions.includes('comment.delete.any')
  const ctx: NoteContext = useMemo(() => ({ me: me.id, myOrg: me.organization_id, now: Date.now(), locations }), [me.id, me.organization_id, locations, notes]) // eslint-disable-line react-hooks/exhaustive-deps
  const params: NoteParams = { ...DEFAULT_NOTE_PARAMS, ...search, q }

  // Условия без статуса → статистика и числа на чипах; со статусом → список
  const scoped = useMemo(() => notes.filter((n) => matchesScope(n, params, ctx)), [notes, search.org, search.who, search.author, search.location, search.period, search.from, search.to, search.photo, q, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
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
    setSearch({ org: ANY, who: ANY, author: ANY, location: ANY, period: 'all', from: '', to: '', photo: false })
  }
  const pick = (s: StatPick) => {
    if (s.kind === 'floor') setSearch({ location: s.key === 'none' ? ANY : s.key })
    else if (s.kind === 'author') setSearch({ author: s.key })
    else if (s.key === 'none') setSearch({ org: NONE, who: NONE })
    else if (s.key.startsWith('o:')) setSearch({ org: s.key.slice(2), who: ANY })
    else setSearch({ who: s.key.slice(2), org: ANY })
  }

  const people = members.filter((m) => m.user).sort((a, b) => a.user!.full_name.localeCompare(b.user!.full_name))

  // Что попадёт в шапку PDF: только включённые условия (статус показываем всегда), чтобы получатель понимал, по какому отбору собран отчёт
  const shareInput = useMemo(() => {
    if (!shareOpen) return null
    const day = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    const d = (iso: string) => day.format(new Date(`${iso}T12:00:00`))
    const filters: { label: string; value: string }[] = [{ label: tr('Статус'), value: NOTE_FILTER_LABELS[search.filter] }]
    if (search.org !== ANY) filters.push({ label: tr('Подрядчик'), value: search.org === NONE ? tr('Без подрядчика') : (orgs.find((o) => o.organization_id === search.org)?.name ?? '—') })
    if (search.who !== ANY) filters.push({ label: tr('Сотрудник'), value: search.who === NONE ? tr('Без сотрудника') : (people.find((m) => m.user!.id === search.who)?.user!.full_name ?? '—') })
    if (search.author !== ANY) filters.push({ label: tr('Автор'), value: people.find((m) => m.user!.id === search.author)?.user!.full_name ?? '—' })
    if (search.location !== ANY) filters.push({ label: tr('Место'), value: locationLabel(locById.get(search.location)?.path, locations) })
    if (search.period === 'custom') {
      const from = search.from ? tr('с {{d}}', { d: d(search.from) }) : ''
      const to = search.to ? tr('по {{d}}', { d: d(search.to) }) : ''
      filters.push({ label: tr('Период'), value: [from, to].filter(Boolean).join(' ') || tr('За всё время') })
    } else if (search.period !== 'all') filters.push({ label: tr('Период'), value: NOTE_PERIOD_LABELS[search.period] })
    if (search.photo) filters.push({ label: tr('Условие'), value: tr('Только с фото') })
    if (q.trim()) filters.push({ label: tr('Поиск'), value: q.trim() })
    return {
      projectName: p.name,
      projectCode: p.code,
      filters,
      generatedBy: me.full_name,
      items: shown.map((n) => ({ note: n, place: locationLabel(locById.get(n.location_id)?.path, locations), stale: isStale(n, ctx.now) })),
    }
    // список «заморожен» на момент нажатия кнопки: PDF собирается по тому, что человек видел
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen])

  const selectCls = 'h-11 w-full min-w-0 text-base md:h-9 md:text-sm'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{tr('Заметки')}</h1>
          <p className="text-sm text-muted-foreground max-sm:hidden">{tr('Фото и пара слов с площадки: к месту, сотруднику или подрядчику. Отдельно от задач.')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" disabled={shown.length === 0} onClick={() => setShareOpen(true)} aria-label={tr('Поделиться заметками')}>
            <Share2 />
            <span className="max-sm:hidden">{tr('Поделиться')}</span>
          </Button>
          {canNote && (
            <Button onClick={() => setNewOpen(true)} className="shrink-0">
              <ClipboardPen />
              {tr('Заметка')}
            </Button>
          )}
        </div>
      </div>

      <NoteStatsPanel stats={stats} storageKey={`notes-stats-tab:${p.id}`} onPick={pick} onStale={() => setSearch({ filter: 'stale' })} />

      {/* От планшета статус и условия собраны в одну панель: сверху чипы статуса, ниже поиск и списки одной сеткой */}
      <div className="flex flex-col gap-3 sm:rounded-lg sm:border sm:bg-card sm:p-3 sm:shadow-soft">
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

      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:items-center lg:grid-cols-3 2xl:grid-cols-6">
        <div className="flex gap-2 sm:contents">
        <div className="relative min-w-0 flex-1 sm:col-span-2 lg:col-span-1">
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
          {search.period === 'custom' && (
            <>
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0 text-muted-foreground">{tr('С')}</span>
                <DatePicker value={search.from} max={search.to || undefined} onChange={(v) => setSearch({ from: v })} aria-label={tr('Период с даты')} placeholder={tr('любая дата')} className="w-full min-w-0" />
              </label>
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0 text-muted-foreground">{tr('по')}</span>
                <DatePicker value={search.to} min={search.from || undefined} onChange={(v) => setSearch({ to: v })} aria-label={tr('Период по дату')} placeholder={tr('любая дата')} className="w-full min-w-0" />
              </label>
            </>
          )}
          <label className="flex h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-signal/15 md:h-9">
            <input type="checkbox" className="size-5 accent-[var(--primary)] md:size-4" checked={search.photo} onChange={(e) => setSearch({ photo: e.target.checked })} />
            <span className="truncate">{tr('Только с фото')}</span>
          </label>
        </MobileFilters>
        {(extras > 0 || q) && (
          <Button type="button" variant="ghost" onClick={reset} className="justify-self-start">
            <X />
            {tr('Сбросить')}
          </Button>
        )}
      </div>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-10 text-center">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-signal/20 text-foreground">
            <ClipboardPen className="size-6" />
          </span>
          <p className="text-lg font-semibold">{tr('Заметок пока нет')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{tr('На площадке нажмите кнопку с камерой, выберите «Заметка с фото», место и кому она адресована. Здесь появятся все заметки со статусами и статистикой.')}</p>
          {canNote && (
            <Button onClick={() => setNewOpen(true)}>
              <ClipboardPen />
              {tr('Добавить заметку')}
            </Button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-10 text-center">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Search className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">{tr('По этим условиям заметок нет.')}</p>
          <Button type="button" variant="outline" onClick={() => { reset(); setSearch({ filter: 'all' }) }}>
            {tr('Показать все')}
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
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

      {shareInput && <NotesShareDialog open={shareOpen} onClose={() => setShareOpen(false)} input={shareInput} />}

      {newOpen && (
        <Suspense fallback={null}>
          <FieldNoteSheet projectId={p.id} open={newOpen} onOpenChange={setNewOpen} />
        </Suspense>
      )}
    </div>
  )
}
