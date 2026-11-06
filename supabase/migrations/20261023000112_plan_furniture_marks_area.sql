-- Отметки мебели на плане комнаты: точка или зона. Зона — прямоугольник от (x, y) до (x2, y2) в долях листа (0…1); у точки x2 и y2 пустые.
-- Старая функция с шестью аргументами заменяется функцией с зоной (аргументы зоны необязательны).
-- См. docs: 05-roadmap/05-backlog.md, раздел «План комнаты: мебель на плане».

alter table public.plan_furniture_marks
  add column x2 numeric check (x2 between 0 and 1),
  add column y2 numeric check (y2 between 0 and 1),
  add constraint plan_furniture_marks_area_chk check ((x2 is null) = (y2 is null) and (x2 is null or (x2 > x and y2 > y)));

drop function public.plan_furniture_mark_add(uuid, uuid, integer, uuid, numeric, numeric);

create or replace function public.plan_furniture_mark_add(
  p_project uuid, p_document uuid, p_page integer, p_item uuid, p_x numeric, p_y numeric,
  p_x2 numeric default null, p_y2 numeric default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ffe_items where id = p_item and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 or p_x is null or p_y is null or p_x not between 0 and 1 or p_y not between 0 and 1
     or (p_x2 is null) <> (p_y2 is null)
     or (p_x2 is not null and (p_x2 not between 0 and 1 or p_y2 not between 0 and 1 or p_x2 <= p_x or p_y2 <= p_y)) then
    raise exception 'position_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.plan_furniture_marks where document_id = p_document) >= 500 then
    raise exception 'too_many_marks' using errcode = '22023';
  end if;
  insert into public.plan_furniture_marks (tenant_id, project_id, document_id, page, item_id, x, y, x2, y2)
  values (v_tenant, p_project, p_document, p_page, p_item, p_x, p_y, p_x2, p_y2)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.plan_furniture_mark_add(uuid, uuid, integer, uuid, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.plan_furniture_mark_add(uuid, uuid, integer, uuid, numeric, numeric, numeric, numeric) to authenticated;
notify pgrst, 'reload schema';
