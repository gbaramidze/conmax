-- S0 · Системные роли по умолчанию и создание тенанта (bootstrap первого администратора).
-- Матрица прав — сокращённая версия из 03-architecture/07-security-access.md; настраивается админом.

create or replace function private.seed_tenant_defaults(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- (scope, code, name, permissions[])
  r record;
  v_role uuid;

  -- наборы прав
  p_view text[] := array['project.view','task.view','task.view.internal','comment.create','comment.internal.view',
                         'meeting.view','schedule.view'];
  p_field text[] := array['task.create','task.edit.own','task.transition.own','comment.internal.create',
                          'progress.report','daily_log.create'];
  p_lead  text[] := array['task.edit.any','task.assign','task.transition.any','meeting.create','meeting.manage',
                          'meeting.conduct','decision.record','commitment.create','commitment.close',
                          'progress.approve','daily_log.approve','signal.view','risk.view','report.view'];
begin
  for r in
    select * from (values
      -- роли тенанта
      ('tenant','tenant_admin','Администратор', array[
        'admin.tenant','admin.users','admin.roles','admin.workflows','admin.templates','admin.reference_data',
        'admin.integrations','project.create','project.view.all','project.edit','project.members.manage',
        'project.settings.manage','project.archive','report.view','report.portfolio.view']),
      ('tenant','director','Директор / наблюдатель портфеля', array[
        'project.view.all','report.view','report.portfolio.view','signal.view','risk.view','budget.view']),
      ('tenant','member','Сотрудник', array[]::text[]),
      -- роли проекта
      ('project','project_manager','Руководитель проекта', p_view || p_field || p_lead || array[
        'project.edit','project.members.manage','project.settings.manage','location.manage','phase.manage',
        'gate.submit','milestone.manage','task.delete','comment.delete.any','comment.mark_decision',
        'meeting.minutes.publish','schedule.edit','schedule.import','baseline.create','period.manage',
        'budget.view','budget.approve','change.create','change.assess','change.approve','risk.manage','snapshot.create','signal.manage']),
      ('project','chief_engineer','ГИП', p_view || p_field || p_lead || array['gate.submit','change.create','change.assess']),
      ('project','pto','ПТО', p_view || p_field || p_lead || array['schedule.edit','schedule.import','baseline.create','budget.view']),
      ('project','foreman','Прораб', p_view || p_field || p_lead),
      ('project','master','Мастер', p_view || p_field),
      ('project','designer','Проектировщик', p_view || array['task.create','task.edit.own','task.transition.own','comment.internal.create']),
      ('project','economist','Экономист', p_view || array['task.create','budget.view','budget.edit','cost.record','signal.view','report.view']),
      ('project','safety_officer','Специалист по ОТ', p_view || array['task.create','meeting.manage','signal.view']),
      ('project','observer','Наблюдатель', p_view || array['signal.view','risk.view']),
      -- внешние: без task.view.internal и comment.internal.*
      ('project','subcontractor','Субподрядчик (внешний)', array['project.view','task.view','task.create','task.edit.own',
                          'task.transition.own','comment.create','progress.report']),
      ('project','client','Заказчик (внешний)', array['project.view','task.view','comment.create','meeting.view'])
    ) as x(scope, code, name, perms)
  loop
    insert into public.roles (tenant_id, scope, code, name, is_system)
    values (p_tenant, r.scope, r.code, r.name, true)
    returning id into v_role;

    insert into public.role_permissions (tenant_id, role_id, permission)
    select p_tenant, v_role, p from unnest(r.perms) as p
    on conflict do nothing;
  end loop;

  -- справочник дисциплин
  insert into public.disciplines (tenant_id, code, name, color) values
    (p_tenant, 'AR',  'Архитектурные решения',       'sky'),
    (p_tenant, 'KR',  'Конструктивные решения',      'amber'),
    (p_tenant, 'OV',  'Отопление и вентиляция',      'teal'),
    (p_tenant, 'VK',  'Водоснабжение и канализация', 'blue'),
    (p_tenant, 'EOM', 'Электроснабжение',            'orange'),
    (p_tenant, 'SS',  'Слаботочные системы',         'violet');
end;
$$;

-- Создание тенанта вызывающим пользователем (первый вход): он становится администратором.
-- После вызова клиент обязан обновить сессию (supabase.auth.refreshSession()), чтобы получить tenant_id в JWT.
create or replace function public.bootstrap_tenant(p_name text, p_slug text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_tenant  uuid;
  v_org     uuid;
  v_admin   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'user already belongs to a tenant' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.tenants (name, slug) values (p_name, p_slug) returning id into v_tenant;

  insert into public.users (id, tenant_id, email, full_name, status, created_by)
  values (v_uid, v_tenant, v_email, p_full_name, 'active', v_uid);

  insert into public.organizations (tenant_id, name, kind, created_by)
  values (v_tenant, p_name, 'own', v_uid) returning id into v_org;
  update public.users set organization_id = v_org where id = v_uid;

  perform private.seed_tenant_defaults(v_tenant);

  select id into v_admin from public.roles where tenant_id = v_tenant and scope = 'tenant' and code = 'tenant_admin';
  insert into public.user_tenant_roles (tenant_id, user_id, role_id) values (v_tenant, v_uid, v_admin);

  return v_tenant;
end;
$$;

revoke execute on function public.bootstrap_tenant from public, anon;
grant  execute on function public.bootstrap_tenant to authenticated;

-- Текущие права пользователя для UI (скрытие кнопок). Сервер всё равно проверяет через RLS.
create or replace function public.my_permissions(p_project uuid default null)
returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct permission), '{}') from (
    select rp.permission
    from public.user_tenant_roles utr
    join public.role_permissions rp on rp.role_id = utr.role_id
    where utr.user_id = auth.uid() and utr.tenant_id = private.tenant_id()
    union all
    select rp.permission
    from public.project_members pm
    join public.role_permissions rp on rp.role_id = pm.role_id
    where p_project is not null
      and pm.project_id = p_project and pm.user_id = auth.uid() and pm.tenant_id = private.tenant_id()
      and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
  ) s;
$$;

revoke execute on function public.my_permissions from public, anon;
grant  execute on function public.my_permissions to authenticated;
