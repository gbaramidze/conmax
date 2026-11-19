-- Уведомления о новых письмах Outlook: колокольчик и push (письмо о письме не шлём — оно и так пришло в почту).
--
-- Как работает: pg_cron раз в минуту будит функцию `mail` (режим опроса, секрет x-worker-secret). Она для каждого подключённого
-- ящика спрашивает Microsoft Graph о письмах во «Входящих», пришедших после курсора `notify_cursor`, и передаёт новые
-- непрочитанные сюда, в `public.mail_notify`. При первом опросе курсор просто ставится на «сейчас» — старые письма не уведомляем.
-- Отдельная категория `mail`: её можно выключить в настройках уведомлений (в приложении и push), не трогая задачи.

-- ---------------------------------------------------------------------------
-- 1. Категория «Почта»
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('assigned','mentioned','watching','escalation','digest','system','mail'));
alter table public.notification_preferences drop constraint notification_preferences_category_check;
alter table public.notification_preferences add constraint notification_preferences_category_check
  check (category in ('assigned','mentioned','watching','escalation','digest','system','mail'));

-- ---------------------------------------------------------------------------
-- 2. Курсор опроса ящика
-- ---------------------------------------------------------------------------
alter table public.mail_accounts
  add column notify_cursor     timestamptz,   -- время получения последнего учтённого письма
  add column notify_checked_at timestamptz;   -- когда ящик опрашивали в последний раз

-- ---------------------------------------------------------------------------
-- 3. Письмо о новом письме не нужно: категория `mail` — только колокольчик и push
-- ---------------------------------------------------------------------------
create or replace function private.notifications_enqueue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_mode  text;
begin
  if new.event_type like '%.reminder' then return new; end if;
  if new.category = 'mail' then return new; end if;
  select u.email into v_email from public.users u where u.id = new.user_id and u.status <> 'blocked';
  if v_email is null then return new; end if;

  v_mode := private.channel_mode(new.user_id, new.category, 'email');
  if new.priority = 'critical' and v_mode = 'off' then v_mode := 'instant'; end if;   -- критичное отключить нельзя

  if v_mode = 'instant' then
    insert into public.email_outbox (tenant_id, user_id, to_email, kind, notification_id, send_after)
    values (new.tenant_id, new.user_id, v_email, 'instant', new.id,
            private.next_send_time(new.user_id, new.priority, now() + interval '3 minutes'))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Новые письма → уведомления. Вызывает только функция `mail` (service_role).
--    p_items: [{id, from_name, from_address, subject, received_at}] — непрочитанные письма после курсора.
--    До 3 писем — по уведомлению на каждое (ведёт к письму), больше — одно сводное (ведёт во «Входящие»).
-- ---------------------------------------------------------------------------
create or replace function public.mail_notify(p_user uuid, p_cursor timestamptz, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_items  jsonb;
  v_n      integer;
  v_out    integer := 0;
  r        jsonb;
  v_from   text;
  v_names  text;
begin
  select a.tenant_id into v_tenant
    from public.mail_accounts a join public.users u on u.id = a.user_id and u.status <> 'blocked'
   where a.user_id = p_user;
  if v_tenant is null then return 0; end if;

  update public.mail_accounts
     set notify_cursor = greatest(coalesce(notify_cursor, p_cursor), p_cursor),
         notify_checked_at = now()
   where user_id = p_user;

  -- выключено в настройках «В приложении» — не уведомляем (как и остальные категории)
  if private.channel_mode(p_user, 'mail', 'in_app') = 'off' then return 0; end if;

  -- письма, о которых уже сообщили (повтор опроса), пропускаем
  select coalesce(jsonb_agg(x order by x->>'received_at'), '[]'::jsonb) into v_items
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where coalesce(x->>'id', '') <> ''
     and not exists (select 1 from public.notifications n
                      where n.user_id = p_user and n.category = 'mail' and n.created_at > now() - interval '7 days'
                        and (n.group_key = 'mail:' || (x->>'id') or coalesce(n.payload->'ids', '[]'::jsonb) ? (x->>'id')));
  v_n := jsonb_array_length(v_items);
  if v_n = 0 then return 0; end if;

  if v_n <= 3 then
    for r in select * from jsonb_array_elements(v_items) loop
      v_from := left(coalesce(nullif(btrim(r->>'from_name'), ''), nullif(btrim(r->>'from_address'), ''), 'Без отправителя'), 120);
      insert into public.notifications (tenant_id, user_id, event_type, priority, category, title, body, group_key, payload)
      values (v_tenant, p_user, 'mail.received', 'normal', 'mail', 'Новое письмо',
              left(v_from || ': ' || coalesce(nullif(btrim(r->>'subject'), ''), '(без темы)'), 300),
              'mail:' || (r->>'id'),
              jsonb_build_object('link', '/mail?m=' || (r->>'id'), 'actor_name', v_from,
                                 'from_address', left(r->>'from_address', 320), 'last_text',
                                 left(v_from || ': ' || coalesce(nullif(btrim(r->>'subject'), ''), '(без темы)'), 300)));
      v_out := v_out + 1;
    end loop;
  else
    select string_agg(distinct left(coalesce(nullif(btrim(x->>'from_name'), ''), x->>'from_address'), 60), ', ')
      into v_names from jsonb_array_elements(v_items) x;
    insert into public.notifications (tenant_id, user_id, event_type, priority, category, title, body, group_key, payload)
    values (v_tenant, p_user, 'mail.received', 'normal', 'mail', 'Новые письма',
            left(format('Новых писем: %s. От: %s', v_n, v_names), 300),
            'mail:batch:' || (v_items->(v_n - 1)->>'id'),
            -- ids: чтобы повторный опрос не сообщил о тех же письмах ещё раз
            jsonb_build_object('link', '/mail', 'last_text', left(format('Новых писем: %s. От: %s', v_n, v_names), 300),
                               'ids', (select jsonb_agg(x->'id') from jsonb_array_elements(v_items) x)));
    v_out := 1;
  end if;
  return v_out;
end;
$$;
revoke execute on function public.mail_notify(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant  execute on function public.mail_notify(uuid, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Расписание: раз в минуту будим опрос, если хоть кто-то подключил почту
-- ---------------------------------------------------------------------------
insert into private.app_config (key, value)
select 'mail_worker_url', replace(value, 'extract-texts', 'mail') from private.app_config where key = 'text_worker_url'
on conflict (key) do nothing;

create or replace function private.kick_mail_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_secret text; v_key text;
begin
  if not exists (select 1 from public.mail_accounts) then return; end if;
  select value into v_url from private.app_config where key = 'mail_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key from private.app_config where key = 'functions_apikey';
  if v_url is null then return; end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
    body := '{"action":"poll"}'::jsonb, timeout_milliseconds := 10000);
end;
$$;
revoke execute on function private.kick_mail_worker() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('buildos-mail-poll', '* * * * *', 'select private.kick_mail_worker()');
exception when others then
  raise notice 'pg_cron недоступен, опрос почты не запланирован: %', sqlerrm;
end $$;
