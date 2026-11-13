-- Push-уведомления о сообщениях чата: приходят на телефон и компьютер, даже когда приложение (PWA) закрыто.
-- Устройство подписывается через Web Push и сохраняет подписку здесь; на каждое новое сообщение БД будит Edge Function send-push
-- (pg_net, как у почты), а та отправляет push тем, кто видит канал, кроме автора. Тихие часы из настроек уведомлений соблюдаются.
-- Адрес воркера и публичный ключ VAPID лежат в private.app_config (seed.sql — локально, deploy/post-install.sh — на сервере).
-- Секретный ключ VAPID — только в секретах Edge-функций, в БД его нет.

create table public.push_subscriptions (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  user_id    uuid not null references public.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);
create index on public.push_subscriptions (tenant_id);

-- Таблица закрыта целиком: пишут функции ниже, читает воркер (service_role обходит RLS)
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Публичный ключ VAPID: нужен браузеру для подписки. Не секрет, но и в сборку сайта его не зашиваем — берём из БД.
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select c.value from private.app_config c where c.key = 'vapid_public_key' and auth.uid() is not null;
$$;

-- Сохранить подписку этого устройства. Если устройство уже было подписано под другим человеком (общий телефон), подписка переходит к текущему.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000
     or coalesce(char_length(p_p256dh), 0) not between 1 and 200 or coalesce(char_length(p_auth), 0) not between 1 and 100 then
    raise exception 'invalid_subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
  values (v_tenant, v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set tenant_id = excluded.tenant_id, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, updated_at = now();
end;
$$;

-- Отписать устройство (при выходе из приложения), только свою подписку
create or replace function public.push_unsubscribe(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke execute on function public.push_public_key(), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) from public, anon;
grant  execute on function public.push_public_key(), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Кто видит канал (то же правило, что private.chat_visible, но для заданного человека, а не для вызывающего)
-- ---------------------------------------------------------------------------
create or replace function private.chat_user_visible(p_user uuid, p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.chat_channels c
      join public.users u on u.id = p_user and u.tenant_id = c.tenant_id
     where c.id = p_channel and c.archived_at is null
       and case c.kind
         when 'direct' then p_user in (c.user_a, c.user_b)
         when 'group'  then exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = p_user)
         else private.user_can_see_project(p_user, c.project_id) and case c.kind
           when 'project' then private.user_has_project_permission(p_user, c.project_id, 'comment.internal.view')
           when 'org'     then private.user_has_project_permission(p_user, c.project_id, 'comment.internal.view') or u.organization_id = c.organization_id
           when 'discipline' then private.user_has_project_permission(p_user, c.project_id, 'comment.internal.view') and (
                exists (select 1 from public.project_members pm
                         where pm.project_id = c.project_id and pm.user_id = p_user and pm.discipline_id = c.discipline_id
                           and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date))
                or exists (select 1 from public.disciplines d where d.id = c.discipline_id and d.lead_user_id = p_user and d.deleted_at is null))
           else false
         end
       end);
$$;

-- Подписки, на которые нужно отправить push о сообщении: не автор, видит канал, не в тихих часах, не заблокирован.
-- Вызывает только воркер send-push.
create or replace function public.chat_push_targets(p_message uuid)
returns table (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text, locale text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.locale
    from public.chat_messages m
    join public.push_subscriptions s on s.tenant_id = m.tenant_id and s.user_id <> m.author_id
    join public.users u on u.id = s.user_id and u.status <> 'blocked'
    left join public.user_notification_settings qs on qs.user_id = u.id
   where m.id = p_message and m.deleted_at is null
     and private.chat_user_visible(u.id, m.channel_id)
     and not coalesce(qs.quiet_enabled and (
           case when qs.quiet_start <= qs.quiet_end
                then (now() at time zone qs.timezone)::time >= qs.quiet_start and (now() at time zone qs.timezone)::time < qs.quiet_end
                else (now() at time zone qs.timezone)::time >= qs.quiet_start or (now() at time zone qs.timezone)::time < qs.quiet_end
           end), false);
$$;

revoke execute on function public.chat_push_targets(uuid) from public, anon, authenticated;
grant  execute on function public.chat_push_targets(uuid) to service_role;
revoke execute on function private.chat_user_visible(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Новое сообщение → будим воркер. Ошибка отправки никогда не мешает отправить сообщение.
-- ---------------------------------------------------------------------------
create or replace function private.chat_message_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  if new.deleted_at is not null then return new; end if;
  -- пока никто в организации не подписался на push, ничего не вызываем
  if not exists (select 1 from public.push_subscriptions s where s.tenant_id = new.tenant_id) then return new; end if;
  select value into v_url    from private.app_config where key = 'push_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key    from private.app_config where key = 'functions_apikey';
  if v_url is null then return new; end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
      body := jsonb_build_object('message_id', new.id),
      timeout_milliseconds := 20000);
  exception when others then
    null;
  end;
  return new;
end;
$$;

create trigger chat_messages_push after insert on public.chat_messages
  for each row execute function private.chat_message_push();

notify pgrst, 'reload schema';
