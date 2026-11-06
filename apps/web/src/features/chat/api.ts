import { queryOptions } from '@tanstack/react-query'
import { compressImage } from '@/features/activity/image'
import { supabase } from '@/lib/supabase'
import { uuid } from '@/lib/utils'

export const CHAT_BUCKET = 'chat'
export const CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024
export const CHAT_MAX_FILES = 10

export type ChatKind = 'project' | 'discipline' | 'org' | 'group' | 'direct'

export interface ChatChannel {
  id: string
  kind: ChatKind
  name: string | null
  /** Проект канала; у личных переписок и групп его нет */
  project_id: string | null
  project_code: string | null
  project_name: string | null
  organization_id: string | null
  organization_name: string | null
  discipline_id: string | null
  discipline_code: string | null
  discipline_name: string | null
  created_by: string | null
  /** Состав группы (только для kind = 'group'), создатель входит всегда */
  member_ids: string[] | null
  other_user_id: string | null
  last_message_at: string | null
  last_body: string | null
  last_author_id: string | null
  unread: number
}

/** Все мои каналы: личные, группы и по каждому проекту — общий чат, направления, организации. */
export const chatOverviewQuery = queryOptions({
    queryKey: ['chat', 'overview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('chat_overview')
      if (error) throw error
      return data as unknown as ChatChannel[]
    },
  })

export interface ChatPerson {
  id: string
  full_name: string
  email: string
  avatar_path: string | null
  job_title: string | null
  is_external: boolean
  organization_name: string | null
}

/** Люди, которым я могу написать (внутренним — все внутренние; внешнему — своя организация и внутренняя команда с общим проектом). */
export const chatPeopleQuery = queryOptions({
  queryKey: ['chat', 'people'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('chat_people')
    if (error) throw error
    return data as unknown as ChatPerson[]
  },
})

/** Число непрочитанных сообщений во всех переписках (значок в меню). */
export const chatUnreadQuery = queryOptions({
    queryKey: ['chat', 'unread'],
    refetchInterval: 60_000, // страховка на случай пропущенного realtime-события
    queryFn: async () => {
      const { data, error } = await supabase.rpc('chat_unread_count')
      if (error) throw error
      return data as number
    },
  })

export type AttachmentKind = 'file' | 'image' | 'voice'

export interface ChatAttachment {
  id: string
  storage_key: string
  name: string
  mime: string
  size_bytes: number
  kind: AttachmentKind
  duration_sec: number | null
}

export interface ChatMessage {
  id: string
  channel_id: string
  author_id: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  attachments: ChatAttachment[]
  reactions: { user_id: string; emoji: string }[]
}

const MESSAGES_LIMIT = 200

/** Последние сообщения канала по порядку отправки. */
export const chatMessagesQuery = (channelId: string) =>
  queryOptions({
    queryKey: ['chat', 'messages', channelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at, attachments:chat_attachments(id, storage_key, name, mime, size_bytes, kind, duration_sec), reactions:chat_reactions(user_id, emoji)')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGES_LIMIT)
      if (error) throw error
      return (data as unknown as ChatMessage[]).reverse()
    },
  })

export async function openChat(target: { kind: 'project'; projectId: string } | { kind: 'org'; projectId: string; orgId: string } | { kind: 'direct'; userId: string }): Promise<string> {
  const { data, error } = await supabase.rpc('chat_open', {
    p_project: target.kind === 'direct' ? (null as never) : target.projectId,
    p_kind: target.kind,
    p_org: target.kind === 'org' ? target.orgId : undefined,
    p_user: target.kind === 'direct' ? target.userId : undefined,
  })
  if (error) throw error
  return data as string
}

/** Файл, уже загруженный в хранилище, который прикрепляется к сообщению. */
export interface UploadedChatFile {
  storage_key: string
  name: string
  kind: AttachmentKind
  duration_sec?: number
}

export async function sendChatMessage(channelId: string, body: string, attachments: UploadedChatFile[] = []): Promise<void> {
  const { error } = await supabase.rpc('chat_send', { p_channel: channelId, p_body: body, p_attachments: attachments as never })
  if (error) throw error
}

/** Удаляет своё сообщение; файлы вложений убираются из хранилища следом (если не получится — остаются без ссылки и не видны). */
export async function deleteChatMessage(messageId: string): Promise<void> {
  const { data, error } = await supabase.rpc('chat_delete', { p_message: messageId })
  if (error) throw error
  const keys = (data as string[] | null) ?? []
  if (keys.length > 0) await supabase.storage.from(CHAT_BUCKET).remove(keys)
}

/** Поставить или снять реакцию. */
export async function reactChatMessage(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('chat_react', { p_message: messageId, p_emoji: emoji })
  if (error) throw error
}

/** Загружает файл в папку канала. Фото сжимаются; в ключе только ASCII (Storage отвергает кириллицу), имя сохраняется отдельно. */
export async function uploadChatFile(ctx: { tenantId: string; projectId: string | null; channelId: string }, original: File, extra?: { kind?: AttachmentKind; durationSec?: number }): Promise<UploadedChatFile> {
  const file = extra?.kind === 'voice' ? original : await compressImage(original)
  if (file.size > CHAT_MAX_FILE_BYTES) throw new Error('file_too_large')
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(file.name)?.[0] ?? ''
  const storageKey = `${ctx.tenantId}/${ctx.projectId ?? 'global'}/${ctx.channelId}/${uuid()}${ext.toLowerCase()}`
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(storageKey, file, { contentType: file.type || undefined })
  if (error) throw error
  const kind: AttachmentKind = extra?.kind ?? (file.type.startsWith('image/') ? 'image' : 'file')
  return { storage_key: storageKey, name: file.name, kind, ...(extra?.durationSec ? { duration_sec: extra.durationSec } : {}) }
}

/** Временная ссылка на файл чата (час); кэшируется на 50 минут. */
export const chatFileUrlQuery = (storageKey: string, download?: string) =>
  queryOptions({
    queryKey: ['chat', 'file-url', storageKey, download ?? null],
    staleTime: 50 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(storageKey, 3600, download ? { download } : undefined)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })

export async function markChatRead(channelId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_mark_read', { p_channel: channelId })
  if (error) throw error
}

export interface Presence {
  user_id: string
  seen_at: string
  online: boolean
}

export const PRESENCE_PING_MS = 30_000

/** Кто из видимых мне людей в проекте и когда был в сети; онлайн — отметка не старше 90 секунд (считает сервер). */
export const presenceQuery = queryOptions({
    queryKey: ['presence'],
    refetchInterval: PRESENCE_PING_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('chat_online')
      if (error) throw error
      return new Map((data as Presence[]).map((r) => [r.user_id, r]))
    },
  })

export async function pingPresence(): Promise<void> {
  const { error } = await supabase.rpc('presence_ping')
  if (error) throw error
}

export async function createChatGroup(name: string, userIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('chat_group_create', { p_name: name, p_users: userIds })
  if (error) throw error
  return data as string
}

export async function updateChatGroup(channelId: string, name: string, userIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('chat_group_update', { p_channel: channelId, p_name: name, p_users: userIds })
  if (error) throw error
}

export async function leaveChatGroup(channelId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_group_leave', { p_channel: channelId })
  if (error) throw error
}

export async function deleteChatGroup(channelId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_group_delete', { p_channel: channelId })
  if (error) throw error
}

/** Изменить текст своего сообщения. */
export async function editChatMessage(messageId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('chat_edit', { p_message: messageId, p_body: body })
  if (error) throw error
}
