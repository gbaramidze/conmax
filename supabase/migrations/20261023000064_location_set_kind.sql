-- Сменить тип узла структуры: например, секция «−1», созданная по ошибке секцией, становится этажом −1.
-- Код и путь не меняются, привязки задач, документов и работ сохраняются. Допустимы секция, этаж и зона; корпус и помещения не трогаем.
-- Этажу нужен номер (`sort`): от него зависят порядок и диапазоны «с … по …». Узел с вложенными узлами меняет тип, только если вложенные подходят новому типу.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Порядок узлов структуры».

create or replace function public.location_set_kind(p_project uuid, p_id uuid, p_kind text, p_floor_no integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  l        public.locations;
  v_parent text;
  v_bad    integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'location.manage') then
    raise exception 'permission denied: location.manage' using errcode = '42501';
  end if;
  select * into l from public.locations where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
  if not found then raise exception 'location_not_found' using errcode = 'P0002'; end if;
  if l.kind not in ('section', 'floor', 'zone') or p_kind not in ('section', 'floor', 'zone') then
    raise exception 'kind_change_not_allowed' using errcode = '22023';
  end if;
  if l.kind = p_kind then return; end if;

  select kind into v_parent from public.locations where id = l.parent_id;
  if p_kind = 'floor' and (v_parent is null or v_parent not in ('building', 'section')) then
    raise exception 'floor_needs_building_or_section' using errcode = '22023';
  end if;
  -- вложенные узлы должны подходить новому типу: у этажа — помещения и зоны, у секции — этажи, секции, зоны
  select count(*) into v_bad from public.locations c
   where c.parent_id = l.id and c.deleted_at is null
     and not (case p_kind when 'floor' then c.kind in ('room', 'zone', 'other')
                          when 'section' then c.kind in ('floor', 'section', 'zone')
                          else c.kind in ('room', 'other') end);
  if v_bad > 0 then raise exception 'children_do_not_fit' using errcode = '22023'; end if;

  if p_kind = 'floor' then
    if p_floor_no is null or p_floor_no = 0 or abs(p_floor_no) > 150 then
      raise exception 'floor_number_required' using errcode = '22023';
    end if;
    if exists (select 1 from public.locations s where s.parent_id is not distinct from l.parent_id and s.id <> l.id
                  and s.kind = 'floor' and s.deleted_at is null and s.sort = p_floor_no) then
      raise exception 'floor_number_taken' using errcode = '23505';
    end if;
    update public.locations set kind = 'floor', sort = p_floor_no, position = null where id = l.id;
  else
    -- не этаж: остаётся на том же месте среди соседей (позиция = прежний ключ порядка)
    update public.locations set kind = p_kind, position = coalesce(l.position, l.sort::numeric) where id = l.id;
  end if;
end;
$$;

revoke execute on function public.location_set_kind(uuid, uuid, text, integer) from public, anon;
grant  execute on function public.location_set_kind(uuid, uuid, text, integer) to authenticated;
notify pgrst, 'reload schema';
