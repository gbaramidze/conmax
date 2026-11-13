// Отключение и возврат доступа сотрудника администратором: человека не удаляем, чтобы сохранилась история (он автор задач, замечаний, документов).
// Вызывает администратор компании (право admin.users): `{ user_id, blocked }`. Только в своей компании и не для самого себя.
// Отключённый не может войти (запрет в Auth) и не получает токен с компанией; открытые сессии закрываются сразу.
// В журнал проекта действие не пишется (учётное действие компании), след остаётся в журнале функций.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// «Навсегда» для Auth: ban_duration принимает только длительность
const BAN_FOREVER = '876000h'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { user_id?: string; blocked?: boolean }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  if (!body.user_id || typeof body.blocked !== 'boolean') return json(400, { error: 'bad_request' })

  // права: администратор компании; если у самого администратора включён второй фактор и код не введён, список прав придёт пустым
  const { data: perms, error: permError } = await caller.rpc('my_tenant_permissions')
  if (permError || !(perms as string[] | null)?.includes('admin.users')) return json(403, { error: 'forbidden' })

  const { data: me } = await caller.auth.getUser()
  if (!me.user) return json(401, { error: 'unauthorized' })
  if (me.user.id === body.user_id) return json(422, { error: 'cannot_block_self' })

  const [{ data: mine }, { data: target }] = await Promise.all([
    admin.from('users').select('tenant_id').eq('id', me.user.id).maybeSingle(),
    admin.from('users').select('tenant_id, email').eq('id', body.user_id).maybeSingle(),
  ])
  if (!mine || !target || mine.tenant_id !== target.tenant_id) return json(404, { error: 'user_not_found' })

  // Сначала запрет в Auth (вход и обновление токена), затем статус и закрытие сессий в базе.
  // Если запись в базу не удалась, запрет снимаем обратно, чтобы не остаться в половинчатом состоянии.
  const { error: banError } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: body.blocked ? BAN_FOREVER : 'none' })
  if (banError) return json(500, { error: 'ban_failed' })

  const { data: status, error: statusError } = await admin.rpc('set_user_blocked', { p_user: body.user_id, p_blocked: body.blocked })
  if (statusError) {
    await admin.auth.admin.updateUserById(body.user_id, { ban_duration: body.blocked ? 'none' : BAN_FOREVER })
    return json(500, { error: 'status_failed' })
  }

  console.log(`set-user-access: ${me.user.email} ${body.blocked ? 'отключил доступ у' : 'вернул доступ'} ${target.email}`)
  return json(200, { status })
})
