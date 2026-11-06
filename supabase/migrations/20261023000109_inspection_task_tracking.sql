-- Инспекция: отслеживание задач по замечаниям.
--
-- 1. Когда задача, созданная по замечанию, уходит на проверку или выполнена, автор отчёта получает уведомление высокого приоритета
--    «Замечание 1.1 отчёта ZK7-IR-4: задача выполнена»; по нажатию открывается сам отчёт (а не задача).
-- 2. Подтверждение устранения: после проверки на месте инспектор отмечает замечание устранённым (`resolved_at`, `resolved_by`). Это работает
--    и у выданного отчёта, статус A/C/R замечания при этом не меняется (в выданном отчёте он зафиксирован). Отметку можно снять.
-- Права: вести инспекции. См. docs: 04-modules/19-quality-control.md.

alter table public.inspection_items
  add column resolved_at timestamptz,
  add column resolved_by uuid references public.users(id);

create or replace function public.inspection_item_resolve(p_item uuid, p_resolved boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspection_items;
  r public.inspection_reports;
begin
  select * into i from public.inspection_items where id = p_item and tenant_id = private.tenant_id();
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(i.report_id, false);
  if i.status is null or i.status = 'A' then raise exception 'item_not_remark' using errcode = '22023'; end if;
  update public.inspection_items
     set resolved_at = case when p_resolved then now() else null end,
         resolved_by = case when p_resolved then auth.uid() else null end,
         updated_at = now()
   where id = i.id;
end;
$$;
revoke execute on function public.inspection_item_resolve(uuid, boolean) from public, anon;
grant execute on function public.inspection_item_resolve(uuid, boolean) to authenticated;

-- Уведомление автору отчёта о задаче по замечанию
create or replace function private.tasks_inspection_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i      public.inspection_items;
  r      public.inspection_reports;
  v_code text;
  v_text text;
begin
  select * into i from public.inspection_items where id = new.source_id;
  if not found then return new; end if;
  select * into r from public.inspection_reports where id = i.report_id and deleted_at is null;
  if not found or r.created_by is null then return new; end if;
  select code into v_code from public.projects where id = r.project_id;

  v_text := 'Замечание ' || private.inspection_item_ref(i.id) || ' отчёта ' || r.key || ': '
            || case new.status_category when 'done' then 'задача выполнена' else 'задача готова к проверке' end;
  perform private.notify(r.created_by, 'task', new.id, 'assigned', 'high', 'status_changed', v_text, true);
  -- по нажатию открывается отчёт
  update public.notifications
     set payload = payload || jsonb_build_object('link', '/projects/' || v_code || '/inspection/' || r.id)
   where id = (select n.id from public.notifications n where n.user_id = r.created_by and n.entity_type = 'task' and n.entity_id = new.id order by n.updated_at desc limit 1);
  return new;
end;
$$;

create trigger tasks_inspection_notify after update of status_category on public.tasks
  for each row
  when (old.status_category is distinct from new.status_category and new.source_type = 'inspection_item' and new.status_category in ('review', 'done'))
  execute function private.tasks_inspection_notify();
notify pgrst, 'reload schema';
