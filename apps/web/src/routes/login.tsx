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
import { clearAuthLinkError, getAuthLinkError, supabase } from '@/lib/supabase'
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
  const [mode, setMode] = useState<'sign_in' | 'sign_up' | 'forgot'>('sign_in')
  const [formError, setFormError] = useState<string | null>(null)
  // ссылка из письма (новый пароль, приглашение) истекла или уже использована
  const [linkError, setLinkError] = useState(getAuthLinkError)
  const {
    register,
    handleSubmit,
    getValues,
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
    setLinkError(null)
    clearAuthLinkError()
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

  if (mode === 'forgot') {
    return (
      <AuthLayout title={tr('Забыли пароль?')} description={tr('Укажите e-mail, с которым входите. Пришлём ссылку, по которой вы зададите новый пароль.')}>
        <ForgotPassword initialEmail={getValues('email') ?? ''} onBack={() => setMode('sign_in')} />
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
            {linkError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {linkError === 'expired'
                  ? tr('Ссылка из письма устарела: она действует один час и только один раз. Запросите новую: «Забыли пароль?» ниже.')
                  : tr('Ссылка из письма не сработала. Запросите новую: «Забыли пароль?» ниже.')}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">{t('password')}</Label>
                {isSignIn && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot')
                      setFormError(null)
                    }}
                    className="-my-2 min-h-9 rounded-md px-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {tr('Забыли пароль?')}
                  </button>
                )}
              </div>
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

/**
 * «Забыли пароль?»: письмо со ссылкой на /reset-password (то же, что отправляет администратор на «Людях»).
 * Ответ всегда одинаковый, есть такой адрес или нет — чтобы по форме нельзя было проверить, кто зарегистрирован.
 */
function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!z.email().safeParse(value).success) {
      setError(tr('Проверьте e-mail: в нём ошибка.'))
      return
    }
    setBusy(true)
    setError(null)
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(value, { redirectTo: window.location.origin })
    setBusy(false)
    if (sendError) {
      setError(
        sendError.status === 429
          ? tr('Письмо уже отправлено недавно. Повторить можно через минуту.')
          : tr('Не удалось отправить письмо. Попробуйте позже или обратитесь к администратору.'),
      )
      return
    }
    setSentTo(value)
  }

  if (sentTo)
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md border bg-muted/50 p-3 text-sm">
          {tr('Если {{email}} зарегистрирован в CONMAX, на него пришло письмо со ссылкой. Ссылка действует один час. Письма нет — проверьте «Спам» или обратитесь к администратору.', { email: sentTo })}
        </p>
        <Button type="button" variant="ghost" onClick={onBack}>
          {tr('Вернуться ко входу')}
        </Button>
      </div>
    )

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="forgot-email">{tr('E-mail')}</Label>
        <Input id="forgot-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !email.trim()}>
        {tr('Отправить ссылку')}
      </Button>
      <Button type="button" variant="ghost" onClick={onBack}>
        {tr('Вернуться ко входу')}
      </Button>
    </form>
  )
}
