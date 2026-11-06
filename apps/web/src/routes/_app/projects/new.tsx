import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROJECT_KIND_LABELS, type ProjectKind } from '@/features/projects/api'
import { useAuth } from '@/features/auth/auth-provider'
import { CURRENCY_SYMBOLS, currencyNames } from '@/features/projects/currency'
import { supabase } from '@/lib/supabase'

/** Валюта по умолчанию по языку интерфейса; её можно выбрать другой. */

export const Route = createFileRoute('/_app/projects/new')({
  component: NewProjectPage,
})

const schema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, tr('Код — 2–8 латинских букв или цифр, например ZK7')),
  name: z.string().trim().min(3, tr('Название — не короче 3 символов')),
  kind: z.enum(Object.keys(PROJECT_KIND_LABELS) as [ProjectKind, ...ProjectKind[]]),
  address: z.string().trim().optional(),
  currency: z.string().length(3),
  planned_start: z.string().optional(),
  planned_finish: z.string().optional(),
}).refine((v) => !v.planned_start || !v.planned_finish || v.planned_finish >= v.planned_start, { message: tr('Окончание не может быть раньше начала'), path: ['planned_finish'] })
type Values = z.infer<typeof schema>

function NewProjectPage() {
  const { tenantId } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur', defaultValues: { kind: 'residential', currency: 'GEL' } })

  async function onSubmit(v: Values) {
    setFormError(null)
    const { error } = await supabase.from('projects').insert({
      tenant_id: tenantId!,
      code: v.code,
      name: v.name,
      kind: v.kind,
      address: v.address || null,
      currency: v.currency,
      planned_start: v.planned_start || null,
      planned_finish: v.planned_finish || null,
      status: 'active',
    })
    if (error) {
      setFormError(
        error.code === '23505'
          ? tr('Проект с кодом {{code}} уже есть. Выберите другой код.', { code: v.code })
          : tr('Не удалось создать проект. Попробуйте ещё раз.'),
      )
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    toast.success(tr('Проект {{code}} создан', { code: v.code }))
    await navigate({ to: '/projects' })
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <h1 className="text-xl font-semibold">{tr('Новый проект')}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">{tr('Код проекта')}</Label>
          <Input id="code" placeholder="ZK7" aria-invalid={!!errors.code} {...register('code')} />
          {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{tr('Название')}</Label>
          <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="kind">{tr('Тип объекта')}</Label>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_KIND_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="currency">{tr('Валюта проекта')}</Label>
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(currencyNames()).map(([c, label]) => (
                    <SelectItem key={c} value={c}>
                      {c} {CURRENCY_SYMBOLS[c] ?? ''} — {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address">{tr('Адрес')}</Label>
          <Input id="address" {...register('address')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="planned_start">{tr('Начало строительства')}</Label>
            <Controller control={control} name="planned_start" render={({ field }) => <DatePicker id="planned_start" value={field.value ?? ''} onChange={field.onChange} />} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="planned_finish">{tr('Плановое окончание')}</Label>
            <Controller control={control} name="planned_finish" render={({ field }) => <DatePicker id="planned_finish" value={field.value ?? ''} aria-invalid={!!errors.planned_finish} onChange={field.onChange} />} />
            {errors.planned_finish && <p className="text-sm text-destructive">{errors.planned_finish.message}</p>}
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{tr('Сроки можно задать позже на странице проекта. Изменить их потом можно с указанием основания, история сохраняется.')}</p>
        </div>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{tr('Создать проект')}</Button>
          <Button type="button" variant="ghost" asChild>
            <Link to="/projects">{tr('Отмена')}</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
