import { tr, trData } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { EXTERNAL_PROJECT_ROLE_CODES, organizationsQuery, projectRolesQuery, projectsQuery } from '@/features/projects/api'
import { STANDARD_JOB_TITLES, usedJobTitlesQuery } from '@/features/people/api'
import { tenantRolesQuery } from '@/features/roles/api'
import { supabase } from '@/lib/supabase'

const NONE = 'none'

const ERROR_TEXT: Record<string, string> = {
  email_taken: tr('Этот email уже зарегистрирован в системе.'),
  organization_required: tr('Выберите организацию.'),
  job_title_required: tr('Укажите должность.'),
  project_role_required: tr('Выберите роль в проекте.'),
  invalid_discipline: tr('Это направление не относится к проекту.'),
  invalid_tenant_role: tr('Эта роль компании недоступна.'),
  invalid_phone: tr('Телефон: только цифры, пробелы и знаки + ( ) - .'),
  invalid_organization: tr('Эта организация недоступна.'),
  forbidden: tr('У вас нет права регистрировать сотрудников.'),
}

async function readErrorCode(error: unknown): Promise<string | null> {
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null)
    return body?.error ?? null
  }
  return null
}

const schema = z
  .object({
    email: z.email(tr('Введите email в формате name@company.ru')),
    fullName: z.string().trim().min(2, tr('Укажите имя и фамилию')),
    organizationId: z.string().min(1, tr('Выберите организацию')),
    jobTitle: z.string().trim().min(2, tr('Укажите должность')).max(120, tr('Не длиннее 120 знаков')),
    phone: z
      .string()
      .trim()
      .max(32, tr('Не длиннее 32 знаков'))
      .regex(/^[0-9+()\-\s.]*$/, tr('Телефон: только цифры, пробелы и знаки + ( ) - .')),
    tenantRoleId: z.string(),
    projectId: z.string(),
    roleId: z.string(),
    disciplineId: z.string(),
  })
  .refine((v) => !v.projectId || !!v.roleId, { path: ['roleId'], message: tr('Выберите роль в проекте') })
type Values = z.infer<typeof schema>

/**
 * Регистрация нового сотрудника компании: письмо со ссылкой, человек задаёт пароль и входит.
 * Направление принадлежит проекту, поэтому его можно выбрать, только если сотрудника сразу добавляют в проект
 * (иначе в проекты его добавляют позже — «Добавить участника»). Проверки прав и полей дублирует Edge Function `invite-user`.
 */
export function AddEmployeeDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: allOrganizations } = useSuspenseQuery(organizationsQuery)
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: allRoles } = useSuspenseQuery(projectRolesQuery)
  const { data: tenantRoles } = useSuspenseQuery(tenantRolesQuery)
  const { data: usedTitles } = useQuery(usedJobTitlesQuery)
  // Подсказки по должностям: типовые, затем уже используемые в компании (без повторов, без учёта регистра)
  const titleOptions = (() => {
    const seen = new Set(STANDARD_JOB_TITLES.map((x) => x.toLowerCase()))
    const extra = (usedTitles ?? []).filter((x) => !seen.has(x.toLowerCase())).sort((a, b) => a.localeCompare(b))
    return [...STANDARD_JOB_TITLES, ...extra]
  })()
  // Сотрудник компании — внутренний пользователь: только свои организации и внутренние роли (внешних приглашают из проекта)
  const organizations = allOrganizations.filter((o) => o.kind === 'own')
  const roles = allRoles.filter((r) => !EXTERNAL_PROJECT_ROLE_CODES.includes(r.code))

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      organizationId: organizations.length === 1 ? organizations[0]!.id : '',
      phone: '',
      tenantRoleId: tenantRoles.find((r) => r.code === 'member')?.id ?? '',
      projectId: '',
      roleId: '',
      disciplineId: '',
    },
  })

  const projectId = watch('projectId')
  const { data: disciplineRows } = useQuery({ ...disciplinesQuery(projectId), enabled: !!projectId })
  const disciplines = flattenDisciplines(disciplineRows ?? [])

  const create = useMutation({
    mutationFn: async (v: Values) => {
      const { error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: v.email,
          full_name: v.fullName,
          organization_id: v.organizationId,
          job_title: v.jobTitle,
          phone: v.phone || null,
          tenant_role_id: v.tenantRoleId || null,
          project_id: v.projectId || null,
          project_role_id: v.projectId ? v.roleId : null,
          title: v.projectId ? v.jobTitle : null,
          discipline_id: v.projectId && v.disciplineId ? v.disciplineId : null,
          redirect_to: window.location.origin,
        },
      })
      if (error) throw new Error((await readErrorCode(error)) ?? 'invite_failed')
    },
    onSuccess: async (_d, v) => {
      await queryClient.invalidateQueries({ queryKey: ['people-directory'] })
      await queryClient.invalidateQueries({ queryKey: ['tenant-users'] })
      if (v.projectId) {
        await queryClient.invalidateQueries({ queryKey: ['project-members', v.projectId] })
        await queryClient.invalidateQueries({ queryKey: ['org-members', v.projectId] })
        await queryClient.invalidateQueries({ queryKey: ['org-overview', v.projectId] })
      }
      toast.success(tr('Сотрудник зарегистрирован. Письмо со ссылкой отправлено на {{email}}', { email: v.email }))
      onClose()
    },
    onError: (e) => toast.error(ERROR_TEXT[e.message] ?? tr('Не удалось зарегистрировать сотрудника. Попробуйте ещё раз.')),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Зарегистрировать сотрудника')}</DialogTitle>
          <DialogDescription>{tr('Человек получит письмо со ссылкой и задаст пароль. Проект и направление можно выбрать сейчас или добавить его в проект позже.')}</DialogDescription>
        </DialogHeader>
        <form id="employee-form" onSubmit={handleSubmit((v) => create.mutate(v))} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-name">{tr('Имя и фамилия')}</Label>
            <Input id="employee-name" autoComplete="off" aria-invalid={!!errors.fullName} {...register('fullName')} />
            {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-email">Email</Label>
            <Input id="employee-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-org">{tr('Организация')}</Label>
            <Controller
              control={control}
              name="organizationId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="employee-org" className="w-full" aria-invalid={!!errors.organizationId}>
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
            {organizations.length === 0 && <p className="text-xs text-muted-foreground">{tr('Нет организации вида «Наша компания». Создайте её на странице организации.')}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-title">{tr('Должность')}</Label>
              <Input id="employee-title" list="employee-job-titles" autoComplete="off" maxLength={120} placeholder={tr('Выберите из списка или введите свою')} aria-invalid={!!errors.jobTitle} {...register('jobTitle')} />
              <datalist id="employee-job-titles">
                {titleOptions.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
              {errors.jobTitle && <p className="text-sm text-destructive">{errors.jobTitle.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-phone">
                {tr('Телефон')}
                {tr(' (необязательно)')}
              </Label>
              <Input id="employee-phone" type="tel" autoComplete="off" maxLength={32} aria-invalid={!!errors.phone} {...register('phone')} />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-tenant-role">{tr('Роль в компании')}</Label>
            <Controller
              control={control}
              name="tenantRoleId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="employee-tenant-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tenantRoles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {trData(r.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">{tr('«Директор» видит все проекты и отчёты портфеля, «Администратор» настраивает компанию. Права ролей — на странице «Роли и права».')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-project">
              {tr('Проект')}
              {tr(' (необязательно)')}
            </Label>
            <Controller
              control={control}
              name="projectId"
              render={({ field }) => (
                <Select
                  value={field.value || NONE}
                  onValueChange={(v) => {
                    field.onChange(v === NONE ? '' : v)
                    // роль и направление относятся к проекту: при смене проекта выбор сбрасывается
                    setValue('roleId', '')
                    setValue('disciplineId', '')
                  }}
                >
                  <SelectTrigger id="employee-project" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr('Не добавлять в проект')}</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="ident text-muted-foreground">{p.code}</span> {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {projectId && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="employee-role">{tr('Роль в проекте')}</Label>
                <Controller
                  control={control}
                  name="roleId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="employee-role" className="w-full" aria-invalid={!!errors.roleId}>
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
                <Label htmlFor="employee-discipline">
                  {tr('Направление')}
                  {tr(' (необязательно)')}
                </Label>
                <Controller
                  control={control}
                  name="disciplineId"
                  render={({ field }) => (
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <SelectTrigger id="employee-discipline" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
                        {disciplines.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            <span style={{ paddingLeft: d.depth * 12 }}>
                              <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="employee-form" disabled={create.isPending || organizations.length === 0}>
            {tr('Зарегистрировать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
