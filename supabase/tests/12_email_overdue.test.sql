-- Требует сид-данных. Просрочки с эскалацией, очередь писем, тихие часы, дайджест.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset

-- Чистое поле: убираем заранее накопленные письма и эскалации
delete from public.email_outbox;
delete from public.task_escalations;

-- Своя задача: высокий приоритет, исполнитель — прораб, срок 5 суток назад
insert into public.tasks (tenant_id, project_id, number, key, type, title, workflow_id, status_id, status_category, priority, reporter_id, assignee_id, due_date)
select :'tenant', :'zk7', 9001, 'ZK7-T-9001', 'task', 'Тест: просроченная задача', t.workflow_id, t.status_id, 'in_progress', 'high', :'pm1', :'fm1', current_date - 5
  from public.tasks t where t.project_id = :'zk7' limit 1;
select id as task from public.tasks where key = 'ZK7-T-9001' \gset

-- 1. Просрочка: исполнителю сразу, РП — на третьем шаге (высокий приоритет, > 72 ч)
select is(private.detect_overdue() >= 3, true, 'детектор выпускает шаги эскалации для высокого приоритета');
select ok(exists (select 1 from public.notifications where user_id = :'fm1' and entity_id = :'task' and (payload -> 'counts') ? 'overdue'),
          'исполнитель получил уведомление о просрочке');
select ok(exists (select 1 from public.notifications where user_id = :'pm1' and entity_id = :'task' and category = 'escalation'),
          'РП получил эскалацию');
select is((select count(*)::int from public.task_escalations where task_id = :'task'), 3, 'зафиксированы три шага (0, 1, 2), шаг для обычного приоритета не применяется');

-- 2. Повторный запуск ничего не дублирует
select private.detect_overdue();
select is((select count(*)::int from public.task_escalations where task_id = :'task'), 3, 'повторный запуск не создаёт шагов заново');
select is((select count(*)::int from public.entity_events where entity_id = :'task' and event_type = 'overdue_escalated'), 3, 'события эскалации записаны в ленту задачи');

-- 3. Закрытая задача не эскалируется; перенос срока сбрасывает шаги
update public.tasks set due_date = current_date + 3 where id = :'task';
select is((select count(*)::int from public.task_escalations where task_id = :'task'), 0, 'перенос срока сбросил эскалацию');

-- 4. Письма: уведомление исполнителю попало в очередь с задержкой окна группировки
select ok(exists (select 1 from public.email_outbox where user_id = :'fm1' and kind = 'instant' and send_after >= now() + interval '2 minutes'),
          'письмо исполнителю поставлено в очередь после окна группировки (3 мин)');

-- 5. Тихие часы
insert into public.user_notification_settings (user_id, tenant_id, timezone, quiet_enabled, quiet_start, quiet_end)
values (:'fm1', :'tenant', 'UTC', true, '21:00', '07:00')
on conflict (user_id) do update set timezone = 'UTC', quiet_enabled = true, quiet_start = '21:00', quiet_end = '07:00';
select is(private.next_send_time(:'fm1', 'normal', timestamptz '2026-10-22 22:30+00'), timestamptz '2026-10-23 07:00+00', 'вечером письмо откладывается до утра следующего дня');
select is(private.next_send_time(:'fm1', 'normal', timestamptz '2026-10-22 03:00+00'), timestamptz '2026-10-22 07:00+00', 'ночью письмо откладывается до утра этого дня');
select is(private.next_send_time(:'fm1', 'normal', timestamptz '2026-10-22 12:00+00'), timestamptz '2026-10-22 12:00+00', 'днём письмо уходит без задержки');
select is(private.next_send_time(:'fm1', 'critical', timestamptz '2026-10-22 23:00+00'), timestamptz '2026-10-22 23:00+00', 'критичное игнорирует тихие часы');

-- 6. Воркер: берёт готовое, пропускает прочитанное, фиксирует итог
update public.email_outbox set send_after = now() - interval '1 minute';
select is(jsonb_array_length(public.claim_emails(10)) >= 1, true, 'воркер получил письма из очереди');
select is((select count(*)::int from public.email_outbox where status = 'sending') >= 1, true, 'забранные письма помечены «в отправке»');
select id as outbox from public.email_outbox where status = 'sending' limit 1 \gset
select public.finish_email(:'outbox', true);
select is((select status from public.email_outbox where id = :'outbox'), 'sent', 'успешная отправка фиксируется');

-- прочитанное в приложении письмом не дублируем
update public.email_outbox set status = 'pending', to_email = 'x@example.com', send_after = now() - interval '1 minute'
 where id = (select id from public.email_outbox where user_id = :'pm1' and kind = 'instant' limit 1);
update public.notifications set read_at = now() where user_id = :'pm1';
select public.claim_emails(10);
select is((select status from public.email_outbox where to_email = 'x@example.com'), 'skipped', 'прочитанное уведомление письмом не дублируется');

-- 7. Дайджест: режим «наблюдаю» по умолчанию идёт в сводку
insert into public.user_notification_settings (user_id, tenant_id, timezone, digest_hour, digest_sent_through)
values (:'pm1', :'tenant', 'UTC', 0, now() - interval '2 days')
on conflict (user_id) do update set timezone = 'UTC', digest_hour = 0, digest_sent_through = now() - interval '2 days';
insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, priority, category, title, body, payload)
values (:'tenant', :'pm1', :'zk7', 'task.commented', 'task', :'task', 'low', 'watching', 'ZK7-T-9001 «Тест»', 'Комментарий для дайджеста',
        '{"entity_key":"ZK7-T-9001","project_code":"ZK7"}');
select is(private.queue_digests() >= 1, true, 'дайджест сформирован');
select is((select jsonb_array_length(payload -> 'ids') from public.email_outbox where user_id = :'pm1' and kind = 'digest'), 1, 'в дайджест вошло накопленное уведомление «наблюдаю»');

select * from finish();
rollback;
