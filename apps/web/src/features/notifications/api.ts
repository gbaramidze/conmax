import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const NOTIFICATION_TABS = ['all', 'assigned', 'mentioned', 'watching', 'snoozed'] as const
export type NotificationTab = (typeof NOTIFICATION_TABS)[number]

export const NOTIFICATION_TAB_LABELS: Record<NotificationTab, string> = {
  all: tr('Все'),
  assigned: tr('Мне назначено'),
  mentioned: tr('Упоминания'),
  watching: tr('Наблюдаю'),
  snoozed: tr('Отложенные'),
}

export const CATEGORY_LABELS = {
  assigned: tr('Назначено мне'),
  mentioned: tr('Упоминания'),
  watching: tr('Наблюдаю'),
  escalation: tr('Эскалации'),
  digest: tr('Дайджест'),
  system: tr('Системные'),
} as const
export type NotificationCategory = keyof typeof CATEGORY_LABELS

export interface NotificationRow {
  id: string
  event_type: string
  entity_type: string | null
  entity_id: string | null
  priority: 'low' | 'normal' | 'high' | 'critical'
  category: NotificationCategory
  title: string
  body: string | null
  payload: { entity_key?: string; project_code?: string; actor_name?: string; link?: string }
  read_at: string | null
  snoozed_until: string | null
  created_at: string
  updated_at: string
}

export const notificationsQuery = (tab: NotificationTab) =>
  queryOptions({
    queryKey: ['notifications', 'list', tab],
    queryFn: async () => {
      const nowIso = new Date().toISOString()
      let q = supabase
        .from('notifications')
        .select('id, event_type, entity_type, entity_id, priority, category, title, body, payload, read_at, snoozed_until, created_at, updated_at')
        .is('archived_at', null)
      if (tab === 'snoozed') q = q.gt('snoozed_until', nowIso)
      else {
        q = q.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
        if (tab !== 'all') q = q.eq('category', tab)
      }
      const { data, error } = await q.order('updated_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as unknown as NotificationRow[]
    },
  })

export interface NotificationCounts {
  badge: number
  all: number
  assigned: number
  mentioned: number
  watching: number
  snoozed: number
}

export const notificationCountsQuery = queryOptions({
  queryKey: ['notifications', 'counts'],
  refetchInterval: 60_000, // страховка на случай пропущенного realtime-события
  queryFn: async () => {
    const { data, error } = await supabase.rpc('my_notification_counts')
    if (error) throw error
    return data as unknown as NotificationCounts
  },
})

export async function markRead(ids: string[]): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
}

export async function markAllRead(tab: NotificationTab): Promise<void> {
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).is('archived_at', null)
  if (tab !== 'all' && tab !== 'snoozed') q = q.eq('category', tab)
  const { error } = await q
  if (error) throw error
}

export async function snooze(id: string, until: Date): Promise<void> {
  const { error } = await supabase.from('notifications').update({ snoozed_until: until.toISOString() }).eq('id', id)
  if (error) throw error
}

export async function archive(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/** Варианты «отложить»: через час, завтра в 8:00, в понедельник в 8:00. */
export function snoozeOptions(now = new Date()): { label: string; until: Date }[] {
  const at8 = (d: Date) => {
    const x = new Date(d)
    x.setHours(8, 0, 0, 0)
    return x
  }
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const monday = new Date(now)
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)) // ближайший понедельник строго после сегодня
  return [
    { label: tr('Через час'), until: new Date(now.getTime() + 60 * 60_000) },
    { label: tr('Завтра в 8:00'), until: at8(tomorrow) },
    { label: tr('В понедельник в 8:00'), until: at8(monday) },
  ]
}

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------
export const PREFERENCE_CATEGORIES: NotificationCategory[] = ['assigned', 'mentioned', 'watching']
/** Категории, для которых настраивается email (эскалации приходят на почту по умолчанию) */
export const EMAIL_CATEGORIES: NotificationCategory[] = ['assigned', 'mentioned', 'watching', 'escalation']
export type PreferenceChannel = 'in_app' | 'email'
export type PreferenceMode = 'instant' | 'digest' | 'off'

/** Значения по умолчанию: совпадают с private.channel_mode в БД и с матрицей в документации. */
export function defaultMode(category: NotificationCategory, channel: PreferenceChannel): PreferenceMode {
  if (channel === 'email' && category === 'watching') return 'digest'
  return 'instant'
}

/** Настройки каналов: ключ «категория:канал» */
export const preferencesQuery = queryOptions({
  queryKey: ['notification-preferences'],
  queryFn: async () => {
    const { data, error } = await supabase.from('notification_preferences').select('category, channel, mode')
    if (error) throw error
    return new Map(data.map((r) => [`${r.category}:${r.channel}`, r.mode as PreferenceMode]))
  },
})

export async function setPreference(category: NotificationCategory, mode: PreferenceMode, channel: PreferenceChannel = 'in_app'): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from('notification_preferences')
    .select('id')
    .eq('category', category)
    .eq('channel', channel)
    .maybeSingle()
  if (readError) throw readError
  const { error } = existing
    ? await supabase.from('notification_preferences').update({ mode }).eq('id', existing.id)
    : await supabase.from('notification_preferences').insert({ category, channel, mode } as never)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Часовой пояс, тихие часы, час сводки
// ---------------------------------------------------------------------------
export interface UserNotificationSettings {
  timezone: string
  quiet_enabled: boolean
  quiet_start: string
  quiet_end: string
  digest_hour: number
}

export const DEFAULT_USER_SETTINGS: UserNotificationSettings = {
  timezone: 'Europe/Moscow',
  quiet_enabled: false,
  quiet_start: '21:00',
  quiet_end: '07:00',
  digest_hour: 7,
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Kaliningrad', label: tr('Калининград (UTC+2)') },
  { value: 'Europe/Moscow', label: tr('Москва (UTC+3)') },
  { value: 'Europe/Samara', label: tr('Самара (UTC+4)') },
  { value: 'Asia/Yekaterinburg', label: tr('Екатеринбург (UTC+5)') },
  { value: 'Asia/Omsk', label: tr('Омск (UTC+6)') },
  { value: 'Asia/Novosibirsk', label: tr('Новосибирск (UTC+7)') },
  { value: 'Asia/Irkutsk', label: tr('Иркутск (UTC+8)') },
  { value: 'Asia/Yakutsk', label: tr('Якутск (UTC+9)') },
  { value: 'Asia/Vladivostok', label: tr('Владивосток (UTC+10)') },
  { value: 'UTC', label: 'UTC' },
]

export const userSettingsQuery = queryOptions({
  queryKey: ['notification-user-settings'],
  queryFn: async (): Promise<UserNotificationSettings> => {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('timezone, quiet_enabled, quiet_start, quiet_end, digest_hour')
      .maybeSingle()
    if (error) throw error
    if (!data) return DEFAULT_USER_SETTINGS
    return { ...data, quiet_start: data.quiet_start.slice(0, 5), quiet_end: data.quiet_end.slice(0, 5) }
  },
})

export async function saveUserSettings(next: UserNotificationSettings): Promise<void> {
  const { error } = await supabase.from('user_notification_settings').upsert(next as never, { onConflict: 'user_id' })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Наблюдение за объектом
// ---------------------------------------------------------------------------
export const watchQuery = (entity: { type: string; id: string }, userId: string) =>
  queryOptions({
    queryKey: ['watch', entity.type, entity.id, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('watchers')
        .select('muted')
        .eq('entity_type', entity.type)
        .eq('entity_id', entity.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data // null — строки нет
    },
  })

export async function setWatching(entity: { type: string; id: string }, userId: string, on: boolean, hasRow: boolean): Promise<void> {
  if (hasRow) {
    const { error } = await supabase
      .from('watchers')
      .update({ muted: !on })
      .eq('entity_type', entity.type)
      .eq('entity_id', entity.id)
      .eq('user_id', userId)
    if (error) throw error
  } else if (on) {
    const { error } = await supabase
      .from('watchers')
      .insert({ entity_type: entity.type, entity_id: entity.id, user_id: userId } as never)
    if (error) throw error
  }
}
