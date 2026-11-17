-- Заметка с площадки как объект ядра («field_note»): у неё свои комментарии с фото, подписчики и уведомления,
-- как у задачи. Идентификатор объекта — comment_id заметки (первичный ключ field_notes).
-- Комментарии к заметке видят те же люди, что саму заметку: внутренняя заметка — только тем, кто видит внутреннее.
-- Из заметки можно создать задачу: связь хранится в field_notes.task_id.

insert into public.entity_types (code, module, features) values ('field_note', 'field_notes', array['comments', 'attachments', 'activity'])
on conflict (code) do nothing;

create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'    then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'       then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
    when 'location'   then (select project_id from public.locations where id = p_id and tenant_id = private.tenant_id())
    when 'document'   then (select project_id from public.documents where id = p_id and tenant_id = private.tenant_id())
    when 'meeting'    then (select project_id from public.meetings where id = p_id and tenant_id = private.tenant_id())
    when 'signal'     then (select project_id from public.signals where id = p_id and tenant_id = private.tenant_id())
    when 'field_note' then (select project_id from public.field_notes where comment_id = p_id and tenant_id = private.tenant_id())
  end;
$$;

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'    then (select id from public.projects where id = p_id)
    when 'task'       then (select project_id from public.tasks where id = p_id)
    when 'location'   then (select project_id from public.locations where id = p_id)
    when 'document'   then (select project_id from public.documents where id = p_id)
    when 'meeting'    then (select project_id from public.meetings where id = p_id)
    when 'ffe_item'   then (select project_id from public.ffe_items where id = p_id)
    when 'signal'     then (select project_id from public.signals where id = p_id)
    when 'room_type'  then (select project_id from public.room_types where id = p_id)
    when 'field_note' then (select project_id from public.field_notes where comment_id = p_id)
  end;
$$;

create or replace function private.user_can_view_entity(p_user uuid, p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then private.user_can_see_project(p_user, p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and private.user_task_visible(p_user, t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    when 'location' then exists (
      select 1 from public.locations l
      where l.id = p_id and private.user_can_see_project(p_user, l.project_id))
    when 'document' then private.user_can_view_document(p_user, p_id)
    when 'meeting' then private.user_can_view_meeting(p_user, p_id)
    when 'signal' then exists (
      select 1 from public.signals s
      where s.id = p_id and private.user_can_see_project(p_user, s.project_id)
        and private.user_has_project_permission(p_user, s.project_id, 'signal.view')
        and private.user_has_project_permission(p_user, s.project_id, 'comment.internal.view'))
    when 'field_note' then exists (
      select 1 from public.field_notes f join public.comments c on c.id = f.comment_id
      where f.comment_id = p_id and c.deleted_at is null
        and private.user_can_see_project(p_user, f.project_id)
        and (c.visibility = 'external' or private.user_has_project_permission(p_user, f.project_id, 'comment.internal.view')))
    else false
  end;
$$;

create or replace function private.entity_display(p_type text, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'task' then (
      select jsonb_build_object('key', t.key, 'title', t.title, 'project_code', p.code)
        from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_id)
    when 'project' then (
      select jsonb_build_object('key', p.code, 'title', p.name, 'project_code', p.code)
        from public.projects p where p.id = p_id)
    when 'location' then (
      select jsonb_build_object('key', l.path::text, 'title', l.name, 'project_code', p.code)
        from public.locations l join public.projects p on p.id = l.project_id where l.id = p_id)
    when 'document' then (
      select jsonb_build_object('key', coalesce(d.code, 'Документ'), 'title', d.title, 'project_code', p.code)
        from public.documents d join public.projects p on p.id = d.project_id where d.id = p_id)
    when 'meeting' then (
      select jsonb_build_object('key', m.key, 'title', m.title, 'project_code', p.code)
        from public.meetings m join public.projects p on p.id = m.project_id where m.id = p_id)
    when 'signal' then (
      select jsonb_build_object('key', 'Сигнал', 'title', s.title, 'project_code', p.code)
        from public.signals s join public.projects p on p.id = s.project_id where s.id = p_id)
    when 'field_note' then (
      select jsonb_build_object('key', 'Заметка', 'title', coalesce(nullif(left(c.body_text, 60), ''), l.name), 'project_code', p.code)
        from public.field_notes f
        join public.comments c on c.id = f.comment_id
        join public.locations l on l.id = f.location_id
        join public.projects p on p.id = f.project_id
       where f.comment_id = p_id)
  end;
$$;

-- Подписчики заметки: автор и адресат-сотрудник получают уведомления о комментариях к ней
create or replace function private.field_note_watch(p_comment uuid, p_author uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.add_watcher('field_note', p_comment, p_author, 'creator');
  if p_user is not null then
    perform private.add_watcher('field_note', p_comment, p_user, 'assignee');
  end if;
end;
$$;
revoke execute on function private.field_note_watch(uuid, uuid, uuid) from public, anon;

-- Подписка при создании заметки и при смене адресата-сотрудника (register_field_note и set_field_note_addressee не меняем)
create or replace function private.field_notes_watch_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.field_note_watch(new.comment_id, new.author_id, new.addressee_user_id);
  return new;
end;
$$;
create trigger field_notes_watch after insert or update of addressee_user_id on public.field_notes
  for each row execute function private.field_notes_watch_trigger();

-- Личное уведомление адресату теперь ведёт в карточку заметки (а не на этаж) и привязано к самой заметке:
-- так комментарии, фото и «создать задачу» открываются прямо из уведомления.
create or replace function private.notify_field_note_addressee(p_comment uuid, p_user uuid, p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c      record;
  r      record;
  v_link text;
  v_body text;
begin
  if p_user is null and p_org is null then return; end if;
  select cm.project_id, cm.visibility, cm.body_text, p.code,
         l.name as loc_name, u.full_name as author
    into c
    from public.comments cm
    join public.projects p on p.id = cm.project_id
    join public.locations l on l.id = cm.entity_id
    left join public.users u on u.id = cm.author_id
   where cm.id = p_comment and cm.entity_type = 'location' and cm.deleted_at is null;
  if not found then return; end if;

  v_link := '/projects/' || c.code || '/note/' || p_comment;
  v_body := coalesce(c.loc_name || ' · ', '') || coalesce(c.author || ': ', '')
            || '«' || left(regexp_replace(coalesce(c.body_text, ''), '\s+', ' ', 'g'), 140) || '»';

  if p_user is not null then
    perform private.notify_direct(p_user, c.project_id, 'assigned', 'high', 'note.assigned', 'field_note', p_comment,
                                  'Вам адресована заметка · ' || c.code, v_body, v_link, c.visibility = 'internal');
  end if;
  if p_org is not null then
    for r in
      select u.id
        from public.users u
        join public.project_members pm on pm.user_id = u.id and pm.project_id = c.project_id and pm.deleted_at is null
                                      and (pm.left_at is null or pm.left_at > current_date)
       where u.organization_id = p_org and u.status <> 'blocked'
    loop
      perform private.notify_direct(r.id, c.project_id, 'assigned', 'high', 'note.assigned', 'field_note', p_comment,
                                    'Заметка вашей организации · ' || c.code, v_body, v_link, c.visibility = 'internal');
    end loop;
  end if;
end;
$$;
revoke execute on function private.notify_field_note_addressee(uuid, uuid, uuid) from public, anon, authenticated;

-- Связать заметку с созданной из неё задачей. Может тот, кто видит заметку и сам создал эту задачу (одна заметка — одна задача).
create or replace function public.link_field_note_task(p_comment uuid, p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_project uuid;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select f.project_id into v_project from public.field_notes f
   where f.comment_id = p_comment and f.tenant_id = private.tenant_id() and f.task_id is null
     and private.user_can_view_entity(v_me, 'field_note', p_comment);
  if v_project is null then
    raise exception 'note not found or already has a task' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tasks t where t.id = p_task and t.project_id = v_project and t.reporter_id = v_me) then
    raise exception 'task not found' using errcode = '42501';
  end if;
  update public.field_notes set task_id = p_task where comment_id = p_comment;
end;
$$;

revoke execute on function public.link_field_note_task(uuid, uuid) from public, anon;
grant  execute on function public.link_field_note_task(uuid, uuid) to authenticated;

-- Подписки на уже существующие заметки: автор и адресат-сотрудник
select private.field_note_watch(f.comment_id, f.author_id, f.addressee_user_id) from public.field_notes f;

notify pgrst, 'reload schema';
