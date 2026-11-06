-- Требует сид-данных. Недельное планирование: обязательства, старт, отметки, закрытие, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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
-- A (армирование) → B (опалубка): B не готова на старте недели, пока A не закончена
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', 'A Армирование', 5, 'snet', date '2026-11-02') returning id as a \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'B Опалубка', 3) returning id as b \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Группа', 1) returning id as g \gset
update public.schedule_activities set kind = 'summary' where id = :'g';
insert into public.schedule_links (predecessor_id, successor_id) values (:'a', :'b');
select public.recalculate_schedule(:'zk7');

-- 4 ноября 2026 — среда: неделя приводится к понедельнику 2 ноября
select public.create_planning_period(:'zk7', date '2026-11-04') as per \gset
select is((select starts_on from public.planning_periods where id = :'per'), date '2026-11-02', 'неделя начинается с понедельника');
select throws_ok(format($$select public.create_planning_period(%L, date '2026-11-06')$$, :'zk7'), '23505', 'period_exists', 'вторая такая же неделя не создаётся');

select public.add_commitment(:'per', :'a', null) as ca \gset
select public.add_commitment(:'per', :'b', null) as cb \gset
select is((select title from public.period_commitments where id = :'ca'), 'A Армирование', 'название берётся из работы');
select is((select was_ready from public.period_commitments where id = :'ca'), true, 'A готова: предшественников нет');
select is((select was_ready from public.period_commitments where id = :'cb'), false, 'B не готова: A ещё не закончена');
select throws_ok(format($$select public.add_commitment(%L, %L, null)$$, :'per', :'a'), '23505', 'already_planned', 'одна работа дважды в неделе не планируется');
select throws_ok(format($$select public.add_commitment(%L, %L, null)$$, :'per', :'g'), 'P0002', 'activity_not_found', 'суммарную работу планировать нельзя');
select public.add_commitment(:'per', null, 'Уборка площадки') as cs \gset

select throws_ok(format($$select public.set_commitment_result(%L, 'completed')$$, :'ca'), '23514', 'period_not_active', 'до старта недели отмечать нечего');
select public.start_planning_period(:'per');
select public.add_commitment(:'per', null, 'Внеплановое бетонирование') as cl \gset
select is((select added_late from public.period_commitments where id = :'cl'), true, 'добавленное после старта помечено «позже»');
select throws_ok(format($$select public.delete_commitment(%L)$$, :'ca'), '23514', 'period_started', 'исходное обязательство после старта не убрать');

-- отметки
select public.set_commitment_result(:'ca', 'completed');
select throws_ok(format($$select public.set_commitment_result(%L, 'not_completed')$$, :'cb'), '22023', 'reason_required', 'невыполненное требует причину');
select public.set_commitment_result(:'cb', 'not_completed', 'predecessor', 'арматуру не успели');
select throws_ok(format($$select public.close_planning_period(%L)$$, :'per'), '23514', 'unresolved_commitments', 'с неотмеченными нельзя закрыть');
select pg_temp.back();

-- прораб: может отмечать, но не закрывать принудительно
select pg_temp.act_as('foreman1@demo.test');
select public.set_commitment_result(:'cs', 'completed');
select throws_ok(format($$select public.close_planning_period(%L, true)$$, :'per'), '42501', 'permission denied: period.manage', 'принудительно закрыть неделю прораб не может');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select public.set_commitment_result(:'cl', 'completed');
select is((public.close_planning_period(:'per') ->> 'completed')::int, 2, 'закрыто: PPC считает 2 из 3 (позднее не в счёт)');
select is((select status from public.planning_periods where id = :'per'), 'closed', 'неделя закрыта');
select pg_temp.back();

-- права и видимость
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.add_commitment(%L, null, 'Чужое')$$, :'per'), '42501', null, 'мастер без commitment.create не планирует');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.planning_periods), 0, 'внешние недельные планы не видят');
select pg_temp.back();

select * from finish();
rollback;
