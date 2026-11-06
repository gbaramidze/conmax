import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { EXTERNAL_PROJECT_ROLE_CODES, organizationsQuery, projectRolesQuery } from '@/features/projects/api'
import { supabase } from '@/lib/supabase'

const ERROR_TEXT: Record<string, string> = {
  email_taken: tr('Этот email уже зарегистрирован. Если человек работает в вашей компании — добавьте его через «Добавить участника».'),
  organization_required: tr('Для внешнего участника выберите организацию.'),
  invalid_discipline: tr('Это направление не относится к проекту.'),
  forbidden: tr('У вас нет права приглашать в этот проект.'),
}

async function readErrorCode(error: unknown): Promise<string | null> {
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null)
    return body?.error ?? null
  }
  return null
}

const schema = z.object({
  email: z.email(tr('Введите email в формате name@company.ru')),
  fullName: z.string().trim().min(2, tr('Укажите имя и фамилию')),
  roleId: z.string().min(1, tr('Выберите роль')),
  organizationId: z.string().optional(),
})
type Values = z.infer<typeof schema>

/**
 * Приглашение по email. Для ответственного от подрядчика (`orgLead`): только роль «Субподрядчик» и только его организация —
 * сервер всё равно проверяет это сам.
 */
export function InviteDialog({
  projectId,
  orgLead,
  fixedOrg,
  onClose,
}: {
  projectId: string
  orgLead?: { organizationId: string; organizationName: string }
  /** Организация задана страницей подрядчика: выбирать её заново не нужно */
  fixedOrg?: { id: string; name: string }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: allRoles } = useSuspenseQuery(projectRolesQuery)
  const { data: allOrganizations } = useSuspenseQuery(organizationsQuery)
  const roles = orgLead ? allRoles.filter((r) => r.code === 'subcontractor') : allRoles
  const organizations = orgLead ? [{ id: orgLead.organizationId, name: orgLead.organizationName }] : fixedOrg ? [fixedOrg] : allOrganizations
  const { data: disciplineRows } = useQuery(disciplinesQuery(projectId))
  const disciplines = flattenDisciplines(disciplineRows ?? [])
  const [title, setTitle] = useState('')
  const [discipline, setDiscipline] = useState('')

  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      organizationId: orgLead?.organizationId ?? fixedOrg?.id ?? '',
      roleId: orgLead ? (roles[0]?.id ?? '') : fixedOrg ? (roles.find((r) => r.code === 'subcontractor')?.id ?? '') : '',
    },
  })

  const roleCode = roles.find((r) => r.id === watch('roleId'))?.code
  const isExternal = !!roleCode && EXTERNAL_PROJECT_ROLE_CODES.includes(roleCode)

  const invite = useMutation({
    mutationFn: async (v: Values) => {
      if (isExternal && !v.organizationId) {
        setError('organizationId', { message: ERROR_TEXT.organization_required })
        throw new Error('validation')
      }
      const { error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: v.email,
          full_name: v.fullName,
          project_id: projectId,
          project_role_id: v.roleId,
          organization_id: v.organizationId || null,
          title: title.trim() || null,
          discipline_id: discipline || null,
          redirect_to: window.location.origin,
        },
      })
      if (error) throw new Error((await readErrorCode(error)) ?? 'invite_failed')
    },
    onSuccess: async (_d, v) => {
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['tenant-users'] })
      await queryClient.invalidateQueries({ queryKey: ['org-members', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['org-overview', projectId] })
      toast.success(tr('Приглашение отправлено на {{email}}', { email: v.email }))
      onClose()
    },
    onError: (e) => {
      if (e.message === 'validation') return
      toast.error(ERROR_TEXT[e.message] ?? tr('Не удалось отправить приглашение. Попробуйте ещё раз.'))
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Пригласить по email')}</DialogTitle>
          <DialogDescription>{tr('Человек получит письмо со ссылкой, задаст пароль и сразу попадёт в этот проект.')}</DialogDescription>
        </DialogHeader>
        <form id="invite-form" onSubmit={handleSubmit((v) => invite.mutate(v))} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-name">{tr('Имя и фамилия')}</Label>
            <Input id="invite-name" autoComplete="off" aria-invalid={!!errors.fullName} {...register('fullName')} />
            {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">{tr('Роль в проекте')}</Label>
            <Controller
              control={control}
              name="roleId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invite-role" className="w-full" aria-invalid={!!errors.roleId}>
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
              )}
            />
            {errors.roleId && <p className="text-sm text-destructive">{errors.roleId.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-org">{tr('Организация')}{isExternal ? '' : tr(' (необязательно)')}</Label>
            <Controller
              control={control}
              name="organizationId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invite-org" className="w-full" aria-invalid={!!errors.organizationId}>
                    <SelectValue placeholder={tr('Выберите организацию')} />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.organizationId && <p className="text-sm text-destructive">{errors.organizationId.message}</p>}
            {isExternal && (
              <p className="text-xs text-muted-foreground">{tr('Внешний участник увидит только этот проект и коллег по нему.')}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-title">{tr('Должность')}{tr(' (необязательно)')}</Label>
              <Input id="invite-title" autoComplete="off" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('Например, прораб')} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-discipline">{tr('Направление')}{tr(' (необязательно)')}</Label>
              <Select value={discipline || 'none'} onValueChange={(v) => setDiscipline(v === 'none' ? '' : v)}>
                <SelectTrigger id="invite-discipline" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tr('Без направления')}</SelectItem>
                  {disciplines.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span style={{ paddingLeft: d.depth * 12 }}>
                        <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="invite-form" disabled={invite.isPending}>{tr('Отправить приглашение')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
