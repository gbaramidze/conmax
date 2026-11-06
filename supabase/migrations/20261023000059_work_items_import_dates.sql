-- Импорт плана объёмов: необязательные сроки позиции (start, finish в формате ГГГГ-ММ-ДД).
-- См. docs: 04-modules/ (объёмы и обходы).

create or replace function public.import_work_items(p_project uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_errors jsonb := '[]';
  v_valid  integer := 0;
  r        record;
  v_loc    uuid;
  v_disc   uuid;
  v_org    uuid;
  v_qty    numeric;
  v_weight numeric;
  v_start  date;
  v_finish date;
  n        integer := 0;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.has_project_permission(p_project, 'workitem.manage') then
    raise exception 'permission denied: workitem.manage' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;

  for r in select value as row, ordinality as idx from jsonb_array_elements(p_rows) with ordinality loop
    n := n + 1;
    v_loc := null; v_disc := null; v_org := null; v_qty := null; v_weight := null; v_start := null; v_finish := null;

    select id into v_loc from public.locations
     where project_id = p_project and deleted_at is null and path::text = upper(btrim(coalesce(r.row ->> 'location', '')));
    if v_loc is null then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Место «' || coalesce(r.row ->> 'location', '') || '» не найдено в структуре проекта');
      continue;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'discipline', '')), '') is not null then
      select id into v_disc from public.disciplines
       where project_id = p_project and deleted_at is null and upper(code) = upper(btrim(r.row ->> 'discipline')) limit 1;
      if v_disc is null then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Направление «' || (r.row ->> 'discipline') || '» не найдено');
        continue;
      end if;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'contractor', '')), '') is not null then
      select id into v_org from public.organizations
       where tenant_id = v_tenant and deleted_at is null and lower(name) = lower(btrim(r.row ->> 'contractor')) limit 1;
      if v_org is null then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Организация «' || (r.row ->> 'contractor') || '» не найдена');
        continue;
      end if;
    end if;

    begin
      v_qty := replace(btrim(coalesce(r.row ->> 'qty', '')), ',', '.')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty < 0 then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Объём «' || coalesce(r.row ->> 'qty', '') || '» — не число');
      continue;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'weight', '')), '') is not null then
      begin
        v_weight := replace(btrim(r.row ->> 'weight'), ',', '.')::numeric;
      exception when others then
        v_weight := null;
      end;
      if v_weight is null or v_weight <= 0 then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Вес «' || (r.row ->> 'weight') || '» — должно быть число больше нуля');
        continue;
      end if;
    end if;

    -- сроки позиции (необязательно): ГГГГ-ММ-ДД; окончание не раньше начала
    begin
      v_start := nullif(btrim(coalesce(r.row ->> 'start', '')), '')::date;
      v_finish := nullif(btrim(coalesce(r.row ->> 'finish', '')), '')::date;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Дата начала или окончания не распознана (нужен формат ГГГГ-ММ-ДД)');
      continue;
    end;
    if v_start is not null and v_finish is not null and v_finish < v_start then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Окончание раньше начала');
      continue;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'name', '')), '') is null or nullif(btrim(coalesce(r.row ->> 'unit', '')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Не заполнено название работы или единица измерения');
      continue;
    end if;

    v_valid := v_valid + 1;
    if not p_dry_run and jsonb_array_length(v_errors) = 0 then
      insert into public.work_items (project_id, location_id, discipline_id, contractor_org_id, name, unit, planned_qty, weight, planned_start, planned_finish)
      values (p_project, v_loc, v_disc, v_org, btrim(r.row ->> 'name'), btrim(r.row ->> 'unit'), v_qty, v_weight, v_start, v_finish);
    end if;
  end loop;

  if not p_dry_run and jsonb_array_length(v_errors) > 0 then
    raise exception 'import_has_errors' using errcode = '22023', detail = v_errors::text;
  end if;

  return jsonb_build_object('total', n, 'valid', v_valid, 'errors', v_errors, 'created', case when p_dry_run then 0 else v_valid end);
end;
$$;


revoke execute on function public.import_work_items(uuid, jsonb, boolean) from public, anon;
grant  execute on function public.import_work_items(uuid, jsonb, boolean) to authenticated;
