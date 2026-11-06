-- Инспекция: раздать замечания задачами.
--
-- Замечание со статусом C или R можно превратить в задачу типа «замечание» (punch): название с ключом отчёта и номером пункта, текст замечания,
-- фото замечания (прикрепляются к задаче), место отчёта, исполнитель и срок. Исполнитель — участник проекта; можно назначить и только
-- организацию (подрядчик отчёта по умолчанию). Приоритет: R — высокий, C — обычный. Связь двусторонняя: у замечания `task_id`, у задачи
-- `source_type = 'inspection_item'` и `source_id`. Задачи можно создавать и у выданного отчёта: их раздают после выдачи.
-- «Раздать все» создаёт задачи для всех замечаний C и R, у которых задачи ещё нет, с одним исполнителем и сроком (потом правятся в задачах).
-- Права: вести инспекции (`inspection.conduct`) и создавать задачи (`task.create`, исполнителя назначает тот, у кого `task.assign`).
-- См. docs: 04-modules/19-quality-control.md.

alter table public.inspection_items add column task_id uuid references public.tasks(id) on delete set null;
create index on public.inspection_items (task_id) where task_id is not null;

-- Номер пункта как на экране: «раздел.замечание» по порядку
create or replace function private.inspection_item_ref(p_item uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.ord || '.' || i.ord
    from (select i2.id, i2.section_id, row_number() over (partition by i2.section_id order by i2.position) as ord from public.inspection_items i2 where i2.report_id = (select report_id from public.inspection_items where id = p_item)) i
    join (select s2.id, row_number() over (order by s2.position) as ord from public.inspection_sections s2 where s2.report_id = (select report_id from public.inspection_items where id = p_item)) s on s.id = i.section_id
   where i.id = p_item
$$;

-- Задача по замечанию
create or replace function private.inspection_make_task(r public.inspection_reports, i public.inspection_items, p_assignee uuid, p_due date, p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ref   text := private.inspection_item_ref(i.id);
  v_text  text := coalesce(nullif(btrim(i.comment), ''), 'Замечание');
  v_task  public.tasks;
begin
  v_task := public.create_task(
    r.project_id,
    left('[' || r.key || ' · ' || v_ref || '] ' || v_text, 200),
    'punch',
    p_assignee,
    p_due,
    case when i.status = 'R' then 'high' else 'normal' end,
    coalesce(p_org, r.contractor_org_id),
    null,
    r.location_id,
    null
  );
  update public.tasks
     set description = jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
           jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))),
           jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text',
             'Отчёт об инспекции ' || r.key || ', пункт ' || v_ref || ', статус ' || coalesce(i.status, '—') || '.')))
         )),
         source_type = 'inspection_item', source_id = i.id
   where id = v_task.id;
  -- фото замечания видны и в задаче
  insert into public.attachments (entity_type, entity_id, file_id)
  select 'task', v_task.id, ph.file_id from public.inspection_photos ph where ph.item_id = i.id;
  update public.inspection_items set task_id = v_task.id where id = i.id;
  return v_task.id;
end;
$$;

-- Задача по одному замечанию (только C и R, один раз)
create or replace function public.inspection_item_assign(p_item uuid, p_assignee uuid default null, p_due date default null, p_org uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspection_items;
  r public.inspection_reports;
begin
  select * into i from public.inspection_items where id = p_item and tenant_id = private.tenant_id();
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(i.report_id, false);
  if i.status is null or i.status = 'A' then raise exception 'item_not_remark' using errcode = '22023'; end if;
  if i.task_id is not null and exists (select 1 from public.tasks t where t.id = i.task_id and t.deleted_at is null) then
    raise exception 'already_assigned' using errcode = '22023';
  end if;
  return private.inspection_make_task(r, i, p_assignee, p_due, p_org);
end;
$$;

-- Задачи по всем замечаниям C и R без задачи; возвращает, сколько создано
create or replace function public.inspection_assign_all(p_report uuid, p_assignee uuid default null, p_due date default null, p_org uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
  i public.inspection_items;
  n integer := 0;
begin
  for i in
    select it.* from public.inspection_items it join public.inspection_sections s on s.id = it.section_id
     where it.report_id = r.id and it.status in ('C', 'R')
       and not exists (select 1 from public.tasks t where t.id = it.task_id and t.deleted_at is null)
     order by s.position, it.position
  loop
    perform private.inspection_make_task(r, i, p_assignee, p_due, p_org);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.inspection_item_assign(uuid, uuid, date, uuid), public.inspection_assign_all(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.inspection_item_assign(uuid, uuid, date, uuid), public.inspection_assign_all(uuid, uuid, date, uuid) to authenticated;
notify pgrst, 'reload schema';
