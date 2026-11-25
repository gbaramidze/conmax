// Приглашение пользователя по email.
// Вызывает администратор (admin.users) или участник проекта с правом project.members.manage.
// Внешние пользователи (субподрядчик, заказчик) приглашаются только в конкретный проект.
import { createClient } from 'npm:@supabase/supabase-js@2'

const EXTERNAL_ROLE_CODES = ['subcontractor', 'subcontractor_lead', 'client']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Body {
  /** Повторно отправить приглашение существующему приглашённому (`user_id`; `project_id` — если вызывает менеджер проекта) */
  resend?: boolean
  user_id?: string
  email: string
  full_name: string
  organization_id?: string | null
  project_id?: string | null
  /** Должность в проекте — роль проекта с правами */
  project_role_id?: string | null
  /** Направление в проекте (необязательно) */
  discipline_id?: string | null
  /**
   * Должность сотрудника без проекта — тоже из справочника должностей (роль проекта). Свободного текста нет:
   * подпись под именем (users.job_title) берётся из названия должности, дальше её пересчитывает база.
   */
  position_role_id?: string | null
  phone?: string | null
  /** Роль в компании сверх «Сотрудника» (например, «Директор»); выдаёт только тот, у кого есть право admin.users */
  tenant_role_id?: string | null
  redirect_to?: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // Клиент «от имени вызывающего»: все проверки идут через RLS и my_permissions
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: userData } = await caller.auth.getUser()
  if (!userData.user) return json(401, { error: 'unauthorized' })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Повторная отправка приглашения тому, кто его ещё не принял (письмо не дошло или потерялось)
  if (body.resend) {
    if (!body.user_id) return json(400, { error: 'invalid_input' })
    const { data: me } = await caller.from('users').select('tenant_id, organization_id').eq('id', userData.user.id).maybeSingle()
    if (!me) return json(403, { error: 'forbidden' })
    const { data: target } = await admin
      .from('users')
      .select('id, email, full_name, status, tenant_id, organization_id')
      .eq('id', body.user_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!target || target.tenant_id !== me.tenant_id) return json(404, { error: 'not_found' })
    if (target.status !== 'invited') return json(409, { error: 'already_accepted' })

    const { data: perms } = await caller.rpc('my_permissions', body.project_id ? { p_project: body.project_id } : {})
    const permissions: string[] = perms ?? []
    let allowed = permissions.includes('admin.users')
    if (!allowed && body.project_id) {
      // Менеджер проекта (или ответственный от подрядчика — для своей организации) и приглашённый состоит в этом проекте
      const { data: member } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', body.project_id)
        .eq('user_id', target.id)
        .is('deleted_at', null)
        .is('left_at', null)
        .maybeSingle()
      const sameOrg = !!me.organization_id && me.organization_id === target.organization_id
      allowed = !!member && (permissions.includes('project.members.manage') || (permissions.includes('project.members.invite_org') && sameOrg))
    }
    if (!allowed) return json(403, { error: 'forbidden' })

    // Для ещё не подтверждённого пользователя GoTrue заново выпускает ссылку и отправляет письмо
    const { error: resendError } = await admin.auth.admin.inviteUserByEmail(target.email, {
      redirectTo: body.redirect_to,
      data: { full_name: target.full_name },
    })
    if (resendError) {
      console.error('resend invite failed', resendError)
      if (resendError.status === 429 || resendError.code === 'over_email_send_rate_limit') return json(429, { error: 'rate_limited' })
      if (resendError.code === 'email_exists' || resendError.status === 422) return json(409, { error: 'already_accepted' })
      if (resendError.message?.toLowerCase().includes('sending')) return json(502, { error: 'email_send_failed' })
      return json(500, { error: 'invite_failed' })
    }
    return json(200, { ok: true, email: target.email })
  }

  const email = body.email?.trim().toLowerCase()
  const fullName = body.full_name?.trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) {
    return json(400, { error: 'invalid_input' })
  }
  const phone = body.phone?.trim() || null
  if (phone && (phone.length > 32 || !/^[0-9+()\-\s.]+$/.test(phone))) return json(400, { error: 'invalid_phone' })
  // Регистрация сотрудника без проекта: у каждого должны быть организация и должность
  if (!body.project_id) {
    if (!body.organization_id) return json(400, { error: 'organization_required' })
    if (!body.position_role_id) return json(400, { error: 'job_title_required' })
  }

  const { data: me } = await caller.from('users').select('tenant_id').eq('id', userData.user.id).maybeSingle()
  if (!me) return json(403, { error: 'forbidden' })
  const tenantId = me.tenant_id as string

  const { data: perms } = await caller.rpc('my_permissions', body.project_id ? { p_project: body.project_id } : {})
  const permissions: string[] = perms ?? []
  // Ответственный от подрядчика приглашает только рядовых сотрудников своей организации
  const orgLeadOnly = !!body.project_id && !permissions.includes('project.members.manage') && permissions.includes('project.members.invite_org')
  const allowed = body.project_id ? permissions.includes('project.members.manage') || orgLeadOnly : permissions.includes('admin.users')
  if (!allowed) return json(403, { error: 'forbidden' })
  if (orgLeadOnly) {
    const { data: mine } = await admin.from('users').select('organization_id').eq('id', userData.user.id).maybeSingle()
    if (!mine?.organization_id) return json(403, { error: 'forbidden' })
    body.organization_id = mine.organization_id as string
  }

  // Роль проекта должна принадлежать тому же тенанту
  let isExternal = false
  if (body.project_id) {
    if (!body.project_role_id) return json(400, { error: 'project_role_required' })
    const { data: role } = await admin
      .from('roles')
      .select('code, scope, tenant_id')
      .eq('id', body.project_role_id)
      .maybeSingle()
    if (!role || role.tenant_id !== tenantId || role.scope !== 'project') return json(400, { error: 'invalid_role' })
    if (orgLeadOnly && role.code !== 'subcontractor') return json(403, { error: 'forbidden' })
    isExternal = EXTERNAL_ROLE_CODES.includes(role.code)

    const { data: project } = await admin.from('projects').select('id').eq('id', body.project_id).eq('tenant_id', tenantId).maybeSingle()
    if (!project) return json(400, { error: 'invalid_project' })
    if (body.discipline_id) {
      const { data: disc } = await admin.from('disciplines').select('id').eq('id', body.discipline_id).eq('project_id', body.project_id).is('deleted_at', null).maybeSingle()
      if (!disc) return json(400, { error: 'invalid_discipline' })
    }
  }
  if (isExternal && !body.organization_id) return json(400, { error: 'organization_required' })

  // Подпись под именем — название должности: в проекте или выбранной при регистрации без проекта
  const positionId = body.project_id ? body.project_role_id : body.position_role_id
  const { data: position } = await admin
    .from('roles')
    .select('name, code, scope, tenant_id')
    .eq('id', positionId ?? '')
    .is('deleted_at', null)
    .maybeSingle()
  if (!position || position.tenant_id !== tenantId || position.scope !== 'project') return json(400, { error: 'invalid_role' })
  if (!body.project_id && EXTERNAL_ROLE_CODES.includes(position.code)) return json(400, { error: 'invalid_role' })
  const jobTitle = position.name as string

  if (body.organization_id) {
    const { data: org } = await admin
      .from('organizations')
      .select('id')
      .eq('id', body.organization_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!org) return json(400, { error: 'invalid_organization' })
  }

  // Роль компании: только с правом admin.users, только своего тенанта и только внутреннему сотруднику
  let extraTenantRoleId: string | null = null
  if (body.tenant_role_id) {
    if (!permissions.includes('admin.users')) return json(403, { error: 'forbidden' })
    if (isExternal) return json(400, { error: 'tenant_role_internal_only' })
    const { data: tRole } = await admin
      .from('roles')
      .select('id, code')
      .eq('id', body.tenant_role_id)
      .eq('tenant_id', tenantId)
      .eq('scope', 'tenant')
      .is('deleted_at', null)
      .maybeSingle()
    if (!tRole) return json(400, { error: 'invalid_tenant_role' })
    if (tRole.code !== 'member') extraTenantRoleId = tRole.id as string
  }

  // Email уже есть в системе (в любой компании) — не приглашаем повторно.
  // Иначе GoTrue вернёт существующего неподтверждённого пользователя, а откат ниже удалил бы его.
  const { data: existing } = await admin.from('users').select('id').eq('email', email).maybeSingle()
  if (existing) return json(409, { error: 'email_taken' })

  // 1. Auth-пользователь + письмо с приглашением
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirect_to,
    data: { full_name: fullName },
  })
  if (inviteError || !invited.user) {
    console.error('inviteUserByEmail failed', inviteError)
    const taken =
      inviteError?.code === 'email_exists' ||
      inviteError?.status === 422 ||
      inviteError?.message?.toLowerCase().includes('already')
    if (taken) return json(409, { error: 'email_taken' })
    // GoTrue не смог отправить письмо (не настроен или недоступен SMTP): пользователь при этом не создан
    if (inviteError?.message?.toLowerCase().includes('sending')) return json(502, { error: 'email_send_failed' })
    return json(500, { error: 'invite_failed' })
  }
  const newUserId = invited.user.id
  // Откатывать (удалять) можно только только что созданного пользователя, а не чужой старый аккаунт
  const createdJustNow = Date.now() - new Date(invited.user.created_at).getTime() < 60_000

  // 2. Профиль, роль тенанта, участие в проекте — при любой ошибке откатываем auth-пользователя
  try {
    const { error: profileError } = await admin.from('users').insert({
      id: newUserId,
      tenant_id: tenantId,
      email,
      full_name: fullName,
      organization_id: body.organization_id ?? null,
      job_title: jobTitle,
      phone,
      is_external: isExternal,
      status: 'invited',
      created_by: userData.user.id,
    })
    if (profileError) throw profileError

    const { data: memberRole } = await admin
      .from('roles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('scope', 'tenant')
      .eq('code', 'member')
      .single()
    if (memberRole) {
      const { error } = await admin
        .from('user_tenant_roles')
        .insert({ tenant_id: tenantId, user_id: newUserId, role_id: memberRole.id })
      if (error) throw error
    }
    if (extraTenantRoleId) {
      const { error } = await admin
        .from('user_tenant_roles')
        .insert({ tenant_id: tenantId, user_id: newUserId, role_id: extraTenantRoleId })
      if (error) throw error
    }

    if (body.project_id && body.project_role_id) {
      const { error } = await admin.from('project_members').insert({
        tenant_id: tenantId,
        project_id: body.project_id,
        user_id: newUserId,
        role_id: body.project_role_id,
        organization_id: body.organization_id ?? null,
        discipline_id: body.discipline_id ?? null,
        created_by: userData.user.id,
      })
      if (error) throw error
    }
  } catch (e) {
    console.error('invite rollback', e)
    if (createdJustNow) await admin.auth.admin.deleteUser(newUserId)
    return json(500, { error: 'invite_failed' })
  }

  return json(200, { user_id: newUserId })
})
