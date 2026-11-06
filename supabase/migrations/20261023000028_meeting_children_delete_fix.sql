-- Исправление: при удалении самого совещания (каскадом) его участники и повестка удаляются без ошибки «совещание не найдено».
create or replace function private.meeting_children_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_id uuid := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
begin
  select * into m from public.meetings where id = v_id;
  if not found then
    -- совещание уже удалено (каскад) — удалять дочерние строки можно
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'meeting_not_found' using errcode = 'P0002';
  end if;
  if m.status in ('published', 'cancelled') then raise exception 'meeting_closed' using errcode = '22023'; end if;

  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'INSERT' then
    new.tenant_id := m.tenant_id;
    new.project_id := m.project_id;
  end if;

  if tg_table_name = 'meeting_participants' then
    if tg_op = 'INSERT' and not private.user_is_project_member(new.user_id, m.project_id) then
      raise exception 'participant is not a project member' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.attendance is distinct from old.attendance and not private.user_can_conduct_meeting(auth.uid(), m.id) then
      raise exception 'permission denied: meeting.conduct' using errcode = '42501';
    end if;
  elsif tg_table_name = 'meeting_agenda_items' then
    if tg_op = 'INSERT' then
      new.title := btrim(new.title);
      if new.sort = 0 then
        select coalesce(max(sort), 0) + 10 into new.sort from public.meeting_agenda_items where meeting_id = m.id;
      end if;
    end if;
    if tg_op = 'UPDATE' and new.notes is distinct from old.notes and not private.user_can_conduct_meeting(auth.uid(), m.id) then
      raise exception 'permission denied: meeting.conduct' using errcode = '42501';
    end if;
    if new.presenter_id is not null and not private.user_is_project_member(new.presenter_id, m.project_id) then
      raise exception 'presenter is not a project member' using errcode = '23514';
    end if;
    if new.task_id is not null and not exists (
      select 1 from public.tasks t where t.id = new.task_id and t.project_id = m.project_id and t.deleted_at is null) then
      raise exception 'task belongs to another project' using errcode = '23514';
    end if;
  else
    if m.status not in ('in_progress', 'minutes_draft') then
      raise exception 'meeting_not_in_progress' using errcode = '22023';
    end if;
    new.text := btrim(new.text);
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      select coalesce(max(number), 0) + 1 into new.number from public.meeting_decisions where meeting_id = m.id;
    end if;
    if new.agenda_item_id is not null and not exists (
      select 1 from public.meeting_agenda_items a where a.id = new.agenda_item_id and a.meeting_id = m.id) then
      raise exception 'agenda item belongs to another meeting' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
