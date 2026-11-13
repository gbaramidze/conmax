// Личная почта Outlook (Microsoft 365): подключение пользователя и чтение писем через Microsoft Graph.
// Письма не копируются в базу: функция ходит в Graph от имени пользователя, токены лежат зашифрованными (AES-GCM) в mail_accounts.
// Права запроса: только чтение (Mail.Read). Работает под JWT пользователя; таблица токенов доступна только service_role.
//
// Секреты функций (supabase/functions/.env, на сервере .env.functions):
//   MS_CLIENT_ID, MS_CLIENT_SECRET — приложение, зарегистрированное в Microsoft Entra (инструкция: deploy/outlook-setup.md)
//   MS_AUTHORITY_TENANT — 'organizations' (рабочие и учебные учётные записи, по умолчанию), 'common' или GUID каталога
//   MAIL_TOKEN_KEY — 32 случайных байта в base64 (openssl rand -base64 32); смена ключа разлогинивает всех из почты
import { createClient } from 'npm:@supabase/supabase-js@2'

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

const LIST_SELECT = 'id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,importance'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  if (!CLIENT_ID || !CLIENT_SECRET || !TOKEN_KEY_B64) return json(503, { error: 'not_configured' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

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

    if (action === 'folders') {
      const res = await graph(token, '/me/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount')
      const data = await res.json()
      // Системные папки (Входящие, Отправленные…) определяем по wellKnownName через отдельные запросы к известным именам
      const wk = ['inbox', 'sentitems', 'drafts', 'archive', 'deleteditems', 'junkemail']
      const known = await Promise.all(
        wk.map(async (n) => {
          try {
            const r = await graph(token, `/me/mailFolders/${n}?$select=id`)
            return [n, (await r.json()).id as string] as const
          } catch {
            return [n, ''] as const
          }
        }),
      )
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
      let path: string
      if (next) {
        path = next
      } else {
        if (!/^[A-Za-z0-9_=\-]+$/.test(folder)) return json(400, { error: 'invalid_input' })
        const q = new URLSearchParams({ $top: '30', $select: LIST_SELECT })
        if (search) q.set('$search', `"${search.replace(/["\\]/g, ' ')}"`)
        else q.set('$orderby', 'receivedDateTime desc')
        path = `/me/mailFolders/${folder}/messages?${q}`
      }
      const res = await graph(token, path, { headers: { ConsistencyLevel: 'eventual' } })
      const data = await res.json()
      return json(200, {
        messages: (data.value ?? []).map((m: Record<string, unknown>) => ({
          id: m.id,
          subject: m.subject ?? '',
          from: pickAddr(m.from as never),
          received_at: m.receivedDateTime,
          is_read: !!m.isRead,
          has_attachments: !!m.hasAttachments,
          preview: String(m.bodyPreview ?? '').slice(0, 200),
          important: m.importance === 'high',
        })),
        next: (data['@odata.nextLink'] as string | undefined) ?? null,
      })
    }

    if (action === 'message') {
      const id = String(body.id ?? '')
      if (!/^[A-Za-z0-9_=\-]+$/.test(id)) return json(400, { error: 'invalid_input' })
      const res = await graph(
        token,
        `/me/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,isRead,webLink,importance`,
        { headers: { Prefer: 'outlook.body-content-type="html"' } },
      )
      const m = await res.json()
      let attachments: unknown[] = []
      if (m.hasAttachments) {
        const a = await graph(token, `/me/messages/${id}/attachments?$select=id,name,contentType,size,isInline`)
        attachments = ((await a.json()).value ?? [])
          .filter((x: Record<string, unknown>) => !x.isInline)
          .map((x: Record<string, unknown>) => ({ id: x.id, name: x.name, content_type: x.contentType, size: x.size }))
      }
      return json(200, {
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
