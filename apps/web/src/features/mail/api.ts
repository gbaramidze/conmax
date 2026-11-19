import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { tr } from '@/lib/tr'
import { supabase } from '@/lib/supabase'

/** Личная почта Outlook (Microsoft 365). Письма не хранятся у нас: функция `mail` читает их из Microsoft Graph по запросу. */

export interface MailAccount {
  email: string
  display_name: string | null
  connected_at: string
  last_ok_at: string | null
  last_error: string | null
}

export interface MailAddress {
  name: string
  address: string
}

export type WellKnownFolder = 'inbox' | 'sentitems' | 'drafts' | 'archive' | 'deleteditems' | 'junkemail'

export interface MailFolder {
  id: string
  name: string
  well_known: WellKnownFolder | null
  unread: number
  total: number
  has_children: boolean
}

export interface MailListItem {
  id: string
  subject: string
  from: MailAddress
  /** Первые получатели: в «Отправленных» и «Черновиках» строка показывает, кому письмо */
  to?: MailAddress[]
  received_at: string
  is_read: boolean
  has_attachments: boolean
  preview: string
  important: boolean
  flagged?: boolean
  /** Приглашение на встречу или отмена */
  meeting?: 'request' | 'cancel' | null
  /** Переписка (ветка), к которой относится письмо */
  conversation_id?: string | null
  /** Сколько писем в переписке по всем папкам (без черновиков); 1 — не ветка */
  thread_count?: number
  /** Первые вложения — названия для «плашек» под строкой, как в Outlook */
  files?: { name: string; size: number }[]
  /** Папка письма — только у писем ветки (они бывают из разных папок) */
  folder_id?: string | null
}

/** Все письма ветки из всех папок (входящие и свои ответы), от новых к старым */
export const mailConversationQuery = (conversationId: string) =>
  queryOptions({
    queryKey: ['mail', 'messages', 'conversation', conversationId],
    staleTime: 30_000,
    retry: false,
    queryFn: async () => (await call<{ messages: MailListItem[] }>({ action: 'conversation', conversation_id: conversationId })).messages,
  })

/** Быстрые фильтры списка (как «Представления» в Zoho и фильтр в Outlook) */
export const MAIL_FILTERS = ['all', 'unread', 'attachments', 'important', 'flagged'] as const
export type MailFilter = (typeof MAIL_FILTERS)[number]

export function filterLabel(f: MailFilter): string {
  switch (f) {
    case 'unread':
      return tr('Непрочитанные')
    case 'attachments':
      return tr('С вложениями')
    case 'important':
      return tr('Важные')
    case 'flagged':
      return tr('С флажком')
    default:
      return tr('Все')
  }
}

/** Фильтр по уже загруженным письмам: при поиске Graph не умеет фильтровать, поэтому досеиваем на сайте. */
export function matchesFilter(m: MailListItem, f: MailFilter): boolean {
  switch (f) {
    case 'unread':
      return !m.is_read
    case 'attachments':
      return m.has_attachments
    case 'important':
      return m.important
    case 'flagged':
      return !!m.flagged
    default:
      return true
  }
}

export interface MailAttachment {
  id: string
  name: string
  content_type: string
  size: number
}

export interface MailMessage {
  id: string
  subject: string
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  received_at: string
  is_read: boolean
  important: boolean
  web_link: string | null
  body_type: 'html' | 'text'
  body: string
  attachments: MailAttachment[]
  /** Приглашение или отмена встречи: функция уже положила её в личный календарь (или убрала оттуда) */
  meeting: MailMeeting | null
  /**
   * Переписка: это письмо и все более ранние письма ветки, сверху самое новое; у каждого — только собственный текст
   * (без цитаты предыдущих). Пусто или одно — письмо показывается целиком, как обычно.
   */
  thread: MailThreadItem[]
}

export interface MailThreadItem {
  id: string
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  received_at: string
  is_read: boolean
  folder_id: string | null
  body_type: 'html' | 'text'
  body: string
  attachments: MailAttachment[]
}

export interface MailMeeting {
  kind: 'request' | 'cancel'
  subject: string
  start: string
  end: string | null
  all_day: boolean
  location: string
  organizer: string
  /** Запись в личном календаре; null — встреча уже прошла или отменена */
  item_id: string | null
  event_date: string | null
  /** Сколько встреч добавлено (у серии — повторы на полгода вперёд) */
  repeats: number
}

/** Код ошибки функции (`reconnect_required`, `not_configured`…) — из тела ответа. */
export class MailError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('mail', { body })
  if (error) {
    let code = 'internal'
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      if (payload && typeof payload.error === 'string') code = payload.error
    } else {
      code = 'network'
    }
    throw new MailError(code)
  }
  return data as T
}

export function mailErrorText(e: unknown): string {
  const code = e instanceof MailError ? e.code : ''
  switch (code) {
    case 'not_configured':
      return tr('Подключение почты не настроено. Обратитесь к администратору.')
    case 'forbidden':
      return tr('У вас нет права подключать почту.')
    case 'reconnect_required':
      return tr('Доступ к почте отозван или истёк. Подключите её заново в профиле.')
    case 'not_connected':
      return tr('Почта не подключена.')
    case 'no_mailbox':
      return tr('В этой учётной записи нет почтового ящика Exchange Online.')
    case 'state_expired':
    case 'invalid_state':
      return tr('Время подключения истекло. Нажмите «Подключить Outlook» ещё раз.')
    case 'too_many_requests':
      return tr('Microsoft просит подождать. Повторите через минуту.')
    case 'too_large':
      return tr('Вложение больше 25 МБ: откройте его в Outlook.')
    case 'not_found':
      return tr('Письма уже нет в ящике.')
    case 'network':
      return tr('Нет связи с сервером. Проверьте интернет и повторите.')
    default:
      return tr('Не удалось связаться с почтой. Попробуйте ещё раз.')
  }
}

// ---------------------------------------------------------------------------
// Подключение
// ---------------------------------------------------------------------------
export const mailAccountQuery = queryOptions({
  queryKey: ['mail', 'account'],
  staleTime: 60_000,
  queryFn: async (): Promise<MailAccount | null> => {
    const { data, error } = await supabase.from('mail_accounts').select('email, display_name, connected_at, last_ok_at, last_error').maybeSingle()
    if (error) throw error
    return data
  },
})

/** Адрес, на который Microsoft вернёт пользователя после входа; его же нужно прописать в приложении Entra. */
export const mailRedirectUri = () => `${window.location.origin}/mail`

/** Ссылка на вход в Microsoft. Пользователя отправляют на неё целиком (редирект). */
export async function mailAuthUrl(): Promise<string> {
  const { url } = await call<{ url: string }>({ action: 'auth_url', redirect_uri: mailRedirectUri() })
  return url
}

export function mailConnect(code: string, state: string) {
  return call<{ email: string; display_name: string | null }>({ action: 'connect', code, state })
}

export async function mailDisconnect(): Promise<void> {
  const { error } = await supabase.from('mail_accounts').delete().not('user_id', 'is', null)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------
const FOLDER_ORDER: WellKnownFolder[] = ['inbox', 'drafts', 'sentitems', 'archive', 'junkemail', 'deleteditems']

export function folderLabel(f: MailFolder): string {
  switch (f.well_known) {
    case 'inbox':
      return tr('Входящие')
    case 'sentitems':
      return tr('Отправленные')
    case 'drafts':
      return tr('Черновики')
    case 'archive':
      return tr('Архив')
    case 'deleteditems':
      return tr('Удалённые')
    case 'junkemail':
      return tr('Нежелательная почта')
    default:
      return f.name
  }
}

export const mailFoldersQuery = queryOptions({
  queryKey: ['mail', 'folders'],
  staleTime: 60_000,
  retry: false,
  queryFn: async (): Promise<MailFolder[]> => {
    const { folders } = await call<{ folders: MailFolder[] }>({ action: 'folders' })
    const rank = (f: MailFolder) => (f.well_known ? FOLDER_ORDER.indexOf(f.well_known) : 100)
    return [...folders].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  },
})

/** Подпапки (раскрываются по стрелке) */
export const mailChildrenQuery = (folderId: string) =>
  queryOptions({
    queryKey: ['mail', 'children', folderId],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<MailFolder[]> => {
      const { folders } = await call<{ folders: MailFolder[] }>({ action: 'children', folder: folderId })
      return [...folders].sort((a, b) => a.name.localeCompare(b.name))
    },
  })

export const mailMessagesQuery = (folder: string, search: string, filter: MailFilter = 'all') =>
  infiniteQueryOptions({
    queryKey: ['mail', 'messages', folder, search, filter],
    staleTime: 30_000,
    // открытая папка сама подтягивает новые письма
    refetchInterval: 60_000,
    retry: false,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      call<{ messages: MailListItem[]; next: string | null }>(
        pageParam ? { action: 'messages', next: pageParam } : { action: 'messages', folder, search, filter: filter === 'all' ? undefined : filter },
      ),
    getNextPageParam: (last) => last.next || undefined,
  })

/** Непрочитанные во «Входящих» — значок у пункта «Почта» в меню. Только если почта подключена. */
export const mailUnreadQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ['mail', 'unread'],
    enabled,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: false,
    queryFn: async () => (await call<{ unread: number }>({ action: 'unread' })).unread,
  })

/** Новое письмо — в Outlook в браузере: отправка из приложения появится позже (сейчас доступ только на чтение). */
export const OUTLOOK_COMPOSE_URL = 'https://outlook.office.com/mail/deeplink/compose'

export const mailMessageQuery = (id: string) =>
  queryOptions({
    queryKey: ['mail', 'message', id],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => call<MailMessage>({ action: 'message', id }),
  })

/** Скачивает вложение через функцию (токен Microsoft в браузер не попадает). */
export async function downloadAttachment(messageId: string, a: MailAttachment): Promise<void> {
  const { data, error } = await supabase.functions.invoke('mail', { body: { action: 'attachment', id: messageId, attachment_id: a.id } })
  if (error) {
    let code = 'internal'
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      if (payload && typeof payload.error === 'string') code = payload.error
    }
    throw new MailError(code)
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart])
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = a.name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
