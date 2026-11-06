-- S2 · Локации (LBS): дерево корпус → секция → этаж → зона → помещение, генератор, привязка задач.
-- См. docs: 03-architecture/04-data-model.md §5, 04-modules/04-tasks.md

create table public.locations (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  version     integer not null default 1,
  deleted_at  timestamptz,
  project_id  uuid not null references public.projects(id) on delete cascade,
  parent_id   uuid references public.locations(id),
  kind        text not null check (kind in ('site','building','section','floor','zone','room','other')),
  code        text not null check (code ~ '^[A-Z0-9_]{1,20}$'),      -- K2, S1, F05, B1
  name        text not null check (length(btrim(name)) between 1 and 200),
  path        extensions.ltree not null,                               -- K2.S1.F05
  sort        integer not null default 0,
  elevation   numeric(8,3),
  unique (project_id, path)
);
create index on public.locations using gist (path);
create index on public.locations (tenant_id, project_id, sort);

create trigger touch before update on public.locations for each row execute function private.touch();

-- Путь строится сервером из кодов родителей; клиент его не задаёт
create or replace function private.locations_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent_path text;
begin
  new.tenant_id := private.tenant_id();
  new.code := upper(btrim(new.code));
  if new.parent_id is null then
    new.path := new.code::extensions.ltree;
  else
    select l.path::text into v_parent_path
      from public.locations l
     where l.id = new.parent_id and l.project_id = new.project_id and l.deleted_at is null;
    if v_parent_path is null then
      raise exception 'parent location not found in this project' using errcode = '23503';
    end if;
    new.path := (v_parent_path || '.' || new.code)::extensions.ltree;
  end if;
  return new;
end;
$$;
create trigger locations_before_insert before insert on public.locations
  for each row execute function private.locations_before_insert();

-- Архивировать можно только узел без активных потомков
create or replace function private.locations_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and exists (
    select 1 from public.locations c where c.parent_id = old.id and c.deleted_at is null
  ) then
    raise exception 'location has active children' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger locations_before_update before update on public.locations
  for each row execute function private.locations_before_update();

alter table public.locations enable row level security;
alter table public.locations force row level security;

create policy locations_select on public.locations for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));
create policy locations_insert on public.locations for insert to authenticated
  with check (private.can_see_project(project_id) and private.has_project_permission(project_id, 'location.manage'));
create policy locations_update on public.locations for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.has_project_permission(project_id, 'location.manage'))
  with check (tenant_id = (select private.tenant_id()));

-- Код и родитель после создания не меняются (на них держатся пути и привязки)
revoke insert, update on public.locations from authenticated;
grant insert (project_id, parent_id, kind, code, name, sort, elevation) on public.locations to authenticated;
grant update (name, sort, elevation, deleted_at) on public.locations to authenticated;

-- ---------------------------------------------------------------------------
-- Генератор корпуса: K2 → секции S1..Sn → этажи (B1 — подвал, F01… — надземные)
-- ---------------------------------------------------------------------------
create or replace function public.generate_building(
  p_project     uuid,
  p_code        text,
  p_name        text,
  p_sections    integer default 0,
  p_floor_from  integer default 1,
  p_floor_to    integer default 1
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_building uuid;
  v_section  uuid;
  v_created  integer := 1;
  v_sec      integer;
  v_floor    integer;
  v_parent   uuid;
  v_sort     integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'location.manage') then
    raise exception 'permission denied: location.manage' using errcode = '42501';
  end if;
  if p_sections < 0 or p_sections > 50 or p_floor_from > p_floor_to or p_floor_to - p_floor_from > 150
     or greatest(p_sections, 1) * (p_floor_to - p_floor_from + 1) > 2000 then
    raise exception 'invalid generator parameters' using errcode = '22023';
  end if;

  select coalesce(max(sort), 0) + 1 into v_sort
    from public.locations where project_id = p_project and parent_id is null;

  insert into public.locations (project_id, kind, code, name, sort)
  values (p_project, 'building', p_code, btrim(p_name), v_sort)
  returning id into v_building;

  for v_sec in 1 .. greatest(p_sections, 1) loop
    if p_sections > 0 then
      insert into public.locations (project_id, parent_id, kind, code, name, sort)
      values (p_project, v_building, 'section', 'S' || v_sec, 'Секция ' || v_sec, v_sec)
      returning id into v_section;
      v_created := v_created + 1;
      v_parent := v_section;
    else
      v_parent := v_building;
    end if;

    for v_floor in p_floor_from .. p_floor_to loop
      continue when v_floor = 0;      -- нулевого этажа нет
      insert into public.locations (project_id, parent_id, kind, code, name, sort, elevation)
      values (
        p_project, v_parent, 'floor',
        case when v_floor < 0 then 'B' || abs(v_floor) else 'F' || lpad(v_floor::text, 2, '0') end,
        'Этаж ' || v_floor,
        v_floor, null);
      v_created := v_created + 1;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.generate_building from public, anon;
grant  execute on function public.generate_building to authenticated;

-- ---------------------------------------------------------------------------
-- Привязка задач к локации
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column location_id   uuid references public.locations(id),
  add column location_path text;           -- денормализация для быстрого фильтра по поддереву: path LIKE 'K2.S1.%'
create index on public.tasks (tenant_id, project_id, location_id);
create index on public.tasks (project_id, location_path text_pattern_ops);

create or replace function private.tasks_set_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.location_id is null then
    if new.type = 'punch' then
      raise exception 'location_required' using errcode = '22023';
    end if;
    new.location_path := null;
  elsif tg_op = 'INSERT' or new.location_id is distinct from old.location_id then
    select l.path::text into new.location_path
      from public.locations l
     where l.id = new.location_id and l.project_id = new.project_id and l.deleted_at is null;
    if new.location_path is null then
      raise exception 'location not found in this project' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
create trigger tasks_set_location before insert or update on public.tasks
  for each row execute function private.tasks_set_location();

grant update (location_id) on public.tasks to authenticated;

-- location_path — производное поле, в ленту изменений не попадает
create or replace function private.tasks_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_changes jsonb;
  v_from text;
  v_to   text;
begin
  if tg_op = 'INSERT' then
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'created',
                                 jsonb_build_object('key', new.key, 'title', new.title), 'external');
    return new;
  end if;

  if new.status_id is distinct from old.status_id then
    select name into v_from from public.workflow_statuses where id = old.status_id;
    select name into v_to   from public.workflow_statuses where id = new.status_id;
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'status_changed',
      jsonb_strip_nulls(jsonb_build_object(
        'status', jsonb_build_array(v_from, v_to),
        'reason_code', new.blocked_reason_code)), 'external');
  end if;

  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}') into v_changes
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value
     and n.key not in ('updated_at','updated_by','version','status_id','status_category','completed_at',
                       'closed_at','actual_start','blocked_reason_code','blocked_comment',
                       'priority_rank','status_rank','location_path');
  if v_changes <> '{}' then
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'field_changed', v_changes,
      case when v_changes ? 'assignee_id' then 'external' else 'internal' end);
  end if;
  return new;
end;
$$;

-- create_task: + локация (для замечаний обязательна — проверяет триггер)
drop function if exists public.create_task(uuid, text, text, uuid, date, text, uuid, uuid);

create or replace function public.create_task(
  p_project      uuid,
  p_title        text,
  p_type         text default 'task',
  p_assignee     uuid default null,
  p_due_date     date default null,
  p_priority     text default 'normal',
  p_organization uuid default null,
  p_discipline   uuid default null,
  p_location     uuid default null
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_tenant   uuid := private.tenant_id();
  v_project  public.projects;
  v_prefix   text;
  v_workflow uuid;
  v_status   public.workflow_statuses;
  v_number   integer;
  v_org      uuid := p_organization;
  v_task     public.tasks;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if not found or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'task.create') then
    raise exception 'permission denied: task.create' using errcode = '42501';
  end if;

  v_prefix := case p_type
    when 'task' then 'T' when 'punch' then 'P' when 'rfi' then 'RFI'
    when 'action_item' then 'A' when 'issue' then 'I' when 'constraint' then 'C'
  end;
  if v_prefix is null then
    raise exception 'unknown task type' using errcode = '22023';
  end if;

  if p_discipline is not null and not exists (
    select 1 from public.disciplines d where d.id = p_discipline and d.tenant_id = v_tenant) then
    raise exception 'discipline belongs to another tenant' using errcode = '23514';
  end if;
  if v_org is not null and not exists (
    select 1 from public.organizations o where o.id = v_org and o.tenant_id = v_tenant) then
    raise exception 'organization belongs to another tenant' using errcode = '23514';
  end if;

  if p_assignee is not null then
    if not private.has_project_permission(p_project, 'task.assign') then
      raise exception 'permission denied: task.assign' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project and pm.user_id = p_assignee and pm.deleted_at is null
        and (pm.left_at is null or pm.left_at > current_date)
    ) then
      raise exception 'assignee is not a project member' using errcode = '23514';
    end if;
    v_org := coalesce(v_org, (select organization_id from public.users where id = p_assignee));
  end if;

  if private.is_external() then
    v_org := private.my_org_id();
  end if;

  select id into v_workflow from public.workflows
   where tenant_id = v_tenant and entity_type = 'task' and (subtype = p_type or (subtype is null and is_default))
   order by (subtype is null) limit 1;
  select * into v_status from public.workflow_statuses
   where workflow_id = v_workflow order by sort limit 1;
  if v_status.id is null then
    raise exception 'workflow is not configured' using errcode = '22023';
  end if;

  insert into public.project_counters as pc (project_id, kind, last_number)
  values (p_project, v_prefix, 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;

  insert into public.tasks (
    tenant_id, project_id, number, key, type, title, workflow_id, status_id, status_category,
    priority, reporter_id, assignee_id, organization_id, due_date, discipline_id, location_id, created_by
  ) values (
    v_tenant, p_project, v_number, v_project.code || '-' || v_prefix || '-' || v_number, p_type, btrim(p_title),
    v_workflow, v_status.id, v_status.category, p_priority, v_uid, p_assignee, v_org, p_due_date, p_discipline,
    p_location, v_uid
  ) returning * into v_task;

  return v_task;
end;
$$;

revoke execute on function public.create_task from public, anon;
grant  execute on function public.create_task to authenticated;

alter publication supabase_realtime add table public.locations;
