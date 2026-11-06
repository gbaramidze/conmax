import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/app-shell/auth-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/auth-provider'
import { MfaChallenge } from '@/features/auth/two-factor'
import { tr } from '@/lib/tr'

export const Route = createFileRoute('/login')({
  beforeLoad: ({ context }) => {
    if (context.auth.status === 'ready') throw redirect({ to: '/' })
    if (context.auth.status === 'no_tenant') throw redirect({ to: '/onboarding' })
  },
  component: LoginPage,
})

const makeSchema = (t: TFunction<'auth'>) =>
  z.object({
    email: z.email(t('emailError')),
    password: z.string().min(10, t('passwordError')),
  })
type Values = z.infer<ReturnType<typeof makeSchema>>

function LoginPage() {
  const { t } = useTranslation('auth')
  const schema = useMemo(() => makeSchema(t), [t])
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  const isSignIn = mode === 'sign_in'
  const auth = useAuth()
  const navigate = useNavigate()
  // после ввода кода AuthProvider получает повышенный уровень входа: пускаем в приложение
  useEffect(() => {
    if (auth.status === 'ready') void navigate({ to: '/' })
  }, [auth.status, navigate])

  async function onSubmit(values: Values) {
    setFormError(null)
    const { error } = isSignIn
      ? await supabase.auth.signInWithPassword(values)
      : await supabase.auth.signUp(values)
    if (error) {
      setFormError(
        error.message === 'Invalid login credentials'
          ? t('wrongCreds')
          : t('failed'),
      )
    }
    // Успех: AuthProvider получит сессию, guard перенаправит дальше
  }

  if (auth.status === 'mfa_required') {
    return (
      <AuthLayout title={tr('Код подтверждения')} description={tr('Пароль принят. Остался второй шаг входа.')}>
        <MfaChallenge onSignOut={() => void auth.signOut()} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={isSignIn ? t('signIn') : t('createAccount')}
      description={
        isSignIn
          ? t('descSignIn')
          : t('descSignUp')
      }
    >
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSignIn ? 'current-password' : 'new-password'}
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSignIn ? t('submitIn') : t('submitUp')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode(isSignIn ? 'sign_up' : 'sign_in')
                setFormError(null)
              }}
            >
              {isSignIn ? t('switchToUp') : t('switchToIn')}
            </Button>
          </form>
    </AuthLayout>
  )
}
