// Воркер push-уведомлений о сообщениях чата: по message_id находит устройства получателей (chat_push_targets) и шлёт Web Push.
// Вызывается из БД (триггер на chat_messages → pg_net) с секретом в заголовке x-worker-secret.
// Ключи VAPID: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (deploy/push-keys.sh создаёт пару), VAPID_SUBJECT — mailto: или адрес сайта.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SECRET = Deno.env.get('EMAIL_WORKER_SECRET') ?? 'dev-worker-secret'
const PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? Deno.env.get('APP_URL') ?? 'mailto:no-reply@buildos.local'

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

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })
  if (!PUBLIC_KEY || !PRIVATE_KEY) return new Response(JSON.stringify({ error: 'VAPID keys are not configured' }), { status: 500 })

  let messageId: string | undefined
  try {
    messageId = ((await req.json()) as { message_id?: string }).message_id
  } catch {
    // тело не JSON
  }
  if (!messageId) return new Response(JSON.stringify({ error: 'message_id required' }), { status: 400 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: targets, error } = await supabase.rpc('chat_push_targets', { p_message: messageId })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  const list = (targets ?? []) as Target[]
  if (list.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } })

  const { data: row, error: msgError } = await supabase
    .from('chat_messages')
    .select(
      'id, body, author:users!chat_messages_author_id_fkey(full_name), attachments:chat_attachments(kind), channel:chat_channels(id, kind, name, project:projects(code), organization:organizations(name), discipline:disciplines(code, name))',
    )
    .eq('id', messageId)
    .maybeSingle()
  if (msgError || !row) return new Response(JSON.stringify({ error: msgError?.message ?? 'message not found' }), { status: msgError ? 500 : 404 })
  const message = row as unknown as MessageRow

  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)

  let sent = 0
  const dead: string[] = []
  await Promise.all(
    list.map(async (t) => {
      const text = describe(message, asLang(t.locale))
      if (!text) return
      const payload = JSON.stringify({
        title: text.title,
        body: text.body,
        tag: `chat-${message.channel!.id}`,
        url: `/chat?channel=${message.channel!.id}`,
      })
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: 24 * 3600, urgency: 'high' })
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

  return new Response(JSON.stringify({ sent, removed: dead.length }), { headers: { 'Content-Type': 'application/json' } })
})
