-- Сроки проекта: плановые начало и окончание меняются одной функцией с обоснованием и записью в историю.
-- При сдвиге начала можно сразу сдвинуть работы графика с ограничениями по датам на столько же дней.
-- Право: project.edit (руководитель проекта, администратор организации). См. docs: 04-modules/03-projects.md.

create or replace function public.set_project_dates(
  p_project uuid, p_start date, p_finish date, p_reason text default null, p_shift_schedule boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pr      public.projects;
  v_delta integer := 0;
  v_shifted integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into pr from public.projects where id = p_project and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  perform private.settings_guard(p_project, array['project.edit']);
  if p_start is not null and p_finish is not null and p_finish < p_start then raise exception 'bad_dates' using errcode = '22023'; end if;
  if p_start is not distinct from pr.planned_start and p_finish is not distinct from pr.planned_finish then
    return jsonb_build_object('changed', false);
  end if;
  -- менять уже назначенные сроки можно только с обоснованием: оно останется в истории проекта
  if (pr.planned_start is not null or pr.planned_finish is not null) and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if p_shift_schedule and p_start is not null and pr.planned_start is not null then
    v_delta := p_start - pr.planned_start;
    if v_delta <> 0 then
      update public.schedule_activities set constraint_date = constraint_date + v_delta
       where project_id = p_project and deleted_at is null and constraint_date is not null;
      get diagnostics v_shifted = row_count;
    end if;
  end if;

  update public.projects set planned_start = p_start, planned_finish = p_finish where id = p_project;
  perform private.record_event(pr.tenant_id, p_project, 'project', p_project, 'dates_changed',
    jsonb_build_object('from_start', pr.planned_start, 'to_start', p_start, 'from_finish', pr.planned_finish, 'to_finish', p_finish,
                       'reason', v_reason, 'shift_days', v_delta, 'shifted_activities', v_shifted), 'internal');

  if v_shifted > 0 and private.has_project_permission(p_project, 'schedule.edit') then
    begin
      perform public.recalculate_schedule(p_project);
    exception when others then
      null;   -- сеть графика с ошибкой (например, цикл) не должна отменять смену сроков
    end;
  end if;
  return jsonb_build_object('changed', true, 'shift_days', v_delta, 'shifted_activities', v_shifted);
end;
$$;

revoke execute on function public.set_project_dates(uuid, date, date, text, boolean) from public, anon;
grant  execute on function public.set_project_dates(uuid, date, date, text, boolean) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
