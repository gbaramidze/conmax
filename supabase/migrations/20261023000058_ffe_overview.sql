-- Сводка по мебели для главной страницы проекта без выгрузки всех строк: штуки по статусам и по типам номеров.
-- Видят внутренние участники проекта (как сами строки мебели).

create or replace function public.ffe_overview(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = private.tenant_id())
     or not private.can_see_project(p_project) or not private.can_see_internal(p_project) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, pieces) from (
        select status, sum(qty)::integer as pieces from public.room_ffe where project_id = p_project group by status) s), '{}'::jsonb),
    'by_type', coalesce((select jsonb_object_agg(coalesce(type_id::text, 'none'), pieces) from (
        select sp.type_id, sum(f.qty)::integer as pieces
          from public.room_ffe f left join public.room_specs sp on sp.location_id = f.location_id
         where f.project_id = p_project group by sp.type_id) t), '{}'::jsonb));
end;
$$;
revoke execute on function public.ffe_overview(uuid) from public, anon;
grant  execute on function public.ffe_overview(uuid) to authenticated;
