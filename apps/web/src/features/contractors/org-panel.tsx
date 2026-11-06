import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { WhatsAppIcon } from '@/components/icons/whatsapp'
import { telHref, whatsappHref } from '@/lib/phone'
import { ListChecks, Mail, MessageCircle, Pencil, Ruler, UserMinus, Users } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import { OnlineDot, presenceText, useOnline } from '@/features/chat/presence'
import { orgMembersQuery, setOrgDisciplines, updateOrgMember, type OrgMember, type OrgOverview } from '@/features/contractors/api'
import { disciplinesQuery, flattenDisciplines, type DisciplineNode } from '@/features/disciplines/api'
import { UserAvatar } from '@/features/profile/avatar'
import { InviteDialog } from '@/features/projects/invite-dialog'
import { RemoveMemberDialog } from '@/features/projects/members-section'
import { DisciplineBadge } from '@/features/tasks/status-badge'
import { tr } from '@/lib/tr'

const KIND_LABELS = (): Record<string, string> => ({
  subcontractor: tr('Подрядчик'),
  supplier: tr('Поставщик'),
  designer: tr('Проектировщик'),
  supervision: tr('Технадзор'),
  client: tr('Заказчик'),
  other: tr('Другое'),
})

const NONE = 'none'

function errorText(e: unknown): string {
  const code = (e as { code?: string }).code
  if (code === '42501') return tr('У вас нет права менять эту организацию.')
  if (code === '22023') return tr('Это направление не относится к проекту.')
  return tr('Не удалось сохранить. Попробуйте ещё раз.')
}

interface Props {
  projectId: string
  org: OrgOverview
  /** Руководитель проекта правит любую организацию; ответственный от подрядчика — только свою */
  canManage: boolean
  canInviteOrg: boolean
}

/** Карточка организации в проекте: сводка, направления работ и сотрудники с должностями и направлениями. */
export function OrgPanel({ projectId, org, canManage, canInviteOrg }: Props) {
  const { session } = useAuth()
  const { data: allMembers } = useSuspenseQuery(orgMembersQuery(projectId))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(projectId))
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])
  const byId = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines])

  const members = allMembers.filter((m) => m.user?.organization_id === org.organization_id)
  const myOrgId = allMembers.find((m) => m.user?.id === session?.user.id)?.user?.organization_id ?? null
  const canEdit = canManage || (canInviteOrg && myOrgId === org.organization_id)

  const [editingDisciplines, setEditingDisciplines] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

  const declared = org.discipline_ids.map((id) => byId.get(id)).filter((d): d is DisciplineNode => !!d)

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label={org.name}>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{org.name}</h2>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{KIND_LABELS()[org.kind] ?? org.kind}</span>
        </div>
        {org.tax_id && <p className="text-sm text-muted-foreground">{tr('ИНН / налоговый номер')}: {org.tax_id}</p>}
      </header>

      <dl className="grid grid-cols-3 gap-3">
        <Stat icon={<Users className="size-4" />} label={tr('Сотрудников')} value={members.length} />
        <Stat icon={<Ruler className="size-4" />} label={tr('Позиций плана')} value={org.work_items} />
        <Stat
          icon={<ListChecks className="size-4" />}
          label={tr('Открытых задач')}
          value={org.open_tasks}
          note={org.overdue_tasks > 0 ? tr('просрочено: {{n}}', { n: org.overdue_tasks }) : undefined}
        />
      </dl>

      <section className="flex flex-col gap-2" aria-label={tr('Направления работ')}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr('Направления работ')}</h3>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditingDisciplines(true)}>
              <Pencil />
              {tr('Выбрать')}
            </Button>
          )}
        </div>
        {declared.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {canEdit ? tr('Направления не выбраны. Отметьте, какими работами организация занимается в этом проекте.') : tr('Направления ещё не выбраны.')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {declared.map((d) => (
              <li key={d.id} className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-sm">
                <DisciplineBadge code={d.code} name={d.name} color={d.color} />
                <span>{d.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={tr('Сотрудники')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {tr('Сотрудники')} <span className="font-normal text-muted-foreground">{members.length}</span>
          </h3>
          {(canManage || canInviteOrg) && canEdit && (
            <Button size="sm" onClick={() => setInviting(true)}>
              <Mail />
              {tr('Пригласить сотрудника')}
            </Button>
          )}
        </div>
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{tr('Сотрудников в проекте пока нет.')}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                projectId={projectId}
                disciplines={disciplines}
                declaredIds={org.discipline_ids}
                canEdit={canEdit}
                canRemove={canManage || (canInviteOrg && m.role?.code === 'subcontractor' && m.user?.id !== session?.user.id)}
                onRemove={() => setRemoving({ id: m.id, name: m.user?.full_name ?? '' })}
              />
            ))}
          </ul>
        )}
      </section>

      {editingDisciplines && <DisciplinesDialog projectId={projectId} org={org} disciplines={disciplines} onClose={() => setEditingDisciplines(false)} />}
      {inviting && (
        <Suspense fallback={null}>
          <InviteDialog
            projectId={projectId}
            orgLead={!canManage && myOrgId ? { organizationId: org.organization_id, organizationName: org.name } : undefined}
            fixedOrg={{ id: org.organization_id, name: org.name }}
            onClose={() => setInviting(false)}
          />
        </Suspense>
      )}
      {removing && <RemoveMemberDialog projectId={projectId} member={removing} viaRpc={!canManage} onClose={() => setRemoving(null)} />}
    </section>
  )
}

function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: number; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3 shadow-soft">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {note && <p className="text-xs font-medium text-red-700 dark:text-red-300">{note}</p>}
    </div>
  )
}

function MemberRow({
  member,
  projectId,
  disciplines,
  declaredIds,
  canEdit,
  canRemove,
  onRemove,
}: {
  member: OrgMember
  projectId: string
  disciplines: DisciplineNode[]
  declaredIds: string[]
  canEdit: boolean
  canRemove: boolean
  onRemove: () => void
}) {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const presence = useOnline()(member.user?.id)
  const isMe = member.user?.id === session?.user.id
  const [title, setTitle] = useState(member.title ?? '')
  useEffect(() => setTitle(member.title ?? ''), [member.title])

  const save = useMutation({
    mutationFn: ({ nextTitle, discipline }: { nextTitle: string; discipline: string | null }) => updateOrgMember(member.id, nextTitle, discipline),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org-members', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
    },
    onError: (e) => {
      setTitle(member.title ?? '')
      toast.error(errorText(e))
    },
  })

  const declared = disciplines.filter((d) => declaredIds.includes(d.id))
  const others = disciplines.filter((d) => !declaredIds.includes(d.id))
  const current = member.discipline_id ? disciplines.find((d) => d.id === member.discipline_id) : undefined

  const option = (d: DisciplineNode) => (
    <SelectItem key={d.id} value={d.id}>
      <span className="ident text-muted-foreground">{d.code}</span> {d.name}
    </SelectItem>
  )

  return (
    <li className="grid gap-3 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          <UserAvatar name={member.user?.full_name ?? '?'} path={member.user?.avatar_path} className="size-9 bg-muted text-sm font-medium text-foreground" />
          {!isMe && <OnlineDot online={presence.online} className="absolute -bottom-0.5 -right-0.5" />}
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium">{member.user?.full_name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {member.user?.email}
            {member.role?.name ? ` · ${member.role.name}` : ''}
            {!isMe && presenceText(presence) ? ` · ${presenceText(presence)}` : ''}
          </div>
          {member.user?.phone && (
            <a href={telHref(member.user.phone)} className="text-xs tabular-nums text-muted-foreground hover:underline">
              {member.user.phone}
            </a>
          )}
        </div>
      </div>

      {canEdit ? (
        <Input
          aria-label={tr('Должность')}
          placeholder={tr('Должность')}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== (member.title ?? '') && save.mutate({ nextTitle: title, discipline: member.discipline_id })}
        />
      ) : (
        <span className="text-sm text-muted-foreground">{member.title || '—'}</span>
      )}

      {canEdit ? (
        <Select value={member.discipline_id ?? NONE} onValueChange={(v) => save.mutate({ nextTitle: title, discipline: v === NONE ? null : v })} disabled={save.isPending}>
          <SelectTrigger aria-label={tr('Направление')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
            {declared.length > 0 && (
              <SelectGroup>
                <SelectLabel>{tr('Направления организации')}</SelectLabel>
                {declared.map(option)}
              </SelectGroup>
            )}
            {others.length > 0 && (
              <>
                {declared.length > 0 && <SelectSeparator />}
                <SelectGroup>
                  <SelectLabel>{declared.length > 0 ? tr('Остальные направления проекта') : tr('Направления проекта')}</SelectLabel>
                  {others.map(option)}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-sm text-muted-foreground">{current ? `${current.code} · ${current.name}` : '—'}</span>
      )}

      <div className="flex justify-end gap-1 md:w-28">
        {!isMe && member.user?.phone && (
          <Button asChild variant="ghost" size="icon" title={tr('Написать в WhatsApp')} className="text-[#1fa855]">
            <a href={whatsappHref(member.user.phone)} target="_blank" rel="noopener noreferrer" aria-label={tr('Написать в WhatsApp: {{name}}', { name: member.user.full_name })}>
              <WhatsAppIcon className="size-5" />
            </a>
          </Button>
        )}
        {!isMe && member.user && (
          <Button asChild variant="ghost" size="icon" title={tr('Написать')}>
            <Link to="/chat" search={{ with: member.user.id }} aria-label={tr('Написать: {{full_name}}', { full_name: member.user.full_name })}>
              <MessageCircle />
            </Link>
          </Button>
        )}
        {canRemove && (
          <Button variant="ghost" size="icon" aria-label={tr('Убрать {{full_name}} из проекта', { full_name: member.user?.full_name })} title={tr('Убрать из проекта')} onClick={onRemove}>
            <UserMinus />
          </Button>
        )}
      </div>
    </li>
  )
}

/** Какими направлениями проекта занимается организация. */
export function DisciplinesDialog({ projectId, org, disciplines, onClose }: { projectId: string; org: Pick<OrgOverview, 'organization_id' | 'name' | 'discipline_ids'>; disciplines: DisciplineNode[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<Set<string>>(new Set(org.discipline_ids))

  const save = useMutation({
    mutationFn: () => setOrgDisciplines(projectId, org.organization_id, [...picked]),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org-overview', projectId] })
      toast.success(tr('Направления сохранены'))
      onClose()
    },
    onError: (e) => toast.error(errorText(e)),
  })

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Направления работ: {{name}}', { name: org.name })}</DialogTitle>
          <DialogDescription>{tr('Отметьте, какими работами организация занимается в этом проекте. Сотрудникам потом можно назначить направление из этого списка.')}</DialogDescription>
        </DialogHeader>
        {disciplines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('В проекте ещё нет направлений. Их заводит руководитель проекта в разделе «Направления».')}</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {disciplines.map((d) => (
              <li key={d.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/50" style={{ paddingLeft: 8 + d.depth * 16 }}>
                  <input type="checkbox" className="size-4" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                  <DisciplineBadge code={d.code} name={d.name} color={d.color} />
                  <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            {tr('Отмена')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
