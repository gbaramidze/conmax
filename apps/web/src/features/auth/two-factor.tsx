import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

const factorsQuery = {
  queryKey: ['mfa-factors'],
  queryFn: async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) throw error
    return data.all.filter((f) => f.factor_type === 'totp')
  },
} as const

/** Проверить код из приложения-аутентификатора для фактора: запрос проверки, затем подтверждение. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const ch = await supabase.auth.mfa.challenge({ factorId })
  if (ch.error) throw ch.error
  const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.replace(/\s+/g, '') })
  if (v.error) throw v.error
}

/** Шаг входа: пароль принят, нужен код из приложения. Показывается вместо формы входа. */
export function MfaChallenge({ onSignOut }: { onSignOut: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      const factor = data.totp[0]
      if (!factor) throw new Error('no_factor')
      await verifyTotp(factor.id, code)
      // дальше AuthProvider увидит повышенный уровень и пустит в приложение
    } catch {
      setError(tr('Код не подошёл. Проверьте, что время на телефоне верное, и введите свежий код.'))
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted-foreground">{tr('Введите 6-значный код из приложения-аутентификатора (Google Authenticator, Microsoft Authenticator и подобных).')}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="mfa-code">{tr('Код из приложения')}</Label>
        <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} autoFocus value={code} onChange={(e) => setCode(e.target.value)} className="text-center text-lg tracking-widest tabular-nums" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || code.replace(/\s+/g, '').length < 6}>
        {tr('Войти')}
      </Button>
      <Button type="button" variant="ghost" onClick={onSignOut}>
        {tr('Выйти и войти под другим именем')}
      </Button>
    </form>
  )
}

/**
 * Блок профиля «Двухфакторная защита»: включение (QR-код и подтверждение кодом), состояние и отключение.
 * Защита необязательна; при включении вход требует и пароль, и код. Проверяет её и база, а не только экран входа.
 */
export function TwoFactorSection({ cardClass }: { cardClass: string }) {
  const queryClient = useQueryClient()
  const { data: factors = [], isLoading } = useQuery(factorsQuery)
  const verified = factors.find((f) => f.status === 'verified')
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: factorsQuery.queryKey })

  const start = useMutation({
    mutationFn: async () => {
      // незавершённая прошлая попытка мешает завести новый фактор с тем же названием
      for (const f of factors.filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: tr('Приложение-аутентификатор') })
      if (error) throw error
      return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
    },
    onSuccess: (s) => {
      setSetup(s)
      setCode('')
    },
    onError: () => toast.error(tr('Не удалось начать настройку. Попробуйте ещё раз.')),
  })
  const confirm = useMutation({
    mutationFn: () => verifyTotp(setup!.id, code),
    onSuccess: async () => {
      setSetup(null)
      await refresh()
      toast.success(tr('Двухфакторная защита включена'))
    },
    onError: () => {
      toast.error(tr('Код не подошёл. Проверьте время на телефоне и введите свежий код.'))
      setCode('')
    },
  })
  const cancel = useMutation({
    mutationFn: async () => {
      if (setup) await supabase.auth.mfa.unenroll({ factorId: setup.id })
    },
    onSettled: async () => {
      setSetup(null)
      await refresh()
    },
  })
  const off = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verified!.id })
      if (error) throw error
    },
    onSuccess: async () => {
      setConfirmOff(false)
      await refresh()
      toast.success(tr('Двухфакторная защита отключена'))
    },
    onError: () => toast.error(tr('Не удалось отключить защиту. Выйдите и войдите заново с кодом, затем повторите.')),
  })

  return (
    <section className={cardClass} aria-labelledby="mfa-title">
      <h2 id="mfa-title" className="text-lg font-semibold">
        {tr('Двухфакторная защита')}
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {tr('Кроме пароля при входе нужен одноразовый код из приложения на телефоне. Даже если пароль узнают посторонние, без телефона они не войдут. Рекомендуем включить её администраторам и руководителям.')}
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>
      ) : verified ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{tr('Включена')}</p>
          <p className="max-w-prose text-xs text-muted-foreground">{tr('Если потеряете телефон, обратитесь к администратору системы: он сбросит защиту, и вы войдёте по паролю.')}</p>
          {confirmOff ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={off.isPending} onClick={() => off.mutate()}>
                {tr('Да, отключить')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmOff(false)}>
                {tr('Не отключать')}
              </Button>
            </div>
          ) : (
            <div>
              <Button variant="outline" onClick={() => setConfirmOff(true)}>
                {tr('Отключить')}
              </Button>
            </div>
          )}
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-3">
          <ol className="flex max-w-prose list-decimal flex-col gap-1 pl-5 text-sm">
            <li>{tr('Установите на телефон приложение-аутентификатор (Google Authenticator, Microsoft Authenticator и подобные).')}</li>
            <li>{tr('Отсканируйте QR-код или введите ключ вручную.')}</li>
            <li>{tr('Введите 6-значный код из приложения и подтвердите.')}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            <img src={setup.qr} alt={tr('QR-код для приложения-аутентификатора')} className="size-40 rounded-lg border bg-white p-2" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">{tr('Ключ для ввода вручную')}</span>
              <code className="break-all rounded bg-muted px-2 py-1 text-sm tracking-wider">{setup.secret}</code>
            </div>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.replace(/\s+/g, '').length >= 6) confirm.mutate()
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="mfa-setup-code">{tr('Код из приложения')}</Label>
              <Input id="mfa-setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className="w-40 text-center text-lg tracking-widest tabular-nums" />
            </div>
            <Button type="submit" disabled={confirm.isPending || code.replace(/\s+/g, '').length < 6}>
              {tr('Подтвердить')}
            </Button>
            <Button type="button" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {tr('Отмена')}
            </Button>
          </form>
        </div>
      ) : (
        <div>
          <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate()}>
            {tr('Включить двухфакторную защиту')}
          </Button>
        </div>
      )}
    </section>
  )
}
