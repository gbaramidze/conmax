-- Письма-уведомления с файлами: к письму прикладываются файлы комментария, из-за которого оно пришло.
-- Раньше в письмо попадал только текст («Упоминание от …: «…»»), фото и файлы из комментария или заметки оставались в приложении.
-- Теперь уведомление помнит комментарий-источник (payload.comment_id; для заметки — сама заметка), а очередь писем отдаёт воркеру список его файлов.
-- Воркер прикладывает их (фото — в тексте письма), в пределах 10 МБ; остальное остаётся по ссылке в приложение.

drop function if exists private.notify(uuid, text, uuid, text, text, text, text, boolean);
create or replace function private.notify(
  p_user          uuid,
  p_entity_type   text,
  p_entity_id     uuid,
  p_category      text,
  p_priority      text,
  p_event         text,        -- ключ счётчика: assigned | mentioned | status_changed | due_changed | commented
  p_text          text,        -- текст события для одиночного уведомления
  p_internal_only boolean default false,  -- событие внутреннее: внешним получателям не показываем
  p_comment       uuid default null       -- комментарий-источник: его файлы воркер почты прикладывает к письму
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor    uuid := auth.uid();
  v_project  uuid;
  v_tenant   uuid;
  v_display  jsonb;
  v_pref     text;
  v_group    text := p_entity_type || ':' || p_entity_id;
  v_existing public.notifications;
  v_counts   jsonb;
  v_actor_name text;
begin
  if p_user is null or p_user = v_actor then return; end if;              -- себе не уведомляем

  v_project := private.entity_project_id_any(p_entity_type, p_entity_id);
  if v_project is null then return; end if;
  select tenant_id into v_tenant from public.projects where id = v_project;

  if not exists (select 1 from public.users u where u.id = p_user and u.tenant_id = v_tenant and u.status <> 'blocked') then
    return;
  end if;
  -- фильтр прав: видит ли получатель объект (и внутренние данные, если событие внутреннее)
  if not private.user_can_view_entity(p_user, p_entity_type, p_entity_id) then return; end if;
  if p_internal_only and not private.user_has_project_permission(p_user, v_project, 'comment.internal.view') then return; end if;

  -- настройки получателя: «выкл» уважаем, кроме критичных
  select mode into v_pref from public.notification_preferences
   where user_id = p_user and category = p_category and channel = 'in_app';
  if v_pref = 'off' and p_priority <> 'critical' then return; end if;

  v_display := private.entity_display(p_entity_type, p_entity_id);
  select full_name into v_actor_name from public.users where id = v_actor;

  -- группировка: непрочитанное по тому же объекту за последние 3 минуты дополняем, а не дублируем
  select * into v_existing from public.notifications n
   where n.user_id = p_user and n.group_key = v_group and n.read_at is null and n.archived_at is null
     and n.updated_at > now() - interval '3 minutes'
   order by n.updated_at desc limit 1
   for update;

  if found then
    v_counts := jsonb_set(coalesce(v_existing.payload -> 'counts', '{}'),
                          array[p_event], to_jsonb(coalesce((v_existing.payload -> 'counts' ->> p_event)::integer, 0) + 1));
    update public.notifications set
      priority = private.max_priority(v_existing.priority, p_priority),
      category = case when array_position(array['watching','assigned','mentioned'], p_category)
                         > array_position(array['watching','assigned','mentioned'], v_existing.category)
                      then p_category else v_existing.category end,
      body     = private.notification_body(v_counts, p_text),
      payload  = v_existing.payload || jsonb_build_object('counts', v_counts, 'last_text', p_text)
                 || case when p_comment is not null then jsonb_build_object('comment_id', p_comment) else '{}'::jsonb end,
      updated_at = now()
    where id = v_existing.id;
  else
    insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, actor_id,
                                      priority, category, title, body, group_key, payload)
    values (v_tenant, p_user, v_project, p_entity_type || '.' || p_event, p_entity_type, p_entity_id, v_actor,
            p_priority, p_category,
            (v_display ->> 'key') || ' «' || (v_display ->> 'title') || '»',
            p_text, v_group,
            jsonb_build_object('entity_key', v_display ->> 'key', 'entity_title', v_display ->> 'title',
                               'project_code', v_display ->> 'project_code', 'actor_name', v_actor_name,
                               'counts', jsonb_build_object(p_event, 1), 'last_text', p_text)
                 || case when p_comment is not null then jsonb_build_object('comment_id', p_comment) else '{}'::jsonb end);
  end if;
end;
$$;

create or replace function private.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_author  text := (select full_name from public.users where id = new.author_id);
  v_snippet text := left(regexp_replace(new.body_text, '\s+', ' ', 'g'), 140);
  m         record;
  w         record;
  v_internal boolean := new.visibility = 'internal';
begin
  perform private.add_watcher(new.entity_type, new.entity_id, new.author_id, 'participant');

  for m in select (e ->> 'id')::uuid as user_id from jsonb_array_elements(new.mentions) e loop
    perform private.add_watcher(new.entity_type, new.entity_id, m.user_id, 'mention');
    perform private.notify(m.user_id, new.entity_type, new.entity_id, 'mentioned', 'high', 'mentioned',
                           'Упоминание от ' || v_author || ': «' || v_snippet || '»', v_internal, new.id);
  end loop;

  -- заметка с площадки: наблюдателям места отдельного «комментария» не шлём
  if new.is_note then
    return new;
  end if;

  for w in select user_id from public.watchers
            where entity_type = new.entity_type and entity_id = new.entity_id and not muted
              and user_id <> new.author_id
              and not (new.mentions @> jsonb_build_array(jsonb_build_object('type', 'user', 'id', user_id))) loop
    perform private.notify(w.user_id, new.entity_type, new.entity_id, 'watching', 'low', 'commented',
                           v_author || ': «' || v_snippet || '»', v_internal, new.id);
  end loop;
  return new;
end;
$$;


create or replace function private.comments_notify_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_author   text := (select full_name from public.users where id = new.author_id);
  v_snippet  text := left(regexp_replace(new.body_text, '\s+', ' ', 'g'), 140);
  v_internal boolean := new.visibility = 'internal';
  m          record;
begin
  if new.deleted_at is not null then return new; end if;
  for m in
    select (e ->> 'id')::uuid as user_id
      from jsonb_array_elements(new.mentions) e
     where not (old.mentions @> jsonb_build_array(e))
  loop
    perform private.add_watcher(new.entity_type, new.entity_id, m.user_id, 'mention');
    perform private.notify(m.user_id, new.entity_type, new.entity_id, 'mentioned', 'high', 'mentioned',
                           'Упоминание от ' || v_author || ': «' || v_snippet || '»', v_internal, new.id);
  end loop;
  return new;
end;
$$;

create or replace function public.claim_emails(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o        public.email_outbox;
  n        public.notifications;
  v_out    jsonb := '[]';
  v_item   jsonb;
  v_items  jsonb;
  v_name   text;
  v_locale text;
  v_email  text;
  v_task   jsonb;
  v_comment uuid;
  v_files  jsonb;
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
    select u.full_name, u.locale, u.email into v_name, v_locale, v_email from public.users u where u.id = o.user_id and u.status <> 'blocked';
    if not found or coalesce(v_email, o.to_email) is null then
      update public.email_outbox set status = 'skipped' where id = o.id;
      continue;
    end if;

    if o.kind = 'instant' then
      select * into n from public.notifications where id = o.notification_id;
      -- уведомления нет; наблюдателю письмо уже не нужно, если он прочитал или убрал; назначение, упоминание, эскалацию отправляем всегда
      if not found or (n.category = 'watching' and (n.read_at is not null or n.archived_at is not null)) then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_task := null;
      if n.entity_type = 'task' then
        select jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'due_date', t.due_date)
          into v_task from public.tasks t where t.id = n.entity_id;
      end if;
      -- файлы комментария, из-за которого пришло уведомление (упоминание, комментарий, заметка), — воркер приложит их к письму
      v_comment := coalesce((n.payload ->> 'comment_id')::uuid, case when n.entity_type = 'field_note' then n.entity_id end);
      v_files := '[]';
      if v_comment is not null then
        select coalesce(jsonb_agg(jsonb_build_object('name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'storage_key', f.storage_key) order by a.created_at, a.id), '[]')
          into v_files
          from public.attachments a join public.files f on f.id = a.file_id
         where a.comment_id = v_comment and f.status = 'ready';
      end if;
      v_item := jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale, 'attachments', v_files,
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
      v_item := jsonb_build_object('id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale, 'items', v_items);
    end if;

    update public.email_outbox set status = 'sending', attempts = attempts + 1, claimed_at = now() where id = o.id;
    v_out := v_out || jsonb_build_array(v_item || jsonb_build_object('attempts', o.attempts + 1));
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.claim_emails(integer) from public, anon, authenticated;
grant  execute on function public.claim_emails(integer) to service_role;

notify pgrst, 'reload schema';
