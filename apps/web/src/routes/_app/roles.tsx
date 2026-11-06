import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Lock, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import {
  createRole,
  deleteRole,
  grantTenantRole,
  internalUsersQuery,
  permissionCatalogQuery,
  renameRole,
  revokeTenantRole,
  roleErrorText,
  roleHoldersQuery,
  rolePermissionsQuery,
  rolesOverviewQuery,
  setRolePermissions,
  type PermissionDef,
  type RoleRow,
  type RoleScope,
} from '@/features/roles/api'
import { tr, trData } from '@/lib/tr'
import { cn } from '@/lib/utils'

const NONE = 'none'

// Паттерн «Разделённая панель»: слева роли, справа права выбранной роли. На телефоне — список, затем роль.
export const Route = createFileRoute('/_app/roles')({
  validateSearch: z.object({
    scope: z.enum(['project', 'tenant']).optional().catch(undefined),
    role: z.string().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient } }) => {
    const perms = await queryClient.ensureQueryData(myTenantPermissionsQuery)
    if (perms.includes('admin.roles')) await Promise.all([queryClient.ensureQueryData(rolesOverviewQuery), queryClient.ensureQueryData(permissionCatalogQuery)])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем роли…')}</p>,
  component: RolesPage,
})

function RolesPage() {
  const { data: tenantPerms } = useSuspenseQuery(myTenantPermissionsQuery)
  if (!tenantPerms.includes('admin.roles')) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        <Lock className="mx-auto mb-2 size-5" />
        {tr('Роли и права настраивает администратор компании.')}
      </div>
    )
  }
  return <RolesEditor canGrant={tenantPerms.includes('admin.users')} />
}

function RolesEditor({ canGrant }: { canGrant: boolean }) {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: roles } = useSuspenseQuery(rolesOverviewQuery)
  const [creating, setCreating] = useState(false)

  const scope: RoleScope = search.scope ?? 'project'
  const inScope = roles.filter((r) => r.scope === scope)
  const selected = inScope.find((r) => r.id === search.role)
  const active = selected ?? inScope[0]

  const setScope = (s: RoleScope) => void navigate({ search: { scope: s }, replace: true })
  const pick = (id: string | undefined) => void navigate({ search: (prev) => ({ ...prev, role: id }), replace: false })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tr('Роли и права')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {tr('Что может делать каждая роль. Изменения действуют сразу, перезаходить не нужно.')}
          </p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> {tr('Новая роль')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <section aria-label={tr('Роли')} className={cn('flex-col gap-3', search.role ? 'hidden lg:flex' : 'flex')}>
          <div role="tablist" aria-label={tr('Вид ролей')} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ['project', tr('Роли проекта')],
                ['tenant', tr('Роли компании')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                onClick={() => setScope(value)}
                className={cn('min-h-9 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', scope === value ? 'bg-background shadow-soft' : 'text-muted-foreground hover:text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {scope === 'project'
              ? tr('Роль проекта действует внутри проектов, где человек участник.')
              : tr('Роль компании действует во всех проектах сразу и открывает администрирование.')}
          </p>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {inScope.map((r) => (
              <li key={r.id}>
                <Link
                  to="/roles"
                  search={{ scope, role: r.id }}
                  aria-current={active?.id === r.id ? 'true' : undefined}
                  className={cn('flex min-h-12 items-center gap-2 px-3 py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active?.id === r.id && 'bg-muted')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{trData(r.name)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {tr('Прав: {{n}}', { n: r.permission_count })} · {tr('Людей: {{n}}', { n: r.holder_count })}
                    </span>
                  </span>
                  {r.is_external && <Badge variant="outline">{tr('внешняя')}</Badge>}
                  {!r.is_system && <Badge variant="secondary">{tr('своя')}</Badge>}
                </Link>
              </li>
            ))}
            {inScope.length === 0 && <li className="p-4 text-sm text-muted-foreground">{tr('Ролей пока нет.')}</li>}
          </ul>
        </section>

        <section aria-label={tr('Права роли')} className={cn('min-w-0 flex-col', search.role ? 'flex' : 'hidden lg:flex')}>
          <Link to="/roles" search={{ scope }} className="mb-2 inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
            <ChevronLeft className="size-4" /> {tr('Все роли')}
          </Link>
          {active ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем права…')}</p>}>
              <RoleDetail key={active.id} role={active} canGrant={canGrant} onDeleted={() => pick(undefined)} />
            </Suspense>
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{tr('Выберите роль слева.')}</div>
          )}
        </section>
      </div>

      {creating && (
        <CreateRoleDialog
          scope={scope}
          roles={inScope}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void navigate({ search: { scope, role: id } })
          }}
        />
      )}
    </div>
  )
}

/** Ключи кеша, зависящие от прав: после правки ролей их надо перечитать. */
function useInvalidateRoles() {
  const queryClient = useQueryClient()
  return async (roleId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['roles-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['my-permissions'] }),
      queryClient.invalidateQueries({ queryKey: ['my-tenant-permissions'] }),
      queryClient.invalidateQueries({ queryKey: ['project-roles'] }),
      ...(roleId ? [queryClient.invalidateQueries({ queryKey: ['role-permissions', roleId] }), queryClient.invalidateQueries({ queryKey: ['role-holders', roleId] })] : []),
    ])
  }
}

function RoleDetail({ role, canGrant, onDeleted }: { role: RoleRow; canGrant: boolean; onDeleted: () => void }) {
  const { data: catalog } = useSuspenseQuery(permissionCatalogQuery)
  const { data: saved } = useSuspenseQuery(rolePermissionsQuery(role.id))
  const invalidate = useInvalidateRoles()
  const savedSet = useMemo(() => new Set(saved), [saved])
  const [draft, setDraft] = useState<Set<string>>(() => new Set(saved))
  const [query, setQuery] = useState('')
  const [onlyOn, setOnlyOn] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Что доступно этой роли: права только для компании скрыты у ролей проекта, внешним доступны лишь безопасные
  const allowed = (p: PermissionDef) => (role.scope === 'tenant' || !p.tenant_only) && (!role.is_external || p.external_ok)
  const visible = useMemo(() => catalog.filter((p) => role.scope === 'tenant' || !p.tenant_only), [catalog, role.scope])

  const added = [...draft].filter((c) => !savedSet.has(c))
  const removed = [...savedSet].filter((c) => !draft.has(c))
  const dirty = added.length + removed.length > 0

  const needle = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const m = new Map<string, PermissionDef[]>()
    for (const p of visible) {
      if (onlyOn && !draft.has(p.code)) continue
      if (needle && !`${trData(p.label)} ${p.label} ${p.code}`.toLowerCase().includes(needle)) continue
      const list = m.get(p.module) ?? []
      list.push(p)
      m.set(p.module, list)
    }
    return [...m]
  }, [visible, needle, onlyOn, draft])

  const toggle = (code: string, on: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev)
      if (on) next.add(code)
      else next.delete(code)
      return next
    })
  const toggleGroup = (items: PermissionDef[], on: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev)
      for (const p of items) {
        if (!allowed(p)) continue
        if (on) next.add(p.code)
        else next.delete(p.code)
      }
      return next
    })

  const save = useMutation({
    mutationFn: () => setRolePermissions(role.id, [...draft]),
    onSuccess: async () => {
      await invalidate(role.id)
      toast.success(tr('Права роли сохранены. Они действуют сразу.'))
    },
    onError: (e) => toast.error(roleErrorText(e)),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{trData(role.name)}</h2>
            {role.is_system ? <Badge variant="outline">{tr('системная')}</Badge> : <Badge variant="secondary">{tr('своя')}</Badge>}
            {role.is_external && <Badge variant="outline">{tr('внешняя')}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {role.scope === 'tenant' ? tr('Роль компании') : tr('Роль проекта')} · <span className="ident">{role.code}</span>
            {role.is_external && ` · ${tr('внешним ролям доступны только безопасные права')}`}
          </p>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(true)}>
            <Pencil className="size-4" /> {tr('Переименовать')}
          </Button>
          {!role.is_system && (
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" /> {tr('Удалить')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Найти право')} aria-label={tr('Найти право')} className="pl-9" />
        </div>
        <label className="inline-flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />
          {tr('Только выбранные')}
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map(([module, items]) => {
          const usable = items.filter(allowed)
          const on = usable.filter((p) => draft.has(p.code)).length
          const all = usable.length > 0 && on === usable.length
          return (
            <fieldset key={module} className="overflow-hidden rounded-lg border bg-card">
              <legend className="sr-only">{trData(module)}</legend>
              <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={tr('Выбрать всю группу: {{name}}', { name: trData(module) })}
                  checked={all}
                  disabled={usable.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && !all
                  }}
                  onChange={(e) => toggleGroup(items, e.target.checked)}
                />
                <span className="text-sm font-semibold">{trData(module)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{tr('{{on}} из {{all}}', { on, all: usable.length })}</span>
              </div>
              <ul className="divide-y">
                {items.map((p) => {
                  const ok = allowed(p)
                  return (
                    <li key={p.code}>
                      <label className={cn('flex min-h-11 items-start gap-3 px-3 py-2', ok ? 'cursor-pointer hover:bg-muted/50' : 'cursor-not-allowed opacity-50')} title={ok ? undefined : tr('Недоступно внешним ролям')}>
                        <input type="checkbox" className="mt-0.5 size-4" disabled={!ok} checked={draft.has(p.code)} onChange={(e) => toggle(p.code, e.target.checked)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{trData(p.label)}</span>
                          <span className="ident block truncate text-xs text-muted-foreground">{p.code}</span>
                        </span>
                        {savedSet.has(p.code) !== draft.has(p.code) && <span className="mt-0.5 text-xs text-signal">{draft.has(p.code) ? tr('будет выдано') : tr('будет убрано')}</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )
        })}
        {groups.length === 0 && <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{tr('Ничего не найдено.')}</div>}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {dirty ? tr('Изменено: выдать {{a}}, убрать {{r}}', { a: added.length, r: removed.length }) : tr('Прав у роли: {{n}}', { n: saved.length })}
        </span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(new Set(saved))}>
            {tr('Отменить')}
          </Button>
          <Button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            <ShieldCheck className="size-4" /> {tr('Сохранить права')}
          </Button>
        </div>
      </div>

      <Holders role={role} canGrant={canGrant} />

      {renaming && <RenameDialog role={role} onClose={() => setRenaming(false)} />}
      {deleting && <DeleteDialog role={role} onClose={() => setDeleting(false)} onDeleted={onDeleted} />}
    </div>
  )
}

function Holders({ role, canGrant }: { role: RoleRow; canGrant: boolean }) {
  const { data: holders } = useSuspenseQuery(roleHoldersQuery(role.id))
  const { data: users } = useSuspenseQuery(internalUsersQuery)
  const invalidate = useInvalidateRoles()
  const [pickUser, setPickUser] = useState(NONE)
  const tenantRole = role.scope === 'tenant'
  const candidates = users.filter((u) => !holders.some((h) => h.user_id === u.id))

  const grant = useMutation({
    mutationFn: () => grantTenantRole(pickUser, role.id),
    onSuccess: async () => {
      setPickUser(NONE)
      await invalidate(role.id)
      toast.success(tr('Роль выдана'))
    },
    onError: (e) => toast.error(roleErrorText(e)),
  })
  const revoke = useMutation({
    mutationFn: (userId: string) => revokeTenantRole(userId, role.id),
    onSuccess: async () => {
      await invalidate(role.id)
      toast.success(tr('Роль убрана'))
    },
    onError: (e) => toast.error(roleErrorText(e)),
  })

  return (
    <section aria-label={tr('Кому выдана роль')} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{tenantRole ? tr('Кому выдана роль') : tr('Кто в этой роли')}</h3>
      {!tenantRole && <p className="text-xs text-muted-foreground">{tr('Роль проекта назначают в проекте, в разделе «Участники».')}</p>}
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {holders.map((h) => (
          <li key={`${h.user_id}-${h.project_code ?? ''}`} className="flex min-h-11 items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{h.full_name}</span>
              <span className="block truncate text-xs text-muted-foreground">{[h.job_title, h.email].filter(Boolean).join(' · ')}</span>
            </span>
            {h.project_code && <span className="ident rounded-full border px-2 py-0.5 text-xs">{h.project_code}</span>}
            {tenantRole && canGrant && (
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(h.user_id)}
                aria-label={tr('Убрать роль: {{name}}', { name: h.full_name })}
                title={tr('Убрать роль')}
                className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            )}
          </li>
        ))}
        {holders.length === 0 && <li className="p-4 text-sm text-muted-foreground">{tr('Пока никому не выдана.')}</li>}
      </ul>
      {tenantRole && canGrant && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={pickUser} onValueChange={setPickUser}>
            <SelectTrigger className="w-full sm:max-w-xs" aria-label={tr('Кому выдать роль')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{tr('Выберите сотрудника')}</SelectItem>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name}
                  {u.job_title ? ` · ${u.job_title}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" disabled={pickUser === NONE || grant.isPending} onClick={() => grant.mutate()}>
            <UserPlus className="size-4" /> {tr('Выдать роль')}
          </Button>
        </div>
      )}
    </section>
  )
}

function CreateRoleDialog({ scope, roles, onClose, onCreated }: { scope: RoleScope; roles: RoleRow[]; onClose: () => void; onCreated: (id: string) => void }) {
  const invalidate = useInvalidateRoles()
  const [name, setName] = useState('')
  const [copy, setCopy] = useState(NONE)
  const create = useMutation({
    mutationFn: () => createRole(scope, name.trim(), copy === NONE ? null : copy),
    onSuccess: async (id) => {
      await invalidate()
      toast.success(tr('Роль создана. Отметьте её права.'))
      onCreated(id)
    },
    onError: (e) => toast.error(roleErrorText(e)),
  })
  const valid = name.trim().length > 0 && name.trim().length <= 80
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{scope === 'tenant' ? tr('Новая роль компании') : tr('Новая роль проекта')}</DialogTitle>
          <DialogDescription>{tr('Новая роль внутренняя. Права можно скопировать с похожей роли и потом поправить.')}</DialogDescription>
        </DialogHeader>
        <form
          id="role-create-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) create.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-name">{tr('Название роли')}</Label>
            <Input id="role-name" autoFocus autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Например, бригадир')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-copy">
              {tr('Скопировать права с роли')}
              {tr(' (необязательно)')}
            </Label>
            <Select value={copy} onValueChange={setCopy}>
              <SelectTrigger id="role-copy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tr('Без прав — отмечу сам')}</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {trData(r.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="role-create-form" disabled={!valid || create.isPending}>
            {tr('Создать роль')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const invalidate = useInvalidateRoles()
  const [name, setName] = useState(role.name)
  const rename = useMutation({
    mutationFn: () => renameRole(role.id, name.trim()),
    onSuccess: async () => {
      await invalidate(role.id)
      toast.success(tr('Название изменено'))
      onClose()
    },
    onError: (e) => toast.error(roleErrorText(e)),
  })
  const valid = name.trim().length > 0 && name.trim().length <= 80
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Переименовать роль')}</DialogTitle>
          <DialogDescription>{tr('Код роли не меняется, права и люди остаются.')}</DialogDescription>
        </DialogHeader>
        <form
          id="role-rename-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) rename.mutate()
          }}
          className="flex flex-col gap-2"
        >
          <Label htmlFor="role-rename">{tr('Название роли')}</Label>
          <Input id="role-rename" autoFocus autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="role-rename-form" disabled={!valid || rename.isPending}>
            {tr('Сохранить название')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ role, onClose, onDeleted }: { role: RoleRow; onClose: () => void; onDeleted: () => void }) {
  const invalidate = useInvalidateRoles()
  const remove = useMutation({
    mutationFn: () => deleteRole(role.id),
    onSuccess: async () => {
      await invalidate()
      toast.success(tr('Роль «{{name}}» удалена', { name: role.name }))
      onClose()
      onDeleted()
    },
    onError: (e) => toast.error(roleErrorText(e)),
  })
  const inUse = role.holder_count > 0
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Удалить роль «{{name}}»?', { name: role.name })}</DialogTitle>
          <DialogDescription>
            {inUse ? tr('Роль выдана людям ({{n}}). Сначала уберите её у них, затем удалите.', { n: role.holder_count }) : tr('Права роли пропадут. Отменить удаление нельзя.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Оставить роль')}
          </Button>
          <Button type="button" variant="destructive" disabled={inUse || remove.isPending} onClick={() => remove.mutate()}>
            {tr('Удалить роль')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
