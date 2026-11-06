-- Слои объектов, вторая часть: подтип и направление объекта, размер метки, масштаб листа (длины и площади), назначение в зонах.
--
-- Объект: `variant` — подтип внутри типа (камера купольная / цилиндрическая / поворотная…), `rotation` — направление в градусах
-- по часовой стрелке от «вверх» (0…360), `size` — множитель размера метки (0,5…3). Каталог подтипов живёт в приложении, как и типы.
-- Масштаб: `plan_scales` — сколько метров в полной ширине листа (на каждый лист документа); из него считаются длина трасс и площадь зон.
-- Зависит только от пропорций листа, поэтому не ломается при смене размера окна. Задают те же, кто ставит объекты.
-- Зоны: `plan_zones()` отдаёт назначение помещения (квартира, машино-место…), чтобы раскрашивать и подписывать зоны.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Слои объектов на планах».

alter table public.plan_objects
  add column variant  text check (variant is null or variant ~ '^[a-z][a-z0-9_]{1,29}$'),
  add column rotation numeric(5, 2) not null default 0 check (rotation >= 0 and rotation < 360),
  add column size     numeric(3, 2) not null default 1 check (size between 0.5 and 3);

drop function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid);
create or replace function public.plan_object_set(
  p_project uuid, p_document uuid, p_page integer, p_type text, p_geometry text, p_points jsonb,
  p_label text default '', p_status text default 'installed', p_notes text default '', p_id uuid default null,
  p_variant text default null, p_rotation numeric default 0, p_size numeric default 1
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
  v_rot    numeric := coalesce(p_rotation, 0);
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 or p_type is null or p_type !~ '^[a-z][a-z0-9_]{1,29}$'
     or p_geometry not in ('point', 'line') or not private.plan_points_ok(p_points, p_geometry)
     or (p_variant is not null and p_variant !~ '^[a-z][a-z0-9_]{1,29}$')
     or coalesce(p_size, 1) not between 0.5 and 3 then
    raise exception 'position_invalid' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'installed', 'checked', 'defect') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;
  -- направление приводим к 0…360: 370 и −10 означают 10 и 350
  v_rot := v_rot - floor(v_rot / 360) * 360;
  if p_id is null then
    insert into public.plan_objects (tenant_id, project_id, document_id, page, type_code, geometry, points, label, status, notes, variant, rotation, size)
    values (v_tenant, p_project, p_document, p_page, p_type, p_geometry, p_points, coalesce(trim(p_label), ''), p_status, coalesce(trim(p_notes), ''),
            p_variant, v_rot, coalesce(p_size, 1))
    returning id into v_id;
  else
    update public.plan_objects
       set page = p_page, points = p_points, label = coalesce(trim(p_label), ''), status = p_status, notes = coalesce(trim(p_notes), ''),
           variant = p_variant, rotation = v_rot, size = coalesce(p_size, 1), updated_at = now()
     where id = p_id and project_id = p_project and document_id = p_document and tenant_id = v_tenant and type_code = p_type and geometry = p_geometry
     returning id into v_id;
    if v_id is null then raise exception 'object_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid, text, numeric, numeric) to authenticated;

-- Масштаб листа: метров в полной ширине листа
create table public.plan_scales (
  tenant_id        uuid not null references public.tenants(id),
  project_id       uuid not null references public.projects(id) on delete cascade,
  document_id      uuid not null references public.documents(id) on delete cascade,
  page             integer not null default 1 check (page >= 1),
  meters_per_width numeric(10, 3) not null check (meters_per_width > 0 and meters_per_width <= 100000),
  set_by           uuid default auth.uid() references public.users(id),
  updated_at       timestamptz not null default now(),
  primary key (document_id, page)
);
create index on public.plan_scales (project_id);

alter table public.plan_scales enable row level security;
alter table public.plan_scales force row level security;
revoke insert, update, delete on public.plan_scales from authenticated;
create policy plan_scales_select on public.plan_scales for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- Задать масштаб листа (p_meters_per_width пусто — сбросить)
create or replace function public.plan_scale_set(p_project uuid, p_document uuid, p_page integer, p_meters_per_width numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 then raise exception 'position_invalid' using errcode = '22023'; end if;
  if p_meters_per_width is null then
    delete from public.plan_scales where document_id = p_document and page = p_page;
    return;
  end if;
  if p_meters_per_width <= 0 or p_meters_per_width > 100000 then raise exception 'scale_invalid' using errcode = '22023'; end if;
  insert into public.plan_scales (tenant_id, project_id, document_id, page, meters_per_width)
  values (v_tenant, p_project, p_document, p_page, p_meters_per_width)
  on conflict (document_id, page) do update set meters_per_width = excluded.meters_per_width, set_by = auth.uid(), updated_at = now();
end;
$$;
revoke execute on function public.plan_scale_set(uuid, uuid, integer, numeric) from public, anon;
grant execute on function public.plan_scale_set(uuid, uuid, integer, numeric) to authenticated;

-- Зоны документа: добавлено назначение помещения
drop function public.plan_zones(uuid);
create or replace function public.plan_zones(p_document uuid) returns table (
  id uuid, page integer, location_id uuid, path text, code text, name text, kind text, points jsonb, type_name text,
  ffe_total integer, ffe_installed integer, tasks_open integer, tasks_overdue integer, purpose text
)
language sql stable set search_path = '' as $$
  select z.id, z.page, l.id, l.path::text, l.code, l.name, l.kind, z.points, rt.name,
         coalesce(f.total, 0)::integer, coalesce(f.installed, 0)::integer, coalesce(t.open, 0)::integer, coalesce(t.overdue, 0)::integer,
         l.purpose
    from public.plan_zones z
    join public.locations l on l.id = z.location_id and l.deleted_at is null
    left join public.room_specs rs on rs.location_id = l.id
    left join public.room_types rt on rt.id = rs.type_id and rt.deleted_at is null
    left join lateral (select sum(r.qty) as total, sum(r.qty) filter (where r.status = 'installed') as installed
                         from public.room_ffe r join public.locations rl on rl.id = r.location_id
                        where rl.path operator(extensions.<@) l.path) f on true
    left join lateral (select count(*) filter (where k.status_category not in ('done', 'cancelled')) as open,
                              count(*) filter (where k.status_category not in ('done', 'cancelled') and k.due_date < current_date) as overdue
                         from public.tasks k join public.locations tl on tl.id = k.location_id
                        where tl.path operator(extensions.<@) l.path and k.deleted_at is null) t on true
   where z.document_id = p_document
   order by z.page, l.path;
$$;
revoke execute on function public.plan_zones(uuid) from public, anon;
grant execute on function public.plan_zones(uuid) to authenticated;
notify pgrst, 'reload schema';
