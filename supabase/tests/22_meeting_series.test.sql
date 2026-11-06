-- Требует сид-данных. Регулярные совещания: серия по дням недели, перенос одной встречи и всей серии, завершение серии.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- автоповестка сигналов добавляет пункт при создании совещания; в этом тесте проверяется только повестка серии
delete from public.signals;

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select coalesce(timezone, 'UTC') as tz from public.projects where code = 'ZK7' \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as des from public.users where email = 'designer@demo.test' \gset

-- ---- создание серии ----
select pg_temp.act_as('pm1@demo.test');
select public.create_meeting_series(:'zk7', 'Планёрка по графику', 'weekly',
  '[{"dow":1,"time":"11:00"},{"dow":3,"time":"13:00"}]'::jsonb, current_date, null, 45, 'Бытовка', 'internal', null,
  array[:'fm1', :'des']::uuid[], array['Итоги недели', 'Проблемы']) as ser \gset
select ok((select count(*)::int from public.meetings where series_id = :'ser') between 9 and 13, 'встречи серии созданы на ~6 недель вперёд');
select is((select count(*)::int from public.meetings where series_id = :'ser'
            and extract(isodow from (scheduled_at at time zone :'tz'))::int not in (1, 3)), 0, 'все встречи приходятся на пн и ср');
select is((select count(*)::int from public.meetings where series_id = :'ser'
            and to_char(scheduled_at at time zone :'tz', 'HH24:MI') <> case extract(isodow from (scheduled_at at time zone :'tz'))::int when 1 then '11:00' else '13:00' end), 0,
          'время: пн 11:00, ср 13:00 по часовому поясу проекта');
select is((select count(distinct (select count(*) from public.meeting_participants p where p.meeting_id = m.id))::int from public.meetings m where m.series_id = :'ser'), 1,
          'состав одинаков во всех встречах');
select is((select count(*)::int from public.meeting_participants p join public.meetings m on m.id = p.meeting_id where m.series_id = :'ser' and p.user_id = :'fm1'),
          (select count(*)::int from public.meetings where series_id = :'ser'), 'участник приглашён на каждую встречу');
select is((select count(*)::int from public.meeting_agenda_items a join public.meetings m on m.id = a.meeting_id where m.series_id = :'ser' and m.id = (select id from public.meetings where series_id = :'ser' order by scheduled_at limit 1)), 2,
          'повестка серии скопирована во встречу');
select is((select min(m.number) from public.meetings m where m.series_id = :'ser') > 0, true, 'встречи получили сквозные номера');
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = :'fm1' and entity_type = 'meeting' and body like 'Вас пригласили на регулярное совещание%'), 1,
          'приглашение одно на всю серию, а не на каждую встречу');
select is(private.generate_series_meetings(:'ser'), 0, 'повторная генерация ничего не дублирует');

-- ---- перенос одной встречи ----
-- m1 — переносим; m2 — соседняя (первая по времени), её не трогаем
select id as m1 from public.meetings where series_id = :'ser' order by scheduled_at offset 1 limit 1 \gset
select id as m2 from public.meetings where series_id = :'ser' order by scheduled_at limit 1 \gset
select scheduled_at as m1_old from public.meetings where id = :'m1' \gset

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.reschedule_meeting(%L, now() + interval '30 days', 'this')$$, :'m1'), '42501', null, 'без прав управления перенести нельзя');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.reschedule_meeting(%L, %L::timestamptz + interval '1 day 2 hours', 'this')$$, :'m1', :'m1_old'), 'встречу можно перенести только её саму');
select is((select scheduled_at <> original_at from public.meetings where id = :'m1'), true, 'перенесённая встреча отличается от расписания');
select is((select scheduled_at from public.meetings where id = :'m2') = (select original_at from public.meetings where id = :'m2'), true, 'соседняя встреча не тронута');
select pg_temp.back();
select is(private.generate_series_meetings(:'ser'), 0, 'перенесённая встреча не создаётся заново на старом месте');
select ok(exists (select 1 from public.notifications where user_id = :'fm1' and entity_type = 'meeting' and entity_id = :'m1' and body like '%перенесено на%'), 'участники уведомлены о переносе');

-- ---- перенос с этой и всех следующих ----
select m.id as mb, m.original_at as mb_old from public.meetings m
 where m.series_id = :'ser' and extract(isodow from (m.original_at at time zone :'tz'))::int = 1 and m.id <> :'m1' and m.status = 'scheduled'
 order by m.original_at offset 1 limit 1 \gset
select id as ma from public.meetings m
 where m.series_id = :'ser' and extract(isodow from (m.original_at at time zone :'tz'))::int = 1 and m.original_at < :'mb_old' and m.id <> :'m1'
 order by m.original_at limit 1 \gset

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.reschedule_meeting(%L, (((%L::timestamptz at time zone %L)::date + 1) + time '12:00') at time zone %L, 'following')$$,
                       :'mb', :'mb_old', :'tz', :'tz'), 'расписание можно изменить с этой встречи');
select is((select (jsonb_path_exists(slots, '$[*] ? (@.dow == 2 && @.time == "12:00")') and jsonb_path_exists(slots, '$[*] ? (@.dow == 3 && @.time == "13:00")')
                   and not jsonb_path_exists(slots, '$[*] ? (@.dow == 1)')) from public.meeting_series where id = :'ser'), true,
          'в расписании серии пн 11:00 заменён на вт 12:00, среда осталась');
select is((select extract(isodow from (original_at at time zone :'tz'))::int || ' ' || to_char(original_at at time zone :'tz', 'HH24:MI') from public.meetings where id = :'mb'), '2 12:00',
          'выбранная встреча стала вторником 12:00');
select is((select extract(isodow from (original_at at time zone :'tz'))::int from public.meetings where id = :'ma'), 1, 'предыдущая встреча осталась в прежний день');
select is((select count(*)::int from public.meetings where series_id = :'ser' and status = 'scheduled' and original_at > :'mb_old'
            and extract(isodow from (original_at at time zone :'tz'))::int = 1), 0, 'следующих понедельничных встреч не осталось — они сдвинуты на вторник');
select pg_temp.back();

-- ---- разовое совещание нельзя «перенести серией» ----
select pg_temp.act_as('pm1@demo.test');
select public.create_meeting(:'zk7', 'Разовое', 'other', now() + interval '10 days', 30, null, 'internal', null, '{}', '{}') as one \gset
select throws_ok(format($$select public.reschedule_meeting(%L, now() + interval '11 days', 'following')$$, :'one'), '22023', 'not_in_series', 'у разового нет серии');
select lives_ok(format($$select public.reschedule_meeting(%L, now() + interval '11 days', 'this')$$, :'one'), 'разовое переносится как одна встреча');
select throws_ok($$select public.create_meeting_series((select id from public.projects where code = 'ZK7'), 'X', 'weekly', '[{"dow":9,"time":"11:00"}]'::jsonb, current_date)$$,
                 '22023', 'slots_invalid', 'неверный день недели отклоняется');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.meeting_series), 0, 'внешние серии не видят');
select pg_temp.back();

-- ---- завершение серии ----
select pg_temp.act_as('pm1@demo.test');
select ok(public.end_meeting_series(:'ser') > 0, 'будущие нетронутые встречи убраны');
select is((select count(*)::int from public.meetings where id = :'m1'), 1, 'вручную перенесённая встреча осталась');
select pg_temp.back();
select is(private.generate_series_meetings(:'ser'), 0, 'завершённая серия новых встреч не создаёт');

select * from finish();
rollback;
