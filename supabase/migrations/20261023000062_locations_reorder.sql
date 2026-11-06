-- Порядок узлов структуры: позже добавленный узел (например, «паркинг −1» или новая секция) можно поставить на своё место,
-- не пересоздавая остальное. У этажей порядок задаёт номер этажа (`sort` = −1, 3, 12…), на нём держатся диапазоны «с … по …»,
-- поэтому этажи переставлять нельзя — меняется номер. Остальные узлы (корпуса, секции, помещения, зоны) переставляются списком.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Порядок узлов структуры».

create or replace function public.locations_reorder(p_project uuid, p_parent uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_expected integer;
  v_found integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'location.manage') then
    raise exception 'permission denied: location.manage' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'invalid order' using errcode = '22023';
  end if;
  if exists (select 1 from public.locations where id = any(p_ids) and kind = 'floor') then
    raise exception 'floors_ordered_by_number' using errcode = '22023';
  end if;
  -- в списке ровно все живые соседи одного родителя
  select count(*) into v_expected from public.locations
   where project_id = p_project and tenant_id = v_tenant and deleted_at is null and parent_id is not distinct from p_parent;
  select count(*) into v_found from public.locations
   where id = any(p_ids) and project_id = p_project and tenant_id = v_tenant and deleted_at is null and parent_id is not distinct from p_parent;
  if v_found <> cardinality(p_ids) or v_expected <> cardinality(p_ids) then
    raise exception 'order must list all siblings' using errcode = '22023';
  end if;
  update public.locations l set sort = o.n
    from (select x as id, n::integer from unnest(p_ids) with ordinality as t(x, n)) o
   where l.id = o.id and l.sort is distinct from o.n;
  return cardinality(p_ids);
end;
$$;

revoke execute on function public.locations_reorder(uuid, uuid, uuid[]) from public, anon;
grant  execute on function public.locations_reorder(uuid, uuid, uuid[]) to authenticated;
notify pgrst, 'reload schema';
