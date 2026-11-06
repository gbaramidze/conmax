-- Требует сид-данных. Эталонный расчёт EVM на дату: PV, EV, AC, индексы, EAC, TCPI, Earned Schedule; снимки; права.
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
delete from public.activity_budgets where project_id = :'zk7';
delete from public.budget_actuals where project_id = :'zk7';
delete from public.budget_commitments where project_id = :'zk7';
delete from public.budget_etc where project_id = :'zk7';
delete from public.budget_amounts where project_id = :'zk7';
delete from public.budget_versions where project_id = :'zk7';
delete from public.cbs_items where project_id = :'zk7';
delete from public.schedule_baselines where project_id = :'zk7';
delete from public.schedule_activities where project_id = :'zk7';
delete from public.snapshots where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
-- Работа A: 5 раб. дней с пн 2 нояб (до пт 6 нояб), бюджет 1000. Работа B: 8 раб. дней со ср 4 нояб (до пт 13 нояб), бюджет 500.
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', 'A', 5, 'snet', date '2026-11-02') returning id as a \gset
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', 'B', 8, 'snet', date '2026-11-04') returning id as b \gset
select public.recalculate_schedule(:'zk7');
select public.create_schedule_baseline(:'zk7', 'Базовый');

select public.budget_upsert_item(:'zk7', null, null, '1', 'Статья A') as i1 \gset
select public.budget_upsert_item(:'zk7', null, null, '2', 'Статья B') as i2 \gset
select public.create_budget_draft(:'zk7') as v \gset
select public.set_budget_amount(:'v', :'i1', 1000);
select public.set_budget_amount(:'v', :'i2', 500);
select public.approve_budget_version(:'v');
select public.allocate_budget(:'i1', array[:'a']::uuid[], 'equal');
select public.allocate_budget(:'i2', array[:'b']::uuid[], 'equal');
select public.budget_save_actual(:'zk7', null, :'i1', 'act', 'А-1', date '2026-11-04', 650);
select public.budget_save_actual(:'zk7', null, :'i2', 'act', 'Б-1', date '2026-11-05', 150);
select public.budget_save_actual(:'zk7', null, :'i1', 'act', 'А-2', date '2026-11-20', 999);   -- после даты расчёта в AC не входит
update public.schedule_activities set percent_complete = 60 where id = :'a';
update public.schedule_activities set percent_complete = 20 where id = :'b';

-- ---- эталон на пятницу-1: 5 нояб 2026 ----
select public.evm_calc(:'zk7', date '2026-11-05') as m \gset
select is((:'m'::jsonb ->> 'bac')::numeric, 1500.00, 'BAC = сумма долей бюджета работ');
select is((:'m'::jsonb ->> 'pv')::numeric, 900.00, 'PV: A 4 из 5 дней = 800, B 2 из 10 дней = 100');
select is((:'m'::jsonb ->> 'ev')::numeric, 700.00, 'EV: 1000×60% + 500×20%');
select is((:'m'::jsonb ->> 'ac')::numeric, 800.00, 'AC на дату: 650 + 150 (позднейший акт не входит)');
select is((:'m'::jsonb ->> 'spi')::numeric, 0.7778, 'SPI = EV/PV');
select is((:'m'::jsonb ->> 'cpi')::numeric, 0.8750, 'CPI = EV/AC');
select is((:'m'::jsonb ->> 'eac1')::numeric, 1714.29, 'EAC(1) = BAC/CPI');
select is((:'m'::jsonb ->> 'eac2')::numeric, 1600.00, 'EAC(2) = AC + (BAC − EV)');
select is((:'m'::jsonb ->> 'eac3')::numeric, 1975.51, 'EAC(3) = AC + (BAC − EV)/(CPI×SPI)');
select is((:'m'::jsonb ->> 'tcpi')::numeric, 1.1429, 'TCPI = (BAC − EV)/(BAC − AC)');
select is((:'m'::jsonb ->> 'es_days')::numeric, 3.20, 'Earned Schedule: EV=700 между PV 650 (3-й день) и 900 (4-й день)');
select is((:'m'::jsonb ->> 'spit')::numeric, 0.8000, 'SPI(t) = ES/AT = 3,2/4');
select is((:'m'::jsonb ->> 'forecast_days')::numeric, 15.0, 'прогноз длительности = 12 / 0,8');
select is((select count(*)::int from public.evm_series(:'zk7', date '2026-11-02', date '2026-11-13', 1)), 12, 'кривая PV: точка на каждый день');

-- ---- снимки ----
select public.create_snapshot(:'zk7', 'тест') as snap \gset
select is((select kind from public.snapshots where id = :'snap'), 'manual', 'ручной снимок создан');
select throws_ok(format($$update public.snapshots set note = 'x' where id = %L$$, :'snap'), '42501', null, 'снимок неизменяем');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.evm_calc(%L)$$, :'zk7'), '42501', null, 'без budget.view показатели недоступны');
select pg_temp.back();

select * from finish();
rollback;
