// Расшифровка короткого куска звука совещания по ходу записи.
// Вызывает ведущий или управляющий совещанием (multipart): `meeting_id`, `session_id`, `seq`, `offset_sec`, `duration_sec`, `speaker?`, `audio`.
// Проверяет право через RPC `meeting_transcript_allowed` от имени вызывающего, расшифровывает кусок облачным сервисом (те же секреты, что у
// `summarize-meeting`: STT_API_KEY, STT_BASE_URL, STT_MODEL, STT_LANGUAGE), записывает строку в `meeting_transcript_parts` и возвращает текст.
// Повторная отправка того же куска (`meeting_id`, `session_id`, `seq`) заменяет текст. Ключи наружу не отдаются.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const STT_KEY = Deno.env.get('STT_API_KEY')
const STT_BASE = (Deno.env.get('STT_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
const STT_MODEL = Deno.env.get('STT_MODEL') ?? 'whisper-1'
const STT_LANG = Deno.env.get('STT_LANGUAGE') ?? 'ru'
const MAX_CHUNK_BYTES = 8 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Whisper на тишине и шуме выдумывает привычные фразы из субтитров: такие куски отбрасываем
const HALLUCINATION = /(субтитры|редактор субтитров|корректор|продолжение следует|спасибо за просмотр|подписывайтесь на канал|dimatorzok)/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!STT_KEY) return json(503, { error: 'not_configured_stt' })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const meetingId = String(form.get('meeting_id') ?? '')
  const sessionId = String(form.get('session_id') ?? '')
  const seq = Number(form.get('seq'))
  const offset = Math.max(0, Math.round(Number(form.get('offset_sec') ?? 0)))
  const duration = Math.max(0, Math.round(Number(form.get('duration_sec') ?? 0)))
  const speaker = String(form.get('speaker') ?? '').trim().slice(0, 200) || null
  const audio = form.get('audio')
  if (!UUID.test(meetingId) || !UUID.test(sessionId) || !Number.isInteger(seq) || seq < 0 || !(audio instanceof File)) return json(400, { error: 'bad_request' })
  if (audio.size === 0) return json(200, { text: '', skipped: 'empty' })
  if (audio.size > MAX_CHUNK_BYTES) return json(413, { error: 'too_large' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: allowed } = await caller.rpc('meeting_transcript_allowed', { p_meeting: meetingId })
  if (allowed !== true) return json(403, { error: 'forbidden' })

  const { data: m } = await admin.from('meetings').select('title, tenant_id, project_id').eq('id', meetingId).single()
  if (!m) return json(404, { error: 'meeting_not_found' })
  const [{ data: people }, { data: prev }] = await Promise.all([
    admin.from('meeting_participants').select('user:users(full_name)').eq('meeting_id', meetingId),
    admin.from('meeting_transcript_parts').select('text').eq('meeting_id', meetingId).eq('session_id', sessionId).lt('seq', seq).order('seq', { ascending: false }).limit(1),
  ])
  const names = ((people ?? []) as { user: { full_name: string } | null }[]).map((p) => p.user?.full_name).filter(Boolean).join(', ')
  // подсказка: названия, фамилии и конец прошлого куска, чтобы фраза на стыке не рвалась
  const tail = ((prev ?? [])[0]?.text as string | undefined)?.slice(-200) ?? ''
  const prompt = `${m.title}. ${names}. ${tail}`.slice(0, 600)

  const body = new FormData()
  body.append('file', audio, audio.name || 'chunk.webm')
  body.append('model', STT_MODEL)
  body.append('response_format', 'text')
  body.append('temperature', '0')
  if (STT_LANG) body.append('language', STT_LANG)
  body.append('prompt', prompt)
  const res = await fetch(`${STT_BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${STT_KEY}` }, body })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    console.error('chunk stt failed', res.status, text)
    return json(res.status === 429 ? 429 : 502, { error: res.status === 429 || /quota|billing|insufficient/i.test(text) ? 'stt_billing' : 'stt_failed' })
  }
  let text = (await res.text()).trim()
  if (text.length < 3 || HALLUCINATION.test(text)) text = ''

  if (text) {
    const { error } = await admin.from('meeting_transcript_parts').upsert(
      { tenant_id: m.tenant_id, project_id: m.project_id, meeting_id: meetingId, session_id: sessionId, seq, offset_sec: offset, duration_sec: duration, speaker, text, created_by: (await caller.auth.getUser()).data.user?.id ?? null },
      { onConflict: 'meeting_id,session_id,seq' },
    )
    if (error) {
      console.error('chunk save failed', error.message)
      return json(500, { error: 'save_failed' })
    }
  }
  return json(200, { text, speaker, seq, offset_sec: offset })
})
