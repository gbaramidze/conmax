-- Подрядчик ведёт свои задачи сам.

-- Внешний участник без права назначать создаёт задачу «для себя»: исполнитель — он сам,
-- иначе задача никому не назначена и выпадает из его списка «мои».
create or replace function private.tasks_self_assign() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is null and new.reporter_id = auth.uid() and private.is_external()
     and not private.has_project_permission(new.project_id, 'task.assign') then
    new.assignee_id := new.reporter_id;
  end if;
  return new;
end;
$$;
create trigger tasks_self_assign before insert on public.tasks
  for each row execute function private.tasks_self_assign();

-- Файл, прикреплённый прямо к задаче (не к комментарию), видит внутренняя команда и тот, кто его загрузил.
-- Так подрядчик прикладывает фото и документы к своей задаче, не видя внутренних вложений заказчика и ПТО.
drop policy attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.can_view_entity(entity_type, entity_id)
    and (
      (comment_id is null and ((select private.can_see_internal(project_id)) or created_by = (select auth.uid())))
      or exists (select 1 from public.comments c where c.id = attachments.comment_id)
    )
  );

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
