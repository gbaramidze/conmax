-- Требует сид-данных. Напоминания за 10 минут: совещания (участникам), личные события со временем (владельцу), один раз, без письма.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select timezone as tz from public.users where email = 'pm1@demo.test' \gset

delete from public.notifications where event_type like '%.reminder';

-- совещание через 8 минут, второе через 40, третье отменено
insert into public.meetings (tenant_id, project_id, number, key, title, scheduled_at, status) values
  (:'tenant', :'zk7', 9001, 'ZK7-M-9001', 'Планёрка по этажу 7', now() + interval '8 minutes', 'scheduled'),
  (:'tenant', :'zk7', 9002, 'ZK7-M-9002', 'Позднее совещание', now() + interval '40 minutes', 'scheduled'),
  (:'tenant', :'zk7', 9003, 'ZK7-M-9003', 'Отменённое совещание', now() + interval '8 minutes', 'scheduled');
insert into public.meeting_participants (meeting_id, user_id, tenant_id, project_id)
select m.id, :'pm1', :'tenant', :'zk7' from public.meetings m where m.number in (9001, 9002, 9003) and m.project_id = :'zk7';

update public.meetings set status = 'cancelled' where number = 9003 and project_id = :'zk7';

-- личное событие pm1 через 5 минут и другое — через час
select (now() at time zone :'tz') + interval '5 minutes' as soon \gset
select (now() at time zone :'tz') + interval '60 minutes' as later \gset
insert into public.personal_items (tenant_id, user_id, kind, title, event_date, start_time, place)
values (:'tenant', :'pm1', 'event', 'Стоматолог', (:'soon'::timestamp)::date, (:'soon'::timestamp)::time, 'Клиника'),
       (:'tenant', :'pm1', 'event', 'Обед с подрядчиком', (:'later'::timestamp)::date, (:'later'::timestamp)::time, null);

select ok(private.send_event_reminders() >= 2, 'напоминания отправлены');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and event_type = 'meeting.reminder' and title like '%Планёрка по этажу 7'), 1, 'напоминание о совещании пришло участнику');
select matches((select title from public.notifications where event_type = 'meeting.reminder' and user_id = :'pm1' and title like '%Планёрка%'), '^Через [0-9]+ мин: Планёрка по этажу 7$', 'в заголовке — через сколько минут и название');
select is((select count(*)::int from public.notifications where event_type = 'meeting.reminder' and title like '%Позднее%'), 0, 'совещание позже 10 минут не напоминает');
select is((select count(*)::int from public.notifications where event_type = 'meeting.reminder' and title like '%Отменённое%'), 0, 'отменённое не напоминает');
select is((select count(*)::int from public.notifications where user_id = :'gip' and event_type like '%.reminder'), 0, 'не участникам напоминаний нет');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and event_type = 'personal.reminder' and title like '%Стоматолог'), 1, 'личное событие напомнило владельцу');
select is((select payload ->> 'link' from public.notifications where event_type = 'personal.reminder' and title like '%Стоматолог') like '/personal?tab=calendar&item=%', true, 'у напоминания о личном есть ссылка на событие');
select is((select count(*)::int from public.notifications where event_type = 'personal.reminder' and title like '%Обед%'), 0, 'событие через час не напоминает');
select is(private.send_event_reminders(), 0, 'повторный запуск ничего не дублирует');
select is((select count(*)::int from public.email_outbox o join public.notifications n on n.id = o.notification_id where n.event_type like '%.reminder'), 0, 'письмом напоминания не дублируются');

select * from finish();
rollback;
