-- Сводка по задачам для списка и доски: чек-лист, вложения, комментарии, документы (как значки в Trello).
-- Работает с правами вызывающего: считается только то, что он видит.
create or replace function public.task_badges(p_tasks uuid[])
returns table (task_id uuid, checklist_total integer, checklist_done integer, attachments integer, comments integer, documents integer)
language sql stable set search_path = '' as $$
  select t.id,
         (select count(*)::integer from public.checklist_items i join public.checklists c on c.id = i.checklist_id
           where c.entity_type = 'task' and c.entity_id = t.id),
         (select count(*)::integer from public.checklist_items i join public.checklists c on c.id = i.checklist_id
           where c.entity_type = 'task' and c.entity_id = t.id and i.done),
         (select count(*)::integer from public.attachments a where a.entity_type = 'task' and a.entity_id = t.id),
         (select count(*)::integer from public.comments cm where cm.entity_type = 'task' and cm.entity_id = t.id and cm.deleted_at is null),
         (select count(*)::integer from public.document_links dl where dl.entity_type = 'task' and dl.entity_id = t.id)
    from unnest(p_tasks) as t(id);
$$;
revoke execute on function public.task_badges(uuid[]) from public, anon;
grant  execute on function public.task_badges(uuid[]) to authenticated;
