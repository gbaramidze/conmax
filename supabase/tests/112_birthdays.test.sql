-- Требует сид-данных. Дни рождения: кто видит дату и год, кто пишет, поздравления и напоминание накануне.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as director from public.users where email = 'director@demo.test' \gset
select id as pm from public.users where email = 'pm2@demo.test' \gset
select id as worker from public.users where email = 'foreman1@demo.test' \gset

-- 29 февраля в невисокосный год — 28-е
select is(private.birthday_in_year(date '2000-02-29', 2025), date '2025-02-28', '29 февраля в невисокосный год празднуют 28-го');
select is(private.birthday_next(date '1990-03-10', date '2026-03-11'), date '2027-03-10', 'прошедший в этом году день рождения — в следующем году');
select is(private.birthday_next(date '1990-03-10', date '2026-03-10'), date '2026-03-10', 'сегодняшний день рождения — сегодня');

-- свою дату пишет сам, чужую — только staff.manage
select pg_temp.act_as('foreman1@demo.test');
select lives_ok(format($$select public.set_birthday(%L, date '1991-06-15', false)$$, :'worker'), 'сотрудник указывает свой день рождения');
select throws_ok(format($$select public.set_birthday(%L, current_date + 1, false)$$, :'worker'), '22023', 'bad_birthday', 'дата из будущего не принимается');
select throws_ok(format($$select public.set_birthday(%L, date '1980-01-01', false)$$, :'pm'), '42501', null, 'чужую дату обычный сотрудник не пишет');
select pg_temp.back();

select pg_temp.act_as('admin@demo.test');
select lives_ok(format($$select public.set_birthday(%L, date '1985-09-01', true)$$, :'pm'), 'staff.manage указывает дату за сотрудника');
select is((select count(*)::int from public.user_birthdays where user_id in (:'pm', :'worker')), 2, 'staff.manage видит полные даты');
select pg_temp.back();

-- коллеги: день и месяц всегда, возраст — только если разрешён
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.user_birthdays where user_id in (:'pm', :'worker')), 0, 'чужую строку с годом коллега не читает');
select is((select birth_day from public.birthdays() where user_id = :'worker'), 15, 'коллега видит день рождения');
select is((select turns from public.birthdays() where user_id = :'worker'), null::int, 'год скрыт — возраста нет');
select ok((select turns from public.birthdays() where user_id = :'pm') > 30, 'год открыт — возраст виден');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select ok((select turns from public.birthdays() where user_id = :'worker') is not null, 'свой возраст человек видит всегда');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.birthdays()), 0, 'внешний участник дни рождения не видит');
select pg_temp.back();

-- уведомления: у прораба день рождения сегодня, у РП — завтра. Часовой пояс — такой, где сейчас полдень (после 9 утра).
select 'Etc/GMT' || case when o > 0 then '-' || o when o < 0 then '+' || (-o) else '' end as tz
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as o) x \gset
update public.users set timezone = :'tz' where id in (:'worker', :'pm');
update public.user_birthdays set birth_date = ((now() at time zone :'tz')::date - interval '30 years')::date where user_id = :'worker';
update public.user_birthdays set birth_date = ((now() at time zone :'tz')::date + 1 - interval '40 years')::date where user_id = :'pm';
insert into public.staff_profiles (user_id, manager_id) values (:'worker', :'pm'), (:'pm', :'director')
  on conflict (user_id) do update set manager_id = excluded.manager_id;

select ok(private.birthday_reminders() > 0, 'ежечасная проверка отправляет уведомления');
select is((select count(*)::int from public.notifications where user_id = :'pm' and event_type = 'birthday.today'
            and group_key like 'birthday:' || :'worker' || ':%'), 1, 'руководитель узнаёт о дне рождения подчинённого');
select is((select count(*)::int from public.notifications where user_id = :'worker' and event_type = 'birthday.greeting'), 1, 'имениннику — поздравление');
select is((select count(*)::int from public.notifications where user_id = :'director' and event_type = 'birthday.tomorrow'
            and group_key like 'birthday_tomorrow:' || :'pm' || ':%'), 1, 'накануне руководителю — напоминание');
select is((select count(*)::int from public.email_outbox o join public.notifications n on n.id = o.notification_id where n.category = 'birthday'), 0,
          'писем о днях рождения нет — только колокольчик и push');
select ok(private.birthday_reminders() >= 0, 'следующая ежечасная проверка');
select is((select count(*)::int from public.notifications where user_id = :'pm' and event_type = 'birthday.today'
            and group_key like 'birthday:' || :'worker' || ':%'), 1, 'за тот же день повторно не поздравляем');

select * from finish();
rollback;
