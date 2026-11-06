-- Требует сид-данных. Расписание повторных инспекций: отчёт создаётся заново раз в период, ритм сохраняется, открытый черновик не дублируется.
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as loc from public.locations where project_id = :'zk7' and deleted_at is null and kind = 'floor' order by path limit 1 \gset
select id as loc2 from public.locations where project_id = :'zk7' and deleted_at is null and kind = 'floor' order by path desc limit 1 \gset
delete from public.inspection_reports where project_id = :'zk7';
delete from public.inspection_schedules where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.inspection_schedule_save(:'zk7', null, :'loc', null, 'Этаж по графику', 14, current_date + 3) as s1 \gset
select is((select period_days || '/' || next_due::text || '/' || active::text from public.inspection_schedules where id = :'s1'), '14/' || (current_date + 3)::text || '/true', 'расписание создано: период, ближайший срок, включено');
select is((select inspector_id from public.inspection_schedules where id = :'s1'), (select id from public.users where email = 'pm1@demo.test'), 'инспектор — тот, кто завёл расписание');
select throws_ok(format($$select public.inspection_schedule_save(%L, null, %L, null, '', 7)$$, :'zk7', :'loc'), '23505', 'schedule_exists', 'на место одно расписание');
select throws_ok(format($$select public.inspection_schedule_save(%L, null, %L, null, '', 0)$$, :'zk7', :'loc2'), '22023', 'period_invalid', 'период меньше одного дня отклоняется');
select throws_ok(format($$select public.inspection_schedule_save(%L, null, %L, null, '', 400)$$, :'zk7', :'loc2'), '22023', 'period_invalid', 'период больше года отклоняется');
select throws_ok(format($$select public.inspection_schedule_save(%L, null, gen_random_uuid(), null, '', 7)$$, :'zk7'), 'P0002', 'location_not_found', 'место должно существовать');

-- срок ещё не наступил: задание ничего не создаёт
select pg_temp.back();
select is(private.inspection_schedules_run(), 0, 'до срока отчёт не создаётся');

-- «провести сейчас»
select pg_temp.act_as('pm1@demo.test');
select public.inspection_schedule_run(:'s1') as r1 \gset
select is((select status || '/' || inspection_date::text || '/' || schedule_id::text from public.inspection_reports where id = :'r1'), 'draft/' || current_date::text || '/' || :'s1', 'отчёт-черновик на сегодня связан с расписанием');
select is((select title from public.inspection_reports where id = :'r1'), 'Этаж по графику', 'название отчёта — из расписания');
select is((select count(*)::int from public.inspection_sections where report_id = :'r1'), 8, 'чек-лист из стандартных разделов');
select is((select next_due from public.inspection_schedules where id = :'s1'), current_date + 14, 'после «провести сейчас» период отсчитывается от сегодня');
select is(public.inspection_schedule_run(:'s1'), :'r1'::uuid, 'повторное «провести сейчас» возвращает открытый черновик');
select is((select count(*)::int from public.inspection_reports where schedule_id = :'s1'), 1, 'второго отчёта не появилось');

-- выдаём отчёт и просрочиваем срок на три периода с хвостом
select public.inspection_item_save((select id from public.inspection_sections where report_id = :'r1' and code = 'walls'), null, 'Принято', 'A');
select public.inspection_issue(:'r1');
select pg_temp.back();
update public.inspection_schedules set next_due = current_date - 30 where id = :'s1';
select is(private.inspection_schedules_run(), 1, 'просроченное расписание создало один отчёт');
select is((select next_due from public.inspection_schedules where id = :'s1'), current_date - 30 + 14 * 3, 'срок сдвинут на ближайшую границу периода: ритм сохранён');
select is((select count(*)::int from public.inspection_reports where schedule_id = :'s1' and status = 'draft'), 1, 'новый отчёт — черновик');

-- пока черновик открыт, новый не создаётся
update public.inspection_schedules set next_due = current_date - 1 where id = :'s1';
select is(private.inspection_schedules_run(), 0, 'открытый черновик не дублируется');

-- выключенное не срабатывает
update public.inspection_reports set status = 'issued' where schedule_id = :'s1';
update public.inspection_schedules set active = false where id = :'s1';
select is(private.inspection_schedules_run(), 0, 'выключенное расписание не срабатывает');

-- права: мастер видит, но не ведёт
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.inspection_schedule_save(%L, null, %L, null, '', 7)$$, :'zk7', :'loc2'), '42501', 'permission denied: inspection.conduct', 'расписание заводит только тот, кто ведёт инспекции');
select is((select count(*)::int from public.inspection_schedules where project_id = :'zk7'), 1, 'мастер расписание видит');

-- удаление прячет расписание
select pg_temp.act_as('pm1@demo.test');
select public.inspection_schedule_delete(:'s1');
select is((select count(*)::int from public.inspection_schedules where project_id = :'zk7'), 0, 'удалённое расписание не видно');

select * from finish();
rollback;
