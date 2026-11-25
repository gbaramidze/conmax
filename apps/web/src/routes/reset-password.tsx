import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/app-shell/auth-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-provider'
import { PASSWORD_RECOVERY_KEY, supabase } from '@/lib/supabase'

// Сюда приводит ссылка из письма «Задать новый пароль» (её отправляет администратор на странице «Люди»).
// Ссылка уже выполнила вход; пока пароль не задан, остальное приложение сюда возвращает (метка вкладки в sessionStorage).
export const Route = createFileRoute('/reset-password')({
  beforeLoad: ({ context }) => {
    // при включённой двухфакторной защите сначала код: страница входа его спросит и вернёт сюда через _app
    if (context.auth.status === 'signed_out' || context.auth.status === 'mfa_required') throw redirect({ to: '/login' })
    if (!sessionStorage.getItem(PASSWORD_RECOVERY_KEY)) throw redirect({ to: '/' })
  },
  component: ResetPasswordPage,
})

const schema = z
  .object({
    password: z.string().min(10, tr('Пароль — не короче 10 символов')),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: tr('Пароли не совпадают') })
type Values = z.infer<typeof schema>

function ResetPasswordPage() {
  const navigate = useNavigate()
  const auth = useAuth()
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
      setFormError(
        error.code === 'same_password'
          ? tr('Это ваш прежний пароль. Придумайте новый.')
          : error.code === 'weak_password'
            ? tr('Пароль слишком простой. Придумайте другой.')
            : tr('Не удалось сохранить пароль. Попросите администратора отправить новую ссылку.'),
      )
      return
    }
    sessionStorage.removeItem(PASSWORD_RECOVERY_KEY)
    toast.success(tr('Новый пароль сохранён'))
    await navigate({ to: '/' })
  }

  async function signOut() {
    sessionStorage.removeItem(PASSWORD_RECOVERY_KEY)
    await auth.signOut()
    await navigate({ to: '/login' })
  }

  return (
    <AuthLayout
      title={tr('Новый пароль')}
      description={tr('Придумайте новый пароль для {{email}}. Им вы будете входить дальше, прежний перестанет работать.', { email: auth.session?.user.email ?? '' })}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{tr('Новый пароль')}</Label>
          <Input id="password" type="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password} {...register('password')} />
          {errors.password ? <p className="text-sm text-destructive">{errors.password.message}</p> : <p className="text-sm text-muted-foreground">{tr('Не короче 10 символов')}</p>}
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
        <Button type="submit" disabled={isSubmitting}>
          {tr('Сохранить пароль')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void signOut()}>
          {tr('Выйти')}
        </Button>
      </form>
    </AuthLayout>
  )
}
