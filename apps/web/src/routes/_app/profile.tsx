import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Bell, Cake, CheckCircle2, ChevronRight, Clock, ImagePlus, LogOut, Mail, Signature, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { birthdayRowQuery, setBirthday } from '@/features/birthdays/api'
import { todayISO } from '@/features/today/api'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import { TIMEZONES } from '@/features/notifications/api'
import {
  changePassword,
  MAX_AVATAR_SOURCE_BYTES,
  myProfileQuery,
  removeAvatar,
  requestEmailChange,
  signOutOtherSessions,
  updateProfile,
  uploadAvatar,
} from '@/features/profile/api'
import { UserAvatar } from '@/features/profile/avatar'
import { OutlookConnection } from '@/features/mail/connect-card'
import { AppBadgeSection } from '@/features/notifications/app-badge'
import { pendingForMeQuery } from '@/features/signatures/api'

export const Route = createFileRoute('/_app/profile')({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(myProfileQuery),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Открываем профиль…')}</p>,
  component: ProfilePage,
})

import { TwoFactorSection } from '@/features/auth/two-factor'
const cardClass = 'flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-soft sm:p-5'

function ProfilePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Профиль')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr('Ваши данные, фото, пароль и почта. Остальные видят только имя, должность, фото и день рождения без года.')}</p>
      </div>
      <PhotoSection />
      <DetailsSection />
      <BirthdaySection />
      <SecuritySection />
      <TwoFactorSection cardClass={cardClass} />
      <EmailSection />
      <NotificationsLink />
      <SignaturesLink />
      <AppBadgeSection className={cardClass} />
      <ConnectionsSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Фото
// ---------------------------------------------------------------------------
function PhotoSection() {
  const queryClient = useQueryClient()
  const { tenantId } = useAuth()
  const { data: me } = useSuspenseQuery(myProfileQuery)
  const input = useRef<HTMLInputElement>(null)

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['my-profile'] }), queryClient.invalidateQueries({ queryKey: ['me'] }), queryClient.invalidateQueries({ queryKey: ['avatar-url'] })])

  const save = useMutation({
    mutationFn: async (file: File | null) => {
      if (file) await uploadAvatar({ file, tenantId: tenantId!, userId: me.id, oldPath: me.avatar_path })
      else await removeAvatar(me.avatar_path)
    },
    onSuccess: async (_, file) => {
      await refresh()
      toast.success(file ? tr('Фото обновлено') : tr('Фото убрано'))
    },
    onError: () => toast.error(tr('Не удалось сохранить фото. Выберите другой файл или попробуйте ещё раз.')),
  })

  return (
    <section className={cardClass} aria-labelledby="photo-title">
      <h2 id="photo-title" className="text-base font-semibold">{tr('Фото')}</h2>
      <div className="flex items-center gap-4">
        <UserAvatar name={me.full_name} path={me.avatar_path} className="size-20 text-2xl" />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (input.current) input.current.value = ''
                if (!f) return
                if (!f.type.startsWith('image/')) return void toast.error(tr('Выберите изображение: JPG, PNG или WebP.'))
                if (f.size > MAX_AVATAR_SOURCE_BYTES) return void toast.error(tr('Фото больше 25 МБ не загрузить.'))
                save.mutate(f)
              }}
            />
            <Button type="button" size="sm" variant="secondary" disabled={save.isPending} onClick={() => input.current?.click()}>
              <ImagePlus /> {save.isPending ? tr('Загружаем…') : me.avatar_path ? tr('Сменить фото') : tr('Загрузить фото')}
            </Button>
            {me.avatar_path && (
              <Button type="button" size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(null)}>
                <Trash2 />{tr('Убрать')}</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{tr('JPG, PNG или WebP. Фото обрежется до квадрата и уменьшится до 256 px.')}</p>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Личные данные
// ---------------------------------------------------------------------------
const detailsSchema = z.object({
  full_name: z.string().trim().min(2, tr('Укажите имя и фамилию')).max(120, tr('Не длиннее 120 символов')),
  phone: z
    .string()
    .trim()
    .max(32, tr('Не длиннее 32 символов'))
    .refine((v) => v === '' || /^[0-9+()\-\s.]+$/.test(v), tr('Только цифры, пробелы, + - ( )')),
  timezone: z.string().min(1),
})
type DetailsValues = z.infer<typeof detailsSchema>

function DetailsSection() {
  const queryClient = useQueryClient()
  const { data: me } = useSuspenseQuery(myProfileQuery)
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    mode: 'onBlur',
    defaultValues: { full_name: me.full_name, phone: me.phone ?? '', timezone: me.timezone },
  })
  const timezone = watch('timezone')
  const zones = TIMEZONES.some((t) => t.value === me.timezone) ? TIMEZONES : [...TIMEZONES, { value: me.timezone, label: me.timezone }]

  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: async (_, v) => {
      reset(v)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-user-settings'] }),
      ])
      toast.success(tr('Профиль сохранён'))
    },
    onError: () => toast.error(tr('Не удалось сохранить профиль. Проверьте значения и попробуйте ещё раз.')),
  })

  return (
    <section className={cardClass} aria-labelledby="details-title">
      <h2 id="details-title" className="text-base font-semibold">{tr('Личные данные')}</h2>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="full_name">{tr('Имя и фамилия')}</Label>
          <Input id="full_name" autoComplete="name" aria-invalid={!!errors.full_name} {...register('full_name')} />
          {errors.full_name && <p className="text-sm text-destructive">{errors.full_name.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="job_title">{tr('Должность')}</Label>
          <Input id="job_title" readOnly value={me.job_title ?? ''} placeholder={tr('Пока не назначена')} className="bg-muted/50" />
          <p className="text-xs text-muted-foreground">{tr('Должность назначают в проекте («Участники») или в оргструктуре компании. Права у неё — на странице «Роли и права».')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">{tr('Телефон')}</Label>
          <Input id="phone" type="tel" autoComplete="tel" placeholder="+7 …" aria-invalid={!!errors.phone} {...register('phone')} />
          {errors.phone ? <p className="text-sm text-destructive">{errors.phone.message}</p> : <p className="text-xs text-muted-foreground">{tr('В международном формате, например +995 5XX XX XX XX: по нему работают звонок и WhatsApp.')}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">{tr('Часовой пояс')}</Label>
          <Select value={timezone} onValueChange={(v) => setValue('timezone', v, { shouldDirty: true })}>
            <SelectTrigger id="timezone" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{tr('Тот же, что в настройках уведомлений: от него зависят тихие часы и время сводки.')}</p>
        </div>
        {(me.organization?.name || me.tenant?.name) && (
          <p className="text-sm text-muted-foreground">{tr('Компания:')}{' '}{[me.tenant?.name, me.organization?.name].filter((v, i, a) => v && a.indexOf(v) === i).join(' · ')}{tr('. Меняет администратор.')}</p>
        )}
        <div>
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {save.isPending ? tr('Сохраняем…') : tr('Сохранить изменения')}
          </Button>
        </div>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
// День рождения
// ---------------------------------------------------------------------------
function BirthdaySection() {
  const queryClient = useQueryClient()
  const { data: me } = useSuspenseQuery(myProfileQuery)
  const { data: row, isPending } = useQuery(birthdayRowQuery(me.id))
  if (isPending) return null
  return (
    <BirthdayForm
      key={`${row?.birth_date ?? ''}:${row?.show_year ?? ''}`}
      userId={me.id}
      initialDate={row?.birth_date ?? ''}
      initialShowYear={row?.show_year ?? false}
      onSaved={() => queryClient.invalidateQueries({ queryKey: ['birthdays'] })}
    />
  )
}

function BirthdayForm({ userId, initialDate, initialShowYear, onSaved }: { userId: string; initialDate: string; initialShowYear: boolean; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(initialDate)
  const [showYear, setShowYear] = useState(initialShowYear)
  const dirty = date !== initialDate || showYear !== initialShowYear
  const save = useMutation({
    mutationFn: () => setBirthday(userId, date || null, showYear),
    onSuccess: async () => {
      toast.success(date ? tr('День рождения сохранён') : tr('День рождения убран'))
      await onSaved()
    },
    onError: () => toast.error(tr('Не удалось сохранить дату. Проверьте её и попробуйте ещё раз.')),
  })
  const today = todayISO()

  return (
    <section className={cardClass} aria-labelledby="birthday-title">
      <div>
        <h2 id="birthday-title" className="flex items-center gap-2 text-base font-semibold">
          <Cake className="size-4" aria-hidden /> {tr('День рождения')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr('Коллеги увидят день и месяц и получат уведомление в этот день. Год видите только вы и отдел кадров.')}</p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="birth_date">{tr('Дата рождения')}</Label>
          <DatePicker id="birth_date" value={date} onChange={setDate} min="1900-01-01" max={today} openTo="1990-01-01" className="w-full sm:w-72" />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={showYear} disabled={!date} onChange={(e) => setShowYear(e.target.checked)} />
          {tr('Показывать коллегам возраст')}
        </label>
        <div>
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? tr('Сохраняем…') : tr('Сохранить')}
          </Button>
        </div>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Безопасность
// ---------------------------------------------------------------------------
const passwordSchema = z
  .object({
    current: z.string().min(1, tr('Введите текущий пароль')),
    next: z.string().min(10, tr('Пароль — не короче 10 символов')),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ['confirm'], message: tr('Пароли не совпадают') })
type PasswordValues = z.infer<typeof passwordSchema>

function SecuritySection() {
  const { data: me } = useSuspenseQuery(myProfileQuery)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), mode: 'onBlur' })

  async function onSubmit(v: PasswordValues) {
    setFormError(null)
    if (v.next === v.current) return void setError('next', { message: tr('Новый пароль должен отличаться от текущего') })
    try {
      const result = await changePassword({ email: me.authEmail, current: v.current, next: v.next })
      if (result === 'wrong_current') return void setError('current', { message: tr('Текущий пароль неверный') })
      if (result === 'same') return void setError('next', { message: tr('Новый пароль должен отличаться от текущего') })
      if (result === 'weak') return void setError('next', { message: tr('Пароль слишком простой. Добавьте цифры и разные буквы.') })
      reset()
      toast.success(tr('Пароль изменён. На других устройствах войдите заново.'))
    } catch {
      setFormError(tr('Не удалось сменить пароль. Попробуйте ещё раз.'))
    }
  }

  const others = useMutation({
    mutationFn: signOutOtherSessions,
    onSuccess: () => toast.success(tr('Вы вышли на всех остальных устройствах')),
    onError: () => toast.error(tr('Не удалось завершить другие сеансы. Попробуйте ещё раз.')),
  })

  return (
    <section className={cardClass} aria-labelledby="security-title">
      <h2 id="security-title" className="text-base font-semibold">{tr('Безопасность')}</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="current-password">{tr('Текущий пароль')}</Label>
          <Input id="current-password" type="password" autoComplete="current-password" aria-invalid={!!errors.current} {...register('current')} />
          {errors.current && <p className="text-sm text-destructive">{errors.current.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">{tr('Новый пароль')}</Label>
          <Input id="new-password" type="password" autoComplete="new-password" aria-invalid={!!errors.next} {...register('next')} />
          {errors.next && <p className="text-sm text-destructive">{errors.next.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password">{tr('Повторите новый пароль')}</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register('confirm')} />
          {errors.confirm && <p className="text-sm text-destructive">{errors.confirm.message}</p>}
        </div>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tr('Меняем…') : tr('Сменить пароль')}
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{tr('Потеряли телефон или вошли на чужом компьютере? Завершите сеансы на других устройствах.')}</p>
        <Button type="button" variant="outline" disabled={others.isPending} onClick={() => others.mutate()} className="shrink-0">
          <LogOut />{tr('Выйти на других устройствах')}</Button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Личная почта
// ---------------------------------------------------------------------------
const emailSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email(tr('Введите адрес вида name@example.com'))) })
type EmailValues = z.infer<typeof emailSchema>

function EmailSection() {
  const queryClient = useQueryClient()
  const { data: me } = useSuspenseQuery(myProfileQuery)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<EmailValues>({ resolver: zodResolver(emailSchema), mode: 'onBlur' })

  const send = useMutation({
    mutationFn: (v: EmailValues) => requestEmailChange(v.email),
    onSuccess: async () => {
      reset()
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] })
      toast.success(tr('Письма отправлены. Откройте ссылку в каждом из них, чтобы подтвердить смену.'))
    },
    onError: (e: { code?: string }, v) => {
      if (e.code === 'email_exists') setError('email', { message: tr('Этот адрес уже занят другим пользователем') })
      else if (e.code === 'over_email_send_rate_limit') setError('email', { message: tr('Письмо только что отправляли. Подождите минуту и повторите.') })
      else if (e.code === 'same_email') setError('email', { message: tr('Сейчас вы и так входите с адресом {{email}}', { email: v.email }) })
      else toast.error(tr('Не удалось отправить письмо. Проверьте адрес и попробуйте ещё раз.'))
    },
  })

  return (
    <section className={cardClass} aria-labelledby="email-title">
      <h2 id="email-title" className="text-base font-semibold">{tr('Личная почта')}</h2>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="size-4 text-muted-foreground" aria-hidden />
          <span className="break-all font-medium">{me.authEmail}</span>
          <Badge variant="secondary">
            <CheckCircle2 />{tr('Подтверждена')}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{tr('Сюда приходят уведомления и письма для входа. Её же вы указываете при входе.')}</p>
      </div>
      {me.pendingEmail && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-signal/40 bg-signal/10 p-3 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{tr('Ждём подтверждения:')}{' '}<span className="break-all font-medium">{me.pendingEmail}</span>{tr('. Мы отправили по письму на старый и новый адрес — откройте ссылку в каждом. До этого вы входите со старой почтой.')}</p>
        </div>
      )}
      <form onSubmit={handleSubmit((v) => send.mutate(v))} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-email">{me.pendingEmail ? tr('Другой адрес') : tr('Новый адрес почты')}</Label>
          <Input id="new-email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div>
          <Button type="submit" variant="secondary" disabled={send.isPending}>
            {send.isPending ? tr('Отправляем…') : tr('Отправить письма для подтверждения')}
          </Button>
        </div>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Уведомления и подключения
// ---------------------------------------------------------------------------
function NotificationsLink() {
  return (
    <Link
      to="/settings/notifications"
      className="group flex min-h-14 items-center gap-3 rounded-lg border bg-card p-4 shadow-soft outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
    >
      <Bell className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{tr('Уведомления')}</span>
        <span className="block text-sm text-muted-foreground">{tr('Что приходит в приложение и на почту, тихие часы, время сводки')}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

/** Переход на «Мои подписи»: образцы подписи и всё подписанное; число — сколько документов ждут вашей подписи */
function SignaturesLink() {
  const { data: pending = [] } = useQuery(pendingForMeQuery)
  return (
    <Link
      to="/signatures"
      className="group flex min-h-14 items-center gap-3 rounded-lg border bg-card p-4 shadow-soft outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
    >
      <Signature className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{tr('Мои подписи')}</span>
        <span className="block text-sm text-muted-foreground">{tr('Образцы подписи и всё, что вы подписали: даты и файлы')}</span>
      </span>
      {pending.length > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground" title={tr('Ждут вашей подписи')}>
          {pending.length}
        </span>
      )}
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

function ConnectionsSection() {
  return (
    <section className={cardClass} aria-labelledby="connections-title">
      <h2 id="connections-title" className="text-base font-semibold">{tr('Подключения')}</h2>
      <OutlookConnection />
    </section>
  )
}
