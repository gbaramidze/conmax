-- Доступ к модулям проекта: модуль можно открыть не всем участникам, а только выбранным людям и ролям.
-- См. docs: 04-modules/29-project-modules.md («Доступ к модулям»).
--
-- По умолчанию модуль виден всем участникам по их ролям (как раньше). Если модуль ограничен
-- (`project_module_restrictions`), его права (budget.*, schedule.*, procurement.* …) у остальных участников проекта
-- перестают действовать: проверка `private.user_has_project_permission` возвращает «нет», поэтому RLS и функции модуля
-- не отдают его данные и не дают их менять, а уведомления модуля не уходят. Тот, кто настраивает проект
-- (`project.settings.manage`), доступ не теряет — иначе можно закрыть модуль от самого себя.

create table public.project_module_restrictions (
  project_id    uuid not null references public.projects(id) on delete cascade,
  module        text not null check (module = any (private.project_module_keys())),
  tenant_id     uuid not null references public.tenants(id),
  restricted_at timestamptz not null default now(),
  restricted_by uuid default auth.uid() references public.users(id),
  primary key (project_id, module)
);

create table public.project_module_access (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  module     text not null check (module = any (private.project_module_keys())),
  user_id    uuid references public.users(id),
  role_id    uuid references public.roles(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users(id),
  check ((user_id is null) <> (role_id is null))
);
create unique index project_module_access_user on public.project_module_access (project_id, module, user_id) where user_id is not null;
create unique index project_module_access_role on public.project_module_access (project_id, module, role_id) where role_id is not null;

do $$
declare t text;
begin
  foreach t in array array['project_module_restrictions', 'project_module_access'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- К какому модулю относится право. null — право не модульное (задачи, совещания, проект, администрирование).
create or replace function private.permission_module(p_permission text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_permission like 'budget.%' or p_permission in ('cost.record', 'snapshot.create') or p_permission like 'risk.%' then 'budget'
    when p_permission like 'change.%' then 'contracts'
    when p_permission like 'schedule.%' or p_permission like 'progress.%' or p_permission like 'daily_log.%'
         or p_permission in ('baseline.create', 'period.manage', 'workitem.manage') then 'schedule'
    when p_permission like 'document.%' then 'documents'
    when p_permission like 'procurement.%' then 'procurement'
    when p_permission like 'inspection.%' or p_permission like 'walk.%' or p_permission like 'signal.%' then 'reporting'
    else null
  end
$$;

-- Прежняя проверка права без учёта доступа к модулям (тенантная роль или роль в проекте)
create or replace function private.user_has_project_permission_base(p_user uuid, p_project uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.projects p
           where p.id = p_project and private.user_has_tenant_permission(p_user, p.tenant_id, p_permission))
      or exists (
           select 1
           from public.project_members pm
           join public.role_permissions rp on rp.role_id = pm.role_id
           where pm.project_id = p_project and pm.user_id = p_user
             and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
             and rp.permission = p_permission);
$$;

-- Открыт ли модуль человеку: модуль не ограничен, или человек (его роль в проекте) в списке, или он настраивает проект
create or replace function private.user_module_allowed(p_user uuid, p_project uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_module is null
      or not exists (select 1 from public.project_module_restrictions r where r.project_id = p_project and r.module = p_module)
      or exists (select 1 from public.project_module_access a where a.project_id = p_project and a.module = p_module and a.user_id = p_user)
      or exists (select 1 from public.project_module_access a
                   join public.project_members pm on pm.role_id = a.role_id and pm.project_id = a.project_id
                  where a.project_id = p_project and a.module = p_module and pm.user_id = p_user
                    and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date))
      or private.user_has_project_permission_base(p_user, p_project, 'project.settings.manage');
$$;

-- Право в проекте с учётом доступа к модулю — на этой функции стоят RLS, функции и уведомления модулей
create or replace function private.user_has_project_permission(p_user uuid, p_project uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_has_project_permission_base(p_user, p_project, p_permission)
     and private.user_module_allowed(p_user, p_project, private.permission_module(p_permission));
$$;

-- Права текущего пользователя для интерфейса — без прав закрытых для него модулей
create or replace function public.my_permissions(p_project uuid default null) returns text[]
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
  ) s
  where p_project is null or private.user_module_allowed(auth.uid(), p_project, private.permission_module(permission));
$$;

-- Модули проекта, закрытые для текущего пользователя (для меню и страниц)
create or replace function public.my_blocked_modules(p_project uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.module order by r.module), '{}')
    from public.project_module_restrictions r
   where r.project_id = p_project and r.tenant_id = private.tenant_id()
     and not private.user_module_allowed(auth.uid(), p_project, r.module);
$$;

-- Ограничить модуль выбранными людьми и ролями (p_restricted = false — снова открыть всем участникам)
create or replace function public.set_project_module_access(p_project uuid, p_module text, p_restricted boolean, p_users uuid[] default '{}', p_roles uuid[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
begin
  perform private.settings_guard(p_project, array['project.settings.manage']);
  if p_module is null or not (p_module = any (private.project_module_keys())) then
    raise exception 'unknown_module' using errcode = '22023';
  end if;
  delete from public.project_module_access where project_id = p_project and module = p_module;
  if not coalesce(p_restricted, false) then
    delete from public.project_module_restrictions where project_id = p_project and module = p_module;
    return;
  end if;
  insert into public.project_module_restrictions (project_id, module, tenant_id, restricted_by)
  values (p_project, p_module, v_tenant, auth.uid())
  on conflict (project_id, module) do update set restricted_at = now(), restricted_by = auth.uid();
  insert into public.project_module_access (tenant_id, project_id, module, user_id, created_by)
  select v_tenant, p_project, p_module, u, auth.uid()
    from unnest(coalesce(p_users, '{}')) u
   where exists (select 1 from public.users x where x.id = u and x.tenant_id = v_tenant)
  on conflict do nothing;
  insert into public.project_module_access (tenant_id, project_id, module, role_id, created_by)
  select v_tenant, p_project, p_module, r, auth.uid()
    from unnest(coalesce(p_roles, '{}')) r
   where exists (select 1 from public.roles x where x.id = r)
  on conflict do nothing;
end;
$$;

revoke execute on function public.my_blocked_modules(uuid), public.set_project_module_access(uuid, text, boolean, uuid[], uuid[]) from public, anon;
grant execute on function public.my_blocked_modules(uuid), public.set_project_module_access(uuid, text, boolean, uuid[], uuid[]) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
