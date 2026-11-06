-- Порядок узлов среди соседей разных видов. У этажа порядок задаёт номер (`sort`: −1, 3, 12…), у корпуса или секции, лежащих рядом с этажами
-- (например, «паркинг» или «подиум» в корпусе с этажами), — необязательная позиция `position`, которая может быть дробной и вставать
-- между номерами этажей. Для показа берётся `coalesce(position, sort)`. Этажи сами никогда не переставляются: меняется их номер.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Порядок узлов структуры».

alter table public.locations add column position numeric;
grant update (position) on public.locations to authenticated;

create or replace function public.locations_reorder(p_project uuid, p_parent uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_expected integer;
  v_found    integer;
  v_n        integer := coalesce(cardinality(p_ids), 0);
  v_floor    boolean[];
  v_sort     numeric[];
  v_key      numeric[];
  i          integer;
  j          integer;
  t          integer;
  m          integer;
  a          numeric;
  b          numeric;
  v_last     numeric;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'location.manage') then
    raise exception 'permission denied: location.manage' using errcode = '42501';
  end if;
  if v_n = 0 or (select count(distinct x) from unnest(p_ids) x) <> v_n then
    raise exception 'invalid order' using errcode = '22023';
  end if;
  -- в списке ровно все живые соседи одного родителя
  select count(*) into v_expected from public.locations
   where project_id = p_project and tenant_id = v_tenant and deleted_at is null and parent_id is not distinct from p_parent;
  select count(*) into v_found from public.locations
   where id = any(p_ids) and project_id = p_project and tenant_id = v_tenant and deleted_at is null and parent_id is not distinct from p_parent;
  if v_found <> v_n or v_expected <> v_n then
    raise exception 'order must list all siblings' using errcode = '22023';
  end if;

  select array_agg(l.kind = 'floor' order by o.n), array_agg(l.sort::numeric order by o.n)
    into v_floor, v_sort
    from unnest(p_ids) with ordinality as o(id, n) join public.locations l on l.id = o.id;

  -- этажи остаются в порядке своих номеров
  v_last := null;
  for i in 1 .. v_n loop
    if v_floor[i] then
      if v_last is not null and v_sort[i] <= v_last then
        raise exception 'floors_ordered_by_number' using errcode = '22023';
      end if;
      v_last := v_sort[i];
    end if;
  end loop;

  -- ключ порядка: у этажа — его номер; у остальных — число между ключами ближайших этажей (или рядом с ними)
  v_key := array_fill(null::numeric, array[v_n]);
  i := 1;
  while i <= v_n loop
    if v_floor[i] then
      v_key[i] := v_sort[i];
      i := i + 1;
    else
      j := i;
      while j < v_n and not v_floor[j + 1] loop j := j + 1; end loop;
      m := j - i + 1;
      a := case when i > 1 then v_key[i - 1] end;
      b := case when j < v_n then v_sort[j + 1] end;
      for t in 1 .. m loop
        v_key[i + t - 1] := case
          when a is null and b is null then t
          when a is null then b - (m - t + 1)
          when b is null then a + t
          else round(a + (b - a) * t / (m + 1), 6)
        end;
      end loop;
      i := j + 1;
    end if;
  end loop;

  update public.locations l set position = o.k
    from (select x as id, v_key[n::integer] as k from unnest(p_ids) with ordinality as t(x, n)) o
   where l.id = o.id and l.kind <> 'floor' and l.position is distinct from o.k;
  return v_n;
end;
$$;

revoke execute on function public.locations_reorder(uuid, uuid, uuid[]) from public, anon;
grant  execute on function public.locations_reorder(uuid, uuid, uuid[]) to authenticated;
notify pgrst, 'reload schema';
