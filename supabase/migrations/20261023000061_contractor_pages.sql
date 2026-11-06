-- Страница подрядчика: направления работ организации в проекте и должность/направление каждого сотрудника.
-- Руководитель проекта (project.members.manage) правит всё; ответственный от подрядчика (project.members.invite_org) —
-- только свою организацию и её сотрудников. Внешний видит только свою организацию (как и раньше, см. external_privacy).
-- См. docs: 05-roadmap/05-backlog.md, раздел «Страницы подрядчиков».

create table public.project_org_disciplines (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  discipline_id   uuid not null references public.disciplines(id),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references public.users(id),
  unique (project_id, organization_id, discipline_id)
);
create index on public.project_org_disciplines (project_id, organization_id);

alter table public.project_org_disciplines enable row level security;
alter table public.project_org_disciplines force row level security;
revoke insert, update, delete on public.project_org_disciplines from authenticated;
create policy project_org_disciplines_select on public.project_org_disciplines for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.can_see_project(project_id)
         and (private.can_see_internal(project_id) or organization_id = (select private.my_org_id())));

-- Кто может править организацию: руководитель проекта — любую, ответственный от подрядчика — только свою
create or replace function private.org_guard(p_project uuid, p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = private.tenant_id())
     or not private.can_see_project(p_project) then
    raise exception 'permission denied: project' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org and tenant_id = private.tenant_id() and deleted_at is null) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if private.has_project_permission(p_project, 'project.members.manage') then return; end if;
  if private.has_project_permission(p_project, 'project.members.invite_org') and p_org = private.my_org_id() then return; end if;
  raise exception 'permission denied: organization' using errcode = '42501';
end;
$$;

-- Направления работ организации в проекте: набор заменяется целиком
create or replace function public.org_disciplines_set(p_project uuid, p_org uuid, p_disciplines uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_disciplines, '{}')) x), '{}');
  v_n integer;
begin
  perform private.org_guard(p_project, p_org);
  select count(*) into v_n from public.disciplines d
   where d.id = any(v_ids) and d.project_id = p_project and d.deleted_at is null;
  if v_n <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'discipline_not_in_project' using errcode = '22023';
  end if;
  delete from public.project_org_disciplines where project_id = p_project and organization_id = p_org and discipline_id <> all(v_ids);
  insert into public.project_org_disciplines (tenant_id, project_id, organization_id, discipline_id)
  select private.tenant_id(), p_project, p_org, x from unnest(v_ids) x
  on conflict (project_id, organization_id, discipline_id) do nothing;
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- Должность и направление сотрудника организации в проекте
create or replace function public.org_member_update(p_member uuid, p_title text, p_discipline uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.project_members;
  v_org uuid;
begin
  select * into m from public.project_members where id = p_member and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  select organization_id into v_org from public.users where id = m.user_id;
  if not private.can_see_project(m.project_id) then raise exception 'permission denied: project' using errcode = '42501'; end if;
  if not (private.has_project_permission(m.project_id, 'project.members.manage')
          or (private.has_project_permission(m.project_id, 'project.members.invite_org') and v_org is not null and v_org = private.my_org_id())) then
    raise exception 'permission denied: member' using errcode = '42501';
  end if;
  if p_discipline is not null and not exists (
       select 1 from public.disciplines d where d.id = p_discipline and d.project_id = m.project_id and d.deleted_at is null) then
    raise exception 'discipline_not_in_project' using errcode = '22023';
  end if;
  if length(coalesce(p_title, '')) > 120 then raise exception 'title_too_long' using errcode = '22023'; end if;
  update public.project_members set title = nullif(btrim(coalesce(p_title, '')), ''), discipline_id = p_discipline where id = m.id;
end;
$$;

-- Сводка по организациям проекта: сотрудники, направления, позиции плана и открытые задачи.
-- Внутренним — все организации, участвующие в проекте (кроме своей компании); внешнему — только его организация.
create or replace function public.project_orgs_overview(p_project uuid)
returns table (organization_id uuid, name text, kind text, tax_id text, members integer, discipline_ids uuid[],
               work_items integer, open_tasks integer, overdue_tasks integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ext boolean := private.is_external();
  v_my uuid := private.my_org_id();
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = private.tenant_id())
     or not private.can_see_project(p_project) then
    raise exception 'permission denied: project' using errcode = '42501';
  end if;
  return query
  with orgs as (
    select o.id from public.organizations o
     where o.tenant_id = private.tenant_id() and o.deleted_at is null and o.is_active and o.kind <> 'own'
       and (not v_ext or o.id = v_my)
       and (
         exists (select 1 from public.project_members pm join public.users u on u.id = pm.user_id
                  where pm.project_id = p_project and pm.deleted_at is null and pm.left_at is null and u.organization_id = o.id)
         or exists (select 1 from public.work_items wi where wi.project_id = p_project and wi.contractor_org_id = o.id)
         or exists (select 1 from public.project_org_disciplines d where d.project_id = p_project and d.organization_id = o.id)
         or exists (select 1 from public.ffe_contracts c where c.project_id = p_project and c.organization_id = o.id and c.deleted_at is null)
       )
  )
  select o.id, o.name, o.kind, o.tax_id,
         (select count(*)::int from public.project_members pm join public.users u on u.id = pm.user_id
           where pm.project_id = p_project and pm.deleted_at is null and pm.left_at is null and u.organization_id = o.id),
         coalesce((select array_agg(d.discipline_id) from public.project_org_disciplines d where d.project_id = p_project and d.organization_id = o.id), '{}'),
         (select count(*)::int from public.work_items wi where wi.project_id = p_project and wi.contractor_org_id = o.id and wi.status = 'active' and wi.deleted_at is null),
         (select count(*)::int from public.tasks t join public.users u on u.id = t.assignee_id
           where t.project_id = p_project and t.deleted_at is null and t.status_category not in ('done', 'cancelled') and u.organization_id = o.id),
         (select count(*)::int from public.tasks t join public.users u on u.id = t.assignee_id
           where t.project_id = p_project and t.deleted_at is null and t.status_category not in ('done', 'cancelled') and u.organization_id = o.id
             and t.due_date < current_date)
    from public.organizations o join orgs on orgs.id = o.id
   order by o.name;
end;
$$;

revoke execute on function public.org_disciplines_set(uuid, uuid, uuid[]), public.org_member_update(uuid, text, uuid), public.project_orgs_overview(uuid) from public, anon;
grant  execute on function public.org_disciplines_set(uuid, uuid, uuid[]), public.org_member_update(uuid, text, uuid), public.project_orgs_overview(uuid) to authenticated;
grant execute on all functions in schema private to authenticated, supabase_auth_admin;

notify pgrst, 'reload schema';
