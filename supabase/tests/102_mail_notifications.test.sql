-- Требует сид-данных. Уведомления о новых письмах Outlook: по одному на письмо (до 3), сводное — если больше,
-- без повторов, без письма-дубля на email, выключаются настройкой, курсор опроса двигается только вперёд.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset

insert into public.mail_accounts (user_id, tenant_id, email, refresh_token_enc)
values (:'pm1', :'tenant', 'pm1@outlook.test', 'v1.x.y')
on conflict (user_id) do update set notify_cursor = null;
delete from public.notifications where user_id = :'pm1';
delete from public.notification_preferences where user_id = :'pm1' and category = 'mail';

-- служебный вызов — только для service_role
select throws_ok($$ set local role authenticated; select public.mail_notify(gen_random_uuid(), now(), '[]') $$, '42501', null, 'сайту функция недоступна');
reset role;

select is(public.mail_notify(:'pm1', '2026-11-19 10:00+00',
  '[{"id":"AAA1","from_name":"Иван Петров","from_address":"ivan@x.test","subject":"Счёт за бетон","received_at":"2026-11-19T09:58:00Z"},
    {"id":"AAA2","from_name":"","from_address":"no-name@x.test","subject":"","received_at":"2026-11-19T09:59:00Z"}]'), 2,
  'два письма — два уведомления');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and category = 'mail'), 2, 'в категории «Почта»');
select is((select body from public.notifications where user_id = :'pm1' and group_key = 'mail:AAA1'), 'Иван Петров: Счёт за бетон', 'текст: отправитель и тема');
select is((select body from public.notifications where user_id = :'pm1' and group_key = 'mail:AAA2'), 'no-name@x.test: (без темы)', 'без имени — адрес, без темы — пометка');
select is((select payload->>'link' from public.notifications where user_id = :'pm1' and group_key = 'mail:AAA1'), '/mail?m=AAA1', 'ссылка ведёт к письму');
select is((select count(*)::int from public.email_outbox o join public.notifications n on n.id = o.notification_id where n.user_id = :'pm1' and n.category = 'mail'), 0,
  'письмо о письме на email не ставится');
select is((select notify_cursor from public.mail_accounts where user_id = :'pm1'), '2026-11-19 10:00+00'::timestamptz, 'курсор сдвинут');

select is(public.mail_notify(:'pm1', '2026-11-19 09:00+00', '[{"id":"AAA1","from_name":"Иван Петров","subject":"Счёт за бетон","received_at":"2026-11-19T09:58:00Z"}]'), 0,
  'повтор того же письма не уведомляет');
select is((select notify_cursor from public.mail_accounts where user_id = :'pm1'), '2026-11-19 10:00+00'::timestamptz, 'курсор назад не уходит');

select is(public.mail_notify(:'pm1', '2026-11-19 11:00+00',
  '[{"id":"B1","from_name":"А","subject":"1","received_at":"2026-11-19T10:01:00Z"},{"id":"B2","from_name":"Б","subject":"2","received_at":"2026-11-19T10:02:00Z"},
    {"id":"B3","from_name":"А","subject":"3","received_at":"2026-11-19T10:03:00Z"},{"id":"B4","from_name":"В","subject":"4","received_at":"2026-11-19T10:04:00Z"}]'), 1,
  'больше трёх — одно сводное');
select is((select body from public.notifications where user_id = :'pm1' and title = 'Новые письма'), 'Новых писем: 4. От: А, Б, В', 'сводное: сколько и от кого');
select is(public.mail_notify(:'pm1', '2026-11-19 11:00+00', '[{"id":"B3","from_name":"А","subject":"3","received_at":"2026-11-19T10:03:00Z"}]'), 0,
  'письмо из сводного повторно не уведомляет');

-- настройку человек меняет сам (триггер берёт пользователя из сессии)
select set_config('request.jwt.claims', json_build_object('sub', :'pm1', 'role', 'authenticated', 'tenant_id', :'tenant')::text, true);
set local role authenticated;
insert into public.notification_preferences (category, channel, mode) values ('mail', 'in_app', 'off');
reset role;
select is(public.mail_notify(:'pm1', '2026-11-19 12:00+00', '[{"id":"C1","from_name":"Г","subject":"x","received_at":"2026-11-19T11:30:00Z"}]'), 0,
  'выключено в настройках — тишина');

select * from finish();
rollback;
