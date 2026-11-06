-- Зоны типов номеров на планах этажей: на листе обводится квартира или номер и выбирается, какого он типа (ONE BEDROOM, STANDARD KING 1).
-- Это не зона конкретного помещения (для них есть `plan_zones`), а «тут номер такого-то типа»: на этаже таких зон много, у каждой свой контур.
-- Нажатие на зону открывает тип: состав мебели, схему, номера этого типа. Контур — многоугольник из 3–60 точек в долях страницы (0…1).
-- Рисуют, меняют тип и убирают те, кто управляет структурой (`location.manage`); смотрят все, кто видит проект.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Зоны типов номеров на планах».

create table public.plan_type_zones (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  page         integer not null default 1 check (page >= 1),
  room_type_id uuid not null references public.room_types(id) on delete cascade,
  points       jsonb not null,
  created_by   uuid default auth.uid() references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.plan_type_zones (project_id, document_id);
create index on public.plan_type_zones (room_type_id);

alter table public.plan_type_zones enable row level security;
alter table public.plan_type_zones force row level security;
revoke insert, update, delete on public.plan_type_zones from authenticated;
create policy plan_type_zones_select on public.plan_type_zones for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- Обвести зону типа (p_zone пусто) или перерисовать и сменить тип у готовой зоны
create or replace function public.plan_type_zone_set(p_project uuid, p_document uuid, p_page integer, p_type uuid, p_points jsonb, p_zone uuid default null) returns uuid
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
  if not exists (select 1 from public.room_types where id = p_type and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'type_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 or jsonb_typeof(p_points) <> 'array' then raise exception 'position_invalid' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_points);
  if v_n < 3 or v_n > 60 then raise exception 'position_invalid' using errcode = '22023'; end if;
  for p in select * from jsonb_array_elements(p_points) loop
    if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
       or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number'
       or (p ->> 0)::numeric not between 0 and 1 or (p ->> 1)::numeric not between 0 and 1 then
      raise exception 'position_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_zone is not null then
    update public.plan_type_zones set room_type_id = p_type, points = p_points, page = p_page, updated_at = now()
     where id = p_zone and document_id = p_document and tenant_id = v_tenant
     returning id into v_id;
    if v_id is null then raise exception 'zone_not_found' using errcode = 'P0002'; end if;
    return v_id;
  end if;
  if (select count(*) from public.plan_type_zones where document_id = p_document) >= 500 then
    raise exception 'too_many_zones' using errcode = '22023';
  end if;
  insert into public.plan_type_zones (tenant_id, project_id, document_id, page, room_type_id, points)
  values (v_tenant, p_project, p_document, p_page, p_type, p_points)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.plan_type_zone_delete(p_zone uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  z public.plan_type_zones;
begin
  select * into z from public.plan_type_zones where id = p_zone and tenant_id = private.tenant_id();
  if not found then raise exception 'zone_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(z.project_id, array['location.manage']);
  delete from public.plan_type_zones where id = z.id;
end;
$$;

-- Зоны типов документа: тип, сколько номеров этого типа в проекте и сколько штук мебели в его составе
create or replace function public.plan_type_zones(p_document uuid) returns table (
  id uuid, page integer, type_id uuid, type_name text, points jsonb, rooms integer, pieces integer
)
language sql stable set search_path = '' as $$
  select z.id, z.page, t.id, t.name, z.points,
         (select count(*)::integer from public.room_specs rs where rs.type_id = t.id),
         coalesce((select sum(i.qty) from public.room_type_items i where i.type_id = t.id), 0)::integer
    from public.plan_type_zones z
    join public.room_types t on t.id = z.room_type_id and t.deleted_at is null
   where z.document_id = p_document
   order by z.page, t.name, z.created_at;
$$;

revoke execute on function public.plan_type_zone_set(uuid, uuid, integer, uuid, jsonb, uuid), public.plan_type_zone_delete(uuid), public.plan_type_zones(uuid) from public, anon;
grant execute on function public.plan_type_zone_set(uuid, uuid, integer, uuid, jsonb, uuid), public.plan_type_zone_delete(uuid), public.plan_type_zones(uuid) to authenticated;
notify pgrst, 'reload schema';
