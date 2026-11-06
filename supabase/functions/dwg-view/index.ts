// Просмотр DWG и DXF через Autodesk Platform Services (APS).
// Браузер спрашивает функцию по ключу файла: функция проверяет, что файл вызывающему виден, при первом обращении отправляет файл
// в APS и запускает перевод (Model Derivative, SVF2), при следующих — сверяет ход перевода, а когда он готов, отдаёт `urn`
// и короткоживущий токен только на чтение. Секреты APS остаются здесь и в браузер не уходят.
// Состояние хранится в `dwg_views` (пишет только эта функция с сервисным ключом).
// Ответ: { status: 'not_configured' | 'uploading' | 'translating' | 'ready' | 'failed', progress?, urn?, token?, expires_in?, error? }.
import { createClient } from 'npm:@supabase/supabase-js@2'

const APS = 'https://developer.api.autodesk.com'
const CLIENT_ID = Deno.env.get('APS_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('APS_CLIENT_SECRET') ?? ''
// Имя хранилища в APS общее для всех аккаунтов, поэтому по умолчанию берём из идентификатора приложения
const BUCKET = (Deno.env.get('APS_BUCKET') || `buildos-${CLIENT_ID.slice(0, 12)}`).toLowerCase().replace(/[^a-z0-9_.-]/g, '')
/** Файл уходит в APS частями по 50 МБ; предел файла — как у загрузки документов в CONMAX. */
const PART_BYTES = 50 * 1024 * 1024
const MAX_BYTES = 150 * 1024 * 1024
/** Если загрузка в APS «висит» дольше этого, считаем её оборвавшейся и разрешаем повторить. */
const STALE_MS = 10 * 60 * 1000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function aps<T>(token: string, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path.startsWith('http') ? path : `${APS}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  let data = {} as T
  try {
    data = text ? (JSON.parse(text) as T) : data
  } catch {
    // ответ не JSON — оставляем пустым, подробности в статусе
  }
  return { ok: res.ok, status: res.status, data }
}

async function token(scope: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${APS}/authentication/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`aps_auth_${res.status}`)
  return await res.json()
}

const urnOf = (objectId: string) => btoa(objectId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function ensureBucket(t: string) {
  const r = await aps(t, '/oss/v2/buckets', { method: 'POST', body: JSON.stringify({ bucketKey: BUCKET, access: 'full', policyKey: 'persistent' }) })
  // 409 — хранилище уже есть
  if (!r.ok && r.status !== 409) throw new Error(`aps_bucket_${r.status}`)
}

/** Загрузка файла в хранилище APS через подписанные адреса (по частям). Возвращает идентификатор объекта. */
async function upload(t: string, objectKey: string, blob: Blob): Promise<string> {
  const base = `/oss/v2/buckets/${BUCKET}/objects/${encodeURIComponent(objectKey)}/signeds3upload`
  const parts = Math.max(1, Math.ceil(blob.size / PART_BYTES))
  const start = await aps<{ uploadKey: string; urls: string[] }>(t, `${base}?firstPart=1&parts=${parts}&minutesExpiration=30`)
  if (!start.ok || !start.data.urls?.length) throw new Error(`aps_upload_start_${start.status}`)
  for (let i = 0; i < start.data.urls.length; i++) {
    const put = await fetch(start.data.urls[i], { method: 'PUT', body: blob.slice(i * PART_BYTES, (i + 1) * PART_BYTES), signal: AbortSignal.timeout(300_000) })
    if (!put.ok) throw new Error(`aps_upload_part_${put.status}`)
  }
  const done = await aps<{ objectId: string }>(t, base, { method: 'POST', body: JSON.stringify({ uploadKey: start.data.uploadKey }) })
  if (!done.ok || !done.data.objectId) throw new Error(`aps_upload_finish_${done.status}`)
  return done.data.objectId
}

async function translate(t: string, urn: string) {
  const r = await aps(t, '/modelderivative/v2/designdata/job', {
    method: 'POST',
    headers: { 'x-ads-force': 'true' },
    body: JSON.stringify({ input: { urn }, output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] } }),
  })
  if (!r.ok) throw new Error(`aps_translate_${r.status}`)
}

/** Ход перевода по манифесту: готово, идёт (с процентами) или не удалось. */
async function manifest(t: string, urn: string): Promise<{ status: 'translating' | 'ready' | 'failed'; progress: string | null }> {
  const r = await aps<{ status?: string; progress?: string }>(t, `/modelderivative/v2/designdata/${urn}/manifest`)
  if (r.status === 404) return { status: 'translating', progress: null }
  if (!r.ok) throw new Error(`aps_manifest_${r.status}`)
  if (r.data.status === 'success') return { status: 'ready', progress: null }
  if (r.data.status === 'failed' || r.data.status === 'timeout') return { status: 'failed', progress: null }
  return { status: 'translating', progress: r.data.progress && r.data.progress !== 'complete' ? r.data.progress : null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: u } = await caller.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401)

  let body: { storage_key?: string; retry?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!body.storage_key) return json({ error: 'storage_key_required' }, 400)

  // Файл должен быть виден вызывающему: проверка идёт через RLS его же ключом
  const { data: file } = await caller.from('files').select('id, tenant_id, project_id, name, size_bytes, storage_key').eq('storage_key', body.storage_key).maybeSingle()
  if (!file) return json({ error: 'file_not_found' }, 404)
  if (!/\.(dwg|dxf)$/i.test(file.name)) return json({ error: 'not_cad' }, 400)
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ status: 'not_configured' })

  const fail = async (error: string) => {
    await admin.from('dwg_views').update({ status: 'failed', error, updated_at: new Date().toISOString() }).eq('file_id', file.id)
    return json({ status: 'failed', error })
  }

  try {
    let { data: row } = await admin.from('dwg_views').select('*').eq('file_id', file.id).maybeSingle()

    // зависшая загрузка считается оборвавшейся
    if (row?.status === 'uploading' && Date.now() - new Date(row.updated_at).getTime() > STALE_MS) {
      await admin.from('dwg_views').update({ status: 'failed', error: 'upload_timeout' }).eq('file_id', file.id)
      row = { ...row, status: 'failed' }
    }

    // запуск: строки ещё нет, либо прошлая попытка не удалась и просили повторить
    let started = false
    if (!row) {
      const { error } = await admin.from('dwg_views').insert({ file_id: file.id, tenant_id: file.tenant_id, project_id: file.project_id, requested_by: u.user.id })
      // 23505: параллельный запрос уже начал — просто сообщаем его состояние
      if (error && error.code !== '23505') throw error
      started = !error
    } else if (row.status === 'failed' && body.retry) {
      const { data: claimed } = await admin
        .from('dwg_views')
        .update({ status: 'uploading', error: null, progress: null, urn: null, updated_at: new Date().toISOString(), requested_by: u.user.id })
        .eq('file_id', file.id)
        .eq('status', 'failed')
        .select('file_id')
      started = (claimed?.length ?? 0) > 0
    }

    if (started) {
      if (file.size_bytes > MAX_BYTES) return await fail('too_big')
      const t = (await token('data:read data:write data:create bucket:create bucket:read')).access_token
      const { data: blob, error: dl } = await admin.storage.from('files').download(file.storage_key)
      if (dl || !blob) return await fail('download_failed')
      await ensureBucket(t)
      const ext = /\.(dwg|dxf)$/i.exec(file.name)![1].toLowerCase()
      const objectId = await upload(t, `${file.id}.${ext}`, blob)
      const urn = urnOf(objectId)
      await translate(t, urn)
      await admin.from('dwg_views').update({ status: 'translating', urn, updated_at: new Date().toISOString() }).eq('file_id', file.id)
      return json({ status: 'translating', progress: null })
    }

    const cur = (await admin.from('dwg_views').select('*').eq('file_id', file.id).single()).data!
    if (cur.status === 'translating' && cur.urn) {
      const t = (await token('data:read')).access_token
      const m = await manifest(t, cur.urn)
      await admin.from('dwg_views').update({ status: m.status, progress: m.progress, updated_at: new Date().toISOString(), error: m.status === 'failed' ? 'translation_failed' : null }).eq('file_id', file.id)
      cur.status = m.status
      cur.progress = m.progress
      if (m.status === 'failed') return json({ status: 'failed', error: 'translation_failed' })
    }

    if (cur.status === 'ready' && cur.urn) {
      const v = await token('viewables:read')
      return json({ status: 'ready', urn: cur.urn, token: v.access_token, expires_in: v.expires_in })
    }
    if (cur.status === 'failed') return json({ status: 'failed', error: cur.error ?? 'failed' })
    return json({ status: cur.status, progress: cur.progress })
  } catch (e) {
    return await fail((e as Error).message ?? 'error')
  }
})
