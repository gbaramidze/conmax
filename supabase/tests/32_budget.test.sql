-- Требует сид-данных. Бюджет: статьи, версии, утверждение, импорт, договоры, факт, прогноз, распределение, права.
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
-- тест не зависит от бюджета, который мог быть заведён вручную
delete from public.activity_budgets where project_id = :'zk7';
delete from public.budget_actuals where project_id = :'zk7';
delete from public.budget_commitments where project_id = :'zk7';
delete from public.budget_etc where project_id = :'zk7';
delete from public.budget_amounts where project_id = :'zk7';
delete from public.budget_versions where project_id = :'zk7';
delete from public.cbs_items where project_id = :'zk7';
delete from public.schedule_activities where project_id = :'zk7';

select pg_temp.act_as('economist@demo.test');
-- ---- статьи и черновик ----
select public.budget_upsert_item(:'zk7', null, null, '1', 'Строительные работы') as g \gset
select public.budget_upsert_item(:'zk7', null, :'g', '1.1', 'Монолит', 'subcontract') as m \gset
select public.budget_upsert_item(:'zk7', null, :'g', '1.2', 'Кладка', 'subcontract') as k \gset
select throws_ok(format($$select public.budget_upsert_item(%L, null, null, '1.1', 'Дубль')$$, :'zk7'), '23505', 'code_exists', 'код статьи уникален');
select throws_ok(format($$select public.budget_upsert_item(%L, %L, %L, '1', 'Строительные работы')$$, :'zk7', :'g', :'m'), '23514', 'cycle_in_hierarchy', 'статью нельзя поместить в свою вложенную');
select public.create_budget_draft(:'zk7') as v1 \gset
select throws_ok(format($$select public.create_budget_draft(%L)$$, :'zk7'), '23505', 'draft_exists', 'второй черновик не создаётся');
select public.set_budget_amount(:'v1', :'m', 1000000);
select public.set_budget_amount(:'v1', :'k', 500000.555);
select is((select amount from public.budget_amounts where version_id = :'v1' and item_id = :'k'), 500000.56, 'сумма округляется до копеек');
select throws_ok(format($$select public.approve_budget_version(%L)$$, :'v1'), '42501', null, 'утверждает только тот, у кого есть budget.approve');
select pg_temp.back();

-- ---- утверждение ----
select pg_temp.act_as('pm1@demo.test');
select public.approve_budget_version(:'v1', 'Исходный бюджет');
select is((select status from public.budget_versions where id = :'v1'), 'approved', 'версия утверждена');
select throws_ok(format($$select public.set_budget_amount(%L, %L, 1)$$, :'v1', :'m'), '23514', 'version_locked', 'утверждённую версию править нельзя');
select public.create_budget_draft(:'zk7', 'Изменение 1') as v2 \gset
select is((select amount from public.budget_amounts where version_id = :'v2' and item_id = :'m'), 1000000.00, 'черновик начинается с копии утверждённой версии');
select public.set_budget_amount(:'v2', :'m', 1200000);
select public.approve_budget_version(:'v2');
select is((select status from public.budget_versions where id = :'v1'), 'superseded', 'прежняя версия заменена');
select throws_ok(format($$select public.budget_delete_item(%L)$$, :'m'), '23514', 'item_in_use', 'статью с суммами утверждённых версий не удалить');
select pg_temp.back();

-- ---- договоры, факт, прогноз ----
select pg_temp.act_as('economist@demo.test');
select public.budget_save_commitment(:'zk7', null, :'m', 'Договор с ООО Монолит', 'ООО Монолит', 'Д-1', date '2026-09-01', 1300000) as c1 \gset
select public.budget_save_actual(:'zk7', null, :'m', 'act', 'КС-1', date '2026-10-10', 400000, 'ООО Монолит', :'c1') as a1 \gset
select throws_ok(format($$select public.budget_save_actual(%L, null, %L, 'act', 'X', current_date, 0)$$, :'zk7', :'m'), '22023', 'bad_amount', 'нулевой факт отклоняется');
select public.set_budget_etc(:'m', 900000, 'по графику платежей');
select is((select etc_amount from public.budget_etc where item_id = :'m'), 900000.00, 'прогноз остатка сохранён');
select is(public.import_budget(public.create_budget_draft(:'zk7', 'Импорт'), '[{"code":"2","name":"Инженерные системы","amount":0},{"code":"2.1","name":"ОВ","amount":250000.5,"cost_type":"materials"}]'::jsonb) ->> 'created', '2', 'импорт создал статьи по кодам (родитель — по префиксу)');
select pg_temp.back();

-- ---- распределение по работам ----
select pg_temp.act_as('pm1@demo.test');
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Монолит эт.1', 3) returning id as w1 \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Монолит эт.2', 1) returning id as w2 \gset
select is(public.allocate_budget(:'m', array[:'w1', :'w2']::uuid[], 'duration'), 1200000.00, 'распределяется сумма действующей версии');
select is((select amount from public.activity_budgets where activity_id = :'w1'), 900000.00, 'доля пропорциональна длительности');
select pg_temp.back();

-- ---- права и видимость ----
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.cbs_items), 0, 'без budget.view статей не видно');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.budget_commitments), 0, 'внешние договоры не видят');
select pg_temp.back();

select * from finish();
rollback;
