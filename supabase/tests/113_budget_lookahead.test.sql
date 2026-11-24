-- Требует сид-данных. Раскладка бюджета по месяцам: импорт файла, прогноз, «разложить», закрытие месяцев, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
delete from public.budget_forecast where project_id = :'zk7';
delete from public.budget_settings where project_id = :'zk7';
delete from public.activity_budgets where project_id = :'zk7';
delete from public.budget_actuals where project_id = :'zk7';
delete from public.budget_commitments where project_id = :'zk7';
delete from public.budget_etc where project_id = :'zk7';
delete from public.budget_amounts where project_id = :'zk7';
delete from public.budget_versions where project_id = :'zk7';
delete from public.cbs_items where project_id = :'zk7';

-- ---- импорт файла раскладки ----
select pg_temp.act_as('economist@demo.test');
select public.create_budget_draft(:'zk7', 'V7') as v \gset
select public.import_budget_lookahead(:'v', $j${
  "items": [
    {"code": "1", "name": "Каркас", "amount": 0, "alt_name": "კარკასი"},
    {"code": "1.1", "name": "Монолит", "amount": 1000},
    {"code": "1.10", "name": "Механизмы", "amount": 300, "source_code": "1.1"}],
  "actuals": [
    {"item_code": "1.1", "month": "2026-01-01", "amount": 100},
    {"item_code": "1.1", "month": "2026-02-01", "amount": 150},
    {"item_code": "1.10", "month": "2026-02-01", "amount": 0}],
  "forecast": [
    {"item_code": "1.1", "month": "2026-03-01", "amount": 400},
    {"item_code": "1.1", "month": "2026-01-01", "amount": 999},
    {"item_code": "1.10", "month": "2026-04-01", "amount": 300}],
  "closed_through": "2026-02-01",
  "replace_actuals": true}$j$::jsonb) as res \gset
select is((:'res'::jsonb ->> 'actuals')::int, 2, 'факт загружен, нулевые месяцы пропущены');
select is((:'res'::jsonb ->> 'forecast')::int, 2, 'прогноз загружен только в открытые месяцы');
select is((select alt_name from public.cbs_items where project_id = :'zk7' and code = '1'), 'კარკასი', 'второе название статьи сохранено');
select is((select source_code from public.cbs_items where project_id = :'zk7' and code = '1.10'), '1.1', 'исправленный код помнит код из файла');
select is((select min(doc_date) from public.budget_actuals where project_id = :'zk7' and deleted_at is null), date '2026-01-31', 'факт месяца ложится на конец месяца');
select is((select closed_through from public.budget_settings where project_id = :'zk7'), date '2026-02-01', 'граница закрытых месяцев из файла');

select public.import_budget_lookahead(:'v', $j${
  "items": [{"code": "1.1", "name": "Монолит", "amount": 1000}],
  "actuals": [{"item_code": "1.1", "month": "2026-01-01", "amount": 100}, {"item_code": "1.1", "month": "2026-02-01", "amount": 150}],
  "forecast": [{"item_code": "1.1", "month": "2026-03-01", "amount": 400}],
  "replace_actuals": true}$j$::jsonb);
select is((select count(*)::int from public.budget_actuals where project_id = :'zk7' and deleted_at is null), 2, 'повторный импорт заменяет перенесённый факт, а не удваивает');
select is((select sum(amount) from public.budget_forecast where project_id = :'zk7'), 700.00, 'повторный импорт заменяет прогноз статей из файла');

-- ---- прогноз по месяцам ----
select id as mono from public.cbs_items where project_id = :'zk7' and code = '1.1' \gset
select throws_ok(format($$select public.set_budget_forecast(%L, date '2026-02-10', 10)$$, :'mono'), '23514', 'month_closed', 'закрытый месяц не правится');
select public.set_budget_forecast(:'mono', date '2026-05-17', 50);
select is((select amount from public.budget_forecast where item_id = :'mono' and month = date '2026-05-01'), 50.00, 'прогноз ложится на первое число месяца');
select public.set_budget_forecast(:'mono', date '2026-05-01', 0);
select is((select count(*)::int from public.budget_forecast where item_id = :'mono' and month = date '2026-05-01'), 0, 'ноль убирает прогноз месяца');

-- ---- «разложить» ----
select public.spread_budget_forecast(:'mono', date '2026-03-01', 3, 750, 'equal');
select is((select array_agg(amount order by month) from public.budget_forecast where item_id = :'mono'), array[250.00, 250.00, 250.00]::numeric[], 'поровну на 3 месяца, прежний прогноз заменён');
select public.spread_budget_forecast(:'mono', date '2026-03-01', 4, 1000.01, 'scurve');
select is((select sum(amount) from public.budget_forecast where item_id = :'mono'), 1000.01, 'колокол: сумма сходится до копейки');
select ok((select max(amount) filter (where month = date '2026-04-01') > max(amount) filter (where month = date '2026-03-01') from public.budget_forecast where item_id = :'mono'),
          'колокол: в середине срока больше, чем в начале');

-- ---- закрытие месяца ----
select public.close_budget_month(:'zk7', date '2026-03-15');
select is((select closed_through from public.budget_settings where project_id = :'zk7'), date '2026-03-01', 'март закрыт');
select is((select count(*)::int from public.budget_forecast where item_id = :'mono' and month = date '2026-03-01'), 1, 'прогноз закрытого месяца остаётся как история');
select throws_ok(format($$select public.close_budget_month(%L, current_date)$$, :'zk7'), '23514', 'month_not_over', 'текущий месяц закрыть нельзя');
select throws_ok(format($$select public.reopen_budget_month(%L)$$, :'zk7'), '42501', null, 'открыть месяц снова может только утверждающий');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is(public.reopen_budget_month(:'zk7'), date '2026-03-01', 'утверждающий открыл март снова');
select is((select closed_through from public.budget_settings where project_id = :'zk7'), date '2026-02-01', 'граница вернулась на февраль');
select pg_temp.back();

-- ---- удаление статьи и права ----
select pg_temp.act_as('economist@demo.test');
select public.budget_upsert_item(:'zk7', null, null, '9', 'Пробная') as tmp \gset
select public.set_budget_forecast(:'tmp', date '2026-12-01', 10);
select public.budget_delete_item(:'tmp');
select is((select count(*)::int from public.budget_forecast where item_id = :'tmp'), 0, 'удаление статьи убирает её прогноз');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.budget_forecast), 0, 'без budget.view прогноза не видно');
select pg_temp.back();

select * from finish();
rollback;
