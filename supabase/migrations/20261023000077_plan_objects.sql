-- Слои объектов на планах: камеры, щиты, гидранты, задвижки (точки) и трассы труб, кабелей, воздуховодов (ломаные линии).
-- Это исполнительная схема на листе плана и реестр оборудования: что где стоит и в каком оно состоянии.
-- Координаты — доли листа (0…1), как у булавок замечаний и зон, поэтому не зависят от масштаба и устройства.
-- Тип объекта — код (`camera`, `panel`, `pipe_water`…); каталог типов, их значки и подписи живут в приложении,
-- в базе проверяется только вид кода и геометрия (`point` — одна точка, `line` — от 2 до 200 точек).
-- Ставят и правят те, кто управляет структурой или графиком (`location.manage`, `schedule.edit`); смотрят все, кто видит проект.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Слои объектов на планах».

create table public.plan_objects (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page        integer not null default 1 check (page >= 1),
  type_code   text not null check (type_code ~ '^[a-z][a-z0-9_]{1,29}$'),
  geometry    text not null check (geometry in ('point', 'line')),
  points      jsonb not null,
  label       text not null default '' check (char_length(label) <= 80),
  status      text not null default 'installed' check (status in ('planned', 'installed', 'checked', 'defect')),
  notes       text not null default '' check (char_length(notes) <= 500),
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.plan_objects (document_id, page);
create index on public.plan_objects (project_id, type_code);

alter table public.plan_objects enable row level security;
alter table public.plan_objects force row level security;
revoke insert, update, delete on public.plan_objects from authenticated;
create policy plan_objects_select on public.plan_objects for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- Проверка точек: массив пар чисел 0…1; для точки ровно одна, для линии от 2 до 200
create or replace function private.plan_points_ok(p_points jsonb, p_geometry text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  n integer;
  p jsonb;
begin
  if jsonb_typeof(p_points) <> 'array' then return false; end if;
  n := jsonb_array_length(p_points);
  if p_geometry = 'point' and n <> 1 then return false; end if;
  if p_geometry = 'line' and (n < 2 or n > 200) then return false; end if;
  for p in select * from jsonb_array_elements(p_points) loop
    if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
       or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number'
       or (p ->> 0)::numeric not between 0 and 1 or (p ->> 1)::numeric not between 0 and 1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Поставить объект (p_id пусто) или изменить существующий (подпись, состояние, заметка, положение)
create or replace function public.plan_object_set(
  p_project uuid, p_document uuid, p_page integer, p_type text, p_geometry text, p_points jsonb,
  p_label text default '', p_status text default 'installed', p_notes text default '', p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 or p_type is null or p_type !~ '^[a-z][a-z0-9_]{1,29}$'
     or p_geometry not in ('point', 'line') or not private.plan_points_ok(p_points, p_geometry) then
    raise exception 'position_invalid' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'installed', 'checked', 'defect') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.plan_objects (tenant_id, project_id, document_id, page, type_code, geometry, points, label, status, notes)
    values (v_tenant, p_project, p_document, p_page, p_type, p_geometry, p_points, coalesce(trim(p_label), ''), p_status, coalesce(trim(p_notes), ''))
    returning id into v_id;
  else
    update public.plan_objects
       set page = p_page, points = p_points, label = coalesce(trim(p_label), ''), status = p_status, notes = coalesce(trim(p_notes), ''), updated_at = now()
     where id = p_id and project_id = p_project and document_id = p_document and tenant_id = v_tenant and type_code = p_type and geometry = p_geometry
     returning id into v_id;
    if v_id is null then raise exception 'object_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.plan_object_delete(p_object uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.plan_objects;
begin
  select * into o from public.plan_objects where id = p_object and tenant_id = private.tenant_id();
  if not found then raise exception 'object_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(o.project_id, array['location.manage', 'schedule.edit']);
  delete from public.plan_objects where id = o.id;
end;
$$;

-- Реестр: сколько объектов каждого типа и в каком состоянии по всему проекту (для сводки и отчёта)
create or replace function public.plan_objects_summary(p_project uuid) returns table (type_code text, geometry text, total integer, planned integer, installed integer, checked integer, defect integer)
language sql stable set search_path = '' as $$
  select o.type_code, o.geometry, count(*)::integer,
         count(*) filter (where o.status = 'planned')::integer, count(*) filter (where o.status = 'installed')::integer,
         count(*) filter (where o.status = 'checked')::integer, count(*) filter (where o.status = 'defect')::integer
    from public.plan_objects o
   where o.project_id = p_project and o.tenant_id = private.tenant_id() and private.can_see_project(o.project_id)
   group by o.type_code, o.geometry
   order by o.type_code;
$$;

revoke execute on function private.plan_points_ok(jsonb, text) from public, anon, authenticated;
revoke execute on function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid), public.plan_object_delete(uuid), public.plan_objects_summary(uuid) from public, anon;
grant execute on function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid), public.plan_object_delete(uuid), public.plan_objects_summary(uuid) to authenticated;
notify pgrst, 'reload schema';
