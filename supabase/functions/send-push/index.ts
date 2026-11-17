// Воркер push-уведомлений: сообщения чата (message_id), заметки с площадки (comment_id) и уведомления из колокольчика (notification_id);
// по ним находит устройства получателей (chat_push_targets / field_note_push_targets / notification_push_targets) и шлёт Web Push.
// Задания берёт из очереди private.push_jobs (claim_push_jobs / finish_push_job): база будит воркер через pg_net с секретом
// в заголовке x-worker-secret сразу после события, а неудачное задание повторяет (миграция 20261023000131_push_queue.sql).
// Ключи VAPID: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (deploy/push-keys.sh создаёт пару), VAPID_SUBJECT — mailto: или адрес сайта.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { trData, trTitle } from '../_shared/i18n.ts'

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

type Db = ReturnType<typeof createClient>

/** Итог задания очереди: сколько ушло, на какие устройства повторить (временная ошибка), ошибка всего задания. */
interface Result {
  sent: number
  retry: string[]
  error?: string
}
const NONE: Result = { sent: 0, retry: [] }
const fail = (error: string): Result => ({ sent: 0, retry: [], error })

/** Устройства получателей; при повторе — только те, на которые в прошлый раз не ушло. */
function pick(targets: unknown, only: string[] | null): Target[] {
  const list = (targets ?? []) as Target[]
  return only ? list.filter((t) => only.includes(t.subscription_id)) : list
}

/**
 * Шлёт payload каждому устройству из списка. Подписки, которых больше нет (404/410), удаляет; временные отказы сервиса push
 * (429, 5xx, сеть, таймаут) возвращает на повтор; прочие ошибки (неверный ключ, слишком большой payload) повторять бесполезно.
 */
async function deliver(supabase: Db, list: Target[], build: (t: Target) => Payload | null): Promise<Result> {
  let sent = 0
  const dead: string[] = []
  const retry: string[] = []
  await Promise.all(
    list.map(async (t) => {
      const payload = build(t)
      if (!payload) return
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: 10_000,
        })
        sent += 1
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        // 404/410 — подписка больше не действует (приложение удалено, разрешение отозвано): убираем
        if (status === 404 || status === 410) dead.push(t.subscription_id)
        else {
          console.error('push failed', status, (e as Error).message)
          if (!status || status === 429 || status >= 500) retry.push(t.subscription_id)
        }
      }
    }),
  )
  if (dead.length > 0) await supabase.from('push_subscriptions').delete().in('id', dead)
  return { sent, retry }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function chatMessage(supabase: Db, messageId: string, only: string[] | null): Promise<Result> {
  const { data: targets, error } = await supabase.rpc('chat_push_targets', { p_message: messageId })
  if (error) return fail(error.message)
  const list = pick(targets, only)
  if (list.length === 0) return NONE

  const { data: row, error: msgError } = await supabase
    .from('chat_messages')
    .select(
      'id, body, author:users!chat_messages_author_id_fkey(full_name), attachments:chat_attachments(kind), channel:chat_channels(id, kind, name, project:projects(code), organization:organizations(name), discipline:disciplines(code, name))',
    )
    .eq('id', messageId)
    .maybeSingle()
  if (msgError) return fail(msgError.message)
  if (!row) return NONE // сообщение уже удалили
  const message = row as unknown as MessageRow

  return deliver(supabase, list, (t) => {
    const text = describe(message, asLang(t.locale))
    if (!text) return null
    return { title: text.title, body: text.body, tag: `chat-${message.channel!.id}`, url: `/chat?channel=${message.channel!.id}` }
  })
}

/** Фото лежит в закрытом хранилище: даём телефону ссылку со сроком жизни, равным времени хранения push (сутки). */
async function signedImage(supabase: Db, key: string | null): Promise<string | undefined> {
  if (!key || !PUBLIC_API) return undefined
  const { data: signed } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(key, 24 * 3600)
  const at = signed?.signedUrl.indexOf('/object/sign/') ?? -1
  return signed && at >= 0 ? `${PUBLIC_API}/storage/v1${signed.signedUrl.slice(at)}` : undefined
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
async function fieldNote(supabase: Db, commentId: string, only: string[] | null): Promise<Result> {
  const { data: targets, error } = await supabase.rpc('field_note_push_targets', { p_comment: commentId })
  if (error) return fail(error.message)
  const list = pick(targets, only)
  if (list.length === 0) return NONE

  const { data: infoRows, error: infoError } = await supabase.rpc('field_note_push_info', { p_comment: commentId })
  const info = ((infoRows ?? []) as NoteInfo[])[0]
  if (infoError) return fail(infoError.message)
  if (!info) return NONE // заметку уже удалили

  const image = await signedImage(supabase, info.photo_key)

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
      url: `/projects/${info.project_code}/note/${commentId}`,
      image,
    }
  })
}

interface NotificationRow {
  id: string
  title: string
  body: string | null
  event_type: string
  entity_type: string | null
  entity_id: string | null
  payload: { link?: string; project_code?: string; entity_key?: string; last_text?: string } | null
}

/** Куда ведёт уведомление — те же правила, что у окна уведомления в приложении и списка «Уведомления». */
function notificationUrl(n: NotificationRow): string {
  const p = n.payload ?? {}
  if (p.link) return p.link
  const code = p.project_code
  if (code && n.entity_type === 'task' && p.entity_key) return `/projects/${code}/tasks/${p.entity_key}`
  if (code && n.entity_type === 'document' && n.entity_id) return `/projects/${code}/document/${n.entity_id}`
  if (code && n.entity_type === 'meeting' && n.entity_id) return `/projects/${code}/meeting/${n.entity_id}`
  if (code && n.entity_type === 'field_note' && n.entity_id) return `/projects/${code}/note/${n.entity_id}`
  if (code && n.entity_type === 'location' && p.entity_key) return `/projects/${code}/locations/${p.entity_key}`
  if (code && n.entity_type === 'signal' && n.entity_id) return `/projects/${code}/signals?s=${n.entity_id}`
  return '/inbox?tab=all'
}

/**
 * Уведомление из колокольчика (назначение, упоминание, изменения в задаче, на которую подписан, заметка, напоминание): push на все устройства получателя.
 * Тот же tag у обновлённого (сгруппированного) уведомления заменяет прежнее на устройстве. Тексты уведомлений хранятся в базе на русском
 * и переводятся на язык владельца устройства (users.locale) по словарю сайта.
 */
async function appNotification(supabase: Db, notificationId: string, only: string[] | null): Promise<Result> {
  const { data: targets, error } = await supabase.rpc('notification_push_targets', { p_notification: notificationId })
  if (error) return fail(error.message)
  const list = pick(targets, only)
  if (list.length === 0) return NONE

  const { data: row, error: rowError } = await supabase
    .from('notifications')
    .select('id, title, body, event_type, entity_type, entity_id, payload')
    .eq('id', notificationId)
    .maybeSingle()
  if (rowError) return fail(rowError.message)
  if (!row) return NONE // уведомление уже удалили
  const n = row as unknown as NotificationRow

  // у сгруппированного уведомления тело — сводка, а свежий текст события лежит в last_text
  const text = (n.payload?.last_text ?? n.body ?? '').trim()
  // уведомление о заметке (адресована вам, комментарий к ней) показывает её первое фото
  let image: string | undefined
  if (n.entity_type === 'field_note' && n.entity_id) {
    const { data: infoRows } = await supabase.rpc('field_note_push_info', { p_comment: n.entity_id })
    image = await signedImage(supabase, ((infoRows ?? []) as NoteInfo[])[0]?.photo_key ?? null)
  }
  return deliver(supabase, list, (t) => {
    const lang = asLang(t.locale)
    const translated = trData(text, lang)
    const body = translated.length > 160 ? `${translated.slice(0, 160)}…` : translated
    return { title: trTitle(n.title, lang), body, tag: `n-${n.id}`, url: notificationUrl(n), image }
  })
}

interface Job {
  id: number
  kind: 'notification' | 'message' | 'note'
  ref_id: string
  only_subs: string[] | null
}

async function run(supabase: Db, job: Job): Promise<Result> {
  if (job.kind === 'notification') return appNotification(supabase, job.ref_id, job.only_subs)
  if (job.kind === 'note') return fieldNote(supabase, job.ref_id, job.only_subs)
  return chatMessage(supabase, job.ref_id, job.only_subs)
}

if (PUBLIC_KEY && PRIVATE_KEY) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/**
 * База будит воркер (триггер сразу после события, сторож — если задание ждёт дольше положенного); воркер забирает из очереди
 * private.push_jobs всё, что пора отправить, рассылает параллельно и отмечает итог каждого задания (неудачное база повторит).
 */
Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })
  if (!PUBLIC_KEY || !PRIVATE_KEY) return json({ error: 'VAPID keys are not configured' }, 500)

  let sent = 0
  let jobsDone = 0
  // несколько кругов: задания, пришедшие, пока шла рассылка, уходят тем же вызовом
  for (let round = 0; round < 5; round++) {
    const { data, error } = await supabase.rpc('claim_push_jobs', { p_limit: 50 })
    if (error) return json({ error: error.message }, 500)
    const jobs = (data ?? []) as Job[]
    if (jobs.length === 0) break
    await Promise.all(
      jobs.map(async (job) => {
        let r: Result
        try {
          r = await run(supabase, job)
        } catch (e) {
          r = fail(e instanceof Error ? e.message : String(e))
        }
        if (r.error) console.error('push job failed', job.kind, job.ref_id, r.error)
        const { error: finishError } = await supabase.rpc('finish_push_job', { p_id: job.id, p_sent: r.sent, p_retry: r.retry, p_error: r.error ?? null })
        if (finishError) console.error('finish_push_job', finishError.message)
        sent += r.sent
        jobsDone += 1
      }),
    )
  }
  return json({ jobs: jobsDone, sent })
})
