-- Комментарии: правка и удаление, упоминания при правке, язык получателя в письмах.
--  1. Правит текст только автор, удалённый комментарий не правится и не «оживает»; автор и модератор (comment.delete.any) удаляют.
--  2. Удаление комментария убирает и его файлы из списка файлов объекта (иначе фото остаётся видимым без комментария).
--  3. Человек, которого добавили в упоминания при правке, получает уведомление (+ push и письмо), как при новом комментарии;
--     уже упомянутых повторно не уведомляем.
--  4. Очередь писем отдаёт воркеру язык получателя (users.locale): письмо собирается на его языке.

-- ---------------------------------------------------------------------------
-- 1. Защита правки и удаления
-- ---------------------------------------------------------------------------
create or replace function private.comments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.tenant_id  := private.tenant_id();
    new.author_id  := auth.uid();
    new.project_id := private.entity_project_id(new.entity_type, new.entity_id);
    if new.project_id is null then
      raise exception 'entity not found' using errcode = '23503';
    end if;
  else
    -- Удалённый комментарий не возвращается и не правится
    if old.deleted_at is not null and (new.deleted_at is null or new.body is distinct from old.body) then
      raise exception 'comment is deleted' using errcode = '42501';
    end if;
    -- Текст правит только автор; модератор (comment.delete.any) может лишь скрыть комментарий
    if new.body is distinct from old.body then
      if old.author_id <> auth.uid() then
        raise exception 'only the author can edit a comment' using errcode = '42501';
      end if;
      new.edited_at := now();
    end if;
  end if;

  -- Производные поля считаем на сервере: клиенту не доверяем
  new.body_text := coalesce((
    select string_agg(t #>> '{}', ' ') from (
      select t from jsonb_path_query(new.body, 'strict $.**.text') t
      union all
      select to_jsonb('@' || (m #>> '{attrs,label}')) from jsonb_path_query(new.body, 'strict $.** ? (@.type == "mention")') m
    ) s
  ), '');

  new.mentions := coalesce((
    select jsonb_agg(jsonb_build_object('type', 'user', 'id', u.id))
    from (
      select distinct (m #>> '{attrs,id}') as uid
      from jsonb_path_query(new.body, 'strict $.** ? (@.type == "mention")') m
      where (m #>> '{attrs,id}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) x
    join public.users u on u.id = x.uid::uuid and u.tenant_id = new.tenant_id
  ), '[]');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Удалили комментарий — его файлы уходят из списка файлов объекта
-- ---------------------------------------------------------------------------
create or replace function private.comments_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.attachments where comment_id = new.id;
  return new;
end;
$$;
revoke execute on function private.comments_after_delete() from public, anon, authenticated;

create trigger comments_after_delete after update of deleted_at on public.comments
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.comments_after_delete();

-- ---------------------------------------------------------------------------
-- 3. Упоминания при правке: уведомляем только новых
-- ---------------------------------------------------------------------------
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
                           'Упоминание от ' || v_author || ': «' || v_snippet || '»', v_internal);
  end loop;
  return new;
end;
$$;
revoke execute on function private.comments_notify_edit() from public, anon, authenticated;

create trigger comments_notify_edit after update of body on public.comments
  for each row when (new.body is distinct from old.body)
  execute function private.comments_notify_edit();

-- ---------------------------------------------------------------------------
-- 4. Очередь писем: язык получателя
-- ---------------------------------------------------------------------------
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
  v_task   jsonb;
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
    select u.full_name, u.locale into v_name, v_locale from public.users u where u.id = o.user_id;

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
        'id', o.id, 'kind', o.kind, 'to', o.to_email, 'name', v_name, 'locale', v_locale,
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
      v_item := jsonb_build_object('id', o.id, 'kind', o.kind, 'to', o.to_email, 'name', v_name, 'locale', v_locale, 'items', v_items);
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
