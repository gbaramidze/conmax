-- S3.5 · Объёмы работ по местам, обходы с контролем полноты, факт (приращениями).
-- См. docs: 04-modules/26-field-work.md §6, ADR-013.

-- ---------------------------------------------------------------------------
-- Права: добавляются ролям автоматически (и существующим, и новым)
-- ---------------------------------------------------------------------------
create or replace function private.field_permissions_for(p_scope text, p_code text) returns text[]
language sql immutable as $$
  select case
    when p_scope = 'project' and p_code = 'project_manager' then array['workitem.manage','walk.create','walk.approve']
    when p_scope = 'project' and p_code = 'chief_engineer'  then array['workitem.manage','walk.create']
    when p_scope = 'project' and p_code = 'pto'             then array['workitem.manage','walk.create','walk.approve']
    when p_scope = 'project' and p_code = 'economist'       then array['workitem.manage']
    when p_scope = 'project' and p_code in ('foreman','master','safety_officer','subcontractor') then array['walk.create']
    when p_scope = 'tenant'  and p_code = 'tenant_admin'    then array['workitem.manage','walk.approve']
    else array[]::text[]
  end;
$$;

create or replace function private.roles_field_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_system then
    insert into public.role_permissions (tenant_id, role_id, permission)
    select new.tenant_id, new.id, p from unnest(private.field_permissions_for(new.scope, new.code)) p
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger roles_field_permissions after insert on public.roles
  for each row execute function private.roles_field_permissions();

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, p
  from public.roles r, lateral unnest(private.field_permissions_for(r.scope, r.code)) p
 where r.is_system
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Вспомогательное
-- ---------------------------------------------------------------------------
create or replace function private.path_in_subtree(p_path text, p_root text) returns boolean
language sql immutable as $$
  select p_path = p_root or position(p_root || '.' in p_path) = 1;
$$;

-- ---------------------------------------------------------------------------
-- Объёмы работ (план): место × направление × подрядчик × объём
-- ---------------------------------------------------------------------------
create table public.work_items (
  id                uuid primary key default public.uuidv7(),
  tenant_id         uuid not null references public.tenants(id),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  version           integer not null default 1,
  deleted_at        timestamptz,
  project_id        uuid not null references public.projects(id) on delete cascade,
  location_id       uuid not null references public.locations(id),
  location_path     text not null,                                  -- выводится триггером (для выборок по поддереву)
  discipline_id     uuid references public.disciplines(id),
  contractor_org_id uuid references public.organizations(id),
  name              text not null check (length(btrim(name)) between 1 and 200),
  unit              text not null check (length(btrim(unit)) between 1 and 20),
  planned_qty       numeric(18,4) not null check (planned_qty >= 0),
  planned_start     date,
  planned_finish    date,
  activity_id       uuid,                                           -- связь с графиком (S4)
  status            text not null default 'active' check (status in ('active','cancelled'))
);
create index on public.work_items (tenant_id, project_id, status);
create index on public.work_items (project_id, location_path text_pattern_ops);
create index on public.work_items (tenant_id, contractor_org_id);

create trigger touch before update on public.work_items for each row execute function private.touch();

create or replace function private.work_items_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id := coalesce(private.tenant_id(), new.tenant_id);
  select l.path::text into new.location_path
    from public.locations l
   where l.id = new.location_id and l.project_id = new.project_id and l.tenant_id = new.tenant_id and l.deleted_at is null;
  if new.location_path is null then
    raise exception 'location not found in this project' using errcode = '23503';
  end if;
  if new.discipline_id is not null and not exists (
    select 1 from public.disciplines d where d.id = new.discipline_id and d.project_id = new.project_id and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
  end if;
  if new.contractor_org_id is not null and not exists (
    select 1 from public.organizations o where o.id = new.contractor_org_id and o.tenant_id = new.tenant_id) then
    raise exception 'organization belongs to another tenant' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger work_items_before_insert before insert on public.work_items
  for each row execute function private.work_items_before_insert();

-- Правка: направление и подрядчик проверяются так же, как при создании
create or replace function private.work_items_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.discipline_id is distinct from old.discipline_id and new.discipline_id is not null and not exists (
    select 1 from public.disciplines d where d.id = new.discipline_id and d.project_id = old.project_id and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
  end if;
  if new.contractor_org_id is distinct from old.contractor_org_id and new.contractor_org_id is not null and not exists (
    select 1 from public.organizations o where o.id = new.contractor_org_id and o.tenant_id = old.tenant_id) then
    raise exception 'organization belongs to another tenant' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger work_items_before_update before update on public.work_items
  for each row execute function private.work_items_before_update();

alter table public.work_items enable row level security;
alter table public.work_items force row level security;

-- Внутренние видят весь план; внешние (подрядчики) — только позиции своей организации
create policy work_items_select on public.work_items for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.can_see_project(project_id)
    and (private.can_see_internal(project_id)
         or (contractor_org_id is not null and contractor_org_id = (select private.my_org_id())))
  );
create policy work_items_insert on public.work_items for insert to authenticated
  with check (private.can_see_project(project_id) and private.has_project_permission(project_id, 'workitem.manage'));
create policy work_items_update on public.work_items for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.has_project_permission(project_id, 'workitem.manage'))
  with check (tenant_id = (select private.tenant_id()));

revoke insert, update on public.work_items from authenticated;
grant insert (project_id, location_id, discipline_id, contractor_org_id, name, unit, planned_qty, planned_start, planned_finish)
  on public.work_items to authenticated;
grant update (discipline_id, contractor_org_id, name, unit, planned_qty, planned_start, planned_finish, status, deleted_at)
  on public.work_items to authenticated;

insert into public.entity_types (code, module, features) values
  ('work_item', 'field', array['comments','attachments','activity']);

-- ---------------------------------------------------------------------------
-- Обходы
-- ---------------------------------------------------------------------------
create table public.site_walks (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  location_id   uuid not null references public.locations(id),
  location_path text not null,
  author_id     uuid not null references public.users(id),
  status        text not null default 'draft' check (status in ('draft','submitted','approved')),
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  approved_by   uuid references public.users(id),
  approved_at   timestamptz
);
create index on public.site_walks (tenant_id, project_id, status);
create index on public.site_walks (author_id, status);

create table public.site_walk_results (
  walk_id       uuid not null references public.site_walks(id) on delete cascade,
  work_item_id  uuid not null references public.work_items(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id),
  result        text not null check (result in ('progress','no_work','blocked')),
  qty           numeric(18,4) check (qty is null or qty > 0),
  reason_code   text,
  comment       text,
  updated_at    timestamptz not null default now(),
  primary key (walk_id, work_item_id),
  check ((result = 'progress') = (qty is not null))
);

create table public.work_progress (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  walk_id      uuid references public.site_walks(id),
  entry_date   date not null default current_date,
  qty          numeric(18,4) not null check (qty > 0),
  reported_by  uuid not null references public.users(id),
  approved_by  uuid references public.users(id),
  approved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.work_progress (work_item_id);
create index on public.work_progress (walk_id);

alter table public.site_walks enable row level security;
alter table public.site_walks force row level security;
alter table public.site_walk_results enable row level security;
alter table public.site_walk_results force row level security;
alter table public.work_progress enable row level security;
alter table public.work_progress force row level security;

-- Обход видит автор; завершённые — внутренние участники проекта
create policy site_walks_select on public.site_walks for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (author_id = (select auth.uid())
         or (status <> 'draft' and private.can_see_project(project_id) and private.can_see_internal(project_id)))
  );
create policy site_walk_results_select on public.site_walk_results for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.site_walks w where w.id = walk_id));
-- факт виден тем, кто видит саму позицию плана
create policy work_progress_select on public.work_progress for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.work_items wi where wi.id = work_item_id));
-- Записи — только функциями ниже (политик на запись нет)

-- Позиции плана с выполнением: подтверждённый факт и ожидающий подтверждения
create view public.work_items_progress with (security_invoker = true) as
select wi.*,
       coalesce((select sum(wp.qty) from public.work_progress wp
                  where wp.work_item_id = wi.id and wp.approved_at is not null), 0) as done_qty,
       coalesce((select sum(wp.qty) from public.work_progress wp
                  where wp.work_item_id = wi.id and wp.approved_at is null), 0) as pending_qty
  from public.work_items wi
 where wi.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Начать обход (или вернуть незавершённый на том же месте)
-- ---------------------------------------------------------------------------
create or replace function public.start_walk(p_project uuid, p_location uuid) returns public.site_walks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := private.tenant_id();
  v_loc    public.locations;
  v_walk   public.site_walks;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'walk.create') then
    raise exception 'permission denied: walk.create' using errcode = '42501';
  end if;
  select * into v_loc from public.locations
   where id = p_location and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'location not found' using errcode = '23503';
  end if;

  select * into v_walk from public.site_walks
   where author_id = v_uid and location_id = p_location and status = 'draft' limit 1;
  if found then return v_walk; end if;

  insert into public.site_walks (tenant_id, project_id, location_id, location_path, author_id)
  values (v_tenant, p_project, p_location, v_loc.path::text, v_uid)
  returning * into v_walk;
  return v_walk;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ожидаемые в обходе позиции: незавершённые в поддереве места (внешним — только свои)
-- ---------------------------------------------------------------------------
create or replace function private.walk_expected_items(p_walk public.site_walks)
returns setof public.work_items
language sql stable security definer set search_path = '' as $$
  select wi.*
    from public.work_items wi
   where wi.project_id = p_walk.project_id and wi.status = 'active' and wi.deleted_at is null
     and private.path_in_subtree(wi.location_path, p_walk.location_path)
     and (private.can_see_internal(wi.project_id) or wi.contractor_org_id = private.my_org_id())
     and (select coalesce(sum(wp.qty), 0) from public.work_progress wp where wp.work_item_id = wi.id) < wi.planned_qty;
$$;

-- Исход по позиции (черновик обхода). Повторный вызов заменяет исход.
create or replace function public.save_walk_result(
  p_walk        uuid,
  p_item        uuid,
  p_result      text,
  p_qty         numeric default null,
  p_reason_code text default null,
  p_comment     text default null
) returns public.site_walk_results
language plpgsql security definer set search_path = '' as $$
declare
  v_walk   public.site_walks;
  v_res    public.site_walk_results;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_walk from public.site_walks where id = p_walk and author_id = auth.uid() and tenant_id = private.tenant_id();
  if not found then raise exception 'walk_not_found' using errcode = 'P0002'; end if;
  if v_walk.status <> 'draft' then raise exception 'walk_closed' using errcode = '22023'; end if;

  if not exists (select 1 from private.walk_expected_items(v_walk) e where e.id = p_item) then
    raise exception 'item_not_expected' using errcode = '22023';
  end if;
  if p_result not in ('progress', 'no_work', 'blocked') then
    raise exception 'invalid_result' using errcode = '22023';
  end if;
  if p_result = 'progress' and (p_qty is null or p_qty <= 0) then
    raise exception 'qty_required' using errcode = '22023';
  end if;
  if p_result = 'blocked' then
    if p_reason_code is null or not exists (
      select 1 from public.reason_codes rc where rc.tenant_id = v_walk.tenant_id and rc.code = p_reason_code and rc.is_active) then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    if p_reason_code = 'other' and v_comment is null then
      raise exception 'comment_required' using errcode = '22023';
    end if;
  end if;

  insert into public.site_walk_results (walk_id, work_item_id, tenant_id, result, qty, reason_code, comment)
  values (p_walk, p_item, v_walk.tenant_id, p_result,
          case when p_result = 'progress' then p_qty end,
          case when p_result = 'blocked' then p_reason_code end,
          v_comment)
  on conflict (walk_id, work_item_id) do update set
    result = excluded.result, qty = excluded.qty, reason_code = excluded.reason_code,
    comment = excluded.comment, updated_at = now()
  returning * into v_res;
  return v_res;
end;
$$;

create or replace function public.clear_walk_result(p_walk uuid, p_item uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.site_walk_results r
   using public.site_walks w
   where r.walk_id = p_walk and r.work_item_id = p_item
     and w.id = r.walk_id and w.author_id = auth.uid() and w.status = 'draft';
$$;

-- ---------------------------------------------------------------------------
-- Завершить обход: только при полном заполнении; факт записывается приращениями
-- ---------------------------------------------------------------------------
create or replace function public.submit_walk(p_walk uuid) returns public.site_walks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_walk    public.site_walks;
  v_missing integer;
  v_auto    boolean;
  v_counts  jsonb;
begin
  select * into v_walk from public.site_walks where id = p_walk and author_id = v_uid and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'walk_not_found' using errcode = 'P0002'; end if;
  if v_walk.status <> 'draft' then raise exception 'walk_closed' using errcode = '22023'; end if;

  select count(*) into v_missing
    from private.walk_expected_items(v_walk) e
   where not exists (select 1 from public.site_walk_results r where r.walk_id = p_walk and r.work_item_id = e.id);
  if v_missing > 0 then
    raise exception 'walk_incomplete' using errcode = '22023', hint = v_missing::text;
  end if;

  -- без подтверждения факт принимается сразу
  select coalesce((p.settings ->> 'progress_approval')::boolean, false) = false into v_auto
    from public.projects p where p.id = v_walk.project_id;

  insert into public.work_progress (tenant_id, project_id, work_item_id, walk_id, qty, reported_by, approved_by, approved_at)
  select v_walk.tenant_id, v_walk.project_id, r.work_item_id, p_walk, r.qty, v_uid,
         case when v_auto then v_uid end, case when v_auto then now() end
    from public.site_walk_results r
   where r.walk_id = p_walk and r.result = 'progress';

  update public.site_walks set
    status = case when v_auto then 'approved' else 'submitted' end,
    submitted_at = now(),
    approved_by = case when v_auto then v_uid end,
    approved_at = case when v_auto then now() end
  where id = p_walk returning * into v_walk;

  select jsonb_build_object(
           'walk_id', p_walk,
           'progress', count(*) filter (where result = 'progress'),
           'no_work',  count(*) filter (where result = 'no_work'),
           'blocked',  count(*) filter (where result = 'blocked'))
    into v_counts from public.site_walk_results where walk_id = p_walk;
  perform private.record_event(v_walk.tenant_id, v_walk.project_id, 'location', v_walk.location_id, 'walk_submitted', v_counts, 'internal');

  return v_walk;
end;
$$;

create or replace function public.approve_walk(p_walk uuid) returns public.site_walks
language plpgsql security definer set search_path = '' as $$
declare
  v_walk public.site_walks;
begin
  select * into v_walk from public.site_walks where id = p_walk and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'walk_not_found' using errcode = 'P0002'; end if;
  if not private.has_project_permission(v_walk.project_id, 'walk.approve') then
    raise exception 'permission denied: walk.approve' using errcode = '42501';
  end if;
  if v_walk.status <> 'submitted' then raise exception 'walk_closed' using errcode = '22023'; end if;

  update public.work_progress set approved_by = auth.uid(), approved_at = now() where walk_id = p_walk;
  update public.site_walks set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_walk returning * into v_walk;
  perform private.record_event(v_walk.tenant_id, v_walk.project_id, 'location', v_walk.location_id, 'walk_approved',
                               jsonb_build_object('walk_id', p_walk), 'internal');
  return v_walk;
end;
$$;

-- ---------------------------------------------------------------------------
-- Импорт плана из таблицы: [{location, discipline, contractor, name, unit, qty}, ...]
-- Всё или ничего: при любой ошибке в строках ничего не создаётся, возвращается список ошибок.
-- ---------------------------------------------------------------------------
create or replace function public.import_work_items(p_project uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_errors jsonb := '[]';
  v_valid  integer := 0;
  r        record;
  v_loc    uuid;
  v_disc   uuid;
  v_org    uuid;
  v_qty    numeric;
  n        integer := 0;
  v_ids    jsonb := '[]';
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.has_project_permission(p_project, 'workitem.manage') then
    raise exception 'permission denied: workitem.manage' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;

  for r in select value as row, ordinality as idx from jsonb_array_elements(p_rows) with ordinality loop
    n := n + 1;
    v_loc := null; v_disc := null; v_org := null; v_qty := null;

    select id into v_loc from public.locations
     where project_id = p_project and deleted_at is null and path::text = upper(btrim(coalesce(r.row ->> 'location', '')));
    if v_loc is null then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Место «' || coalesce(r.row ->> 'location', '') || '» не найдено в структуре проекта');
      continue;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'discipline', '')), '') is not null then
      select id into v_disc from public.disciplines
       where project_id = p_project and deleted_at is null and upper(code) = upper(btrim(r.row ->> 'discipline')) limit 1;
      if v_disc is null then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Направление «' || (r.row ->> 'discipline') || '» не найдено');
        continue;
      end if;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'contractor', '')), '') is not null then
      select id into v_org from public.organizations
       where tenant_id = v_tenant and deleted_at is null and lower(name) = lower(btrim(r.row ->> 'contractor')) limit 1;
      if v_org is null then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Организация «' || (r.row ->> 'contractor') || '» не найдена');
        continue;
      end if;
    end if;

    begin
      v_qty := replace(btrim(coalesce(r.row ->> 'qty', '')), ',', '.')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty < 0 then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Объём «' || coalesce(r.row ->> 'qty', '') || '» — не число');
      continue;
    end if;
    if nullif(btrim(coalesce(r.row ->> 'name', '')), '') is null or nullif(btrim(coalesce(r.row ->> 'unit', '')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Не заполнено название работы или единица измерения');
      continue;
    end if;

    v_valid := v_valid + 1;
    if not p_dry_run and jsonb_array_length(v_errors) = 0 then
      insert into public.work_items (project_id, location_id, discipline_id, contractor_org_id, name, unit, planned_qty)
      values (p_project, v_loc, v_disc, v_org, btrim(r.row ->> 'name'), btrim(r.row ->> 'unit'), v_qty);
    end if;
  end loop;

  -- Если ошибки нашлись после начала вставки (в более поздних строках) — откатываем всё
  if not p_dry_run and jsonb_array_length(v_errors) > 0 then
    raise exception 'import_has_errors' using errcode = '22023', detail = v_errors::text;
  end if;

  return jsonb_build_object('total', n, 'valid', v_valid, 'errors', v_errors, 'created', case when p_dry_run then 0 else v_valid end);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['start_walk(uuid,uuid)','save_walk_result(uuid,uuid,text,numeric,text,text)',
                           'clear_walk_result(uuid,uuid)','submit_walk(uuid)','approve_walk(uuid)',
                           'import_work_items(uuid,jsonb,boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
grant select on public.work_items_progress to authenticated;

alter publication supabase_realtime add table public.work_items, public.work_progress, public.site_walk_results;
