-- Новая заметка с площадки: уведомление ВСЕМ участникам проекта, а не только адресату.
-- Раньше всем уходил лишь общий push «Новая заметка» (если человек подписан на push); в колокольчике и на почте заметка появлялась только у адресата.
-- Теперь каждому участнику проекта (кроме автора и адресата, у которого своё личное уведомление) создаётся уведомление «Новая заметка · CODE»
-- с переходом в карточку заметки. Дальше работает обычный конвейер: окно в приложении, push (с фото) и письмо — по настройкам каждого человека
-- (категория «наблюдаю»). Внутренняя заметка не уходит тем, кто не видит внутренние комментарии.
-- Общий push заметки остаётся только для тех, у кого уведомления нет (например, выключено в приложении), чтобы не было двойных.

create or replace function private.notify_field_note_members(p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c      record;
  r      record;
  v_link text;
  v_body text;
begin
  select cm.project_id, cm.visibility, cm.body_text, cm.author_id, p.code, l.name as loc_name, u.full_name as author,
         fn.addressee_user_id, fn.addressee_org_id
    into c
    from public.comments cm
    join public.field_notes fn on fn.comment_id = cm.id
    join public.projects p on p.id = cm.project_id
    join public.locations l on l.id = fn.location_id
    left join public.users u on u.id = cm.author_id
   where cm.id = p_comment and cm.deleted_at is null;
  if not found then return; end if;

  v_link := '/projects/' || c.code || '/note/' || p_comment;
  v_body := coalesce(c.loc_name || ' · ', '') || coalesce(c.author || ': ', '')
            || '«' || left(regexp_replace(coalesce(c.body_text, ''), '\s+', ' ', 'g'), 140) || '»';

  for r in
    select distinct pm.user_id
      from public.project_members pm
      join public.users u2 on u2.id = pm.user_id and u2.status <> 'blocked'
     where pm.project_id = c.project_id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
       and pm.user_id <> c.author_id
       and pm.user_id is distinct from c.addressee_user_id
       and (c.addressee_org_id is null or u2.organization_id is distinct from c.addressee_org_id)
  loop
    perform private.notify_direct(r.user_id, c.project_id, 'watching', 'normal', 'note.created', 'field_note', p_comment,
                                  'Новая заметка · ' || c.code, v_body, v_link, c.visibility = 'internal');
  end loop;
end;
$$;
revoke execute on function private.notify_field_note_members(uuid) from public, anon, authenticated;

create or replace function public.register_field_note(
  p_comment uuid, p_user uuid default null, p_org uuid default null, p_task uuid default null,
  p_scheme_file uuid default null, p_scheme_version uuid default null, p_x numeric default null, p_y numeric default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := auth.uid();
  c          record;
  v_old_user uuid;
  v_old_org  uuid;
  v_point    boolean := p_x is not null or p_y is not null or p_scheme_file is not null or p_scheme_version is not null;
  v_known    boolean;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select cm.tenant_id, cm.project_id, cm.entity_id, cm.visibility into c
    from public.comments cm
   where cm.id = p_comment and cm.author_id = v_me and cm.entity_type = 'location' and cm.deleted_at is null
     and cm.tenant_id = private.tenant_id();
  if not found then
    raise exception 'note not found' using errcode = '42501';
  end if;
  perform private.field_note_check_addressee(c.project_id, c.visibility, p_user, p_org);
  if p_task is not null and not exists (
       select 1 from public.tasks t where t.id = p_task and t.project_id = c.project_id and t.reporter_id = v_me) then
    raise exception 'task not found' using errcode = '42501';
  end if;
  if v_point then
    if p_x is null or p_y is null or p_x not between 0 and 1 or p_y not between 0 and 1 or (p_scheme_file is null) = (p_scheme_version is null) then
      raise exception 'invalid scheme point' using errcode = '22023';
    end if;
    -- схема должна быть одной из доступных этому месту
    if not exists (
         select 1 from public.inspection_scheme_options(c.entity_id) o
          where o.source <> 'parent'
            and ((p_scheme_file is not null and o.file_id = p_scheme_file) or (p_scheme_version is not null and o.version_id = p_scheme_version))) then
      raise exception 'scheme is not available for this place' using errcode = '42501';
    end if;
  end if;

  select f.addressee_user_id, f.addressee_org_id into v_old_user, v_old_org from public.field_notes f where f.comment_id = p_comment;
  v_known := found;

  insert into public.field_notes (comment_id, tenant_id, project_id, location_id, author_id, addressee_user_id, addressee_org_id, task_id,
                                  scheme_file_id, scheme_version_id, scheme_x, scheme_y)
  values (p_comment, c.tenant_id, c.project_id, c.entity_id, v_me, p_user, p_org, p_task,
          p_scheme_file, p_scheme_version, p_x, p_y)
  on conflict (comment_id) do update
    set addressee_user_id = excluded.addressee_user_id,
        addressee_org_id  = excluded.addressee_org_id,
        task_id           = coalesce(excluded.task_id, public.field_notes.task_id),
        -- повторная регистрация без точки не стирает уже отмеченную
        scheme_file_id    = case when excluded.scheme_x is not null then excluded.scheme_file_id else public.field_notes.scheme_file_id end,
        scheme_version_id = case when excluded.scheme_x is not null then excluded.scheme_version_id else public.field_notes.scheme_version_id end,
        scheme_x          = coalesce(excluded.scheme_x, public.field_notes.scheme_x),
        scheme_y          = coalesce(excluded.scheme_y, public.field_notes.scheme_y);

  perform private.notify_field_note_addressee(p_comment,
    case when p_user is distinct from v_old_user then p_user end,
    case when p_org  is distinct from v_old_org  then p_org  end);
  -- новая заметка: уведомление всем на проекте (адресат получил своё личное выше)
  if not v_known then
    perform private.notify_field_note_members(p_comment);
  end if;
end;
$$;

revoke execute on function public.register_field_note(uuid, uuid, uuid, uuid, uuid, uuid, numeric, numeric) from public, anon;
grant  execute on function public.register_field_note(uuid, uuid, uuid, uuid, uuid, uuid, numeric, numeric) to authenticated;

-- Общий push заметки: только тем, у кого нет уведомления об этой заметке (их push придёт из конвейера уведомлений)
create or replace function public.field_note_push_targets(p_comment uuid)
returns table (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text, locale text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.locale
    from public.comments c
    join public.push_subscriptions s on s.tenant_id = c.tenant_id and s.user_id <> c.author_id
    join public.users u on u.id = s.user_id and u.status <> 'blocked'
    left join public.user_notification_settings qs on qs.user_id = u.id
    left join public.field_notes fn on fn.comment_id = c.id
   where c.id = p_comment and c.entity_type = 'location' and c.deleted_at is null
     and private.user_can_see_project(u.id, c.project_id)
     and (c.visibility = 'external' or private.user_has_project_permission(u.id, c.project_id, 'comment.internal.view'))
     and not coalesce(fn.addressee_user_id = u.id or (fn.addressee_org_id is not null and fn.addressee_org_id = u.organization_id), false)
     and not exists (select 1 from public.notifications n where n.user_id = u.id and n.entity_type = 'field_note' and n.entity_id = c.id)
     and not coalesce(qs.quiet_enabled and (
           case when qs.quiet_start <= qs.quiet_end
                then (now() at time zone qs.timezone)::time >= qs.quiet_start and (now() at time zone qs.timezone)::time < qs.quiet_end
                else (now() at time zone qs.timezone)::time >= qs.quiet_start or (now() at time zone qs.timezone)::time < qs.quiet_end
           end), false);
$$;
revoke execute on function public.field_note_push_targets(uuid) from public, anon, authenticated;
grant  execute on function public.field_note_push_targets(uuid) to service_role;

notify pgrst, 'reload schema';
