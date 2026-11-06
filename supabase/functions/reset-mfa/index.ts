// Сброс двухфакторной защиты сотрудника администратором: у человека потерян или заменён телефон, войти с кодом он не может.
// Вызывает администратор компании (право admin.users): `{ user_id }`. Удаляет все вторые факторы у этого человека, после чего он входит по паролю
// и при желании включает защиту заново. Только в своей компании. В журнал проекта действие не пишется (это учётное действие компании),
// след остаётся в журнале функций.
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
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { user_id?: string }
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
  const [{ data: mine }, { data: target }] = await Promise.all([
    admin.from('users').select('tenant_id').eq('id', me.user.id).maybeSingle(),
    admin.from('users').select('tenant_id, email').eq('id', body.user_id).maybeSingle(),
  ])
  if (!mine || !target || mine.tenant_id !== target.tenant_id) return json(404, { error: 'user_not_found' })

  const { data: list, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: body.user_id })
  if (listError) return json(500, { error: 'list_failed' })
  let removed = 0
  for (const f of list?.factors ?? []) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: body.user_id })
    if (!error) removed += 1
  }
  console.log(`reset-mfa: ${me.user.email} сбросил защиту у ${target.email}, факторов: ${removed}`)
  return json(200, { removed })
})
