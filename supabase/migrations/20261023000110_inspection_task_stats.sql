-- Инспекция: сводка по задачам для списка отчётов и уведомление «всё выполнено — проверьте».
--
-- `inspection_task_stats(p_project)` — по каждому отчёту проекта считает замечания C и R, сколько у них задач, сколько в работе (в том числе на
-- проверке), сколько выполнено, просрочено и подтверждено инспектором, и «готово к проверке»: есть неподтверждённые замечания, и у каждого из них
-- задача выполнена (или отменена). Считается по правам вызывающего: задачи, которых он не видит, учитываются как «без задачи».
-- Когда последняя задача отчёта выполнена и отчёт готов к проверке, автор отчёта получает отдельное уведомление «Все задачи по отчёту выполнены:
-- зайдите проверить». См. docs: 04-modules/19-quality-control.md.

create or replace function public.inspection_task_stats(p_project uuid)
returns table (report_id uuid, remarks integer, with_task integer, active integer, review integer, done integer, overdue integer, resolved integer, ready boolean)
language sql stable security invoker set search_path = '' as $$
  select i.report_id,
         count(*)::integer,
         count(t.id)::integer,
         (count(*) filter (where t.id is not null and t.status_category not in ('done', 'cancelled', 'review')))::integer,
         (count(*) filter (where t.status_category = 'review'))::integer,
         (count(*) filter (where t.status_category = 'done'))::integer,
         (count(*) filter (where t.due_date < current_date and t.status_category not in ('done', 'cancelled')))::integer,
         (count(*) filter (where i.resolved_at is not null))::integer,
         (count(*) filter (where i.resolved_at is null) > 0
          and count(*) filter (where i.resolved_at is null and (t.id is null or t.status_category not in ('done', 'cancelled'))) = 0)
    from public.inspection_items i
    join public.inspection_reports r on r.id = i.report_id and r.project_id = p_project and r.deleted_at is null
    left join public.tasks t on t.id = i.task_id and t.deleted_at is null
   where i.status in ('C', 'R')
   group by i.report_id
$$;
revoke execute on function public.inspection_task_stats(uuid) from public, anon;
grant execute on function public.inspection_task_stats(uuid) to authenticated;

-- Уведомление о выполненной задаче + отдельное, когда выполнено всё
create or replace function private.tasks_inspection_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i      public.inspection_items;
  r      public.inspection_reports;
  v_code text;
  v_text text;
  v_link text;
  v_ready boolean;
begin
  select * into i from public.inspection_items where id = new.source_id;
  if not found then return new; end if;
  select * into r from public.inspection_reports where id = i.report_id and deleted_at is null;
  if not found or r.created_by is null then return new; end if;
  select code into v_code from public.projects where id = r.project_id;
  v_link := '/projects/' || v_code || '/inspection/' || r.id;

  v_text := 'Замечание ' || private.inspection_item_ref(i.id) || ' отчёта ' || r.key || ': '
            || case new.status_category when 'done' then 'задача выполнена' else 'задача готова к проверке' end;
  perform private.notify(r.created_by, 'task', new.id, 'assigned', 'high', 'status_changed', v_text, true);
  update public.notifications
     set payload = payload || jsonb_build_object('link', v_link)
   where id = (select n.id from public.notifications n where n.user_id = r.created_by and n.entity_type = 'task' and n.entity_id = new.id order by n.updated_at desc limit 1);

  -- выполнено всё: у каждого неподтверждённого замечания задача выполнена
  if new.status_category = 'done' then
    select (count(*) filter (where it.resolved_at is null) > 0
            and count(*) filter (where it.resolved_at is null and (t.id is null or t.status_category not in ('done', 'cancelled'))) = 0)
      into v_ready
      from public.inspection_items it
      left join public.tasks t on t.id = it.task_id and t.deleted_at is null
     where it.report_id = r.id and it.status in ('C', 'R');
    if v_ready then
      perform private.notify(r.created_by, 'project', r.project_id, 'assigned', 'high', 'status_changed',
                             'Все задачи по отчёту ' || r.key || ' выполнены: зайдите проверить', true);
      update public.notifications
         set payload = payload || jsonb_build_object('link', v_link)
       where id = (select n.id from public.notifications n where n.user_id = r.created_by and n.entity_type = 'project' and n.entity_id = r.project_id order by n.updated_at desc limit 1);
    end if;
  end if;
  return new;
end;
$$;
notify pgrst, 'reload schema';
