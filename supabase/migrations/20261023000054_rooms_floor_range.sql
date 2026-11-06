-- Помещения по диапазону этажей: «на этажах с 3 по 8 — 6 номеров и 2 коммерческих».
-- Диапазон задаётся номерами этажей (у этажа sort равен его номеру); без диапазона — все этажи узла, как раньше.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Типовые этажи».

drop function if exists public.generate_rooms(uuid, uuid, integer, text, text);

create or replace function public.generate_rooms(
  p_project    uuid,
  p_parent     uuid,
  p_per_floor  integer,
  p_scheme     text default 'floor',
  p_purpose    text default null,
  p_floor_from integer default null,
  p_floor_to   integer default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_parent  public.locations;
  f         record;
  v_floors  integer;
  v_seq     integer := 0;
  v_created integer := 0;
  v_rows    integer;
  v_num     integer;
  v_start   integer;
  v_code    text;
  v_name    text;
  v_label   text;
  i         integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'location.manage') then
    raise exception 'permission denied: location.manage' using errcode = '42501';
  end if;
  if p_scheme not in ('floor', 'sequential') or p_per_floor < 1 or p_per_floor > 200
     or (p_purpose is not null and p_purpose not in ('apartment','hotel_room','office','commercial','common','technical','parking','storage','other'))
     or (p_floor_from is not null and p_floor_to is not null and p_floor_from > p_floor_to) then
    raise exception 'invalid generator parameters' using errcode = '22023';
  end if;
  v_label := case coalesce(p_purpose, 'other')
    when 'apartment' then 'Квартира' when 'hotel_room' then 'Номер' when 'office' then 'Офис' when 'commercial' then 'Коммерческое помещение'
    when 'common' then 'МОП' when 'technical' then 'Техпомещение' when 'parking' then 'Машино-место' when 'storage' then 'Кладовая' else 'Помещение' end;

  select * into v_parent from public.locations
   where id = p_parent and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'parent location not found' using errcode = '23503';
  end if;

  select count(*) into v_floors from public.locations l
   where l.project_id = p_project and l.deleted_at is null and l.kind = 'floor'
     and (l.id = p_parent or l.path::text like v_parent.path::text || '.%')
     and (p_floor_from is null or l.sort >= p_floor_from)
     and (p_floor_to is null or l.sort <= p_floor_to);
  if v_floors = 0 then
    raise exception 'no floors under this location' using errcode = '22023';
  end if;
  if v_floors * p_per_floor > 5000 then
    raise exception 'too many rooms' using errcode = '22023';
  end if;

  -- сквозная нумерация продолжается с наибольшего номера среди уже созданных помещений узла
  select coalesce(max(substring(l.code from '^R([0-9]+)$')::integer), 0) into v_seq from public.locations l
   where l.project_id = p_project and l.deleted_at is null and l.kind = 'room' and l.code ~ '^R[0-9]+$'
     and (l.path::text like v_parent.path::text || '.%');

  for f in
    select l.id, l.sort from public.locations l
     where l.project_id = p_project and l.deleted_at is null and l.kind = 'floor'
       and (l.id = p_parent or l.path::text like v_parent.path::text || '.%')
       and (p_floor_from is null or l.sort >= p_floor_from)
       and (p_floor_to is null or l.sort <= p_floor_to)
     order by l.sort, l.path
  loop
    -- на этаже уже есть помещения: новая партия продолжает порядок, а не пытается занять те же номера
    select coalesce(max(r.sort), 0) into v_start from public.locations r where r.parent_id = f.id and r.kind = 'room' and r.deleted_at is null;
    for i in v_start + 1 .. v_start + p_per_floor loop
      if p_scheme = 'sequential' then
        v_seq := v_seq + 1;
        v_code := 'R' || v_seq;
        v_name := v_label || ' ' || v_seq;
      else
        v_num := abs(f.sort) * (case when v_start + p_per_floor >= 100 then 1000 else 100 end) + i;
        v_code := 'R' || case when f.sort < 0 then 'B' else '' end || v_num;
        v_name := v_label || ' ' || case when f.sort < 0 then 'B' else '' end || v_num;
      end if;
      insert into public.locations (project_id, parent_id, kind, code, name, sort, purpose)
      values (p_project, f.id, 'room', v_code, v_name, i, p_purpose)
      on conflict (project_id, path) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.generate_rooms(uuid, uuid, integer, text, text, integer, integer) from public, anon;
grant  execute on function public.generate_rooms(uuid, uuid, integer, text, text, integer, integer) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
