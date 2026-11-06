import { tr } from '@/lib/tr'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import {
  CATEGORY_LABELS,
  defaultMode,
  EMAIL_CATEGORIES,
  PREFERENCE_CATEGORIES,
  preferencesQuery,
  saveUserSettings,
  setPreference,
  TIMEZONES,
  userSettingsQuery,
  type NotificationCategory,
  type PreferenceChannel,
  type PreferenceMode,
  type UserNotificationSettings,
} from '@/features/notifications/api'

export const Route = createFileRoute('/_app/settings/notifications')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(preferencesQuery), queryClient.ensureQueryData(userSettingsQuery)]),
  component: NotificationSettings,
})

const DESCRIPTIONS: Partial<Record<NotificationCategory, string>> = {
  assigned: tr('Вас назначили исполнителем, задачу передали вам на проверку, задача просрочена'),
  mentioned: tr('Кто-то упомянул вас через @ в комментарии'),
  watching: tr('Изменения и комментарии в задачах, за которыми вы следите'),
  escalation: tr('Просрочка, которая дошла до вас как до руководителя'),
}

const hours = Array.from({ length: 24 }, (_, h) => h)

function NotificationSettings() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const { data: prefs } = useSuspenseQuery(preferencesQuery)
  const { data: settings } = useSuspenseQuery(userSettingsQuery)

  const save = useMutation({
    mutationFn: (v: { category: NotificationCategory; mode: PreferenceMode; channel: PreferenceChannel }) => setPreference(v.category, v.mode, v.channel),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
    onError: () => toast.error(tr('Не удалось сохранить настройку. Попробуйте ещё раз.')),
  })
  const saveSettings = useMutation({
    mutationFn: (next: UserNotificationSettings) => saveUserSettings(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-user-settings'] }),
    onError: () => toast.error(tr('Не удалось сохранить. Проверьте значения и попробуйте ещё раз.')),
  })
  const change = (patch: Partial<UserNotificationSettings>) => saveSettings.mutate({ ...settings, ...patch })

  const modeOf = (category: NotificationCategory, channel: PreferenceChannel) =>
    prefs.get(`${category}:${channel}`) ?? defaultMode(category, channel)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Настройки уведомлений')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr('Что и как вам сообщать. Критичные уведомления отключить нельзя. Telegram появится позже.')}</p>
      </div>

      <section className="flex flex-col gap-3" aria-label={tr('В приложении')}>
        <h2 className="text-base font-semibold">{tr('В приложении')}</h2>
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {PREFERENCE_CATEGORIES.map((c) => (
            <li key={c} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="font-medium">{CATEGORY_LABELS[c]}</p>
                <p className="text-sm text-muted-foreground">{DESCRIPTIONS[c]}</p>
              </div>
              <Select value={modeOf(c, 'in_app')} onValueChange={(v) => save.mutate({ category: c, mode: v as PreferenceMode, channel: 'in_app' })}>
                <SelectTrigger aria-label={tr('{{v1}}: в приложении', { v1: CATEGORY_LABELS[c] })} className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">{tr('Показывать')}</SelectItem>
                  <SelectItem value="off">{tr('Не показывать')}</SelectItem>
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-label="Email">
        <div>
          <h2 className="text-base font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">{tr('Письма приходят на')}{' '}{session?.user.email}{tr('. «Сводка» — одно письмо в сутки вместо потока.')}</p>
        </div>
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {EMAIL_CATEGORIES.map((c) => (
            <li key={c} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="font-medium">{CATEGORY_LABELS[c]}</p>
                <p className="text-sm text-muted-foreground">{DESCRIPTIONS[c]}</p>
              </div>
              <Select value={modeOf(c, 'email')} onValueChange={(v) => save.mutate({ category: c, mode: v as PreferenceMode, channel: 'email' })}>
                <SelectTrigger aria-label={`${CATEGORY_LABELS[c]}: email`} className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">{tr('Сразу')}</SelectItem>
                  <SelectItem value="digest">{tr('В сводке раз в сутки')}</SelectItem>
                  <SelectItem value="off">{tr('Не отправлять')}</SelectItem>
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Время')}>
        <h2 className="text-base font-semibold">{tr('Когда беспокоить')}</h2>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tz">{tr('Ваш часовой пояс')}</Label>
          <Select value={settings.timezone} onValueChange={(v) => change({ timezone: v })}>
            <SelectTrigger id="tz" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 md:size-4" checked={settings.quiet_enabled} onChange={(e) => change({ quiet_enabled: e.target.checked })} />
            <span>{tr('Тихие часы')}<span className="block text-xs text-muted-foreground">{tr('Письма в это время придут утром. Критичные приходят всегда.')}</span>
            </span>
          </label>
          {settings.quiet_enabled && (
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <div className="flex flex-col gap-2">
                <Label htmlFor="quiet-start">{tr('С')}</Label>
                <Input id="quiet-start" type="time" value={settings.quiet_start} onChange={(e) => e.target.value && change({ quiet_start: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="quiet-end">{tr('До')}</Label>
                <Input id="quiet-end" type="time" value={settings.quiet_end} onChange={(e) => e.target.value && change({ quiet_end: e.target.value })} />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="digest-hour">{tr('Сводка приходит в')}</Label>
          <Select value={String(settings.digest_hour)} onValueChange={(v) => change({ digest_hour: Number(v) })}>
            <SelectTrigger id="digest-hour" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {hours.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {String(h).padStart(2, '0')}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  )
}
