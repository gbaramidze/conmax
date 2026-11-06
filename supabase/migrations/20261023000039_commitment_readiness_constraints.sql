-- Недельный план × look-ahead: работа с неснятыми ограничениями на старте недели считается «не готовой»
-- (раньше учитывался только незавершённый предшественник). Влияет на was_ready у новых обязательств и на аналитику PPC.

create or replace function private.activity_ready(p_activity uuid, p_week_start date) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1
      from public.schedule_links l
      join public.schedule_activities p on p.id = l.predecessor_id
     where l.successor_id = p_activity and l.type = 'FS' and p.deleted_at is null
       and p.percent_complete < 100 and coalesce(p.finish_date, 'infinity'::date) >= p_week_start)
  and not exists (
    select 1
      from public.activity_constraints ac
      join public.tasks t on t.id = ac.task_id
     where ac.activity_id = p_activity and t.deleted_at is null
       and t.status_category not in ('done', 'cancelled'));
$$;
