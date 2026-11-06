-- Требует сид-данных. Сигналы: правила, дедупликация, автозакрытие, отклонение, действия, индекс здоровья, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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
delete from public.signals where project_id = :'zk7';
delete from public.snapshots where project_id = :'zk7';
delete from public.activity_budgets where project_id = :'zk7';
delete from public.budget_actuals where project_id = :'zk7';
delete from public.budget_commitments where project_id = :'zk7';
delete from public.budget_etc where project_id = :'zk7';
delete from public.budget_amounts where project_id = :'zk7';
delete from public.budget_versions where project_id = :'zk7';
delete from public.cbs_items where project_id = :'zk7';
delete from public.planning_periods where project_id = :'zk7';
delete from public.schedule_baselines where project_id = :'zk7';
delete from public.schedule_activities where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
-- работа критического пути, закончить которую должны были в сентябре
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', 'Старая работа', 3, 'snet', date '2026-09-01') returning id as a \gset
select public.recalculate_schedule(:'zk7');

-- ---- правила и дедупликация ----
select public.evaluate_signals(:'zk7');
select is((select count(*)::int from public.signals where project_id = :'zk7' and rule = 'critical_activity_overdue' and status = 'open'), 1, 'просроченная работа критического пути поднимает сигнал');
select is((select count(*)::int from public.signals where project_id = :'zk7' and rule = 'baseline_missing' and status = 'open'), 1, 'нет базового плана — сигнал');
select public.evaluate_signals(:'zk7');
select is((select count(*)::int from public.signals where project_id = :'zk7' and rule = 'critical_activity_overdue'), 1, 'повторный расчёт не плодит дубликаты');

-- ---- автозакрытие ----
select public.create_schedule_baseline(:'zk7', 'Базовый');
select public.evaluate_signals(:'zk7');
select is((select status || ':' || auto_resolved from public.signals where project_id = :'zk7' and rule = 'baseline_missing'), 'resolved:true', 'условие исчезло — сигнал закрыт системой');

-- ---- отклонение ----
select id as sig from public.signals where project_id = :'zk7' and rule = 'critical_activity_overdue' \gset
select throws_ok(format($$select public.signal_dismiss(%L, 'wrong')$$, :'sig'), '22023', 'bad_reason', 'причина отклонения из списка');
select public.signal_dismiss(:'sig', 'known', 7);
select public.evaluate_signals(:'zk7');
select is((select count(*)::int from public.signals where project_id = :'zk7' and rule = 'critical_activity_overdue' and status = 'open'), 0, 'отклонённый сигнал не поднимается, пока не истёк срок');

-- ---- стоимость: прогноз выше бюджета на 20% ----
select public.budget_upsert_item(:'zk7', null, null, '1', 'Работы') as i1 \gset
select public.create_budget_draft(:'zk7') as v \gset
select public.set_budget_amount(:'v', :'i1', 1000);
select public.approve_budget_version(:'v');
select public.budget_save_actual(:'zk7', null, :'i1', 'act', 'А-1', current_date, 1200);
select public.evaluate_signals(:'zk7');
select is((select severity from public.signals where project_id = :'zk7' and rule = 'eac_over_budget' and status = 'open'), 'critical', 'прогноз выше бюджета на 20% — критический сигнал');

-- ---- действия ----
select id as sig2 from public.signals where project_id = :'zk7' and rule = 'eac_over_budget' and status = 'open' \gset
select public.signal_create_task(:'sig2', 'Подготовить меры по экономии') as tid \gset
select is((select task_id from public.signals where id = :'sig2'), :'tid'::uuid, 'из сигнала создана задача, связь сохранена');
select public.signal_assign(:'sig2', (select id from public.users where email = 'gip@demo.test'));
select is((select assignee_id from public.signals where id = :'sig2'), (select id from public.users where email = 'gip@demo.test'), 'сигнал назначен ответственному');
select public.signal_feedback(:'sig2', true);
select is((select useful from public.signals where id = :'sig2'), true, 'отметка «полезно» сохранена');

-- ---- индекс здоровья ----
select ok((select score between 0 and 100 from public.project_health where project_id = :'zk7'), 'индекс здоровья посчитан');
select ok((select jsonb_array_length(components) >= 2 from public.project_health where project_id = :'zk7'), 'у индекса есть разложение по компонентам');
select pg_temp.back();

-- ---- права и видимость ----
select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$select public.evaluate_signals(%L)$$, :'zk7'), '42501', null, 'наблюдатель пересчитывать сигналы не может');
select ok((select count(*) from public.signals) > 0, 'но видит ленту сигналов');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.signals), 0, 'внешние сигналы не видят');
select pg_temp.back();

select * from finish();
rollback;
