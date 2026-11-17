-- Уведомления: push на все уведомления, письма всем наблюдателям, адресат заметки, больше событий для наблюдателей.
--  1. Любое новое (или дополненное в окне группировки) уведомление уходит push на устройства получателя: воркер send-push (по notification_id),
--     настройка канала «push» по категориям, тихие часы (критичное — всегда).
--  2. Письма: «наблюдаю» теперь приходит сразу, как и «назначено» и «упоминания» (раньше — сводкой раз в сутки). Сводку можно выбрать в настройках.
--  3. Заметка с площадки, адресованная человеку (или организации), создаёт ему уведомление «Вам адресована заметка» (+ push и письмо).
--  4. Наблюдатели задачи узнают о любом изменении карточки: исполнитель, приоритет, название, описание, плановый старт, «нужно к», вложения.
--  5. В письмо попадает ссылка из уведомления (заметка, документ, совещание), а не только страница проекта.

-- ---------------------------------------------------------------------------
-- 1. Режим канала по умолчанию: push и email — сразу
-- ---------------------------------------------------------------------------
create or replace function private.channel_mode(p_user uuid, p_category text, p_channel text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select np.mode from public.notification_preferences np
      where np.user_id = p_user and np.category = p_category and np.channel = p_channel),
    case p_channel when 'in_app' then 'instant' when 'email' then 'instant' when 'push' then 'instant' else 'off' end);
$$;

-- ---------------------------------------------------------------------------
-- 2. Текст сгруппированного уведомления: добавлено «изменений»
-- ---------------------------------------------------------------------------
create or replace function private.notification_body(p_counts jsonb, p_last_text text) returns text
language plpgsql immutable as $$
declare
  v_total integer := 0;
  v_parts text[] := '{}';
  v_n     integer;
  k       text;
begin
  for k in select jsonb_object_keys(p_counts) loop v_total := v_total + (p_counts ->> k)::integer; end loop;
  if v_total <= 1 then return p_last_text; end if;

  v_n := coalesce((p_counts ->> 'overdue')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'задача просрочена'); end if;
  v_n := coalesce((p_counts ->> 'assigned')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'вас назначили исполнителем'); end if;
  v_n := coalesce((p_counts ->> 'mentioned')::integer, 0);
  if v_n = 1 then v_parts := array_append(v_parts, 'вас упомянули');
  elsif v_n > 1 then v_parts := array_append(v_parts, 'упоминаний: ' || v_n); end if;
  v_n := coalesce((p_counts ->> 'status_changed')::integer, 0);
  if v_n = 1 then v_parts := array_append(v_parts, 'статус изменён');
  elsif v_n > 1 then v_parts := array_append(v_parts, 'статус менялся ' || v_n || ' ' || private.ru_plural(v_n, 'раз', 'раза', 'раз')); end if;
  v_n := coalesce((p_counts ->> 'due_changed')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'срок изменён'); end if;
  v_n := coalesce((p_counts ->> 'changed')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, v_n || ' ' || private.ru_plural(v_n, 'изменение', 'изменения', 'изменений')); end if;
  v_n := coalesce((p_counts ->> 'commented')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, v_n || ' ' || private.ru_plural(v_n, 'комментарий', 'комментария', 'комментариев')); end if;
  v_n := coalesce((p_counts ->> 'discrepancy')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'расхождений: ' || v_n); end if;

  return array_to_string(v_parts, ', ');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Push на уведомления
-- ---------------------------------------------------------------------------
-- Подписки, на которые нужно отправить push об уведомлении: не прочитано и не убрано, не отложено, канал «push» не выключен,
-- не тихие часы (критичное — всегда). Вызывает только воркер send-push.
create or replace function public.notification_push_targets(p_notification uuid)
returns table (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text, locale text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.locale
    from public.notifications n
    join public.push_subscriptions s on s.user_id = n.user_id and s.tenant_id = n.tenant_id
    join public.users u on u.id = n.user_id and u.status <> 'blocked'
    left join public.user_notification_settings qs on qs.user_id = u.id
   where n.id = p_notification
     and n.read_at is null and n.archived_at is null
     and (n.snoozed_until is null or n.snoozed_until <= now())
     and (n.priority = 'critical' or private.channel_mode(n.user_id, n.category, 'push') <> 'off')
     and (n.priority = 'critical' or not coalesce(qs.quiet_enabled and (
           case when qs.quiet_start <= qs.quiet_end
                then (now() at time zone qs.timezone)::time >= qs.quiet_start and (now() at time zone qs.timezone)::time < qs.quiet_end
                else (now() at time zone qs.timezone)::time >= qs.quiet_start or (now() at time zone qs.timezone)::time < qs.quiet_end
           end), false));
$$;
revoke execute on function public.notification_push_targets(uuid) from public, anon, authenticated;
grant  execute on function public.notification_push_targets(uuid) to service_role;

-- Новое уведомление (или дополненное сгруппированное) → будим воркер. Ошибка отправки никогда не мешает самому действию.
create or replace function private.notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  if new.read_at is not null or new.archived_at is not null then return new; end if;
  if new.snoozed_until is not null and new.snoozed_until > now() then return new; end if;
  -- пока у человека нет подписанных устройств, ничего не вызываем
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return new; end if;
  select value into v_url    from private.app_config where key = 'push_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key    from private.app_config where key = 'functions_apikey';
  if v_url is null then return new; end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
      body := jsonb_build_object('notification_id', new.id),
      timeout_milliseconds := 20000);
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function private.notification_push() from public, anon, authenticated;

create trigger notifications_push_insert after insert on public.notifications
  for each row execute function private.notification_push();
-- сгруппированное уведомление дополнили (окно 3 минуты): тот же tag заменит уведомление на устройстве
create trigger notifications_push_update after update of updated_at on public.notifications
  for each row when (new.updated_at is distinct from old.updated_at) execute function private.notification_push();

-- ---------------------------------------------------------------------------
-- 4. Письмо: ссылка из уведомления и идентификатор сущности
-- ---------------------------------------------------------------------------
create or replace function public.claim_emails(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o       public.email_outbox;
  n       public.notifications;
  v_out   jsonb := '[]';
  v_item  jsonb;
  v_items jsonb;
  v_name  text;
  v_task  jsonb;
begin
  -- письма, которые «зависли» в отправке, возвращаем в очередь
  update public.email_outbox set status = 'pending'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  for o in
    select * from public.email_outbox
     where status = 'pending' and send_after <= now()
     order by send_after
     limit p_limit
     for update skip locked
  loop
    select u.full_name into v_name from public.users u where u.id = o.user_id;

    if o.kind = 'instant' then
      select * into n from public.notifications where id = o.notification_id;
      -- уже прочитано в приложении или убрано — письмо не нужно
      if not found or n.read_at is not null or n.archived_at is not null then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_task := null;
      if n.entity_type = 'task' then
        select jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'due_date', t.due_date)
          into v_task from public.tasks t where t.id = n.entity_id;
      end if;
      v_item := jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'to', o.to_email, 'name', v_name,
        'notification', jsonb_build_object(
          'title', n.title, 'body', n.body, 'priority', n.priority, 'category', n.category, 'event_type', n.event_type,
          'entity_type', n.entity_type, 'entity_id', n.entity_id, 'entity_key', n.payload ->> 'entity_key',
          'project_code', n.payload ->> 'project_code', 'actor_name', n.payload ->> 'actor_name',
          'link', n.payload ->> 'link'),
        'task', v_task);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', x.title, 'body', x.body, 'category', x.category, 'priority', x.priority,
               'entity_key', x.payload ->> 'entity_key', 'project_code', x.payload ->> 'project_code',
               'entity_type', x.entity_type, 'entity_id', x.entity_id, 'link', x.payload ->> 'link') order by x.created_at), '[]')
        into v_items
        from public.notifications x
       where x.id in (select (jsonb_array_elements_text(o.payload -> 'ids'))::uuid)
         and x.read_at is null and x.archived_at is null;
      if jsonb_array_length(v_items) = 0 then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_item := jsonb_build_object('id', o.id, 'kind', o.kind, 'to', o.to_email, 'name', v_name, 'items', v_items);
    end if;

    update public.email_outbox set status = 'sending', attempts = attempts + 1, claimed_at = now() where id = o.id;
    v_out := v_out || jsonb_build_array(v_item || jsonb_build_object('attempts', o.attempts + 1));
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.claim_emails(integer) from public, anon, authenticated;
grant  execute on function public.claim_emails(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Уведомление «напрямую»: для событий, у которых нет «задачи» (адресованная заметка)
-- ---------------------------------------------------------------------------
create or replace function private.notify_direct(
  p_user          uuid,
  p_project       uuid,
  p_category      text,
  p_priority      text,
  p_event_type    text,
  p_entity_type   text,
  p_entity_id     uuid,
  p_title         text,
  p_body          text,
  p_link          text,
  p_internal_only boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor      uuid := auth.uid();
  v_tenant     uuid;
  v_code       text;
  v_pref       text;
  v_actor_name text;
begin
  if p_user is null or p_user = v_actor then return; end if;              -- себе не уведомляем
  select tenant_id, code into v_tenant, v_code from public.projects where id = p_project;
  if v_tenant is null then return; end if;
  if not exists (select 1 from public.users u where u.id = p_user and u.tenant_id = v_tenant and u.status <> 'blocked') then return; end if;
  if not private.user_can_see_project(p_user, p_project) then return; end if;
  if p_internal_only and not private.user_has_project_permission(p_user, p_project, 'comment.internal.view') then return; end if;

  select mode into v_pref from public.notification_preferences
   where user_id = p_user and category = p_category and channel = 'in_app';
  if v_pref = 'off' and p_priority <> 'critical' then return; end if;

  select full_name into v_actor_name from public.users where id = v_actor;
  insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, actor_id,
                                    priority, category, title, body, payload)
  values (v_tenant, p_user, p_project, p_event_type, p_entity_type, p_entity_id, v_actor,
          p_priority, p_category, p_title, p_body,
          jsonb_build_object('project_code', v_code, 'actor_name', v_actor_name, 'link', p_link, 'last_text', p_body));
end;
$$;
revoke execute on function private.notify_direct(uuid, uuid, text, text, text, text, uuid, text, text, text, boolean) from public, anon, authenticated;

-- Адресат заметки: человеку — лично; организации — каждому её сотруднику, работающему на проекте
create or replace function private.notify_field_note_addressee(p_comment uuid, p_user uuid, p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c      record;
  r      record;
  v_link text;
  v_body text;
begin
  if p_user is null and p_org is null then return; end if;
  select cm.project_id, cm.visibility, cm.body_text, cm.entity_id as location_id, p.code,
         l.path::text as path, l.name as loc_name, u.full_name as author
    into c
    from public.comments cm
    join public.projects p on p.id = cm.project_id
    join public.locations l on l.id = cm.entity_id
    left join public.users u on u.id = cm.author_id
   where cm.id = p_comment and cm.entity_type = 'location' and cm.deleted_at is null;
  if not found then return; end if;

  v_link := '/projects/' || c.code || '/locations/' || c.path;
  v_body := coalesce(c.loc_name || ' · ', '') || coalesce(c.author || ': ', '')
            || '«' || left(regexp_replace(coalesce(c.body_text, ''), '\s+', ' ', 'g'), 140) || '»';

  if p_user is not null then
    perform private.notify_direct(p_user, c.project_id, 'assigned', 'high', 'note.assigned', 'location', c.location_id,
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
      perform private.notify_direct(r.id, c.project_id, 'assigned', 'high', 'note.assigned', 'location', c.location_id,
                                    'Заметка вашей организации · ' || c.code, v_body, v_link, c.visibility = 'internal');
    end loop;
  end if;
end;
$$;
revoke execute on function private.notify_field_note_addressee(uuid, uuid, uuid) from public, anon, authenticated;

-- Регистрация заметки: новый адресат получает уведомление (повторный вызов с тем же адресатом — нет)
create or replace function public.register_field_note(p_comment uuid, p_user uuid default null, p_org uuid default null, p_task uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := auth.uid();
  c          record;
  v_old_user uuid;
  v_old_org  uuid;
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

  select f.addressee_user_id, f.addressee_org_id into v_old_user, v_old_org from public.field_notes f where f.comment_id = p_comment;

  insert into public.field_notes (comment_id, tenant_id, project_id, location_id, author_id, addressee_user_id, addressee_org_id, task_id)
  values (p_comment, c.tenant_id, c.project_id, c.entity_id, v_me, p_user, p_org, p_task)
  on conflict (comment_id) do update
    set addressee_user_id = excluded.addressee_user_id,
        addressee_org_id  = excluded.addressee_org_id,
        task_id           = coalesce(excluded.task_id, public.field_notes.task_id);

  perform private.notify_field_note_addressee(p_comment,
    case when p_user is distinct from v_old_user then p_user end,
    case when p_org  is distinct from v_old_org  then p_org  end);
end;
$$;

-- Передача заметки другому адресату: новому — уведомление
create or replace function public.set_field_note_addressee(p_comment uuid, p_user uuid default null, p_org uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := auth.uid();
  n          record;
  v_old_user uuid;
  v_old_org  uuid;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select f.project_id, f.author_id, f.addressee_user_id, f.addressee_org_id, cm.visibility into n
    from public.field_notes f join public.comments cm on cm.id = f.comment_id
   where f.comment_id = p_comment and f.tenant_id = private.tenant_id() and cm.deleted_at is null;
  if not found or not private.can_see_project(n.project_id) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  if not (v_me = n.author_id or private.has_project_permission(n.project_id, 'comment.delete.any')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform private.field_note_check_addressee(n.project_id, n.visibility, p_user, p_org);
  v_old_user := n.addressee_user_id;
  v_old_org  := n.addressee_org_id;
  update public.field_notes set addressee_user_id = p_user, addressee_org_id = p_org where comment_id = p_comment;

  perform private.notify_field_note_addressee(p_comment,
    case when p_user is distinct from v_old_user then p_user end,
    case when p_org  is distinct from v_old_org  then p_org  end);
end;
$$;

revoke execute on function public.register_field_note(uuid, uuid, uuid, uuid), public.set_field_note_addressee(uuid, uuid, uuid) from public, anon;
grant  execute on function public.register_field_note(uuid, uuid, uuid, uuid), public.set_field_note_addressee(uuid, uuid, uuid) to authenticated;

-- Общий push «Новая заметка» не дублирует адресату личное уведомление: адресат (или сотрудник организации-адресата) получает только его
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
     and not coalesce(qs.quiet_enabled and (
           case when qs.quiet_start <= qs.quiet_end
                then (now() at time zone qs.timezone)::time >= qs.quiet_start and (now() at time zone qs.timezone)::time < qs.quiet_end
                else (now() at time zone qs.timezone)::time >= qs.quiet_start or (now() at time zone qs.timezone)::time < qs.quiet_end
           end), false);
$$;
revoke execute on function public.field_note_push_targets(uuid) from public, anon, authenticated;
grant  execute on function public.field_note_push_targets(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Наблюдатели задачи: любое изменение карточки
-- ---------------------------------------------------------------------------
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor   text := (select full_name from public.users where id = auth.uid());
  v_who     text;
  w         record;
  l         uuid;
  v_from    text;
  v_to      text;
  v_text    text;
  v_changes text[];
  v_prio    constant jsonb := '{"low":"низкий","normal":"обычный","high":"высокий","critical":"критичный"}';
begin
  v_who := coalesce(' (' || v_actor || ')', '');

  if tg_op = 'INSERT' then
    perform private.add_watcher('task', new.id, new.reporter_id, 'creator');
    if new.assignee_id is not null then
      perform private.add_watcher('task', new.id, new.assignee_id, 'assignee');
      perform private.notify(new.assignee_id, 'task', new.id, 'assigned', 'high', 'assigned', 'Вас назначили исполнителем' || v_who);
    end if;
    if new.discipline_id is not null then
      for l in select private.discipline_leads(new.discipline_id) loop
        perform private.add_watcher('task', new.id, l, 'discipline_lead');
      end loop;
    end if;
    return new;
  end if;

  if new.discipline_id is distinct from old.discipline_id and new.discipline_id is not null then
    for l in select private.discipline_leads(new.discipline_id) loop
      perform private.add_watcher('task', new.id, l, 'discipline_lead');
    end loop;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null then
      perform private.add_watcher('task', new.id, new.assignee_id, 'assignee');
      perform private.notify(new.assignee_id, 'task', new.id, 'assigned', 'high', 'assigned', 'Вас назначили исполнителем' || v_who);
    end if;
    -- остальные наблюдатели (в том числе прежний исполнитель): кто теперь отвечает за задачу
    select full_name into v_from from public.users where id = old.assignee_id;
    select full_name into v_to   from public.users where id = new.assignee_id;
    v_text := 'Исполнитель: ' || coalesce(v_from, '—') || ' → ' || coalesce(v_to, '—') || v_who;
    for w in select user_id from public.watchers
              where entity_type = 'task' and entity_id = new.id and not muted and user_id is distinct from new.assignee_id loop
      perform private.notify(w.user_id, 'task', new.id, 'watching', 'normal', 'changed', v_text);
    end loop;
  end if;

  if new.status_id is distinct from old.status_id then
    select name into v_from from public.workflow_statuses where id = old.status_id;
    select name into v_to   from public.workflow_statuses where id = new.status_id;
    v_text := 'Статус: ' || v_from || ' → ' || v_to || v_who;
    if new.status_category = 'review' then
      perform private.notify(new.reporter_id, 'task', new.id, 'assigned', 'high', 'status_changed', v_text);
    end if;
    for w in select user_id from public.watchers
              where entity_type = 'task' and entity_id = new.id and not muted loop
      if new.status_category = 'blocked' then
        perform private.notify(w.user_id, 'task', new.id, 'watching', 'high', 'status_changed',
                               v_text || coalesce(' — ' || (select name from public.reason_codes
                                                            where tenant_id = new.tenant_id and code = new.blocked_reason_code), ''));
      elsif new.status_category <> 'review' or w.user_id <> new.reporter_id then
        perform private.notify(w.user_id, 'task', new.id, 'watching', 'normal', 'status_changed', v_text);
      end if;
    end loop;
  end if;

  if new.due_date is distinct from old.due_date then
    v_text := 'Срок: ' || coalesce(old.due_date::text, '—') || ' → ' || coalesce(new.due_date::text, '—') || v_who;
    perform private.notify(new.assignee_id, 'task', new.id, 'watching', 'normal', 'due_changed', v_text);
    for w in select user_id from public.watchers
              where entity_type = 'task' and entity_id = new.id and not muted and user_id is distinct from new.assignee_id loop
      perform private.notify(w.user_id, 'task', new.id, 'watching', 'normal', 'due_changed', v_text);
    end loop;
  end if;

  -- прочие поля карточки: одним уведомлением перечисляем всё, что изменили за раз
  v_changes := '{}';
  if new.title is distinct from old.title then
    v_changes := v_changes || ('название: «' || left(old.title, 60) || '» → «' || left(new.title, 60) || '»');
  end if;
  if new.description is distinct from old.description then
    v_changes := v_changes || 'описание изменено'::text;
  end if;
  if new.priority is distinct from old.priority then
    v_changes := v_changes || ('приоритет: ' || (v_prio ->> old.priority) || ' → ' || (v_prio ->> new.priority));
  end if;
  if new.planned_start is distinct from old.planned_start then
    v_changes := v_changes || ('плановый старт: ' || coalesce(old.planned_start::text, '—') || ' → ' || coalesce(new.planned_start::text, '—'));
  end if;
  if new.need_by_date is distinct from old.need_by_date then
    v_changes := v_changes || ('нужно к: ' || coalesce(old.need_by_date::text, '—') || ' → ' || coalesce(new.need_by_date::text, '—'));
  end if;
  if new.organization_id is distinct from old.organization_id then
    v_changes := v_changes || 'ответственная организация изменена'::text;
  end if;
  if array_length(v_changes, 1) > 0 then
    v_text := upper(left(array_to_string(v_changes, '; '), 1)) || substr(array_to_string(v_changes, '; '), 2) || v_who;
    for w in select user_id from public.watchers
              where entity_type = 'task' and entity_id = new.id and not muted loop
      perform private.notify(w.user_id, 'task', new.id, 'watching', 'normal', 'changed', v_text);
    end loop;
  end if;

  return new;
end;
$$;

-- Файл, добавленный в задачу (не в комментарий — о комментарии наблюдатели уже узнают сами)
create or replace function private.attachments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w      record;
  v_name text;
  v_text text;
begin
  if new.entity_type <> 'task' or new.comment_id is not null then return new; end if;
  select f.name into v_name from public.files f where f.id = new.file_id;
  v_text := 'Добавлен файл «' || coalesce(v_name, '') || '»'
            || coalesce(' (' || (select full_name from public.users where id = auth.uid()) || ')', '');
  for w in select user_id from public.watchers
            where entity_type = 'task' and entity_id = new.entity_id and not muted loop
    perform private.notify(w.user_id, 'task', new.entity_id, 'watching', 'normal', 'changed', v_text);
  end loop;
  return new;
end;
$$;
revoke execute on function private.attachments_notify() from public, anon, authenticated;
create trigger attachments_notify after insert on public.attachments
  for each row execute function private.attachments_notify();

notify pgrst, 'reload schema';
