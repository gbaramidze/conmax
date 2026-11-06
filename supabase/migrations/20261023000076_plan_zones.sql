-- Зоны на планах: на листе плана обводится место структуры (помещение на плане этажа, этаж на разрезе, корпус на генплане),
-- и нажатие на зону открывает это место. Зоны раскрашиваются по данным места: готовность мебели, открытые задачи, тип номера.
-- Зона — многоугольник из 3–60 точек в долях страницы (0…1), как и булавки замечаний, поэтому не зависит от масштаба и устройства.
-- Привязана к документу и странице, а не к версии: новая ревизия с тем же листом сохраняет зоны (при заметном сдвиге чертежа зоны перерисовывают).
-- Рисуют и удаляют те, кто управляет структурой (`location.manage`); смотрят все, кто видит проект.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Зоны на планах».

create table public.plan_zones (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page        integer not null default 1 check (page >= 1),
  location_id uuid not null references public.locations(id) on delete cascade,
  points      jsonb not null,
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (document_id, page, location_id)
);
create index on public.plan_zones (project_id, document_id);
create index on public.plan_zones (location_id);

alter table public.plan_zones enable row level security;
alter table public.plan_zones force row level security;
revoke insert, update, delete on public.plan_zones from authenticated;
create policy plan_zones_select on public.plan_zones for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- Нарисовать (или перерисовать) зону места на листе плана
create or replace function public.plan_zone_set(p_project uuid, p_document uuid, p_page integer, p_location uuid, p_points jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_n      integer;
  v_id     uuid;
  p        jsonb;
begin
  perform private.week_guard(p_project, array['location.manage']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.locations where id = p_location and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 then raise exception 'position_invalid' using errcode = '22023'; end if;
  if jsonb_typeof(p_points) <> 'array' then raise exception 'position_invalid' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_points);
  if v_n < 3 or v_n > 60 then raise exception 'position_invalid' using errcode = '22023'; end if;
  for p in select * from jsonb_array_elements(p_points) loop
    if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
       or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number'
       or (p ->> 0)::numeric not between 0 and 1 or (p ->> 1)::numeric not between 0 and 1 then
      raise exception 'position_invalid' using errcode = '22023';
    end if;
  end loop;
  insert into public.plan_zones (tenant_id, project_id, document_id, page, location_id, points)
  values (v_tenant, p_project, p_document, p_page, p_location, p_points)
  on conflict (document_id, page, location_id) do update set points = excluded.points, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.plan_zone_delete(p_zone uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  z public.plan_zones;
begin
  select * into z from public.plan_zones where id = p_zone and tenant_id = private.tenant_id();
  if not found then raise exception 'zone_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(z.project_id, array['location.manage']);
  delete from public.plan_zones where id = z.id;
end;
$$;

-- Зоны документа с данными места: мебель (для помещения своя, для этажа и выше — сумма по всем помещениям внутри) и открытые задачи внутри
create or replace function public.plan_zones(p_document uuid) returns table (
  id uuid, page integer, location_id uuid, path text, code text, name text, kind text, points jsonb, type_name text,
  ffe_total integer, ffe_installed integer, tasks_open integer, tasks_overdue integer
)
language sql stable set search_path = '' as $$
  select z.id, z.page, l.id, l.path::text, l.code, l.name, l.kind, z.points, rt.name,
         coalesce(f.total, 0)::integer, coalesce(f.installed, 0)::integer, coalesce(t.open, 0)::integer, coalesce(t.overdue, 0)::integer
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

revoke execute on function public.plan_zone_set(uuid, uuid, integer, uuid, jsonb), public.plan_zone_delete(uuid), public.plan_zones(uuid) from public, anon;
grant execute on function public.plan_zone_set(uuid, uuid, integer, uuid, jsonb), public.plan_zone_delete(uuid), public.plan_zones(uuid) to authenticated;
notify pgrst, 'reload schema';
