// Личная почта Outlook (Microsoft 365): подключение пользователя и чтение писем через Microsoft Graph.
// Письма не копируются в базу: функция ходит в Graph от имени пользователя, токены лежат зашифрованными (AES-GCM) в mail_accounts.
// Права запроса: только чтение (Mail.Read). Работает под JWT пользователя; таблица токенов доступна только service_role.
//
// Секреты функций (supabase/functions/.env, на сервере .env.functions):
//   MS_CLIENT_ID, MS_CLIENT_SECRET — приложение, зарегистрированное в Microsoft Entra (инструкция: deploy/outlook-setup.md)
//   MS_AUTHORITY_TENANT — 'organizations' (рабочие и учебные учётные записи, по умолчанию), 'common' или GUID каталога
//   MAIL_TOKEN_KEY — 32 случайных байта в base64 (openssl rand -base64 32); смена ключа разлогинивает всех из почты
import { createClient } from 'npm:@supabase/supabase-js@2'
import { inBackground } from '../_shared/background.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
const SCOPES = 'offline_access openid profile User.Read Mail.Read'
const STATE_TTL_MS = 15 * 60_000
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const CLIENT_ID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''
const AUTHORITY = Deno.env.get('MS_AUTHORITY_TENANT') || 'organizations'
const TOKEN_KEY_B64 = Deno.env.get('MAIL_TOKEN_KEY') ?? ''
// Опрос ящиков для уведомлений о новых письмах: pg_cron → pg_net с этим секретом (тот же, что у остальных воркеров)
const WORKER_SECRET = Deno.env.get('EMAIL_WORKER_SECRET') ?? 'dev-worker-secret'
const TOKEN_URL = `https://login.microsoftonline.com/${AUTHORITY}/oauth2/v2.0/token`
const AUTHORIZE_URL = `https://login.microsoftonline.com/${AUTHORITY}/oauth2/v2.0/authorize`

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// ---------------------------------------------------------------------------
// Шифрование: AES-GCM, ключ из MAIL_TOKEN_KEY; формат v1.<iv>.<шифртекст> (base64url)
// ---------------------------------------------------------------------------
const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64u = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

let keyPromise: Promise<CryptoKey> | null = null
function aesKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const raw = Uint8Array.from(atob(TOKEN_KEY_B64), (c) => c.charCodeAt(0))
    if (raw.length !== 32) throw new Error('MAIL_TOKEN_KEY must be 32 bytes in base64')
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  })()
  return keyPromise
}
async function seal(text: string, aad = ''): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const additionalData = new TextEncoder().encode(aad)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, await aesKey(), new TextEncoder().encode(text))
  return `v1.${b64u(iv)}.${b64u(ct)}`
}
async function open(token: string, aad = ''): Promise<string> {
  const [v, iv, ct] = token.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('bad_token_format')
  const additionalData = new TextEncoder().encode(aad)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv), additionalData }, await aesKey(), unb64u(ct))
  return new TextDecoder().decode(pt)
}

// «state» не хранится в базе: зашифрованная строка с пользователем, проверочным кодом PKCE и сроком.
// К шифртексту привязан user_id (AAD), поэтому чужой state не подойдёт.
interface StatePayload {
  u: string
  v: string
  r: string
  exp: number
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

class MailError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

interface AccountRow {
  user_id: string
  tenant_id: string
  refresh_token_enc: string
  access_token_enc: string | null
  access_expires_at: string | null
}

// Токен доступа: из кэша в строке или через refresh_token. Microsoft выдаёт новый refresh_token — его сохраняем.
async function accessToken(admin: ReturnType<typeof createClient>, acc: AccountRow): Promise<string> {
  const aad = acc.user_id
  if (acc.access_token_enc && acc.access_expires_at && new Date(acc.access_expires_at).getTime() - Date.now() > 120_000) {
    try {
      return await open(acc.access_token_enc, aad)
    } catch {
      /* ключ сменили или запись повреждена: обновим токен ниже */
    }
  }
  let refresh: string
  try {
    refresh = await open(acc.refresh_token_enc, aad)
  } catch {
    await admin.from('mail_accounts').update({ last_error: 'Не удалось расшифровать токен. Подключите почту заново.' }).eq('user_id', acc.user_id)
    throw new MailError(401, 'reconnect_required')
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh,
      scope: SCOPES,
    }),
  })
  const tok = await res.json().catch(() => ({}))
  if (!res.ok || !tok.access_token) {
    const err = String(tok.error ?? res.status)
    // invalid_grant: отозван доступ, сменён пароль или истёк срок — пользователю нужно подключиться заново
    const reconnect = err === 'invalid_grant' || err === 'interaction_required'
    await admin
      .from('mail_accounts')
      .update({ last_error: reconnect ? 'Доступ к почте отозван или истёк. Подключите почту заново.' : `Microsoft: ${String(tok.error_description ?? err).slice(0, 300)}` })
      .eq('user_id', acc.user_id)
    throw new MailError(reconnect ? 401 : 502, reconnect ? 'reconnect_required' : 'token_refresh_failed')
  }
  const expires = new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString()
  await admin
    .from('mail_accounts')
    .update({
      access_token_enc: await seal(tok.access_token, aad),
      access_expires_at: expires,
      ...(tok.refresh_token ? { refresh_token_enc: await seal(tok.refresh_token, aad) } : {}),
      last_ok_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', acc.user_id)
  return tok.access_token as string
}

async function graph(token: string, path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('https://') ? path : `${GRAPH}${path}`
  // токен отдаём только Graph: nextLink и пути приходят от клиента, поэтому проверяем хост
  if (!url.startsWith(`${GRAPH}/me`)) throw new MailError(400, 'invalid_link')
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } })
  if (res.status === 429) throw new MailError(429, 'too_many_requests')
  if (res.status === 401 || res.status === 403) throw new MailError(401, 'reconnect_required')
  if (res.status === 404) throw new MailError(404, 'not_found')
  if (!res.ok) throw new MailError(502, 'graph_failed')
  return res
}

const pickAddr = (r: { emailAddress?: { name?: string; address?: string } } | undefined) => ({
  name: r?.emailAddress?.name ?? '',
  address: r?.emailAddress?.address ?? '',
})

const LIST_SELECT = 'id,conversationId,subject,from,toRecipients,receivedDateTime,isRead,isDraft,hasAttachments,bodyPreview,importance,flag'

/**
 * Сколько писем в каждой переписке по всем папкам (ваши ответы лежат в «Отправленных»), без черновиков.
 * Одним-двумя запросами на страницу списка: условия «conversationId eq …» через «or» пачками по 15.
 * Не получилось (Graph занят) — считаем по одному письму: строка просто не станет веткой.
 */
async function threadCounts(token: string, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const unique = [...new Set(ids)].filter((c) => /^[A-Za-z0-9_=\-]+$/.test(c))
  for (let i = 0; i < unique.length; i += 15) {
    const chunk = unique.slice(i, i + 15)
    const q = new URLSearchParams({
      $filter: chunk.map((c) => `conversationId eq '${c}'`).join(' or '),
      $select: 'conversationId,isDraft',
      $top: '500',
    })
    try {
      const data = await (await graph(token, `/me/messages?${q}`)).json()
      for (const m of (data.value ?? []) as { conversationId?: string; isDraft?: boolean }[]) {
        if (!m.conversationId || m.isDraft) continue
        counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1)
      }
    } catch (e) {
      console.error('mail thread counts failed', e instanceof Error ? e.message : e)
    }
  }
  return counts
}

/** Строка списка: как в Outlook — с названиями вложений (без содержимого) и признаком приглашения. */
function listItem(m: Record<string, unknown>) {
  const files = ((m.attachments as { name?: string; contentType?: string; isInline?: boolean; size?: number }[] | undefined) ?? [])
    .filter((a) => !a.isInline)
    .slice(0, 3)
    .map((a) => ({ name: String(a.name ?? ''), size: Number(a.size ?? 0) }))
  return {
    id: m.id,
    conversation_id: (m.conversationId as string | undefined) ?? null,
    subject: m.subject ?? '',
    from: pickAddr(m.from as never),
    to: ((m.toRecipients as unknown[]) ?? []).slice(0, 5).map((r) => pickAddr(r as never)),
    received_at: m.receivedDateTime,
    is_read: !!m.isRead,
    has_attachments: !!m.hasAttachments,
    files,
    preview: String(m.bodyPreview ?? '').slice(0, 200),
    important: m.importance === 'high',
    flagged: (m.flag as { flagStatus?: string } | undefined)?.flagStatus === 'flagged',
    meeting: meetingKind(m),
  }
}

// Класс письма MAPI (PidTagMessageClass): по нему видно приглашение на встречу и отмену, не открывая письмо.
// IPM.Schedule.Meeting.Request — приглашение (и его обновление), IPM.Schedule.Meeting.Canceled — отмена.
const CLASS_PROP = 'String 0x001A'
const CLASS_EXPAND = `singleValueExtendedProperties($filter=id eq '${CLASS_PROP}')`
// Список: класс письма + названия вложений (без содержимого — только имя, размер и признак «встроено в текст»)
const LIST_EXPAND = `${CLASS_EXPAND},attachments($select=name,contentType,size,isInline)`

function meetingKind(m: Record<string, unknown>): 'request' | 'cancel' | null {
  // свойство запрошено одно (фильтр в $expand); Graph возвращает его id в сокращённом виде («String 0x1a»)
  const props = (m.singleValueExtendedProperties as { id?: string; value?: string }[] | undefined) ?? []
  const cls = props.map((p) => String(p.value ?? '')).join(' ')
  if (/IPM\.Schedule\.Meeting\.Request/i.test(cls)) return 'request'
  if (/IPM\.Schedule\.Meeting\.Canceled/i.test(cls)) return 'cancel'
  return null
}

export interface MeetingInfo {
  kind: 'request' | 'cancel'
  uid: string
  subject: string
  start: string // ISO, UTC
  end: string | null
  all_day: boolean
  location: string
  organizer: string
}

const utc = (v: { dateTime?: string; timeZone?: string } | undefined) => {
  if (!v?.dateTime) return null
  // Graph отдаёт время приглашения в UTC без суффикса зоны
  const s = /[zZ]|[+-]\d\d:\d\d$/.test(v.dateTime) ? v.dateTime : `${v.dateTime}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// PidLidCleanGlobalObjectId — идентификатор встречи, общий для приглашения, его обновлений и отмены.
// Читается с правом Mail.Read (в отличие от связанного события календаря, которому нужен Calendars.Read).
const GOID_PROP = 'Binary {6ED8DA90-450B-101B-98DA-00AA003F1305} Id 0x0023'

const DAY = 86_400_000
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const HORIZON_DAYS = 183
const MAX_OCCURRENCES = 60

interface Recurrence {
  pattern?: { type?: string; interval?: number; daysOfWeek?: string[]; dayOfMonth?: number }
  range?: { type?: string; endDate?: string; numberOfOccurrences?: number }
}

/**
 * Даты повторов серии (UTC-начала) на полгода вперёд: ежедневно, еженедельно по дням недели, ежемесячно в число.
 * Остальные шаблоны (например, «вторая среда месяца») — только первая встреча.
 */
function occurrences(startIso: string, rec: Recurrence | null | undefined): string[] {
  const first = new Date(startIso).getTime()
  const p = rec?.pattern
  if (!p?.type) return [startIso]
  const step = Math.max(1, Number(p.interval ?? 1))
  const until = Math.min(
    Date.now() + HORIZON_DAYS * DAY,
    rec?.range?.type === 'endDate' && rec.range.endDate ? new Date(`${rec.range.endDate}T23:59:59Z`).getTime() : Infinity,
  )
  const limit = rec?.range?.type === 'numbered' ? Math.max(1, Number(rec.range.numberOfOccurrences ?? 1)) : Infinity
  const out: number[] = []
  let n = 0
  // false — пора остановиться; дни первой недели раньше самой первой встречи просто пропускаем
  const push = (t: number) => {
    if (t < first) return true
    if (t > until || n >= limit) return false
    n++
    // прошедшие повторы считаем (для «N раз»), но не добавляем
    if (t >= Date.now() - DAY) out.push(t)
    return out.length < MAX_OCCURRENCES
  }
  if (p.type === 'daily') {
    for (let t = first; t <= until && n < limit; t += step * DAY) if (!push(t)) break
  } else if (p.type === 'weekly') {
    const days = new Set((p.daysOfWeek ?? []).map((d) => WEEKDAYS.indexOf(d.toLowerCase())).filter((d) => d >= 0))
    if (days.size === 0) days.add(new Date(first).getUTCDay())
    const weekStart = first - new Date(first).getUTCDay() * DAY
    outer: for (let w = weekStart; w <= until && n < limit; w += step * 7 * DAY) {
      for (let d = 0; d < 7; d++) if (days.has(d) && !push(w + d * DAY)) break outer
    }
  } else if (p.type === 'absoluteMonthly') {
    const s = new Date(first)
    for (let k = 0; n < limit; k += step) {
      const t = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, p.dayOfMonth ?? s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes())
      if (t > until) break
      if (!push(t)) break
    }
  } else {
    return [startIso]
  }
  return out.map((t) => new Date(t).toISOString())
}

/**
 * Приглашение или отмена → записи для календаря. Ключ записи — «идентификатор встречи#дата», поэтому обновление
 * переносит запись, отмена одной встречи убирает её дату, отмена серии (с повторением) — все даты («#*»).
 */
async function meetingInfo(token: string, id: string, kind: 'request' | 'cancel'): Promise<MeetingInfo[]> {
  const q = new URLSearchParams({
    $select: 'id,subject,from,conversationId,startDateTime,endDateTime,location,isAllDay,recurrence',
    $expand: `singleValueExtendedProperties($filter=id eq '${GOID_PROP}')`,
  })
  let m: Record<string, any>
  try {
    m = await (await graph(token, `/me/messages/${id}?${q}`, { headers: { Prefer: 'outlook.timezone="UTC"' } })).json()
  } catch (e) {
    // $select со свойствами приглашения Graph может не принять у обычного письма — тогда берём письмо целиком
    if (!(e instanceof MailError) || e.code !== 'graph_failed') throw e
    m = await (await graph(token, `/me/messages/${id}?$expand=${encodeURIComponent(`singleValueExtendedProperties($filter=id eq '${GOID_PROP}')`)}`, {
      headers: { Prefer: 'outlook.timezone="UTC"' },
    })).json()
  }
  const start = utc(m.startDateTime)
  if (!start) return []
  const goid = String(((m.singleValueExtendedProperties ?? []) as { value?: string }[])[0]?.value ?? m.conversationId ?? id).slice(0, 280)
  const end = utc(m.endDateTime)
  const length = end ? new Date(end).getTime() - new Date(start).getTime() : null
  const base = {
    kind,
    subject: String(m.subject ?? '').replace(/^\s*(Canceled|Cancelled|Отменено|Отменена|გაუქმებულია)\s*:\s*/i, '').slice(0, 200),
    all_day: !!m.isAllDay,
    location: String(m.location?.displayName ?? '').slice(0, 200),
    organizer: String(m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? '').slice(0, 120),
  }
  const rec = m.recurrence as Recurrence | null
  if (kind === 'cancel' && rec?.pattern?.type) return [{ ...base, uid: `${goid}#*`, start, end }]
  return occurrences(start, rec).map((s) => ({
    ...base,
    uid: `${goid}#${s.slice(0, 10)}`,
    start: s,
    end: length !== null ? new Date(new Date(s).getTime() + length).toISOString() : null,
  }))
}

// Быстрые фильтры списка. Graph требует, чтобы поле сортировки стояло в $filter первым, поэтому дата — всегда в начале.
const FILTERS: Record<string, string> = {
  unread: 'isRead eq false',
  attachments: 'hasAttachments eq true',
  important: "importance eq 'high'",
  flagged: "flag/flagStatus eq 'flagged'",
}

// ---------------------------------------------------------------------------
// Опрос: новые письма во «Входящих» → уведомления (public.mail_notify). Раз в минуту из pg_cron.
// ---------------------------------------------------------------------------
interface PollRow extends AccountRow {
  notify_cursor: string | null
  calendar_synced_at: string | null
}

/** Приглашения и отмены из списка писем → личный календарь. Ошибка одной встречи не мешает остальным. */
async function syncMeetings(admin: ReturnType<typeof createClient>, token: string, userId: string, list: Record<string, unknown>[]) {
  const infos: MeetingInfo[] = []
  // по одному: Exchange пускает к ящику не больше 4 запросов одновременно
  for (const m of list) {
    const kind = meetingKind(m)
    if (!kind) continue
    try {
      infos.push(...(await meetingInfo(token, String(m.id), kind)))
    } catch {
      /* письмо удалили или Graph занят — разберём при открытии */
    }
  }
  // по времени получения (список — от новых к старым): отмена после приглашения должна победить
  if (infos.length) await admin.rpc('mail_calendar_apply', { p_user: userId, p_items: infos.reverse() })
  return infos.length
}

/** Один раз после подключения: приглашения за 30 дней (принятые Outlook убирает в «Удалённые»). */
async function backfillMeetings(admin: ReturnType<typeof createClient>, token: string, userId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  for (const folder of ['inbox', 'deleteditems']) {
    const q = new URLSearchParams({
      $filter: `receivedDateTime ge ${since}`,
      $orderby: 'receivedDateTime desc',
      $top: '100',
      $select: 'id,receivedDateTime',
      $expand: CLASS_EXPAND,
    })
    const list = ((await (await graph(token, `/me/mailFolders/${folder}/messages?${q}`)).json()).value ?? []) as Record<string, unknown>[]
    await syncMeetings(admin, token, userId, list)
  }
  await admin.from('mail_accounts').update({ calendar_synced_at: new Date().toISOString() }).eq('user_id', userId)
}

async function pollOne(admin: ReturnType<typeof createClient>, acc: PollRow): Promise<number> {
  // первый опрос: просто запоминаем «сейчас», старые письма не уведомляем
  if (!acc.notify_cursor) {
    await admin.rpc('mail_notify', { p_user: acc.user_id, p_cursor: new Date().toISOString(), p_items: [] })
    return 0
  }
  const token = await accessToken(admin, acc)
  if (!acc.calendar_synced_at) await backfillMeetings(admin, token, acc.user_id)
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${new Date(acc.notify_cursor).toISOString()}`,
    $orderby: 'receivedDateTime desc',
    $top: '25',
    $select: 'id,subject,from,receivedDateTime,isRead',
    $expand: CLASS_EXPAND,
  })
  const res = await graph(token, `/me/mailFolders/inbox/messages?${q}`)
  const list = ((await res.json()).value ?? []) as Record<string, unknown>[]
  // новые приглашения — в календарь (повтор того же письма только обновит запись)
  await syncMeetings(admin, token, acc.user_id, list)
  let cursor = new Date(acc.notify_cursor).getTime()
  for (const m of list) cursor = Math.max(cursor, new Date(String(m.receivedDateTime)).getTime() || 0)
  const items = list
    .filter((m) => !m.isRead)
    .map((m) => {
      const from = pickAddr(m.from as never)
      return { id: m.id, subject: String(m.subject ?? '').slice(0, 250), from_name: from.name, from_address: from.address, received_at: m.receivedDateTime }
    })
  const { data, error } = await admin.rpc('mail_notify', { p_user: acc.user_id, p_cursor: new Date(cursor).toISOString(), p_items: items })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

async function pollAll(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from('mail_accounts')
    .select('user_id, tenant_id, refresh_token_enc, access_token_enc, access_expires_at, notify_cursor, calendar_synced_at')
    .order('notify_checked_at', { ascending: true, nullsFirst: true })
    .limit(500)
  if (error) throw new Error(error.message)
  let notified = 0
  let failed = 0
  const rows = (data ?? []) as PollRow[]
  // по 5 ящиков параллельно: Graph ограничивает частоту на пользователя, а не на приложение
  for (let i = 0; i < rows.length; i += 5) {
    const results = await Promise.allSettled(rows.slice(i, i + 5).map((r) => pollOne(admin, r)))
    for (const r of results) {
      if (r.status === 'fulfilled') notified += r.value
      else failed++
    }
  }
  return { accounts: rows.length, notified, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  if (!CLIENT_ID || !CLIENT_SECRET || !TOKEN_KEY_B64) return json(503, { error: 'not_configured' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // фоновый опрос из базы: без пользователя, по секрету воркеров
  const workerSecret = req.headers.get('x-worker-secret')
  if (workerSecret !== null) {
    if (workerSecret !== WORKER_SECRET) return json(403, { error: 'forbidden' })
    return inBackground('mail-poll', () => pollAll(admin))
  }

  const { data: userData } = await caller.auth.getUser()
  const user = userData.user
  if (!user) return json(401, { error: 'unauthorized' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }
  const action = String(body.action ?? '')

  try {
    const { data: me } = await caller.from('users').select('tenant_id, is_external').eq('id', user.id).maybeSingle()
    if (!me) return json(403, { error: 'forbidden' })
    const { data: perms } = await caller.rpc('my_permissions')
    if (me.is_external || !(perms ?? []).includes('mail.connect')) return json(403, { error: 'forbidden' })

    // -------------------------------------------------------------------- подключение
    if (action === 'auth_url') {
      const redirect = String(body.redirect_uri ?? '')
      if (!/^https?:\/\/[^\s]+$/.test(redirect)) return json(400, { error: 'invalid_redirect' })
      const { verifier, challenge } = await pkce()
      const payload: StatePayload = { u: user.id, v: verifier, r: redirect, exp: Date.now() + STATE_TTL_MS }
      const state = await seal(JSON.stringify(payload), user.id)
      const q = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirect,
        response_mode: 'query',
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
        login_hint: user.email ?? '',
      })
      if (!user.email) q.delete('login_hint')
      return json(200, { url: `${AUTHORIZE_URL}?${q}` })
    }

    if (action === 'connect') {
      const code = String(body.code ?? '')
      const state = String(body.state ?? '')
      if (!code || !state) return json(400, { error: 'invalid_input' })
      let payload: StatePayload
      try {
        payload = JSON.parse(await open(state, user.id))
      } catch {
        return json(400, { error: 'invalid_state' })
      }
      if (payload.u !== user.id || payload.exp < Date.now()) return json(400, { error: 'state_expired' })

      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: payload.r,
          code_verifier: payload.v,
          scope: SCOPES,
        }),
      })
      const tok = await res.json().catch(() => ({}))
      if (!res.ok || !tok.access_token || !tok.refresh_token) {
        console.error('mail connect: token exchange failed', tok.error, tok.error_description)
        return json(502, { error: 'exchange_failed', detail: String(tok.error_description ?? tok.error ?? '').slice(0, 300) })
      }
      const profileRes = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${tok.access_token}` } })
      const profile = profileRes.ok ? await profileRes.json() : {}
      const email = String(profile.mail ?? profile.userPrincipalName ?? '').toLowerCase()
      if (!email) return json(502, { error: 'profile_failed' })
      // ящик без почты (учётная запись без лицензии Exchange Online) читать нечего
      const probe = await fetch(`${GRAPH}/me/mailFolders/inbox?$select=id`, { headers: { Authorization: `Bearer ${tok.access_token}` } })
      if (!probe.ok) return json(422, { error: 'no_mailbox' })

      let msTenant: string | null = null
      try {
        msTenant = JSON.parse(new TextDecoder().decode(unb64u(String(tok.access_token).split('.')[1]))).tid ?? null
      } catch {
        /* токен непрозрачен — не страшно */
      }
      const { error } = await admin.from('mail_accounts').upsert({
        user_id: user.id,
        tenant_id: me.tenant_id,
        provider: 'microsoft',
        email,
        display_name: profile.displayName ?? null,
        ms_tenant_id: msTenant,
        scopes: String(tok.scope ?? SCOPES),
        refresh_token_enc: await seal(tok.refresh_token, user.id),
        access_token_enc: await seal(tok.access_token, user.id),
        access_expires_at: new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString(),
        connected_at: new Date().toISOString(),
        last_ok_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      if (error) {
        console.error('mail connect: save failed', error)
        return json(500, { error: 'save_failed' })
      }
      return json(200, { email, display_name: profile.displayName ?? null })
    }

    // -------------------------------------------------------------------- чтение (нужно подключение)
    const { data: acc } = await admin
      .from('mail_accounts')
      .select('user_id, tenant_id, refresh_token_enc, access_token_enc, access_expires_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!acc) return json(409, { error: 'not_connected' })
    const token = await accessToken(admin, acc as AccountRow)

    // Непрочитанные во «Входящих» — для значка в меню (один лёгкий запрос)
    if (action === 'unread') {
      const res = await graph(token, '/me/mailFolders/inbox?$select=unreadItemCount')
      return json(200, { unread: Number((await res.json()).unreadItemCount ?? 0) })
    }

    if (action === 'folders') {
      const res = await graph(token, '/me/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount')
      const data = await res.json()
      // Системные папки (Входящие, Отправленные…) определяем по wellKnownName через отдельные запросы к известным именам
      const wk = ['inbox', 'sentitems', 'drafts', 'archive', 'deleteditems', 'junkemail']
      // По очереди, а не разом: Exchange пускает к одному ящику не больше 4 запросов одновременно (лишние получают 429,
      // и папка теряла пометку — «Отправленные» и «Черновики» показывались обычными папками)
      const known: (readonly [string, string])[] = []
      for (const n of wk) {
        try {
          const r = await graph(token, `/me/mailFolders/${n}?$select=id`)
          known.push([n, (await r.json()).id as string])
        } catch {
          known.push([n, ''])
        }
      }
      const byId = new Map(known.filter(([, id]) => id).map(([n, id]) => [id, n]))
      const folders = (data.value ?? []).map((f: Record<string, unknown>) => ({
        id: f.id,
        name: f.displayName,
        well_known: byId.get(String(f.id)) ?? null,
        unread: f.unreadItemCount ?? 0,
        total: f.totalItemCount ?? 0,
        has_children: Number(f.childFolderCount ?? 0) > 0,
      }))
      return json(200, { folders })
    }

    if (action === 'children') {
      const folder = String(body.folder ?? '')
      if (!/^[A-Za-z0-9_=\-]+$/.test(folder)) return json(400, { error: 'invalid_input' })
      const res = await graph(token, `/me/mailFolders/${folder}/childFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount`)
      const data = await res.json()
      return json(200, {
        folders: (data.value ?? []).map((f: Record<string, unknown>) => ({
          id: f.id,
          name: f.displayName,
          well_known: null,
          unread: f.unreadItemCount ?? 0,
          total: f.totalItemCount ?? 0,
          has_children: Number(f.childFolderCount ?? 0) > 0,
        })),
      })
    }

    if (action === 'messages') {
      const next = typeof body.next === 'string' ? body.next : ''
      const folder = String(body.folder ?? 'inbox')
      const search = String(body.search ?? '').trim().slice(0, 100)
      const filter = FILTERS[String(body.filter ?? '')]
      let path: string
      if (next) {
        path = next
      } else {
        if (!/^[A-Za-z0-9_=\-]+$/.test(folder)) return json(400, { error: 'invalid_input' })
        const q = new URLSearchParams({ $top: '30', $select: LIST_SELECT, $expand: LIST_EXPAND })
        if (search) q.set('$search', `"${search.replace(/["\\]/g, ' ')}"`)
        // $search в Graph не сочетается с $filter: при поиске фильтр применяет сайт к найденному
        else {
          q.set('$orderby', 'receivedDateTime desc')
          if (filter) q.set('$filter', `receivedDateTime ge 1900-01-01T00:00:00Z and ${filter}`)
        }
        path = `/me/mailFolders/${folder}/messages?${q}`
      }
      const res = await graph(token, path, { headers: { ConsistencyLevel: 'eventual' } })
      const data = await res.json()
      const messages = ((data.value ?? []) as Record<string, unknown>[]).map(listItem)
      const counts = await threadCounts(token, messages.map((m) => m.conversation_id).filter((c): c is string => !!c))
      return json(200, {
        messages: messages.map((m) => ({ ...m, thread_count: (m.conversation_id && counts.get(m.conversation_id)) || 1 })),
        next: (data['@odata.nextLink'] as string | undefined) ?? null,
      })
    }

    // Вся переписка (ветка) из всех папок: входящие, свои ответы из «Отправленных» и т.д. — для раскрытия ветки в списке
    if (action === 'conversation') {
      const conv = String(body.conversation_id ?? '')
      if (!/^[A-Za-z0-9_=\-]+$/.test(conv)) return json(400, { error: 'invalid_input' })
      const q = new URLSearchParams({
        $filter: `conversationId eq '${conv}'`,
        $top: '50',
        $select: `${LIST_SELECT},parentFolderId`,
        $expand: LIST_EXPAND,
      })
      const data = await (await graph(token, `/me/messages?${q}`)).json()
      const messages = ((data.value ?? []) as Record<string, unknown>[])
        // черновики ветки не показываем, как и Outlook в свёрнутом виде
        .filter((m) => m.isDraft !== true)
        .map((m) => ({ ...listItem(m), folder_id: (m.parentFolderId as string | undefined) ?? null }))
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
      return json(200, { messages })
    }

    if (action === 'message') {
      const id = String(body.id ?? '')
      if (!/^[A-Za-z0-9_=\-]+$/.test(id)) return json(400, { error: 'invalid_input' })
      const res = await graph(
        token,
        `/me/messages/${id}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,isRead,webLink,importance&$expand=${CLASS_EXPAND}`,
        { headers: { Prefer: 'outlook.body-content-type="html"' } },
      )
      const m = await res.json()
      // Приглашение на встречу: сразу в личный календарь (повторное открытие только обновит запись)
      let meeting: (MeetingInfo & { item_id: string | null; event_date: string | null; repeats: number }) | null = null
      const kind = meetingKind(m)
      if (kind) {
        try {
          const infos = await meetingInfo(token, id, kind)
          if (infos.length) {
            const { data: applied } = await admin.rpc('mail_calendar_apply', { p_user: user.id, p_items: infos })
            const rows = (applied ?? []) as { uid: string; item_id: string; event_date: string }[]
            // в карточке письма — ближайшая встреча (у серии) и сколько их добавлено
            const first = rows[0]
            const info = infos.find((x) => x.uid === first?.uid) ?? infos[0]!
            meeting = { ...info, item_id: first?.item_id ?? null, event_date: first?.event_date ?? null, repeats: rows.length }
          }
        } catch (e) {
          console.error('mail meeting failed', e instanceof Error ? e.message : e)
        }
      }
      const attachmentsOf = async (messageId: string) =>
        ((await (await graph(token, `/me/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`)).json()).value ?? [])
          .filter((x: Record<string, unknown>) => !x.isInline)
          .map((x: Record<string, unknown>) => ({ id: x.id, name: x.name, content_type: x.contentType, size: x.size }))
      const attachments: unknown[] = m.hasAttachments ? await attachmentsOf(id) : []

      // Переписка: это письмо и все более ранние письма ветки (из всех папок), у каждого — только его собственный текст
      // (uniqueBody, без цитаты предыдущих). Сайт показывает их отдельными блоками, а не одним длинным письмом с цитатами.
      let thread: unknown[] = []
      if (m.conversationId && /^[A-Za-z0-9_=\-]+$/.test(String(m.conversationId))) {
        try {
          const q = new URLSearchParams({
            $filter: `conversationId eq '${m.conversationId}'`,
            $select: 'id,from,toRecipients,ccRecipients,receivedDateTime,uniqueBody,hasAttachments,isDraft,isRead,parentFolderId',
            $top: '30',
          })
          const list = ((await (await graph(token, `/me/messages?${q}`, { headers: { Prefer: 'outlook.body-content-type="html"' } })).json()).value ??
            []) as Record<string, any>[]
          const items = list
            .filter((x) => !x.isDraft && String(x.receivedDateTime) <= String(m.receivedDateTime))
            .sort((a, b) => String(b.receivedDateTime).localeCompare(String(a.receivedDateTime)))
          if (items.length > 1) {
            for (const x of items) {
              // вложения ранних писем — по очереди (Exchange пускает к ящику не больше 4 запросов разом)
              const files = x.id === id ? attachments : x.hasAttachments ? await attachmentsOf(String(x.id)).catch(() => []) : []
              thread.push({
                id: x.id,
                from: pickAddr(x.from),
                to: (x.toRecipients ?? []).map(pickAddr),
                cc: (x.ccRecipients ?? []).map(pickAddr),
                received_at: x.receivedDateTime,
                is_read: !!x.isRead,
                folder_id: x.parentFolderId ?? null,
                body_type: String(x.uniqueBody?.contentType ?? 'text').toLowerCase(),
                body: String(x.uniqueBody?.content ?? ''),
                attachments: files,
              })
            }
          }
        } catch (e) {
          // не получилось — покажем письмо целиком, как раньше
          console.error('mail thread failed', e instanceof Error ? e.message : e)
          thread = []
        }
      }

      return json(200, {
        thread,
        id: m.id,
        subject: m.subject ?? '',
        from: pickAddr(m.from),
        to: (m.toRecipients ?? []).map(pickAddr),
        cc: (m.ccRecipients ?? []).map(pickAddr),
        received_at: m.receivedDateTime,
        is_read: !!m.isRead,
        important: m.importance === 'high',
        web_link: m.webLink ?? null,
        body_type: String(m.body?.contentType ?? 'text').toLowerCase(),
        body: String(m.body?.content ?? ''),
        attachments,
        meeting,
      })
    }

    if (action === 'attachment') {
      const id = String(body.id ?? '')
      const att = String(body.attachment_id ?? '')
      if (!/^[A-Za-z0-9_=\-]+$/.test(id) || !/^[A-Za-z0-9_=\-]+$/.test(att)) return json(400, { error: 'invalid_input' })
      const meta = await (await graph(token, `/me/messages/${id}/attachments/${att}?$select=name,contentType,size`)).json()
      if (Number(meta.size ?? 0) > MAX_ATTACHMENT_BYTES) return json(413, { error: 'too_large' })
      const res = await graph(token, `/me/messages/${id}/attachments/${att}/$value`)
      const name = String(meta.name ?? 'attachment').replace(/[\r\n"\\]/g, '_')
      return new Response(res.body, {
        status: 200,
        headers: {
          ...cors,
          // Тип не доверяем: вложение скачивается, а не открывается на нашем домене
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Expose-Headers': 'Content-Disposition',
        },
      })
    }

    return json(400, { error: 'unknown_action' })
  } catch (e) {
    if (e instanceof MailError) return json(e.status, { error: e.code })
    console.error('mail failed', e)
    return json(500, { error: 'internal' })
  }
})
