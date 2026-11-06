-- S3 (остаток) · Просрочки с эскалацией, исходящая почта (мгновенная и дайджест), тихие часы.
-- См. docs: 04-modules/06-notifications.md §2 (шаги 3–5), §5.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Адрес и секрет воркера почты (Edge Function send-emails). Значения задаёт окружение (seed.sql для локальной разработки).
create table private.app_config (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- Настройки пользователя: часовой пояс, тихие часы, час дайджеста
-- ---------------------------------------------------------------------------
create table public.user_notification_settings (
  user_id             uuid primary key references public.users(id) on delete cascade default auth.uid(),
  tenant_id           uuid not null references public.tenants(id),
  timezone            text not null default 'Europe/Moscow',
  quiet_enabled       boolean not null default false,
  quiet_start         time not null default '21:00',
  quiet_end           time not null default '07:00',
  digest_hour         smallint not null default 7 check (digest_hour between 0 and 23),
  digest_sent_through timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function private.user_notification_settings_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id   := coalesce(auth.uid(), new.user_id);
  if auth.uid() is not null then new.tenant_id := private.tenant_id(); end if;
  new.updated_at := now();
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger user_notification_settings_before_write before insert or update on public.user_notification_settings
  for each row execute function private.user_notification_settings_before_write();

alter table public.user_notification_settings enable row level security;
alter table public.user_notification_settings force row level security;
create policy user_notification_settings_own on public.user_notification_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke insert, update on public.user_notification_settings from authenticated;
grant insert (timezone, quiet_enabled, quiet_start, quiet_end, digest_hour) on public.user_notification_settings to authenticated;
grant update (timezone, quiet_enabled, quiet_start, quiet_end, digest_hour) on public.user_notification_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Режим канала: настройка пользователя или значение по умолчанию из матрицы документации
-- ---------------------------------------------------------------------------
create or replace function private.channel_mode(p_user uuid, p_category text, p_channel text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select np.mode from public.notification_preferences np
      where np.user_id = p_user and np.category = p_category and np.channel = p_channel),
    case p_channel
      when 'in_app' then 'instant'
      when 'email'  then case p_category when 'watching' then 'digest' else 'instant' end
      else 'off'
    end);
$$;

-- Когда отправлять: обычные письма в тихие часы откладываются до их конца, критичные — никогда
create or replace function private.next_send_time(p_user uuid, p_priority text, p_from timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  s        public.user_notification_settings;
  v_local  timestamp;
  v_t      time;
  v_quiet  boolean;
  v_end    timestamp;
begin
  if p_priority = 'critical' then return p_from; end if;
  select * into s from public.user_notification_settings where user_id = p_user;
  if not found or not s.quiet_enabled then return p_from; end if;

  v_local := p_from at time zone s.timezone;
  v_t := v_local::time;
  v_quiet := case when s.quiet_start > s.quiet_end then v_t >= s.quiet_start or v_t < s.quiet_end
                  else v_t >= s.quiet_start and v_t < s.quiet_end end;
  if not v_quiet then return p_from; end if;

  v_end := date_trunc('day', v_local) + s.quiet_end;
  if v_end <= v_local then v_end := v_end + interval '1 day'; end if;
  return v_end at time zone s.timezone;
end;
$$;

-- ---------------------------------------------------------------------------
-- Очередь писем
-- ---------------------------------------------------------------------------
create table public.email_outbox (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  user_id         uuid not null references public.users(id) on delete cascade,
  to_email        text not null,
  kind            text not null check (kind in ('instant','digest')),
  notification_id uuid references public.notifications(id) on delete set null,
  payload         jsonb not null default '{}',
  status          text not null default 'pending' check (status in ('pending','sending','sent','skipped','failed')),
  attempts        integer not null default 0,
  send_after      timestamptz not null default now(),
  claimed_at      timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index on public.email_outbox (status, send_after);
create unique index email_outbox_one_per_notification on public.email_outbox (notification_id) where kind = 'instant';
alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;
revoke all on public.email_outbox from authenticated, anon;

-- Каждое новое уведомление ставит письмо в очередь, если у получателя email в режиме «сразу».
-- Окно группировки (3 мин) выдерживается: письмо строится в момент отправки по актуальному тексту уведомления.
create or replace function private.notifications_enqueue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_mode  text;
begin
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
create trigger notifications_enqueue_email after insert on public.notifications
  for each row execute function private.notifications_enqueue_email();

-- ---------------------------------------------------------------------------
-- Воркер почты: забрать пачку, отметить итог
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
          'entity_type', n.entity_type, 'entity_key', n.payload ->> 'entity_key',
          'project_code', n.payload ->> 'project_code', 'actor_name', n.payload ->> 'actor_name'),
        'task', v_task);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', x.title, 'body', x.body, 'category', x.category, 'priority', x.priority,
               'entity_key', x.payload ->> 'entity_key', 'project_code', x.payload ->> 'project_code',
               'entity_type', x.entity_type) order by x.created_at), '[]')
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

create or replace function public.finish_email(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.email_outbox where id = p_id;
  if p_ok then
    update public.email_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif v_attempts >= 5 then
    update public.email_outbox set status = 'failed', last_error = left(p_error, 500) where id = p_id;
  else
    update public.email_outbox
       set status = 'pending', last_error = left(p_error, 500), send_after = now() + (v_attempts * interval '2 minutes')
     where id = p_id;
  end if;
end;
$$;

revoke execute on function public.claim_emails(integer), public.finish_email(uuid, boolean, text) from public, anon, authenticated;
grant  execute on function public.claim_emails(integer), public.finish_email(uuid, boolean, text) to service_role;

-- Будит воркер (Edge Function) через pg_net, если в очереди есть что отправлять
create or replace function private.kick_email_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  if not exists (select 1 from public.email_outbox where status = 'pending' and send_after <= now()) then return; end if;
  select value into v_url    from private.app_config where key = 'email_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key    from private.app_config where key = 'functions_apikey';
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Дайджест: раз в сутки в заданный пользователем час, всё накопленное в режиме «дайджест»
-- ---------------------------------------------------------------------------
create or replace function private.queue_digests() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r       record;
  v_ids   jsonb;
  v_count integer := 0;
begin
  for r in
    select u.id as user_id, u.tenant_id, u.email,
           coalesce(s.timezone, 'Europe/Moscow') as tz,
           coalesce(s.digest_hour, 7) as hr,
           greatest(coalesce(s.digest_sent_through, u.created_at), now() - interval '48 hours') as since,
           coalesce(s.digest_sent_through, u.created_at) as last_sent
      from public.users u
      left join public.user_notification_settings s on s.user_id = u.id
     where u.status <> 'blocked' and u.email is not null
  loop
    continue when extract(hour from now() at time zone r.tz) < r.hr or r.last_sent > now() - interval '20 hours';

    select jsonb_agg(n.id order by n.created_at) into v_ids
      from public.notifications n
     where n.user_id = r.user_id and n.created_at > r.since and n.read_at is null and n.archived_at is null
       and private.channel_mode(n.user_id, n.category, 'email') = 'digest';

    insert into public.user_notification_settings (user_id, tenant_id, digest_sent_through)
    values (r.user_id, r.tenant_id, now())
    on conflict (user_id) do update set digest_sent_through = now();

    if v_ids is not null then
      insert into public.email_outbox (tenant_id, user_id, to_email, kind, payload, send_after)
      values (r.tenant_id, r.user_id, r.email, 'digest', jsonb_build_object('ids', v_ids), now());
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Просрочки: уведомление исполнителю и эскалация по шагам (раз на шаг)
--   высокий/критичный приоритет: +0 ч исполнитель, +24 ч руководитель направления (иначе РП), +72 ч РП
--   обычный и ниже:              +0 ч исполнитель, +72 ч автор
-- ---------------------------------------------------------------------------
create table public.task_escalations (
  task_id  uuid not null references public.tasks(id) on delete cascade,
  step     smallint not null,
  fired_at timestamptz not null default now(),
  primary key (task_id, step)
);
alter table public.task_escalations enable row level security;
alter table public.task_escalations force row level security;
revoke all on public.task_escalations from authenticated, anon;

-- Сдвинули срок — эскалация начинается заново
create or replace function private.tasks_reset_escalation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.task_escalations where task_id = new.id;
  return new;
end;
$$;
create trigger tasks_reset_escalation after update of due_date on public.tasks
  for each row when (new.due_date is distinct from old.due_date) execute function private.tasks_reset_escalation();

create or replace function private.detect_overdue() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t         record;
  v_target  uuid;
  v_lead    uuid;
  v_fired   integer := 0;
  v_step    smallint;
  v_rows    integer;
  v_text    text;
  v_cat     text;
  v_high    boolean;
begin
  for t in
    select tk.id, tk.tenant_id, tk.project_id, tk.assignee_id, tk.reporter_id, tk.discipline_id, tk.priority, tk.due_date,
           p.manager_user_id,
           extract(epoch from (now() - ((tk.due_date + 1)::timestamp at time zone coalesce(p.timezone, 'UTC')))) / 3600 as hours
      from public.tasks tk
      join public.projects p on p.id = tk.project_id
     where tk.deleted_at is null and tk.due_date is not null and tk.due_date < current_date
       and tk.status_category not in ('done', 'cancelled')
  loop
    continue when t.hours < 0;
    v_high := t.priority in ('high', 'critical');

    -- руководитель направления (или его предка), иначе РП проекта
    select d.lead_user_id into v_lead
      from (with recursive r(id, parent_id, lead_user_id, depth) as (
              select d0.id, d0.parent_id, d0.lead_user_id, 0 from public.disciplines d0 where d0.id = t.discipline_id
              union all
              select d1.id, d1.parent_id, d1.lead_user_id, r.depth + 1 from public.disciplines d1 join r on d1.id = r.parent_id)
            select * from r where lead_user_id is not null order by depth limit 1) d;

    for v_step in 0..3 loop
      continue when case v_step
                      when 0 then false
                      when 1 then not v_high or t.hours < 24
                      when 2 then not v_high or t.hours < 72
                      else v_high or t.hours < 72
                    end;

      insert into public.task_escalations (task_id, step) values (t.id, v_step) on conflict do nothing;
      get diagnostics v_rows = row_count;
      continue when v_rows = 0;

      v_target := case v_step
                    when 0 then coalesce(t.assignee_id, t.reporter_id)
                    when 1 then coalesce(v_lead, t.manager_user_id)
                    when 2 then coalesce(t.manager_user_id, v_lead)
                    else t.reporter_id
                  end;
      v_cat := case when v_step = 0 then 'assigned' else 'escalation' end;
      v_text := case v_step
                  when 0 then 'Задача просрочена: срок был ' || to_char(t.due_date, 'DD.MM.YYYY')
                  when 1 then 'Просрочка больше суток — задача не выполнена (срок ' || to_char(t.due_date, 'DD.MM.YYYY') || ')'
                  when 2 then 'Просрочка больше 3 суток, нужна ваша помощь (срок ' || to_char(t.due_date, 'DD.MM.YYYY') || ')'
                  else 'Задача просрочена больше 3 суток (срок ' || to_char(t.due_date, 'DD.MM.YYYY') || ')'
                end;
      perform private.notify(v_target, 'task', t.id, v_cat, 'high', 'overdue', v_text);
      perform private.record_event(t.tenant_id, t.project_id, 'task', t.id, 'overdue_escalated',
                                   jsonb_build_object('step', v_step, 'user_id', v_target), 'internal');
      v_fired := v_fired + 1;
    end loop;
  end loop;
  return v_fired;
end;
$$;

-- Текст схлопнутого уведомления: добавлена «просрочка» (иначе она терялась бы внутри свежего «вас назначили»)
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
  v_n := coalesce((p_counts ->> 'commented')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, v_n || ' ' || private.ru_plural(v_n, 'комментарий', 'комментария', 'комментариев')); end if;
  v_n := coalesce((p_counts ->> 'discrepancy')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'расхождений: ' || v_n); end if;

  return array_to_string(v_parts, ', ');
end;
$$;

-- ---------------------------------------------------------------------------
-- Расписание
-- ---------------------------------------------------------------------------
select cron.schedule('buildos-overdue',      '7 * * * *', $$select private.detect_overdue()$$);
select cron.schedule('buildos-digests',      '3 * * * *', $$select private.queue_digests()$$);
select cron.schedule('buildos-send-emails',  '* * * * *', $$select private.kick_email_worker()$$);

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
