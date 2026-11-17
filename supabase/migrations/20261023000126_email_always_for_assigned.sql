-- Письма о назначении, упоминании и эскалации уходят ВСЕГДА, даже если человек уже открыл уведомление в приложении.
-- Раньше воркер отменял письмо («skipped»), если к моменту отправки (через 3 минуты) уведомление уже прочитано: выдали замечание
-- исполнителю, он сразу увидел окно в приложении и открыл его — письмо на почту не приходило. Отменяем только то, что можно
-- потерять без вреда: письма наблюдателей («наблюдаю») по уже прочитанному и письма по уведомлениям, которых больше нет.
-- Адрес берётся из профиля получателя в момент отправки (а не копируется при постановке в очередь): сменил почту — письма идут на новую.

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
      v_item := jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale,
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
