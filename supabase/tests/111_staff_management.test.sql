-- Требует сид-данных. Персонал: оргструктура, цепочка руководителей, скрытые заметки, оценки, напоминания.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
select id as admin from public.users where email = 'admin@demo.test' \gset

-- оргструктура: директор → РП → прораб; ведёт администратор (staff.manage)
select pg_temp.act_as('admin@demo.test');
insert into public.staff_departments (name, head_user_id) values ('Строительство', :'director') returning id as dep \gset
insert into public.staff_profiles (user_id, department_id, manager_id) values
  (:'director', :'dep', null), (:'pm', :'dep', :'director'), (:'worker', :'dep', :'pm');
select ok(true, 'администратор строит оргструктуру');
select throws_ok(format($$update public.staff_profiles set manager_id = %L where user_id = %L$$, :'worker', :'director'), '22023', 'manager_cycle',
                 'подчинённого нельзя сделать руководителем своего руководителя');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.staff_profiles where user_id in (:'director', :'pm', :'worker')), 3, 'оргструктуру видят все сотрудники');
select is((select count(*)::int from public.staff_profiles where user_id = :'worker' and manager_id = :'pm'), 1, 'видно, кто чей руководитель');
update public.staff_profiles set hire_date = date '2020-01-01' where user_id = :'worker';
select is((select hire_date from public.staff_profiles where user_id = :'worker'), null::date, 'обычный сотрудник карточки не правит');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.staff_profiles), 0, 'внешний участник оргструктуру не видит');
select pg_temp.back();

-- заметка руководителя: бонус в конце года
select pg_temp.act_as('pm2@demo.test');
insert into public.staff_notes (user_id, kind, body, remind_on)
values (:'worker', 'bonus', 'Добавил новые функции в систему — начислить бонус в конце года', current_date) returning id as note \gset
select ok(:'note' is not null, 'руководитель пишет заметку о подчинённом');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.staff_notes where user_id = :'worker'), 0, 'сотрудник НЕ видит заметки о себе');
select throws_ok(format($$insert into public.staff_notes (user_id, body) values (%L, 'о себе')$$, :'worker'), '42501', null,
                 'сотрудник не пишет заметки о себе');
select throws_ok(format($$insert into public.staff_notes (user_id, body) values (%L, 'о руководителе')$$, :'pm'), '42501', null,
                 'подчинённый не пишет заметки о руководителе');
select pg_temp.back();

select pg_temp.act_as('director@demo.test');
select is((select count(*)::int from public.staff_notes where id = :'note'), 1, 'руководитель руководителя видит заметку');
insert into public.staff_notes (user_id, kind, body) values (:'admin', 'note', 'заметка об администраторе');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.staff_notes where id = :'note'), 0, 'посторонний сотрудник заметку не видит');
select pg_temp.back();

select pg_temp.act_as('admin@demo.test');
select is((select count(*)::int from public.staff_notes where id = :'note'), 1, 'право staff.notes.view видит заметки о других');
select is((select count(*)::int from public.staff_notes where user_id = :'admin'), 0, 'даже с этим правом заметки о себе не видны');
select pg_temp.back();

-- оценка эффективности
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.staff_review_start(%L, '2026', current_date + 30)$$, :'worker'), '42501', null, 'чужой сотрудник оценку не начинает');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select public.staff_review_start(:'worker', '2026', current_date + 30) as review \gset
select throws_ok(format($$select public.staff_review_start(%L, '2026-2', current_date + 30)$$, :'worker'), '22023', 'review_open', 'вторую открытую оценку не начать');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select public.staff_review_self(:'review', 'Сделал модуль отчётов', true);
select is((select status from public.staff_reviews where id = :'review'), 'manager', 'самооценка отдана руководителю');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select public.staff_review_assess(:'review', 'Сильный год', 5::smallint, 'Вести новых сотрудников', false);
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.staff_review_assessments where review_id = :'review'), 0, 'черновик руководителя сотруднику не виден');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select public.staff_review_assess(:'review', 'Сильный год', 5::smallint, 'Вести новых сотрудников', true);
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select rating from public.staff_review_assessments where review_id = :'review'), 5::smallint, 'после «Поделиться» сотрудник видит итог');
select is((select next_review_on from public.staff_profiles where user_id = :'worker'), (current_date + 30 + interval '12 months')::date,
          'следующая оценка — через год от срока');
select is((select count(*)::int from public.notifications where user_id = :'worker' and event_type = 'staff.review_shared'), 1, 'сотрудник получил уведомление об итогах');
select pg_temp.back();

-- напоминания
update public.staff_profiles set next_review_on = current_date + 7 where user_id = :'pm';
select ok(private.staff_reminders() >= 2, 'ежедневные напоминания отработали');
select is((select count(*)::int from public.notifications where user_id = :'pm' and event_type = 'staff.note_due' and body like '%бонус%'), 1,
          'автору напомнили о бонусе');
select is((select count(*)::int from public.notifications where user_id = :'worker' and (body like '%бонус%' or event_type = 'staff.note_due')), 0,
          'сотруднику о заметке не сообщили');
select is((select count(*)::int from public.notifications where user_id = :'director' and event_type = 'staff.review_due'), 1,
          'руководителю напомнили, что пора оценивать подчинённого');

select * from finish();
rollback;
