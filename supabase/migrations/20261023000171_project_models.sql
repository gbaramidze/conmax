-- 3D-модель здания проекта (раздел «3D»): быстрая навигация по этажам (позже — по номерам) поверх структуры мест.
--
-- Модель приходит от архитекторов в IFC (ArchiCAD, Revit). IFC весит сотни мегабайт, поэтому он один раз переводится
-- в лёгкий GLB (scripts/model/ifc-to-glb.mjs: геометрия по этажам, сжатие meshopt), и в проект загружается уже GLB.
-- Этажи модели (IfcBuildingStorey) сопоставляются с местами структуры: «3-4 typical» → «Этаж 3» и т. п. Сопоставление
-- хранится по GlobalId этажа и переносится на новую версию модели. При сохранении сопоставления отметка этажа из модели
-- записывается в `locations.elevation`.
-- В проекте одна действующая модель: новая загрузка убирает прежнюю (строка остаётся с deleted_at, файл не удаляется).
-- Загружают и сопоставляют те, кто управляет структурой (`location.manage`); смотрят все, кто видит проект.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('models', 'models', false, 104857600, array['model/gltf-binary', 'application/octet-stream'])
on conflict (id) do nothing;

create table public.project_models (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  storage_key text not null unique,
  file_name   text not null check (length(btrim(file_name)) between 1 and 300),
  size_bytes  bigint not null check (size_bytes > 0),
  -- сколько помещений (IfcSpace) в модели: без них номера в 3D не выбираются
  spaces      integer not null default 0 check (spaces >= 0),
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index project_models_active on public.project_models (project_id) where deleted_at is null;
alter table public.project_models enable row level security;
alter table public.project_models force row level security;
revoke insert, update, delete on public.project_models from authenticated;
create policy project_models_select on public.project_models for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

create table public.project_model_storeys (
  model_id    uuid not null references public.project_models(id) on delete cascade,
  gid         text not null check (length(gid) between 1 and 64),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  -- отметка этажа из IFC, м; y — уровень пола в координатах модели, м
  elevation   numeric(9,3) not null,
  y           numeric(9,3) not null,
  sort        integer not null,
  location_id uuid references public.locations(id) on delete set null,
  primary key (model_id, gid)
);
create index on public.project_model_storeys (location_id) where location_id is not null;
alter table public.project_model_storeys enable row level security;
alter table public.project_model_storeys force row level security;
revoke insert, update, delete on public.project_model_storeys from authenticated;
create policy project_model_storeys_select on public.project_model_storeys for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- файл кладётся в {tenant}/{project}/…; скачать можно файл модели, которая видна в таблице
create policy models_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'models'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and private.has_project_permission(((storage.foldername(name))[2])::uuid, 'location.manage')
  );
create policy models_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'models' and exists (select 1 from public.project_models m where m.storage_key = name));

-- Зарегистрировать загруженный GLB как действующую модель проекта. p_storeys — этажи из файла:
-- [{gid, name, elevation, y}], снизу вверх. Сопоставление переносится с прежней модели по GlobalId, затем по названию.
create or replace function public.model_register(p_project uuid, p_key text, p_file_name text, p_size bigint, p_spaces integer, p_storeys jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_old    uuid;
  v_id     uuid;
  s        jsonb;
  i        integer := 0;
begin
  perform private.week_guard(p_project, array['location.manage']);
  if p_key is null or p_key not like v_tenant::text || '/' || p_project::text || '/%' then
    raise exception 'model_key_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'models' and name = p_key) then
    raise exception 'model_file_missing' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_storeys) <> 'array' or jsonb_array_length(p_storeys) = 0 or jsonb_array_length(p_storeys) > 300 then
    raise exception 'model_storeys_invalid' using errcode = '22023';
  end if;

  select id into v_old from public.project_models where project_id = p_project and deleted_at is null;
  update public.project_models set deleted_at = now() where id = v_old;
  insert into public.project_models (tenant_id, project_id, storage_key, file_name, size_bytes, spaces)
  values (v_tenant, p_project, p_key, left(btrim(coalesce(p_file_name, 'model.glb')), 300), p_size, greatest(coalesce(p_spaces, 0), 0))
  returning id into v_id;

  for s in select * from jsonb_array_elements(p_storeys) loop
    if coalesce(s ->> 'gid', '') = '' or jsonb_typeof(s -> 'elevation') <> 'number' or jsonb_typeof(s -> 'y') <> 'number' then
      raise exception 'model_storeys_invalid' using errcode = '22023';
    end if;
    insert into public.project_model_storeys (model_id, gid, tenant_id, project_id, name, elevation, y, sort, location_id)
    values (v_id, left(s ->> 'gid', 64), v_tenant, p_project, left(coalesce(nullif(btrim(s ->> 'name'), ''), s ->> 'gid'), 200),
            (s ->> 'elevation')::numeric, (s ->> 'y')::numeric, i,
            coalesce(
              (select o.location_id from public.project_model_storeys o where o.model_id = v_old and o.gid = s ->> 'gid'),
              (select o.location_id from public.project_model_storeys o where o.model_id = v_old and o.name = btrim(s ->> 'name') limit 1)))
    on conflict (model_id, gid) do nothing;
    i := i + 1;
  end loop;
  return v_id;
end;
$$;

-- Сопоставить этажи модели с местами: p_items = [{gid, location_id | null}]. Этажам структуры записывается отметка из модели.
create or replace function public.model_set_storeys(p_model uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m   public.project_models;
  it  jsonb;
  v_loc uuid;
begin
  select * into m from public.project_models where id = p_model and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'model_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(m.project_id, array['location.manage']);
  if jsonb_typeof(p_items) <> 'array' then raise exception 'model_storeys_invalid' using errcode = '22023'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_loc := nullif(it ->> 'location_id', '')::uuid;
    if v_loc is not null and not exists (
      select 1 from public.locations where id = v_loc and project_id = m.project_id and deleted_at is null
    ) then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    update public.project_model_storeys set location_id = v_loc where model_id = m.id and gid = it ->> 'gid';
    if not found then raise exception 'model_storeys_invalid' using errcode = '22023'; end if;
  end loop;

  -- одно место — один этаж модели: при повторе оставляем нижний
  update public.project_model_storeys s set location_id = null
   where s.model_id = m.id and s.location_id is not null
     and exists (select 1 from public.project_model_storeys o where o.model_id = m.id and o.location_id = s.location_id and o.sort < s.sort);

  update public.locations l set elevation = s.elevation
    from public.project_model_storeys s
   where s.model_id = m.id and s.location_id = l.id and l.kind = 'floor' and l.elevation is distinct from s.elevation;
end;
$$;

-- Цифры для окраски этажей: открытые и просроченные задачи, открытые заметки с площадки — по месту и всему внутри него.
-- Права обычные (security invoker): человек видит только то, что ему видно в задачах и заметках.
create or replace function public.model_floor_stats(p_project uuid) returns table (
  location_id uuid, tasks_open integer, tasks_overdue integer, notes_open integer
)
language sql stable set search_path = '' as $$
  select l.id, coalesce(t.open, 0)::integer, coalesce(t.overdue, 0)::integer, coalesce(n.open, 0)::integer
    from public.project_model_storeys s
    join public.project_models m on m.id = s.model_id and m.deleted_at is null
    join public.locations l on l.id = s.location_id and l.deleted_at is null
    left join lateral (select count(*) filter (where k.status_category not in ('done', 'cancelled')) as open,
                              count(*) filter (where k.status_category not in ('done', 'cancelled') and k.due_date < current_date) as overdue
                         from public.tasks k join public.locations tl on tl.id = k.location_id
                        where tl.path operator(extensions.<@) l.path and k.deleted_at is null) t on true
    left join lateral (select count(*) as open
                         from public.field_notes f join public.locations fl on fl.id = f.location_id
                        where fl.path operator(extensions.<@) l.path and f.status = 'open') n on true
   where s.project_id = p_project;
$$;

revoke execute on function public.model_register(uuid, text, text, bigint, integer, jsonb), public.model_set_storeys(uuid, jsonb), public.model_floor_stats(uuid) from public, anon;
grant execute on function public.model_register(uuid, text, text, bigint, integer, jsonb), public.model_set_storeys(uuid, jsonb), public.model_floor_stats(uuid) to authenticated;
notify pgrst, 'reload schema';
