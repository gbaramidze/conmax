// Сброс пароля сотрудника администратором: человек забыл пароль и не может войти.
// Вызывает администратор компании (право admin.users): `{ user_id, redirect_to }`. GoTrue отправляет человеку письмо
// со ссылкой (шаблон recovery.html, ссылка действует час); по ссылке он попадает на /reset-password и задаёт новый пароль.
// Сам администратор ни пароля, ни ссылки не видит. Только в своей компании, только тем, кто уже принял приглашение
// (приглашённому — повторное приглашение) и чей доступ не отключён. След остаётся в журнале функций.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: { user_id?: string; redirect_to?: string }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  if (!body.user_id) return json(400, { error: 'bad_request' })

  // права: администратор компании; если у самого администратора включён второй фактор и код не введён, список прав придёт пустым
  const { data: perms, error: permError } = await caller.rpc('my_tenant_permissions')
  if (permError || !(perms as string[] | null)?.includes('admin.users')) return json(403, { error: 'forbidden' })

  const { data: me } = await caller.auth.getUser()
  if (!me.user) return json(401, { error: 'unauthorized' })
  if (me.user.id === body.user_id) return json(400, { error: 'self' })
  const [{ data: mine }, { data: target }] = await Promise.all([
    admin.from('users').select('tenant_id').eq('id', me.user.id).maybeSingle(),
    admin.from('users').select('tenant_id, email, status').eq('id', body.user_id).is('deleted_at', null).maybeSingle(),
  ])
  if (!mine || !target || mine.tenant_id !== target.tenant_id) return json(404, { error: 'user_not_found' })
  if (target.status === 'invited') return json(409, { error: 'not_accepted' })
  if (target.status === 'blocked') return json(409, { error: 'blocked' })

  const { error } = await admin.auth.resetPasswordForEmail(target.email, { redirectTo: body.redirect_to })
  if (error) {
    console.error('reset-password failed', error)
    if (error.status === 429 || error.code === 'over_email_send_rate_limit') return json(429, { error: 'rate_limited' })
    if (error.message?.toLowerCase().includes('sending')) return json(502, { error: 'email_send_failed' })
    return json(500, { error: 'reset_failed' })
  }
  console.log(`reset-password: ${me.user.email} отправил ссылку для нового пароля ${target.email}`)
  return json(200, { email: target.email })
})
