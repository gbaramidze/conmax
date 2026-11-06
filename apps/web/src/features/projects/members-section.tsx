import { tr } from '@/lib/tr'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Mail, Plus, UserMinus } from 'lucide-react'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/auth-provider'
import { InviteDialog } from '@/features/projects/invite-dialog'
import { projectMembersQuery, projectRolesQuery, tenantUsersQuery } from '@/features/projects/api'
import { UserAvatar } from '@/features/profile/avatar'
import { supabase } from '@/lib/supabase'

interface Props {
  projectId: string
  canManage: boolean
  /** Ответственный от подрядчика: может приглашать людей своей организации */
  canInviteOrg?: boolean
}

export function MembersSection({ projectId, canManage, canInviteOrg = false }: Props) {
  const { data: members } = useSuspenseQuery(projectMembersQuery(projectId))
  const { session } = useAuth()
  const myOrg = members.find((m) => m.user?.id === session?.user.id)?.organization
  // РП убирает любого; ответственный от подрядчика — только рядовых сотрудников своей организации
  const canRemove = (m: (typeof members)[number]) =>
    canManage || (canInviteOrg && !!myOrg && m.organization?.id === myOrg.id && m.role?.code === 'subcontractor' && m.user?.id !== session?.user.id)
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{tr('Участники')}{' '}<span className="font-normal text-muted-foreground">{members.length}</span>
        </h2>
        {(canManage || (canInviteOrg && myOrg)) && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setInviting(true)}>
              <Mail /> {canManage ? tr('Пригласить') : tr('Пригласить сотрудника')}
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus />{tr('Добавить')}</Button>
            )}
          </div>
        )}
      </div>

      {/* Телефон: карточки участников */}
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft md:hidden">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 p-3">
            <UserAvatar name={m.user?.full_name ?? '?'} path={m.user?.avatar_path} className="size-10 bg-muted text-sm font-medium text-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.user?.full_name}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {m.role?.name}
                {m.organization?.name ? ` · ${m.organization.name}` : ''}
              </span>
            </span>
            {canRemove(m) && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={tr('Убрать {{full_name}} из проекта', { full_name: m.user?.full_name })}
                onClick={() => setRemoving({ id: m.id, name: m.user?.full_name ?? '' })}
              >
                <UserMinus />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border bg-card shadow-soft md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>{tr('Имя')}</TableHead>
              <TableHead>{tr('Роль в проекте')}</TableHead>
              <TableHead>{tr('Организация')}</TableHead>
              {(canManage || canInviteOrg) && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={m.user?.full_name ?? '?'} path={m.user?.avatar_path} className="size-8 bg-muted text-xs font-medium text-foreground" />
                    <div className="min-w-0">
                      <div className="font-medium">{m.user?.full_name}</div>
                      <div className="text-xs text-muted-foreground">{m.user?.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{canManage ? <RoleSelect projectId={projectId} memberId={m.id} roleCode={m.role?.code} roleName={m.role?.name} /> : m.role?.name}</TableCell>
                <TableCell className="text-muted-foreground">{m.organization?.name ?? '—'}</TableCell>
                {(canManage || canInviteOrg) && (
                  <TableCell>
                    {canRemove(m) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tr('Убрать {{full_name}} из проекта', { full_name: m.user?.full_name })}
                        title={tr('Убрать из проекта')}
                        onClick={() => setRemoving({ id: m.id, name: m.user?.full_name ?? '' })}
                      >
                        <UserMinus />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {adding && (
        // Свой Suspense: иначе загрузка списков сотрудников/ролей заменит всю страницу индикатором маршрута
        <Suspense fallback={null}>
          <AddMemberDialog
            projectId={projectId}
            existingUserIds={members.map((m) => m.user?.id)}
            onClose={() => setAdding(false)}
          />
        </Suspense>
      )}
      {inviting && (
        <Suspense fallback={null}>
          <InviteDialog
            projectId={projectId}
            orgLead={!canManage && myOrg ? { organizationId: myOrg.id, organizationName: myOrg.name } : undefined}
            onClose={() => setInviting(false)}
          />
        </Suspense>
      )}
      {removing && <RemoveMemberDialog projectId={projectId} member={removing} viaRpc={!canManage} onClose={() => setRemoving(null)} />}
    </section>
  )
}

/** Смена роли участника прямо в таблице (например, назначить подрядчика ответственным). */
function RoleSelect({ projectId, memberId, roleCode, roleName }: { projectId: string; memberId: string; roleCode?: string; roleName?: string }) {
  const queryClient = useQueryClient()
  const { data: roles } = useSuspenseQuery(projectRolesQuery)
  const current = roles.find((r) => r.code === roleCode)
  const change = useMutation({
    mutationFn: async (roleId: string) => {
      const { error } = await supabase.from('project_members').update({ role_id: roleId }).eq('id', memberId)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      toast.success(tr('Роль изменена'))
    },
    onError: () => toast.error(tr('Не удалось изменить роль.')),
  })
  return (
    <Select value={current?.id ?? ''} onValueChange={(v) => change.mutate(v)} disabled={change.isPending}>
      <SelectTrigger size="sm" aria-label={tr('Роль: {{v1}}', { v1: roleName ?? '' })} className="w-full min-w-44">
        <SelectValue placeholder={roleName} />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AddMemberDialog({
  projectId,
  existingUserIds,
  onClose,
}: {
  projectId: string
  existingUserIds: (string | undefined)[]
  onClose: () => void
}) {
  const { tenantId } = useAuth()
  const queryClient = useQueryClient()
  const { data: users } = useSuspenseQuery(tenantUsersQuery)
  const { data: roles } = useSuspenseQuery(projectRolesQuery)
  const [userId, setUserId] = useState('')
  const [roleId, setRoleId] = useState('')

  const candidates = users.filter((u) => !existingUserIds.includes(u.id))

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('project_members')
        .insert({ tenant_id: tenantId!, project_id: projectId, user_id: userId, role_id: roleId })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      toast.success(tr('Участник добавлен'))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось добавить участника. Проверьте права и попробуйте ещё раз.')),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Добавить участника')}</DialogTitle>
          <DialogDescription>{tr('Сотрудник сразу получит доступ к проекту с правами выбранной роли.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-user">{tr('Сотрудник')}</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="member-user" className="w-full">
                <SelectValue placeholder={tr('Выберите сотрудника')} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-role">{tr('Роль в проекте')}</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="member-role" className="w-full">
                <SelectValue placeholder={tr('Выберите роль')} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={!userId || !roleId || add.isPending} onClick={() => add.mutate()}>{tr('Добавить участника')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveMemberDialog({
  projectId,
  member,
  viaRpc,
  onClose,
}: {
  projectId: string
  member: { id: string; name: string }
  /** Ответственный от подрядчика убирает людей через серверную функцию с проверкой организации */
  viaRpc: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => {
      // Не удаляем строку: фиксируем дату выхода, история участия сохраняется
      const { error } = viaRpc
        ? await supabase.rpc('remove_org_member', { p_member: member.id })
        : await supabase
            .from('project_members')
            .update({ left_at: new Date().toISOString().slice(0, 10) })
            .eq('id', member.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['org-members', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['org-overview', projectId] })
      toast.success(tr('{{name}} убран из проекта', { name: member.name }))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось убрать участника. Попробуйте ещё раз.')),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Убрать')}{' '}{member.name}{tr('из проекта?')}</DialogTitle>
          <DialogDescription>{tr('Доступ к проекту пропадёт сразу. Задачи участника сохранятся — их можно будет переназначить.')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{tr('Убрать из проекта')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
