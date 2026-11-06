import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Building2, ChevronLeft, Globe, Mail, MapPin, Pencil, Phone, StickyNote } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppIcon } from '@/components/icons/whatsapp'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ORG_KIND_LABELS, peopleDirectoryQuery } from '@/features/people/api'
import { myTenantPermissionsQuery, ORG_CONTACT_KEYS, organizationQuery, updateOrganization, websiteHref, type Organization } from '@/features/people/org-api'
import { UserAvatar } from '@/features/profile/avatar'
import { telHref, whatsappHref } from '@/lib/phone'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Запись»: одна организация — реквизиты и контакты, люди, проекты
export const Route = createFileRoute('/_app/organizations/$id')({
  loader: async ({ context: { queryClient }, params }) => {
    const org = await queryClient.ensureQueryData(organizationQuery(params.id))
    if (!org) throw notFound()
    await Promise.all([queryClient.ensureQueryData(peopleDirectoryQuery), queryClient.ensureQueryData(myTenantPermissionsQuery)])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем организацию…')}</p>,
  component: OrganizationPage,
})

function OrganizationPage() {
  const { id } = Route.useParams()
  const { data: org } = useSuspenseQuery(organizationQuery(id))
  const { data: people } = useSuspenseQuery(peopleDirectoryQuery)
  const { data: perms } = useSuspenseQuery(myTenantPermissionsQuery)
  const [editing, setEditing] = useState(false)
  const o = org!
  const kinds = ORG_KIND_LABELS()
  const canEdit = perms.includes('admin.reference_data')

  const staff = useMemo(() => people.filter((p) => p.organization_id === id).sort((a, b) => a.full_name.localeCompare(b.full_name)), [people, id])
  // проекты организации — те, где участвуют её люди: сколько человек и в каких ролях
  const projects = useMemo(() => {
    const m = new Map<string, { code: string; name: string; people: number; roles: Set<string> }>()
    for (const p of staff)
      for (const x of p.projects) {
        const cur = m.get(x.project_id) ?? { code: x.code, name: x.name, people: 0, roles: new Set<string>() }
        cur.people += 1
        if (x.role) cur.roles.add(x.role)
        m.set(x.project_id, cur)
      }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [staff])

  const c = o.contacts
  const site = c.website ? websiteHref(c.website) : null
  const rows: { icon: typeof Phone; label: string; node: React.ReactNode }[] = [
    ...(c.phone
      ? [
          {
            icon: Phone,
            label: tr('Телефон'),
            node: (
              <span className="flex flex-wrap items-center gap-2">
                <a href={telHref(c.phone)} className="tabular-nums hover:underline">
                  {c.phone}
                </a>
                <a href={whatsappHref(c.phone)} target="_blank" rel="noopener noreferrer" aria-label={tr('Написать в WhatsApp: {{name}}', { name: o.name })} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[#1fa855] hover:bg-[#25D366]/15">
                  <WhatsAppIcon className="size-4" /> {tr('WhatsApp')}
                </a>
              </span>
            ),
          },
        ]
      : []),
    ...(c.email ? [{ icon: Mail, label: tr('Почта'), node: <a href={`mailto:${c.email}`} className="break-all hover:underline">{c.email}</a> }] : []),
    ...(c.website ? [{ icon: Globe, label: tr('Сайт'), node: site ? <a href={site} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">{c.website}</a> : <span>{c.website}</span> }] : []),
    ...(c.address ? [{ icon: MapPin, label: tr('Адрес'), node: <span>{c.address}</span> }] : []),
    ...(c.note ? [{ icon: StickyNote, label: tr('Заметка'), node: <span className="whitespace-pre-line">{c.note}</span> }] : []),
  ]

  return (
    <div className="flex flex-col gap-5">
      <Link to="/people" search={{}} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft className="size-4" aria-hidden /> {tr('Люди')}
      </Link>

      <header className="flex flex-wrap items-start gap-3">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Building2 className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">{o.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>{kinds[o.kind] ?? o.kind}</span>
            {o.short_name && <span>· {o.short_name}</span>}
            {!o.is_active && <span className="rounded bg-muted px-1.5 text-xs">{tr('не работаем')}</span>}
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> {tr('Изменить')}
          </Button>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Реквизиты и контакты')}>
          <h2 className="text-sm font-semibold">{tr('Реквизиты и контакты')}</h2>
          {o.tax_id && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{tr('ИНН / налоговый номер')}</span>
              <span className="text-sm tabular-nums">{o.tax_id}</span>
            </div>
          )}
          {rows.length === 0 && !o.tax_id ? (
            <p className="text-sm text-muted-foreground">{canEdit ? tr('Реквизиты не заполнены. Нажмите «Изменить», чтобы добавить телефон, почту и адрес.') : tr('Реквизиты не заполнены.')}</p>
          ) : (
            <dl className="flex flex-col gap-3">
              {rows.map((r) => (
                <div key={r.label} className="flex items-start gap-2.5">
                  <r.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{r.label}</dt>
                    <dd className="text-sm">{r.node}</dd>
                  </div>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Проекты')}>
          <h2 className="text-sm font-semibold">
            {tr('Проекты')} <span className="font-normal text-muted-foreground">{projects.length}</span>
          </h2>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('Люди этой организации пока не участвуют в проектах.')}</p>
          ) : (
            <ul className="divide-y">
              {projects.map((p) => (
                <li key={p.code}>
                  <Link to="/projects/$code" params={{ code: p.code }} className="flex min-h-11 items-center gap-2 py-1.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                    <span className="ident shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{p.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{[...p.roles].slice(0, 2).join(', ')}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tr('чел.: {{n}}', { n: p.people })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border bg-card shadow-soft" aria-label={tr('Сотрудники')}>
        <h2 className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
          {tr('Сотрудники')} <span className="font-normal text-muted-foreground">{staff.length}</span>
        </h2>
        {staff.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{tr('В справочнике нет людей этой организации, видимых вам.')}</p>
        ) : (
          <ul className="divide-y">
            {staff.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3 sm:px-4">
                <UserAvatar name={p.full_name} path={p.avatar_path} className="size-10 bg-muted text-sm font-medium text-foreground" />
                <div className="min-w-0 flex-1">
                  <Link to="/people" search={{ q: p.full_name }} className="block truncate font-medium hover:underline">
                    {p.full_name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">{p.job_title || '—'}</p>
                </div>
                {p.phone && (
                  <div className="flex shrink-0 items-center gap-1">
                    <a href={telHref(p.phone)} aria-label={tr('Позвонить: {{name}}', { name: p.full_name })} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <Phone className="size-4" />
                    </a>
                    <a href={whatsappHref(p.phone)} target="_blank" rel="noopener noreferrer" aria-label={tr('Написать в WhatsApp: {{name}}', { name: p.full_name })} className="inline-flex size-10 items-center justify-center rounded-md text-[#1fa855] outline-none hover:bg-[#25D366]/15 focus-visible:ring-2 focus-visible:ring-ring">
                      <WhatsAppIcon className="size-5" />
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <Suspense fallback={null}>
          <EditDialog org={o} onClose={() => setEditing(false)} />
        </Suspense>
      )}
    </div>
  )
}

function EditDialog({ org, onClose }: { org: Organization; onClose: () => void }) {
  const queryClient = useQueryClient()
  const kinds = ORG_KIND_LABELS()
  const [name, setName] = useState(org.name)
  const [short, setShort] = useState(org.short_name ?? '')
  const [tax, setTax] = useState(org.tax_id ?? '')
  const [kind, setKind] = useState(org.kind)
  const [active, setActive] = useState(org.is_active)
  const [contacts, setContacts] = useState<Record<string, string>>(() => Object.fromEntries(ORG_CONTACT_KEYS.map((k) => [k, org.contacts[k] ?? ''])))
  const save = useMutation({
    mutationFn: () => updateOrganization({ ...org, name: name.trim(), short_name: short.trim() || null, tax_id: tax.trim() || null, kind, is_active: active, contacts }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organization', org.id] }),
        queryClient.invalidateQueries({ queryKey: ['organizations'] }),
        queryClient.invalidateQueries({ queryKey: ['people-directory'] }),
      ])
      toast.success(tr('Организация сохранена'))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '42501' ? tr('Нет права менять справочник организаций.') : tr('Не удалось сохранить. Проверьте название и длину полей.')),
  })
  const field = (key: string, label: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`org-${key}`} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input id={`org-${key}`} value={contacts[key] ?? ''} maxLength={300} onChange={(e) => setContacts((cur) => ({ ...cur, [key]: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm" {...props} />
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Организация')}</DialogTitle>
          <DialogDescription>{tr('Название, реквизиты и контакты видят все, кому видна эта организация.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="org-name" className="text-xs text-muted-foreground">
              {tr('Название')}
            </label>
            <input id="org-name" value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="org-short" className="text-xs text-muted-foreground">
                {tr('Краткое название')}
              </label>
              <input id="org-short" value={short} maxLength={60} onChange={(e) => setShort(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tr('Вид')}</span>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label={tr('Вид организации')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(kinds).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="org-tax" className="text-xs text-muted-foreground">
              {tr('ИНН / налоговый номер')}
            </label>
            <input id="org-tax" value={tax} maxLength={40} inputMode="numeric" onChange={(e) => setTax(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm tabular-nums" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('phone', tr('Телефон'), { type: 'tel', inputMode: 'tel', placeholder: '+995 …' })}
            {field('email', tr('Почта'), { type: 'email' })}
          </div>
          {field('website', tr('Сайт'), { placeholder: 'example.com' })}
          {field('address', tr('Адрес'))}
          <div className="flex flex-col gap-1">
            <label htmlFor="org-note" className="text-xs text-muted-foreground">
              {tr('Заметка')}
            </label>
            <textarea id="org-note" rows={2} maxLength={300} value={contacts.note ?? ''} onChange={(e) => setContacts((cur) => ({ ...cur, note: e.target.value }))} className="rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <label className={cn('flex min-h-10 cursor-pointer items-center gap-2 text-sm')}>
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {tr('Работаем с этой организацией (неактивные не предлагаются в списках)')}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {tr('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
