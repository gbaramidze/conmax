-- Требует сид-данных. Независимая проверка факта, расхождения, автопринятие, сводка прогресса.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as sub_org from public.organizations where name = 'МонолитСтрой' \gset

-- Вердикт сверки: относительно значения, шум 0,5 % плана
select is(private.check_verdict(:'zk7', 400, 30, 28), 'match', 'вердикт: 28 вместо 30 — совпало (7 %)');
select is(private.check_verdict(:'zk7', 400, 30, 25), 'minor', 'вердикт: 25 вместо 30 — расхождение (17 %)');
select is(private.check_verdict(:'zk7', 400, 30, 10), 'major', 'вердикт: 10 вместо 30 — серьёзное (67 %), хотя от плана лишь 5 %');
select is(private.check_verdict(:'zk7', 400, 0, 1.5), 'match', 'вердикт: 1,5 при плане 400 — шум измерения');

-- Чистый сценарий: весь прежний план проекта отменяем, заводим три позиции
update public.work_items set status = 'cancelled' where project_id = :'zk7';
delete from public.work_progress where project_id = :'zk7';
delete from public.work_checks where project_id = :'zk7';

insert into public.work_items (tenant_id, project_id, location_id, contractor_org_id, name, unit, planned_qty, weight, planned_start, planned_finish)
values (:'tenant', :'zk7', :'f5', :'sub_org', 'T-стекло', 'м²', 150, 3, current_date - 10, current_date + 10);
insert into public.work_items (tenant_id, project_id, location_id, name, unit, planned_qty, weight)
values (:'tenant', :'zk7', :'f5', 'T-штукатурка', 'м²', 400, 1);
insert into public.work_items (tenant_id, project_id, location_id, name, unit, planned_qty)
values (:'tenant', :'zk7', :'f5', 'T-пол', 'м²', 100);
select id as glass from public.work_items where project_id = :'zk7' and name = 'T-стекло' \gset
select id as plaster from public.work_items where project_id = :'zk7' and name = 'T-штукатурка' \gset
select id as floor_item from public.work_items where project_id = :'zk7' and name = 'T-пол' \gset

insert into public.work_progress (tenant_id, project_id, work_item_id, qty, reported_by, approved_by, approved_at)
values (:'tenant', :'zk7', :'glass', 75, :'pm1', :'pm1', now()),
       (:'tenant', :'zk7', :'plaster', 100, :'pm1', :'pm1', now());

-- 1. Сводка: вес у «пола» не задан — берётся среднее заданных (3 и 1 → 2)
select pg_temp.act_as('pm1@demo.test');
select is((public.project_dashboard(:'zk7') -> 'totals' ->> 'percent')::numeric, 29.2::numeric,
          'прогресс взвешенный: (3×50 % + 1×25 % + 2×0 %) / 6 = 29,2 %');
select is((public.project_dashboard(:'zk7') -> 'totals' ->> 'items')::int, 3, 'в сводке три активные позиции (отменённые не считаются)');
select is((public.project_dashboard(:'zk7') -> 'plan' ->> 'plan')::numeric, 50::numeric, 'план на сегодня по позиции со сроками: середина окна = 50 %');
select is((public.project_dashboard(:'zk7') -> 'plan' ->> 'coverage')::numeric, 50::numeric, 'охват сроками — 50 % веса');
select is(jsonb_array_length(public.project_dashboard(:'zk7') -> 'series'), 12, 'динамика — 12 недельных точек');
select ok((public.project_dashboard(:'zk7') -> 'by_location') @> '[{"path": "K1.S1.F05"}]', 'срез по месту включает этаж 5');
select pg_temp.back();

-- 2. Подрядчик не проводит проверок, не видит расхождений и чужого прогресса
select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.start_walk(%L, %L, 'check')$$, :'zk7', :'f5'), '42501', null, 'подрядчик не может начать проверку');
select is((public.project_dashboard(:'zk7') -> 'totals' ->> 'items')::int, 1, 'подрядчик видит в сводке только свою позицию');
select is(public.project_dashboard(:'zk7') -> 'attention', 'null'::jsonb, 'блок «внимание» подрядчику не отдаётся');
select pg_temp.back();

-- 3. Проверка ПТО: слепой ввод итога, полнота, допустимые исходы
select pg_temp.act_as('pto@demo.test');
select id as chk1 from public.start_walk(:'zk7', :'f5', 'check') \gset
select is((select kind from public.site_walks where id = :'chk1'), 'check', 'создана проверка, а не отчёт');
select is((select count(*)::int from private.walk_expected_items((select w from public.site_walks w where w.id = :'chk1'))),
          2, 'в проверку попадают только позиции с заявленным фактом (без «T-пол»)');
select throws_ok(format($$select public.save_walk_result(%L, %L, 'progress', 5)$$, :'chk1', :'glass'), '22023', 'invalid_result', 'в проверке нельзя вносить приращение');
select throws_ok(format($$select public.save_walk_result(%L, %L, 'observed')$$, :'chk1', :'glass'), '22023', 'qty_required', 'итог на месте обязателен');
select throws_ok(format($$select public.submit_walk(%L)$$, :'chk1'), '22023', 'walk_incomplete', 'проверку нельзя завершить, пока не измерено всё');
select public.save_walk_result(:'chk1', :'glass', 'observed', 75);
select public.save_walk_result(:'chk1', :'plaster', 'observed', 40);
select lives_ok(format($$select public.submit_walk(%L)$$, :'chk1'), 'проверка завершается при полном заполнении');
select pg_temp.back();

select is((select verdict from public.work_checks where work_item_id = :'glass'), 'match', 'стекло: 75 = 75 — совпало');
select is((select verdict from public.work_checks where work_item_id = :'plaster'), 'major', 'штукатурка: заявлено 100, на месте 40 — серьёзное расхождение');
select is((select verification from public.work_items_progress where id = :'glass'), 'verified', 'стекло — проверено');
select is((select verification from public.work_items_progress where id = :'plaster'), 'disputed', 'штукатурка — спорная');
-- несколько расхождений подряд схлопываются в одно уведомление («расхождений: N»)
select ok(exists (select 1 from public.notifications where user_id = :'pm1' and category = 'escalation'
                    and (body like 'Расхождение:%' or body like '%расхождений: %')),
          'руководитель проекта уведомлён о расхождении');

-- 4. Новая проверка заменяет прежнее открытое расхождение; решение «принять проверенное» корректирует факт
select pg_temp.act_as('pto@demo.test');
select id as chk2 from public.start_walk(:'zk7', :'f5', 'check') \gset
select public.save_walk_result(:'chk2', :'glass', 'observed', 75);
select public.save_walk_result(:'chk2', :'plaster', 'observed', 20);
select public.submit_walk(:'chk2');
select pg_temp.back();
select is((select count(*)::int from public.work_checks where work_item_id = :'plaster' and verdict <> 'match' and resolution is null), 1,
          'открытое расхождение по позиции одно');
select is((select count(*)::int from public.work_checks where work_item_id = :'plaster' and resolution = 'superseded'), 1, 'прежнее расхождение заменено новой проверкой');

select pg_temp.act_as('pto@demo.test');
select throws_ok(format($$select public.resolve_discrepancy(%L, 'accept_reported')$$,
                        (select id from public.work_checks where work_item_id = :'plaster' and resolution is null)),
                 '22023', 'comment_required', 'принять заявленное без комментария нельзя');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.resolve_discrepancy(%L, 'accept_observed')$$,
                        (select id from public.work_checks where work_item_id = :'plaster' and resolution is null)),
                 '42501', null, 'прораб не решает расхождения');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.resolve_discrepancy(%L, 'accept_observed')$$,
                       (select id from public.work_checks where work_item_id = :'plaster' and resolution is null)),
                'РП принимает проверенный итог');
select pg_temp.back();
select is((select done_qty from public.work_items_progress where id = :'plaster'), 20::numeric, 'факт скорректирован до проверенного: 100 − 80 = 20');
select is((select count(*)::int from public.work_progress where work_item_id = :'plaster' and kind = 'correction' and qty = -80), 1, 'корректировка записана отдельной строкой, история цела');
select is((select verification from public.work_items_progress where id = :'plaster'), 'verified', 'после принятия проверенного позиция проверена');

-- 5. «Принять заявленное»: нужен комментарий; факт не меняется
select pg_temp.act_as('pto@demo.test');
select id as chk3 from public.start_walk(:'zk7', :'f5', 'check') \gset
select public.save_walk_result(:'chk3', :'glass', 'observed', 75);
select public.save_walk_result(:'chk3', :'plaster', 'observed', 5);
select public.submit_walk(:'chk3');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.resolve_discrepancy((select id from public.work_checks where work_item_id = :'plaster' and resolution is null), 'accept_reported', 'Часть работ скрыта под отделкой');
select pg_temp.back();
select is((select done_qty from public.work_items_progress where id = :'plaster'), 20::numeric, 'при «принять заявленное» факт не меняется');
select is((select verification from public.work_items_progress where id = :'plaster'), 'accepted', 'позиция помечена «принято решением»');

-- 6. Совпавшая независимая проверка принимает ожидающий факт; зависимая — нет
select pg_temp.act_as('pm1@demo.test');
update public.projects set settings = settings || '{"progress_approval": true}' where id = :'zk7';
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select id as rep from public.start_walk(:'zk7', :'f5') \gset
select public.save_walk_result(:'rep', :'glass', 'progress', 10);
select public.save_walk_result(:'rep', :'plaster', 'no_work');
select public.save_walk_result(:'rep', :'floor_item', 'no_work');
select public.submit_walk(:'rep');
select id as self from public.start_walk(:'zk7', :'f5', 'check') \gset
select public.save_walk_result(:'self', :'glass', 'observed', 85);
select public.save_walk_result(:'self', :'plaster', 'observed', 20);
select public.submit_walk(:'self');
select pg_temp.back();
select is((select independent from public.work_checks where walk_id = :'self' and work_item_id = :'glass'), false, 'прораб проверил то, что сам заявил, — проверка зависимая');
select is((select pending_qty from public.work_items_progress where id = :'glass'), 10::numeric, 'зависимая проверка факт не принимает');
select pg_temp.act_as('pto@demo.test');
select id as chk4 from public.start_walk(:'zk7', :'f5', 'check') \gset
select public.save_walk_result(:'chk4', :'glass', 'observed', 85);
select public.save_walk_result(:'chk4', :'plaster', 'observed', 20);
select public.submit_walk(:'chk4');
select pg_temp.back();
select is((select pending_qty from public.work_items_progress where id = :'glass'), 0::numeric, 'независимое совпадение принимает ожидающий факт');
select is((select status from public.site_walks where id = :'rep'), 'approved', 'отчёт прораба закрыт автоматически, когда принят весь его факт');

select * from finish();
rollback;
