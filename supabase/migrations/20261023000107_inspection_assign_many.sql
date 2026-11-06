-- Инспекция: раздать замечания разным исполнителям за одно действие.
--
-- `inspection_assign_many(p_report, p_items)` создаёт задачи по списку замечаний отчёта; у каждого свой исполнитель, срок и организация:
-- p_items — массив объектов {"item": "<id замечания>", "assignee": "<id участника>", "due": "ГГГГ-ММ-ДД", "org": "<id организации>"}, всё, кроме item,
-- необязательно. Всё или ничего: если одно замечание не подходит (чужое, без статуса C/R, уже с задачей), задачи не создаются совсем.
-- Права те же, что у выдачи задач по одному замечанию. См. docs: 04-modules/19-quality-control.md.

create or replace function public.inspection_assign_many(p_report uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
  e jsonb;
  i public.inspection_items;
  n integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'items_invalid' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    select * into i from public.inspection_items where id = nullif(e ->> 'item', '')::uuid and report_id = r.id;
    if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    if i.status is null or i.status = 'A' then raise exception 'item_not_remark' using errcode = '22023'; end if;
    if i.task_id is not null and exists (select 1 from public.tasks t where t.id = i.task_id and t.deleted_at is null) then
      raise exception 'already_assigned' using errcode = '22023';
    end if;
    perform private.inspection_make_task(r, i, nullif(e ->> 'assignee', '')::uuid, nullif(e ->> 'due', '')::date, nullif(e ->> 'org', '')::uuid);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.inspection_assign_many(uuid, jsonb) from public, anon;
grant execute on function public.inspection_assign_many(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
