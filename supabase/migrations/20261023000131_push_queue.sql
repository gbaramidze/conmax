-- Push сразу и без потерь.
-- Было: триггер звал воркер send-push через pg_net и забывал о нём. pg_net шлёт запросы пачками и не берёт новые, пока не ответили
-- все запросы пачки, а в той же очереди раз в минуту — воркеры почты и чтения документов (держали соединение до 20–55 секунд):
-- push ждал их. Если вызов падал (перезапуск функций при выкладке, сбой сети, ошибка сервиса push Google/Apple), push пропадал.
-- Стало: воркеры почты/документов/погоды отвечают сразу и работают в фоне (код функций), а каждое событие push — строка в очереди
-- private.push_jobs. Триггер ставит задание и сразу будит воркер; воркер забирает задания (claim_push_jobs) и отмечает итог
-- (finish_push_job). Неудачное задание (или устройства, на которые не ушло) повторяется с растущей паузой; сторож каждые
-- 10 секунд будит воркер, если в очереди что-то ждёт дольше положенного. По таблице видно, сколько шёл каждый push.

create table private.push_jobs (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('notification', 'message', 'note')),
  ref_id     uuid not null,                 -- notifications.id / chat_messages.id / comments.id (заметка)
  only_subs  uuid[],                        -- повтор: только устройства, на которые не ушло; null — все
  status     text not null default 'pending' check (status in ('pending', 'sending', 'done', 'failed')),
  attempts   integer not null default 0,
  next_at    timestamptz not null default now(),
  locked_at  timestamptz,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,                   -- когда push впервые ушёл хотя бы на одно устройство
  sent       integer not null default 0,
  last_error text
);
create index push_jobs_due_idx on private.push_jobs (next_at) where status in ('pending', 'sending');
create index push_jobs_ref_idx on private.push_jobs (kind, ref_id) where status = 'pending';
create index push_jobs_created_idx on private.push_jobs (created_at);
revoke all on private.push_jobs from public, anon, authenticated;

-- Разбудить воркер push. Ошибка вызова никогда не мешает самому действию: задание останется в очереди, его подберёт сторож.
create or replace function private.kick_push_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  select value into v_url    from private.app_config where key = 'push_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key    from private.app_config where key = 'functions_apikey';
  if v_url is null then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  exception when others then
    null;
  end;
end;
$$;

-- Поставить push в очередь и сразу разбудить воркер (запрос уходит после фиксации транзакции).
create or replace function private.queue_push(p_kind text, p_ref uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- push не настроен (нет ключей VAPID) — очередь не копим
  if not exists (select 1 from private.app_config where key = 'push_worker_url') then return; end if;
  -- то же событие ещё не забрано воркером (сгруппированное уведомление дополнили дважды подряд): воркер всё равно возьмёт свежее состояние
  if exists (select 1 from private.push_jobs j
              where j.kind = p_kind and j.ref_id = p_ref and j.status = 'pending' and j.attempts = 0) then
    return;
  end if;
  insert into private.push_jobs (kind, ref_id) values (p_kind, p_ref);
  perform private.kick_push_worker();
end;
$$;

-- Воркер забирает задания, которые пора отправить. Задание, забранное воркером, который не отчитался (перезапуск функций), — снова в работу.
create or replace function public.claim_push_jobs(p_limit integer default 50)
returns table (id bigint, kind text, ref_id uuid, only_subs uuid[])
language plpgsql security definer set search_path = '' as $$
begin
  update private.push_jobs j set status = 'pending', locked_at = null, next_at = now()
   where j.status = 'sending' and j.locked_at < now() - interval '1 minute';
  return query
  with c as (
    select j.id from private.push_jobs j
     where j.status = 'pending' and j.next_at <= now()
     order by j.id limit p_limit for update skip locked)
  update private.push_jobs j set status = 'sending', locked_at = now(), attempts = j.attempts + 1
    from c where j.id = c.id
  returning j.id, j.kind, j.ref_id, j.only_subs;
end;
$$;
revoke execute on function public.claim_push_jobs(integer) from public, anon, authenticated;
grant  execute on function public.claim_push_jobs(integer) to service_role;

-- Итог задания. p_retry — устройства, на которые не ушло по временной причине (сервис push ответил 429/5xx, сеть);
-- p_error — задание целиком не выполнено (ошибка базы, воркер упал). Повтор через 5, 10, 20, 40 с … до 8 попыток и не дольше 30 минут.
create or replace function public.finish_push_job(p_id bigint, p_sent integer, p_retry uuid[] default null, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean := p_error is null and coalesce(cardinality(p_retry), 0) = 0;
begin
  update private.push_jobs j set
    sent       = j.sent + coalesce(p_sent, 0),
    sent_at    = case when coalesce(p_sent, 0) > 0 and j.sent_at is null then now() else j.sent_at end,
    last_error = case when v_ok then null else coalesce(p_error, 'не доставлено на ' || cardinality(p_retry) || ' устр.') end,
    status     = case when v_ok then 'done'
                      when j.attempts >= 8 or j.created_at < now() - interval '30 minutes' then 'failed'
                      else 'pending' end,
    only_subs  = case when p_error is null and coalesce(cardinality(p_retry), 0) > 0 then p_retry else j.only_subs end,
    next_at    = now() + interval '5 seconds' * power(2, greatest(j.attempts - 1, 0)),
    locked_at  = null
   where j.id = p_id and j.status = 'sending';
end;
$$;
revoke execute on function public.finish_push_job(bigint, integer, uuid[], text) from public, anon, authenticated;
grant  execute on function public.finish_push_job(bigint, integer, uuid[], text) to service_role;

-- Сторож: в очереди что-то ждёт дольше положенного (вызов воркера потерялся, пора повторить) — будим воркер. Заодно чистим старое.
create or replace function private.push_sweep() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.push_jobs j
              where (j.status = 'pending' and j.next_at <= now() - interval '3 seconds')
                 or (j.status = 'sending' and j.locked_at < now() - interval '1 minute')) then
    perform private.kick_push_worker();
  end if;
  delete from private.push_jobs where created_at < now() - interval '7 days' and status in ('done', 'failed');
end;
$$;
revoke execute on function private.push_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Источники push: вместо прямого вызова воркера — задание в очереди
-- ---------------------------------------------------------------------------
create or replace function private.notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.read_at is not null or new.archived_at is not null then return new; end if;
  if new.snoozed_until is not null and new.snoozed_until > now() then return new; end if;
  -- пока у человека нет подписанных устройств, ничего не ставим
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return new; end if;
  perform private.queue_push('notification', new.id);
  return new;
end;
$$;

create or replace function private.chat_message_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then return new; end if;
  -- пока никто в организации не подписался на push, ничего не ставим
  if not exists (select 1 from public.push_subscriptions s where s.tenant_id = new.tenant_id) then return new; end if;
  perform private.queue_push('message', new.id);
  return new;
end;
$$;

-- Вызывает сайт после загрузки фото заметки. Разослать можно только свою свежую заметку к месту, один раз.
create or replace function public.field_note_notify(p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := auth.uid();
  v_tenant uuid;
  v_new    integer;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select c.tenant_id into v_tenant
    from public.comments c
   where c.id = p_comment and c.author_id = v_me and c.entity_type = 'location'
     and c.deleted_at is null and c.created_at > now() - interval '30 minutes';
  if v_tenant is null then return; end if;

  insert into private.field_note_pushes (comment_id) values (p_comment) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return; end if;

  if not exists (select 1 from public.push_subscriptions s where s.tenant_id = v_tenant) then return; end if;
  perform private.queue_push('note', p_comment);
end;
$$;
revoke execute on function public.field_note_notify(uuid) from public, anon;
grant  execute on function public.field_note_notify(uuid) to authenticated;

-- Сторож каждые 10 секунд (pg_cron 1.5+; на старом — раз в минуту)
do $$
begin
  perform cron.schedule('buildos-push-sweep', '10 seconds', $c$select private.push_sweep()$c$);
exception when others then
  perform cron.schedule('buildos-push-sweep', '* * * * *', $c$select private.push_sweep()$c$);
end;
$$;

-- Журнал запусков pg_cron растёт на каждый запуск (сторож — 8640 строк в сутки): раз в сутки убираем старше 3 дней
create or replace function private.cron_log_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '3 days';
exception when others then
  null;
end;
$$;
select cron.schedule('buildos-cron-log-cleanup', '41 2 * * *', $$select private.cron_log_cleanup()$$);
