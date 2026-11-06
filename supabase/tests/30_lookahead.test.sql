-- Требует сид-данных. Look-ahead: ограничения как задачи, отметка проверки, права и видимость.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
delete from public.schedule_activities where project_id = :'zk7';
delete from public.planning_periods where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', 'Монолит плиты', 5, 'snet', current_date + 14) returning id as a \gset
insert into public.schedule_activities (project_id, name, kind) values (:'zk7', 'Группа', 'summary') returning id as g \gset
select public.recalculate_schedule(:'zk7');

-- ---- создание ограничения ----
select public.create_constraint(:'a', 'design', 'Нет чертежей армирования') as t \gset
select is((select type from public.tasks where id = :'t'), 'constraint', 'ограничение — задача типа constraint');
select ok((select key from public.tasks where id = :'t') like 'ZK7-C-%', 'у неё ключ C-n');
select is((select kind from public.activity_constraints where task_id = :'t'), 'design', 'вид проверки сохранён');
select is((select due_date from public.tasks where id = :'t'), (select start_date - 7 from public.schedule_activities where id = :'a'),
          'срок по умолчанию — за неделю до старта работы');
select throws_ok(format($$select public.create_constraint(%L, 'weather', 'Дождь')$$, :'a'), '22023', 'bad_kind', 'неизвестный вид проверки отклоняется');
select throws_ok(format($$select public.create_constraint(%L, 'design', '  ')$$, :'a'), '22023', 'title_required', 'пустое название отклоняется');
select throws_ok(format($$select public.create_constraint(%L, 'design', 'Группа')$$, :'g'), 'P0002', 'activity_not_found', 'к суммарной работе ограничение не привязывается');

-- ---- отметка «проверено» ----
select public.set_activity_checked(:'a', true);
select is((select count(*)::int from public.activity_readiness_checks where activity_id = :'a'), 1, 'отметка проверки поставлена');
select public.create_constraint(:'a', 'materials', 'Арматура не привезена');
select is((select count(*)::int from public.activity_readiness_checks where activity_id = :'a'), 0, 'новое ограничение снимает отметку проверки');
-- ---- связь с недельным планом: открытое ограничение делает работу «не готовой» ----
select public.create_planning_period(:'zk7', current_date) as per \gset
select public.add_commitment(:'per', :'a', null) as cm \gset
select is((select was_ready from public.period_commitments where id = :'cm'), false, 'работа с неснятым ограничением в плане недели — не готова');
select public.create_planning_period(:'zk7', current_date + 14) as per2 \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Чистая работа', 2) returning id as clean \gset
select public.add_commitment(:'per2', :'clean', null) as cm2 \gset
select is((select was_ready from public.period_commitments where id = :'cm2'), true, 'без ограничений и предшественников — готова');
select pg_temp.back();

-- ---- права и видимость ----
select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$select public.create_constraint(%L, 'access', 'Фронт занят')$$, :'a'), '42501', null, 'без права создавать задачи ограничение не завести');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.activity_constraints), 0, 'внешние ограничения не видят');
select pg_temp.back();

select * from finish();
rollback;
