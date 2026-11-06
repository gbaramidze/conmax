import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, Mail, MessageCircle, Phone, Search, ShieldOff, UserPlus } from 'lucide-react'
import { WhatsAppIcon } from '@/components/icons/whatsapp'
import { useMutation, useSuspenseQuery as useSQ } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useShowMore } from '@/components/show-more'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import { chatPeopleQuery } from '@/features/chat/api'
import { OnlineDot, presenceText, useOnline } from '@/features/chat/presence'
import { AddEmployeeDialog } from '@/features/people/add-employee-dialog'
import { ORG_KIND_LABELS, peopleDirectoryQuery, type DirectoryPerson } from '@/features/people/api'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { supabase } from '@/lib/supabase'
import { UserAvatar } from '@/features/profile/avatar'
import { telHref, whatsappHref } from '@/lib/phone'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const ALL = 'all'

// Паттерн «Список / Index»: люди и организации, поиск и фильтры сверху
export const Route = createFileRoute('/_app/people')({
  validateSearch: z.object({
    q: z.string().optional().catch(undefined),
    org: z.string().optional().catch(undefined),
    project: z.string().optional().catch(undefined),
    who: z.enum(['own', 'external']).optional().catch(undefined),
    view: z.enum(['list', 'orgs']).optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([queryClient.ensureQueryData(peopleDirectoryQuery), queryClient.ensureQueryData(chatPeopleQuery), queryClient.ensureQueryData(myTenantPermissionsQuery)])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем справочник…')}</p>,
  component: PeoplePage,
})

const haystack = (p: DirectoryPerson) =>
  [p.full_name, p.email, p.phone, p.job_title, p.organization_name, ...p.projects.flatMap((x) => [x.code, x.role, x.title])].filter(Boolean).join(' ').toLowerCase()

function PeoplePage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { session } = useAuth()
  const me = session!.user.id
  const { data: people } = useSuspenseQuery(peopleDirectoryQuery)
  const { data: chatPeople } = useSuspenseQuery(chatPeopleQuery)
  const canChat = useMemo(() => new Set(chatPeople.map((x) => x.id)), [chatPeople])
  const online = useOnline()
  const [typed, setTyped] = useState(search.q ?? '')
  const [adding, setAdding] = useState(false)

  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const orgs = useMemo(() => {
    const m = new Map<string, { name: string; kind: string | null; count: number }>()
    for (const p of people) {
      if (!p.organization_id) continue
      const o = m.get(p.organization_id) ?? { name: p.organization_name ?? '', kind: p.organization_kind, count: 0 }
      o.count += 1
      m.set(p.organization_id, o)
    }
    return [...m].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [people])

  const projects = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of people) for (const x of p.projects) m.set(x.project_id, `${x.code} · ${x.name}`)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [people])

  const filtered = useMemo(() => {
    const needle = (search.q ?? '').trim().toLowerCase()
    return people.filter(
      (p) =>
        (!needle || haystack(p).includes(needle)) &&
        (!search.org || p.organization_id === search.org) &&
        (!search.project || p.projects.some((x) => x.project_id === search.project)) &&
        (!search.who || (search.who === 'external' ? p.is_external : !p.is_external)),
    )
  }, [people, search.q, search.org, search.project, search.who])

  const { shown: shownPeople, more: morePeople } = useShowMore(filtered, 40, `${search.view}|${search.q ?? ''}|${filtered.length}`)
  const groups = useMemo(() => {
    if (search.view !== 'orgs') return [{ key: 'all', title: null as string | null, kind: null as string | null, items: shownPeople }]
    const m = new Map<string, { title: string; kind: string | null; items: DirectoryPerson[] }>()
    for (const p of shownPeople) {
      const key = p.organization_id ?? 'none'
      const g = m.get(key) ?? { title: p.organization_name ?? tr('Без организации'), kind: p.organization_kind, items: [] }
      g.items.push(p)
      m.set(key, g)
    }
    return [...m].sort((a, b) => a[1].title.localeCompare(b[1].title)).map(([key, g]) => ({ key, ...g }))
  }, [shownPeople, search.view])

  const kinds = ORG_KIND_LABELS()
  const { data: tenantPerms } = useSQ(myTenantPermissionsQuery)
  const isAdmin = tenantPerms.includes('admin.users')
  const seg = (value: 'own' | 'external' | undefined, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={search.who === value}
      onClick={() => set({ who: value })}
      className={cn('min-h-9 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', search.who === value ? 'bg-background shadow-soft' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tr('Люди')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{tr('Кто есть кто: организация, должность, контакты и проекты. Видны только те, кого вам можно видеть.')}</p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> {tr('Зарегистрировать сотрудника')}
          </Button>
        )}
      </div>
      {adding && <AddEmployeeDialog onClose={() => setAdding(false)} />}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              set({ q: e.target.value || undefined })
            }}
            placeholder={tr('Имя, должность, организация, почта, телефон')}
            aria-label={tr('Поиск людей')}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <Select value={search.org ?? ALL} onValueChange={(v) => set({ org: v === ALL ? undefined : v })}>
            <SelectTrigger aria-label={tr('Организация')} className="w-full lg:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr('Все организации')}</SelectItem>
              {orgs.map(([id, o]) => (
                <SelectItem key={id} value={id}>
                  {o.name} ({o.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={search.project ?? ALL} onValueChange={(v) => set({ project: v === ALL ? undefined : v })}>
            <SelectTrigger aria-label={tr('Проект')} className="w-full lg:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr('Все проекты')}</SelectItem>
              {projects.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label={tr('Кого показывать')} className="flex gap-1 rounded-lg bg-muted p-1">
          {seg(undefined, tr('Все'))}
          {seg('own', tr('Наши сотрудники'))}
          {seg('external', tr('Внешние'))}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{tr('Найдено: {{n}}', { n: filtered.length })}</span>
          <button
            type="button"
            onClick={() => set({ view: search.view === 'orgs' ? undefined : 'orgs' })}
            aria-pressed={search.view === 'orgs'}
            className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', search.view === 'orgs' ? 'border-primary bg-primary/10 text-foreground' : 'hover:bg-muted')}
          >
            <Building2 className="size-4" /> {tr('По организациям')}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {people.length === 0 ? tr('Пока никого нет.') : tr('Никого не нашли. Измените запрос или фильтры.')}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} className="overflow-hidden rounded-lg border bg-card shadow-soft" aria-label={g.title ?? tr('Люди')}>
              {g.title && (
                <h2 className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
                  <Building2 className="size-4 text-muted-foreground" />
                  {g.key !== 'none' && g.key !== 'all' ? (
                    <Link to="/organizations/$id" params={{ id: g.key }} className="hover:underline">
                      {g.title}
                    </Link>
                  ) : (
                    g.title
                  )}
                  {g.kind && <span className="text-xs font-normal text-muted-foreground">{kinds[g.kind] ?? g.kind}</span>}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{g.items.length}</span>
                </h2>
              )}
              <ul className="divide-y">
                {g.items.map((p) => (
                  <PersonRow key={p.id} p={p} me={p.id === me} canResetMfa={isAdmin} canChat={canChat.has(p.id)} state={online(p.id)} showOrg={search.view !== 'orgs'} kinds={kinds} />
                ))}
              </ul>
            </section>
          ))}
          {morePeople}
        </div>
      )}
    </div>
  )
}

function ResetMfa({ p }: { p: DirectoryPerson }) {
  const [ask, setAsk] = useState(false)
  const reset = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('reset-mfa', { body: { user_id: p.id } })
      if (error) throw error
      return (data as { removed: number }).removed
    },
    onSuccess: (n) => {
      setAsk(false)
      toast.success(n > 0 ? tr('Двухфакторная защита сброшена: {{name}} входит по паролю', { name: p.full_name }) : tr('У {{name}} двухфакторная защита не была включена', { name: p.full_name }))
    },
    onError: () => toast.error(tr('Не удалось сбросить защиту.')),
  })
  if (!ask)
    return (
      <button type="button" onClick={() => setAsk(true)} aria-label={tr('Сбросить двухфакторную защиту: {{name}}', { name: p.full_name })} title={tr('Сбросить двухфакторную защиту (потерян телефон)')} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ShieldOff className="size-4" />
      </button>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <button type="button" disabled={reset.isPending} onClick={() => reset.mutate()} className="min-h-9 rounded-md bg-destructive px-2 text-destructive-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {tr('Сбросить защиту')}
      </button>
      <button type="button" onClick={() => setAsk(false)} className="min-h-9 rounded-md px-2 hover:bg-muted">
        {tr('Нет')}
      </button>
    </span>
  )
}

function PersonRow({ p, me, canChat, state, showOrg, kinds, canResetMfa }: { canResetMfa: boolean; p: DirectoryPerson; me: boolean; canChat: boolean; state: ReturnType<ReturnType<typeof useOnline>>; showOrg: boolean; kinds: Record<string, string> }) {
  const shown = p.projects.slice(0, 3)
  const more = p.projects.length - shown.length
  return (
    <li className="grid gap-3 p-3 sm:px-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.5fr)_11rem] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          <UserAvatar name={p.full_name} path={p.avatar_path} className="size-11 bg-muted text-sm font-medium text-foreground" />
          {!me && <OnlineDot online={state.online} className="absolute -bottom-0.5 -right-0.5" />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="truncate font-medium">{p.full_name}</span>
            {me && <span className="text-xs text-muted-foreground">{tr('это вы')}</span>}
            {p.status === 'invited' && <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{tr('приглашён')}</span>}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {p.job_title}
            {p.job_title && showOrg && p.organization_name ? ' · ' : ''}
            {showOrg && p.organization_id && p.organization_name ? (
              <Link to="/organizations/$id" params={{ id: p.organization_id }} className="hover:underline max-sm:inline-flex max-sm:min-h-9 max-sm:items-center">
                {p.organization_name}
              </Link>
            ) : null}
            {!p.job_title && showOrg && !p.organization_name ? '—' : ''}
          </div>
          {showOrg && p.organization_kind && p.organization_kind !== 'own' && <div className="text-xs text-muted-foreground">{kinds[p.organization_kind] ?? p.organization_kind}</div>}
          {p.phone && (
            <a href={telHref(p.phone)} className="mt-0.5 inline-flex items-center gap-1 text-sm tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              <Phone className="size-3.5 text-muted-foreground" /> {p.phone}
            </a>
          )}
          {!me && presenceText(state) && <div className="text-xs text-muted-foreground">{presenceText(state)}</div>}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1.5">
        {shown.map((x) => (
          <Link
            key={x.project_id}
            to="/projects/$code"
            params={{ code: x.code }}
            title={`${x.name}${x.role ? ` · ${x.role}` : ''}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-9 max-sm:px-3 max-sm:text-sm"
          >
            <span className="ident font-medium">{x.code}</span>
            {(x.title || x.role) && <span className="truncate text-muted-foreground">{x.title || x.role}</span>}
            {x.discipline && <span className="ident text-muted-foreground">{x.discipline}</span>}
          </Link>
        ))}
        {more > 0 && <span className="inline-flex items-center px-1 text-xs text-muted-foreground">{tr('ещё {{n}}', { n: more })}</span>}
        {p.projects.length === 0 && <span className="text-xs text-muted-foreground">{tr('Не участвует в проектах')}</span>}
      </div>

      <div className="flex items-center gap-1 md:justify-end">
        {p.phone && (
          <a href={telHref(p.phone)} aria-label={tr('Позвонить: {{name}}', { name: p.full_name })} title={tr('Позвонить')} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <Phone className="size-4" />
          </a>
        )}
        {p.phone && (
          <a href={whatsappHref(p.phone)} target="_blank" rel="noopener noreferrer" aria-label={tr('Написать в WhatsApp: {{name}}', { name: p.full_name })} title={tr('Написать в WhatsApp')} className="inline-flex size-10 items-center justify-center rounded-md text-[#1fa855] outline-none hover:bg-[#25D366]/15 focus-visible:ring-2 focus-visible:ring-ring">
            <WhatsAppIcon className="size-5" />
          </a>
        )}
        <a href={`mailto:${p.email}`} aria-label={tr('Написать письмо: {{name}}', { name: p.full_name })} title={p.email} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <Mail className="size-4" />
        </a>
        {!me && canResetMfa && <ResetMfa p={p} />}
        {!me && canChat && (
          <Link to="/chat" search={{ with: p.id }} aria-label={tr('Написать в чат: {{name}}', { name: p.full_name })} title={tr('Написать в чат')} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <MessageCircle className="size-4" />
          </Link>
        )}
      </div>
    </li>
  )
}
