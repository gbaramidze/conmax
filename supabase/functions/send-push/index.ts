// Воркер push-уведомлений о сообщениях чата: по message_id находит устройства получателей (chat_push_targets) и шлёт Web Push.
// Вызывается из БД (триггер на chat_messages → pg_net) с секретом в заголовке x-worker-secret.
// Ключи VAPID: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (deploy/push-keys.sh создаёт пару), VAPID_SUBJECT — mailto: или адрес сайта.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SECRET = Deno.env.get('EMAIL_WORKER_SECRET') ?? 'dev-worker-secret'
const PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? Deno.env.get('APP_URL') ?? 'mailto:no-reply@buildos.local'
// Адрес Supabase снаружи (телефон тянет фото для уведомления сам, внутренний SUPABASE_URL ему не виден): сайт отдаёт /supabase/* шлюзу
const PUBLIC_API = (Deno.env.get('PUBLIC_SUPABASE_URL') ?? (Deno.env.get('APP_URL') ? `${Deno.env.get('APP_URL')!.replace(/\/$/, '')}/supabase` : '')).replace(/\/$/, '')
const FILES_BUCKET = 'files'

type Lang = 'ru' | 'ka' | 'en'
// Тексты те же, что в словарях сайта (locales/<язык>/src.json): пользователь видит push на своём языке
const T: Record<string, Record<Lang, string>> = {
  team: { ru: 'Вся команда', ka: 'მთელი გუნდი', en: 'Whole team' },
  member: { ru: 'Участник', ka: 'მონაწილე', en: 'Participant' },
  org: { ru: 'Организация', ka: 'ორგანიზაცია', en: 'Organization' },
  discipline: { ru: 'Направление', ka: 'მიმართულება', en: 'Discipline' },
  group: { ru: 'Группа', ka: 'ჯგუფი', en: 'Group' },
  voice: { ru: 'Голосовое сообщение', ka: 'ხმოვანი შეტყობინება', en: 'Voice message' },
  image: { ru: 'Фото', ka: 'ფოტო', en: 'Photo' },
  file: { ru: 'Файл', ka: 'ფაილი', en: 'File' },
  note: { ru: 'Новая заметка', ka: 'ახალი შენიშვნა', en: 'New note' },
}
const tr = (key: string, lang: Lang) => T[key][lang]
const asLang = (l: string | null): Lang => (l === 'ka' || l === 'en' ? l : 'ru')

interface Target {
  subscription_id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  locale: string | null
}
interface MessageRow {
  id: string
  body: string
  author: { full_name: string } | null
  attachments: { kind: string }[]
  channel: {
    id: string
    kind: 'project' | 'discipline' | 'org' | 'group' | 'direct'
    name: string | null
    project: { code: string } | null
    organization: { name: string } | null
    discipline: { code: string; name: string } | null
  } | null
}

function describe(m: MessageRow, lang: Lang): { title: string; body: string } | null {
  const c = m.channel
  if (!c) return null
  const who = m.author?.full_name ?? tr('member', lang)
  const where = c.project?.code ? ` · ${c.project.code}` : ''
  const title =
    c.kind === 'direct'
      ? who
      : c.kind === 'project'
        ? `${tr('team', lang)}${where}`
        : c.kind === 'org'
          ? `${c.organization?.name ?? tr('org', lang)}${where}`
          : c.kind === 'discipline'
            ? `${c.discipline?.code ?? ''} · ${c.discipline?.name ?? tr('discipline', lang)}${where}`
            : (c.name ?? tr('group', lang))
  let preview = m.body.trim()
  if (!preview) {
    const kind = m.attachments[0]?.kind
    preview = kind === 'voice' ? `🎤 ${tr('voice', lang)}` : kind === 'image' ? `📷 ${tr('image', lang)}` : `📎 ${tr('file', lang)}`
  }
  const text = preview.length > 140 ? `${preview.slice(0, 140)}…` : preview
  return { title, body: c.kind === 'direct' ? text : `${who.split(' ')[0]}: ${text}` }
}

interface Payload {
  title: string
  body: string
  tag: string
  url: string
  image?: string
}

/** Шлёт payload каждому устройству из списка; подписки, которых больше нет (404/410), удаляет. */
async function deliver(supabase: ReturnType<typeof createClient>, list: Target[], build: (t: Target) => Payload | null): Promise<Response> {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
  let sent = 0
  const dead: string[] = []
  await Promise.all(
    list.map(async (t) => {
      const payload = build(t)
      if (!payload) return
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' })
        sent += 1
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        // 404/410 — подписка больше не действует (приложение удалено, разрешение отозвано): убираем
        if (status === 404 || status === 410) dead.push(t.subscription_id)
        else console.error('push failed', status, (e as Error).message)
      }
    }),
  )
  if (dead.length > 0) await supabase.from('push_subscriptions').delete().in('id', dead)
  return json({ sent, removed: dead.length })
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function chatMessage(supabase: ReturnType<typeof createClient>, messageId: string): Promise<Response> {
  const { data: targets, error } = await supabase.rpc('chat_push_targets', { p_message: messageId })
  if (error) return json({ error: error.message }, 500)
  const list = (targets ?? []) as Target[]
  if (list.length === 0) return json({ sent: 0 })

  const { data: row, error: msgError } = await supabase
    .from('chat_messages')
    .select(
      'id, body, author:users!chat_messages_author_id_fkey(full_name), attachments:chat_attachments(kind), channel:chat_channels(id, kind, name, project:projects(code), organization:organizations(name), discipline:disciplines(code, name))',
    )
    .eq('id', messageId)
    .maybeSingle()
  if (msgError || !row) return json({ error: msgError?.message ?? 'message not found' }, msgError ? 500 : 404)
  const message = row as unknown as MessageRow

  return deliver(supabase, list, (t) => {
    const text = describe(message, asLang(t.locale))
    if (!text) return null
    return { title: text.title, body: text.body, tag: `chat-${message.channel!.id}`, url: `/chat?channel=${message.channel!.id}` }
  })
}

interface NoteInfo {
  project_code: string
  location_path: string
  location_label: string | null
  author_name: string | null
  body_text: string
  photo_count: number
  photo_key: string | null
}

/** Заметка с площадки: «Новая заметка · CODE», этаж/помещение, автор и текст; первое фото — картинкой в самом уведомлении. */
async function fieldNote(supabase: ReturnType<typeof createClient>, commentId: string): Promise<Response> {
  const { data: targets, error } = await supabase.rpc('field_note_push_targets', { p_comment: commentId })
  if (error) return json({ error: error.message }, 500)
  const list = (targets ?? []) as Target[]
  if (list.length === 0) return json({ sent: 0 })

  const { data: infoRows, error: infoError } = await supabase.rpc('field_note_push_info', { p_comment: commentId })
  const info = ((infoRows ?? []) as NoteInfo[])[0]
  if (infoError || !info) return json({ error: infoError?.message ?? 'note not found' }, infoError ? 500 : 404)

  // Фото лежит в закрытом хранилище: даём телефону ссылку со сроком жизни, равным времени хранения push (сутки)
  let image: string | undefined
  if (info.photo_key && PUBLIC_API) {
    const { data: signed } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(info.photo_key, 24 * 3600)
    const at = signed?.signedUrl.indexOf('/object/sign/') ?? -1
    if (signed && at >= 0) image = `${PUBLIC_API}/storage/v1${signed.signedUrl.slice(at)}`
  }

  return deliver(supabase, list, (t) => {
    const lang = asLang(t.locale)
    const who = info.author_name?.split(' ')[0] ?? tr('member', lang)
    const text = info.body_text.trim()
    const preview = text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : `📷 ${tr('image', lang)}`
    const photos = info.photo_count > 1 ? ` (📷 ${info.photo_count})` : ''
    const where = info.location_label ? `${info.location_label}\n` : ''
    return {
      title: `${tr('note', lang)} · ${info.project_code}`,
      body: `${where}${who}: ${preview}${photos}`,
      tag: `note-${commentId}`,
      url: `/projects/${info.project_code}/locations/${info.location_path}`,
      image,
    }
  })
}

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })
  if (!PUBLIC_KEY || !PRIVATE_KEY) return json({ error: 'VAPID keys are not configured' }, 500)

  let input: { message_id?: string; comment_id?: string } = {}
  try {
    input = (await req.json()) as typeof input
  } catch {
    // тело не JSON
  }
  if (!input.message_id && !input.comment_id) return json({ error: 'message_id or comment_id required' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  return input.comment_id ? fieldNote(supabase, input.comment_id) : chatMessage(supabase, input.message_id!)
})
