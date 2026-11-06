-- Мебель и оборудование (FF&E) по номерам: каталог позиций с кодами и чертежами, типы номеров (King, Junior Suite)
-- с набором позиций, спецификация каждого номера (тип, площадь, особенности, своя правка состава) и статус по позиции:
-- запланировано → заказано → поставлено → установлено. Ведомость «что и где» собирается из этих таблиц.
-- Права: смотреть — внутренним участникам проекта; править — location.manage или schedule.edit (руководитель, ГИП, ПТО).
-- См. docs: 04-modules/03-projects.md (структура объекта), 05-roadmap/05-backlog.md (пункт «Мебель и оборудование»).

create table public.ffe_items (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null check (length(btrim(code)) between 1 and 60),
  name        text not null check (length(btrim(name)) between 1 and 300),
  category    text check (category is null or length(category) <= 80),
  unit        text not null default 'шт' check (length(btrim(unit)) between 1 and 20),
  document_id uuid references public.documents(id) on delete set null,
  note        text check (note is null or length(note) <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  deleted_at  timestamptz
);
create unique index ffe_items_code_uniq on public.ffe_items (project_id, lower(code)) where deleted_at is null;

create table public.room_types (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  area       numeric(8,2) check (area is null or area > 0),
  specs      text check (specs is null or length(specs) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users(id),
  deleted_at timestamptz
);
create unique index room_types_name_uniq on public.room_types (project_id, lower(name)) where deleted_at is null;

create table public.room_type_items (
  type_id    uuid not null references public.room_types(id) on delete cascade,
  item_id    uuid not null references public.ffe_items(id),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  qty        integer not null check (qty > 0 and qty <= 10000),
  primary key (type_id, item_id)
);

create table public.room_specs (
  location_id uuid primary key references public.locations(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  type_id     uuid references public.room_types(id),
  area        numeric(8,2) check (area is null or area > 0),
  specs       text check (specs is null or length(specs) <= 4000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references public.users(id)
);
create index on public.room_specs (type_id);

create table public.room_ffe (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  item_id     uuid not null references public.ffe_items(id),
  qty         integer not null check (qty > 0 and qty <= 10000),
  source      text not null default 'manual' check (source in ('type', 'manual')),
  status      text not null default 'planned' check (status in ('planned', 'ordered', 'delivered', 'installed')),
  status_at   timestamptz,
  status_by   uuid references public.users(id),
  unique (location_id, item_id)
);
create index on public.room_ffe (project_id, item_id);

do $$
declare t text;
begin
  foreach t in array array['ffe_items', 'room_types', 'room_type_items', 'room_specs', 'room_ffe'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Внутренние помощники
-- ---------------------------------------------------------------------------
create or replace function private.ffe_guard(p_project uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
end;
$$;

-- Привести состав номера к составу его типа. Строки, поставленные по типу, обновляются; свои правки и строки с продвинутым статусом сохраняются.
create or replace function private.room_sync(p_location uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_spec public.room_specs;
begin
  select * into v_spec from public.room_specs where location_id = p_location;
  if not found then return; end if;

  if v_spec.type_id is not null then
    insert into public.room_ffe (tenant_id, project_id, location_id, item_id, qty, source)
    select v_spec.tenant_id, v_spec.project_id, p_location, ti.item_id, ti.qty, 'type'
      from public.room_type_items ti where ti.type_id = v_spec.type_id
    on conflict (location_id, item_id) do update set qty = excluded.qty where public.room_ffe.source = 'type';
  end if;

  -- позиции, которых в типе больше нет: незаказанные убираем, остальные остаются как ручные
  delete from public.room_ffe f
   where f.location_id = p_location and f.source = 'type' and f.status = 'planned'
     and (v_spec.type_id is null or f.item_id not in (select item_id from public.room_type_items where type_id = v_spec.type_id));
  update public.room_ffe f set source = 'manual'
   where f.location_id = p_location and f.source = 'type'
     and (v_spec.type_id is null or f.item_id not in (select item_id from public.room_type_items where type_id = v_spec.type_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Каталог позиций
-- ---------------------------------------------------------------------------
create or replace function public.ffe_upsert_item(
  p_project uuid, p_id uuid, p_code text, p_name text, p_category text default null,
  p_unit text default 'шт', p_document uuid default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.ffe_guard(p_project);
  if v_code = '' or v_name = '' then raise exception 'title_required' using errcode = '22023'; end if;
  if p_document is not null and not exists (select 1 from public.documents where id = p_document and project_id = p_project and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  begin
    if v_id is null then
      insert into public.ffe_items (tenant_id, project_id, code, name, category, unit, document_id, note)
      values (private.tenant_id(), p_project, v_code, v_name, nullif(btrim(coalesce(p_category, '')), ''), coalesce(nullif(btrim(p_unit), ''), 'шт'), p_document, nullif(btrim(coalesce(p_note, '')), ''))
      returning id into v_id;
    else
      update public.ffe_items set code = v_code, name = v_name, category = nullif(btrim(coalesce(p_category, '')), ''),
             unit = coalesce(nullif(btrim(p_unit), ''), 'шт'), document_id = p_document, note = nullif(btrim(coalesce(p_note, '')), '')
       where id = v_id and project_id = p_project and deleted_at is null;
      if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    end if;
  exception when unique_violation then
    raise exception 'code_exists' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.ffe_delete_item(p_project uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ffe_guard(p_project);
  if exists (select 1 from public.room_ffe where item_id = p_id) or exists (select 1 from public.room_type_items where item_id = p_id) then
    raise exception 'in_use' using errcode = '23503';
  end if;
  update public.ffe_items set deleted_at = now() where id = p_id and project_id = p_project and deleted_at is null;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
end;
$$;

-- Импорт каталога: [{code, name, category, unit, document_code}], существующие коды обновляются
create or replace function public.ffe_import_items(p_project uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_created integer := 0;
  v_updated integer := 0;
  v_unknown integer := 0;
  v_doc uuid;
  v_id uuid;
begin
  perform private.ffe_guard(p_project);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'bad_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(code text, name text, category text, unit text, document_code text) loop
    if btrim(coalesce(r.code, '')) = '' or btrim(coalesce(r.name, '')) = '' then raise exception 'title_required' using errcode = '22023'; end if;
    v_doc := null;
    if btrim(coalesce(r.document_code, '')) <> '' then
      select id into v_doc from public.documents where project_id = p_project and lower(code) = lower(btrim(r.document_code)) and deleted_at is null;
      if v_doc is null then v_unknown := v_unknown + 1; end if;
    end if;
    select id into v_id from public.ffe_items where project_id = p_project and lower(code) = lower(btrim(r.code)) and deleted_at is null;
    if v_id is null then
      insert into public.ffe_items (tenant_id, project_id, code, name, category, unit, document_id)
      values (private.tenant_id(), p_project, btrim(r.code), btrim(r.name), nullif(btrim(coalesce(r.category, '')), ''), coalesce(nullif(btrim(r.unit), ''), 'шт'), v_doc);
      v_created := v_created + 1;
    else
      update public.ffe_items set name = btrim(r.name), category = nullif(btrim(coalesce(r.category, '')), ''),
             unit = coalesce(nullif(btrim(r.unit), ''), unit), document_id = coalesce(v_doc, document_id)
       where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unknown_documents', v_unknown);
end;
$$;

-- ---------------------------------------------------------------------------
-- Типы номеров
-- ---------------------------------------------------------------------------
create or replace function public.room_type_upsert(p_project uuid, p_id uuid, p_name text, p_area numeric default null, p_specs text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.ffe_guard(p_project);
  if v_name = '' then raise exception 'title_required' using errcode = '22023'; end if;
  begin
    if v_id is null then
      insert into public.room_types (tenant_id, project_id, name, area, specs)
      values (private.tenant_id(), p_project, v_name, p_area, nullif(btrim(coalesce(p_specs, '')), '')) returning id into v_id;
    else
      update public.room_types set name = v_name, area = p_area, specs = nullif(btrim(coalesce(p_specs, '')), '')
       where id = v_id and project_id = p_project and deleted_at is null;
      if not found then raise exception 'type_not_found' using errcode = 'P0002'; end if;
    end if;
  exception when unique_violation then
    raise exception 'name_exists' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.room_type_delete(p_project uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ffe_guard(p_project);
  if exists (select 1 from public.room_specs where type_id = p_id) then raise exception 'in_use' using errcode = '23503'; end if;
  update public.room_types set deleted_at = now() where id = p_id and project_id = p_project and deleted_at is null;
  if not found then raise exception 'type_not_found' using errcode = 'P0002'; end if;
  delete from public.room_type_items where type_id = p_id;
end;
$$;

-- Количество позиции в типе (0 — убрать); номера этого типа обновляются
create or replace function public.room_type_set_item(p_project uuid, p_type uuid, p_item uuid, p_qty integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_loc uuid;
  v_n integer := 0;
begin
  perform private.ffe_guard(p_project);
  if not exists (select 1 from public.room_types where id = p_type and project_id = p_project and deleted_at is null) then raise exception 'type_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.ffe_items where id = p_item and project_id = p_project and deleted_at is null) then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 10000 then raise exception 'bad_qty' using errcode = '22023'; end if;
  if p_qty = 0 then
    delete from public.room_type_items where type_id = p_type and item_id = p_item;
  else
    insert into public.room_type_items (type_id, item_id, tenant_id, project_id, qty) values (p_type, p_item, private.tenant_id(), p_project, p_qty)
    on conflict (type_id, item_id) do update set qty = excluded.qty;
  end if;
  for v_loc in select location_id from public.room_specs where type_id = p_type loop
    perform private.room_sync(v_loc);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Номера
-- ---------------------------------------------------------------------------
-- Назначить тип номерам (null — снять тип)
create or replace function public.apply_room_type(p_project uuid, p_locations uuid[], p_type uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_loc uuid;
  v_n integer := 0;
begin
  perform private.ffe_guard(p_project);
  if p_type is not null and not exists (select 1 from public.room_types where id = p_type and project_id = p_project and deleted_at is null) then
    raise exception 'type_not_found' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_locations, 1), 0) > 3000 then raise exception 'too many rooms' using errcode = '22023'; end if;
  for v_loc in select l.id from public.locations l where l.id = any (p_locations) and l.project_id = p_project and l.kind = 'room' and l.deleted_at is null loop
    insert into public.room_specs (location_id, tenant_id, project_id, type_id) values (v_loc, private.tenant_id(), p_project, p_type)
    on conflict (location_id) do update set type_id = excluded.type_id, updated_at = now(), updated_by = auth.uid();
    perform private.room_sync(v_loc);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Название, площадь и особенности номера
create or replace function public.room_set_specs(p_project uuid, p_location uuid, p_name text, p_area numeric, p_specs text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ffe_guard(p_project);
  if not exists (select 1 from public.locations where id = p_location and project_id = p_project and kind = 'room' and deleted_at is null) then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if p_name is not null then
    if btrim(p_name) = '' or length(btrim(p_name)) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
    update public.locations set name = btrim(p_name) where id = p_location;
  end if;
  insert into public.room_specs (location_id, tenant_id, project_id, area, specs)
  values (p_location, private.tenant_id(), p_project, p_area, nullif(btrim(coalesce(p_specs, '')), ''))
  on conflict (location_id) do update set area = excluded.area, specs = excluded.specs, updated_at = now(), updated_by = auth.uid();
end;
$$;

-- Своя правка состава номера: добавить позицию или изменить количество (0 — убрать)
create or replace function public.room_ffe_set(p_project uuid, p_location uuid, p_item uuid, p_qty integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ffe_guard(p_project);
  if not exists (select 1 from public.locations where id = p_location and project_id = p_project and kind = 'room' and deleted_at is null) then raise exception 'room_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.ffe_items where id = p_item and project_id = p_project and deleted_at is null) then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 10000 then raise exception 'bad_qty' using errcode = '22023'; end if;
  if p_qty = 0 then
    delete from public.room_ffe where location_id = p_location and item_id = p_item;
  else
    insert into public.room_ffe (tenant_id, project_id, location_id, item_id, qty, source) values (private.tenant_id(), p_project, p_location, p_item, p_qty, 'manual')
    on conflict (location_id, item_id) do update set qty = excluded.qty, source = 'manual';
  end if;
end;
$$;

-- Статус выбранных строк: запланировано / заказано / поставлено / установлено
create or replace function public.room_ffe_set_status(p_project uuid, p_ids uuid[], p_status text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  perform private.ffe_guard(p_project);
  if p_status not in ('planned', 'ordered', 'delivered', 'installed') then raise exception 'bad_status' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 20000 then raise exception 'too many rows' using errcode = '22023'; end if;
  update public.room_ffe set status = p_status, status_at = now(), status_by = auth.uid()
   where project_id = p_project and id = any (p_ids) and status <> p_status;
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ffe_upsert_item(uuid, uuid, text, text, text, text, uuid, text)', 'ffe_delete_item(uuid, uuid)', 'ffe_import_items(uuid, jsonb)',
    'room_type_upsert(uuid, uuid, text, numeric, text)', 'room_type_delete(uuid, uuid)', 'room_type_set_item(uuid, uuid, uuid, integer)',
    'apply_room_type(uuid, uuid[], uuid)', 'room_set_specs(uuid, uuid, text, numeric, text)', 'room_ffe_set(uuid, uuid, uuid, integer)',
    'room_ffe_set_status(uuid, uuid[], text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
