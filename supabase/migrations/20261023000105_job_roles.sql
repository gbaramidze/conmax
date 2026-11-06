-- Должностные роли проекта: архитекторы, инженеры, координаторы, финансисты, служба безопасности.
--
-- Рядом с общими ролями («Руководитель проекта», «ГИП», «Прораб»…) компании нужны роли по должностям, как они названы в самой компании.
-- Здесь заведены 14 ролей проекта; права каждой скопированы с самой похожей существующей роли и, где нужно, дополнены.
-- Роли не системные: администратор правит их права, переименовывает и удаляет на странице «Роли и права».
-- «Project Manager» и «Director» отдельно не заводятся: это уже есть («Руководитель проекта» — роль проекта, «Директор / наблюдатель
-- портфеля» — роль компании).
--
--   Main Architect, Chief Electrical Engineer, Chief Mechanical Engineer  ← ГИП (chief_engineer)
--   Architect, Electrical Engineer, Mechanical Engineer, Low-current Systems Engineer ← Проектировщик (designer)
--   Senior Project Coordinator ← Прораб (foreman);  Project Coordinator ← Мастер (master)
--   Senior Financial Manager ← Экономист + утверждение бюджета и оценка изменений;  Financial Manager ← Экономист
--   Project Owner ← Наблюдатель + бюджет и отчёты проекта (внутренняя роль; заказчик снаружи остаётся ролью «Заказчик»)
--   Security Manager ← Специалист по ОТ;  Senior Security Manager ← он же + управление задачами, совещания, риски, отчёты
--
-- Роли заводятся и для новых компаний: `seed_tenant_defaults` теперь вызывает `seed_job_roles` после базовых ролей.
-- Повторный запуск безопасен: уже существующую роль (по коду) не трогает и права не перезаписывает.
-- См. docs: 04-modules/02-identity-org.md, раздел «Роли и права».

create or replace function private.seed_job_roles(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  v_role uuid;
begin
  for r in
    select * from (values
      ('main_architect',            'Main Architect',                'chief_engineer', array[]::text[]),
      ('architect',                 'Architect',                     'designer',       array[]::text[]),
      ('chief_electrical_engineer', 'Chief Electrical Engineer',     'chief_engineer', array[]::text[]),
      ('electrical_engineer',       'Electrical Engineer',           'designer',       array[]::text[]),
      ('chief_mechanical_engineer', 'Chief Mechanical Engineer',     'chief_engineer', array[]::text[]),
      ('mechanical_engineer',       'Mechanical Engineer',           'designer',       array[]::text[]),
      ('low_current_engineer',      'Low-current Systems Engineer',  'designer',       array[]::text[]),
      ('senior_project_coordinator','Senior Project Coordinator',    'foreman',        array[]::text[]),
      ('project_coordinator',       'Project Coordinator',           'master',         array[]::text[]),
      ('senior_financial_manager',  'Senior Financial Manager',      'economist',      array['budget.approve', 'change.assess']),
      ('financial_manager',         'Financial Manager',             'economist',      array[]::text[]),
      ('project_owner',             'Project Owner',                 'observer',       array['budget.view', 'report.view']),
      ('security_manager',          'Security Manager',              'safety_officer', array[]::text[]),
      ('senior_security_manager',   'Senior Security Manager',       'safety_officer',
        array['task.assign', 'task.edit.any', 'task.transition.any', 'meeting.create', 'risk.view', 'report.view'])
    ) as x(code, name, copy_from, extra)
  loop
    v_role := null;
    insert into public.roles (tenant_id, scope, code, name, is_system)
    values (p_tenant, 'project', r.code, r.name, false)
    on conflict (tenant_id, scope, code) do nothing
    returning id into v_role;
    if v_role is null then continue; end if;

    insert into public.role_permissions (tenant_id, role_id, permission)
    select p_tenant, v_role, rp.permission
      from public.role_permissions rp
      join public.roles src on src.id = rp.role_id
     where src.tenant_id = p_tenant and src.scope = 'project' and src.code = r.copy_from
    on conflict do nothing;

    insert into public.role_permissions (tenant_id, role_id, permission)
    select p_tenant, v_role, x from unnest(r.extra) x
    on conflict do nothing;
  end loop;
end;
$$;

-- Существующие компании
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform private.seed_job_roles(t.id);
  end loop;
end $$;

-- Новые компании: базовые роли, затем должностные
alter function private.seed_tenant_defaults(uuid) rename to seed_tenant_base;
create function private.seed_tenant_defaults(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_tenant_base(p_tenant);
  perform private.seed_job_roles(p_tenant);
end;
$$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
