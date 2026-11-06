-- Зоны на типовом плане: один план привязан к этажам 13–18, номер обводится один раз, а зона создаётся у номера на каждом этаже группы.
-- Функция делает то же, что `plan_zone_set`, сразу для нескольких мест с одним и тем же контуром, в одной транзакции:
-- не получится, чтобы на части этажей зона появилась, а на части — нет. Не больше 200 мест за раз.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Зоны на планах».

create or replace function public.plan_zone_set_many(p_project uuid, p_document uuid, p_page integer, p_locations uuid[], p_points jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_loc uuid;
  v_n   integer := 0;
begin
  if p_locations is null or coalesce(array_length(p_locations, 1), 0) = 0 or array_length(p_locations, 1) > 200 then
    raise exception 'position_invalid' using errcode = '22023';
  end if;
  foreach v_loc in array (select array_agg(distinct x) from unnest(p_locations) x) loop
    perform public.plan_zone_set(p_project, p_document, p_page, v_loc, p_points);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.plan_zone_set_many(uuid, uuid, integer, uuid[], jsonb) from public, anon;
grant execute on function public.plan_zone_set_many(uuid, uuid, integer, uuid[], jsonb) to authenticated;
notify pgrst, 'reload schema';
