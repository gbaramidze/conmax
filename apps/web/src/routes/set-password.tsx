import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/app-shell/auth-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { meQuery } from '@/features/auth/api'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/set-password')({
  beforeLoad: async ({ context }) => {
    if (context.auth.status === 'signed_out' || context.auth.status === 'mfa_required') throw redirect({ to: '/login' })
    if (context.auth.status === 'no_tenant') throw redirect({ to: '/onboarding' })
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me.status !== 'invited') throw redirect({ to: '/' })
  },
  component: SetPasswordPage,
})

const schema = z
  .object({
    password: z.string().min(10, tr('Пароль — не короче 10 символов')),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: tr('Пароли не совпадают') })
type Values = z.infer<typeof schema>

function SetPasswordPage() {
  const navigate = useNavigate()
  const { queryClient } = Route.useRouteContext()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  async function onSubmit(v: Values) {
    setFormError(null)
    const { error } = await supabase.auth.updateUser({ password: v.password })
    if (error) {
      setFormError(tr('Не удалось сохранить пароль. Попробуйте другой или запросите новое приглашение.'))
      return
    }
    const { error: activateError } = await supabase.rpc('activate_me')
    if (activateError) {
      setFormError(tr('Пароль сохранён, но активировать профиль не удалось. Обновите страницу и войдите снова.'))
      return
    }
    // ensureQueryData в guard-ах отдаёт кэш как есть, поэтому профиль перечитываем явно
    await queryClient.refetchQueries({ queryKey: ['me'] })
    await navigate({ to: '/' })
  }

  return (
    <AuthLayout title={tr('Задайте пароль')} description={tr('Вас пригласили в BuildOS. Пароль понадобится для следующих входов.')}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{tr('Новый пароль')}</Label>
              <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm">{tr('Повторите пароль')}</Label>
              <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register('confirm')} />
              {errors.confirm && <p className="text-sm text-destructive">{errors.confirm.message}</p>}
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>{tr('Сохранить пароль')}</Button>
          </form>
    </AuthLayout>
  )
}
