-- Привязка объектов слоёв к помещениям: камера, щит или гидрант на плане «знают», в каком помещении стоят.
--
-- Помещение определяет база: точка объекта попадает в контур зоны помещения (`plan_zones`) на том же листе. При вложенных зонах
-- (этаж и номер в нём) берётся самая маленькая. Если самых маленьких несколько с одинаковым контуром — это типовой план на группу
-- этажей, где один контур относится сразу ко многим помещениям, — привязки нет (`null`), чтобы не приписать камеру чужому этажу.
-- Привязка пересчитывается при постановке и переносе объекта, а также при любом изменении зон листа (нарисовали, перерисовали,
-- убрали), поэтому порядок «сначала объекты, потом зоны» не важен. У трасс (линий) помещения нет: они проходят через многие.
-- Показывается в карточке помещения («Оборудование») и в реестре оборудования (колонка «Место»).
-- См. docs: 05-roadmap/05-backlog.md, раздел «Слои объектов на планах».

alter table public.plan_objects add column location_id uuid references public.locations(id) on delete set null;
create index on public.plan_objects (location_id) where location_id is not null;

-- Точка внутри многоугольника (луч вправо), координаты в долях листа
create or replace function private.point_in_poly(p_x numeric, p_y numeric, p_poly jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  n      integer := jsonb_array_length(p_poly);
  i      integer;
  j      integer := n - 1;
  xi     numeric;
  yi     numeric;
  xj     numeric;
  yj     numeric;
  inside boolean := false;
begin
  for i in 0 .. n - 1 loop
    xi := (p_poly -> i ->> 0)::numeric;
    yi := (p_poly -> i ->> 1)::numeric;
    xj := (p_poly -> j ->> 0)::numeric;
    yj := (p_poly -> j ->> 1)::numeric;
    if (yi > p_y) <> (yj > p_y) and p_x < (xj - xi) * (p_y - yi) / (yj - yi) + xi then inside := not inside; end if;
    j := i;
  end loop;
  return inside;
end;
$$;

-- Площадь многоугольника в долях листа (шнуровка); для сравнения «меньше или больше» пропорции листа не нужны
create or replace function private.poly_area(p_poly jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  n integer := jsonb_array_length(p_poly);
  s numeric := 0;
  i integer;
  j integer;
begin
  for i in 0 .. n - 1 loop
    j := (i + 1) % n;
    s := s + (p_poly -> i ->> 0)::numeric * (p_poly -> j ->> 1)::numeric - (p_poly -> j ->> 0)::numeric * (p_poly -> i ->> 1)::numeric;
  end loop;
  return abs(s) / 2;
end;
$$;

-- Помещение для точки листа: самая маленькая зона вокруг неё; если таких несколько с одним контуром — null
create or replace function private.plan_object_room(p_document uuid, p_page integer, p_x numeric, p_y numeric) returns uuid
language sql stable set search_path = '' as $$
  with hits as (
    select z.location_id, private.poly_area(z.points) as area
      from public.plan_zones z
     where z.document_id = p_document and z.page = p_page and private.point_in_poly(p_x, p_y, z.points)
  ), best as (select min(area) as a from hits)
  select case when (select count(*) from hits where area = (select a from best)) = 1
              then (select location_id from hits where area = (select a from best)) end;
$$;

create or replace function private.plan_objects_set_room() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.location_id := case when new.geometry = 'point'
    then private.plan_object_room(new.document_id, new.page, (new.points -> 0 ->> 0)::numeric, (new.points -> 0 ->> 1)::numeric) end;
  return new;
end;
$$;
create trigger plan_objects_set_room before insert or update of points, page on public.plan_objects
  for each row execute function private.plan_objects_set_room();

-- Зоны листа изменились — пересчитываем помещения у его точек
create or replace function private.plan_zones_relink() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_doc  uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  v_page integer := case when tg_op = 'DELETE' then old.page else new.page end;
begin
  update public.plan_objects o
     set location_id = private.plan_object_room(o.document_id, o.page, (o.points -> 0 ->> 0)::numeric, (o.points -> 0 ->> 1)::numeric)
   where o.document_id = v_doc and o.page = v_page and o.geometry = 'point';
  return null;
end;
$$;
create trigger plan_zones_relink after insert or update of points or delete on public.plan_zones
  for each row execute function private.plan_zones_relink();

-- Уже поставленные объекты: пересчитать (изменение «points на то же значение» запускает триггер)
update public.plan_objects set points = points where geometry = 'point';

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
notify pgrst, 'reload schema';
