-- Требует сид-данных. График: зависимости, рабочие дни, критический путь, резервы, суммарные работы, базовый план.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
select id as f4 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F04' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset

-- тест не зависит от графика, который могли завести вручную: внутри транзакции начинаем с пустого
delete from public.schedule_activities where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
-- Корпус работ: сводная S → A (5 дн, старт пн 2 нояб), B (3 дн после A), C (6 дн после A), веха M после B и C, D (2 дн, старт через 2 дня после старта A)
insert into public.schedule_activities (project_id, name, kind) values (:'zk7', 'Каркас', 'summary') returning id as s \gset
insert into public.schedule_activities (project_id, parent_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', :'s', 'A Армирование', 5, 'snet', date '2026-11-02') returning id as a \gset
insert into public.schedule_activities (project_id, parent_id, name, duration_days) values (:'zk7', :'s', 'B Опалубка', 3) returning id as b \gset
insert into public.schedule_activities (project_id, parent_id, name, duration_days) values (:'zk7', :'s', 'C Бетонирование', 6) returning id as c \gset
insert into public.schedule_activities (project_id, parent_id, name, kind) values (:'zk7', :'s', 'M Приёмка', 'milestone') returning id as m \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'D Сопутствующая', 2) returning id as d \gset
insert into public.schedule_links (predecessor_id, successor_id) values (:'a', :'b');
insert into public.schedule_links (predecessor_id, successor_id) values (:'a', :'c');
insert into public.schedule_links (predecessor_id, successor_id) values (:'b', :'m');
insert into public.schedule_links (predecessor_id, successor_id) values (:'c', :'m');
insert into public.schedule_links (predecessor_id, successor_id, type, lag_days) values (:'a', :'d', 'SS', 2);

select is((public.recalculate_schedule(:'zk7') ->> 'critical')::int, 3, 'критических работ три: A, C и веха M');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'a'), '2026-11-02 2026-11-06', 'A: пн–пт, 5 рабочих дней');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'b'), '2026-11-09 2026-11-11', 'B начинается после A');
select is((select finish_date from public.schedule_activities where id = :'c'), date '2026-11-16', 'C: 6 рабочих дней пропускают выходные');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'m'), '2026-11-17 2026-11-17', 'веха — после самой поздней из работ');
select is((select total_float from public.schedule_activities where id = :'b'), 3, 'у B общий резерв 3 рабочих дня');
select is((select free_float from public.schedule_activities where id = :'b'), 3, 'и свободный резерв 3 дня');
select is((select is_critical from public.schedule_activities where id = :'b'), false, 'B не критическая');
select is((select is_critical from public.schedule_activities where id = :'c'), true, 'C критическая');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'d'), '2026-11-04 2026-11-05', 'связь «начало–начало» со сдвигом 2 дня');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'s'), '2026-11-02 2026-11-17', 'суммарная работа охватывает вложенные');
select is((select is_critical from public.schedule_activities where id = :'s'), true, 'суммарная критична, если критична вложенная');

-- защита от цикла и связей с суммарной работой
select throws_ok(format($$insert into public.schedule_links (predecessor_id, successor_id) values (%L, %L)$$, :'m', :'a'), '23514', 'cycle_detected', 'цикл запрещён');
select throws_ok(format($$insert into public.schedule_links (predecessor_id, successor_id) values (%L, %L)$$, :'s', :'d'), '23514', 'summary_link_not_allowed', 'связь с суммарной работой запрещена');
select throws_ok(format($$update public.schedule_activities set parent_id = %L where id = %L$$, :'a', :'s'), '23514', 'cycle_in_hierarchy', 'родитель не может стать потомком себя');

-- базовый план до сдвига
select public.create_schedule_baseline(:'zk7', 'Базовый', 'Утверждённый график') as bl \gset
select is((select count(*)::int from public.schedule_baseline_activities where baseline_id = :'bl'), 6, 'в базовый план попали все работы');

-- фактическое начало на день позже сдвигает последователей
update public.schedule_activities set actual_start = date '2026-11-03' where id = :'a';
select public.recalculate_schedule(:'zk7');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'a'), '2026-11-03 2026-11-09', 'A стартовала позже — сдвиг в прогнозе');
select is((select start_date from public.schedule_activities where id = :'b'), date '2026-11-10', 'B сдвинулась следом');
select is((select start_date from public.schedule_baseline_activities where activity_id = :'a'), date '2026-11-02', 'базовый план остался прежним');
update public.schedule_activities set actual_start = null where id = :'a';

-- генерация по этажам с лагом
select is(public.generate_schedule_by_locations(:'zk7', 'Монолит перекрытия', array[:'f4', :'f5']::uuid[], 4, 2, true), 2, 'создано по работе на каждый этаж');
select public.recalculate_schedule(:'zk7');
select is((select count(*)::int from public.schedule_links l join public.schedule_activities x on x.id = l.successor_id where x.name like 'Монолит перекрытия — %'), 1, 'этажи связаны цепочкой');
select is((select (select s.start_date from public.schedule_activities s where s.id = l.successor_id)
                  - (select p.finish_date from public.schedule_activities p where p.id = l.predecessor_id)
            from public.schedule_links l join public.schedule_activities x on x.id = l.successor_id where x.name like 'Монолит перекрытия — %'), 5,
          'между этажами лаг 2 рабочих дня: чт → вт (через выходные 5 календарных дней)');
select pg_temp.back();

-- шестидневка: суббота рабочая
update public.projects set settings = jsonb_set(coalesce(settings, '{}'), '{workdays}', '[1,2,3,4,5,6]') where id = :'zk7';
select pg_temp.act_as('pm1@demo.test');
select public.recalculate_schedule(:'zk7');
select is((select start_date || ' ' || finish_date from public.schedule_activities where id = :'c'), '2026-11-07 2026-11-13', 'при шестидневке суббота рабочая: C идёт с 7 по 13 ноября');
select pg_temp.back();
update public.projects set settings = settings - 'workdays' where id = :'zk7';

-- права
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$insert into public.schedule_activities (project_id, name) values (%L, 'Чужая')$$, :'zk7'), '42501', null, 'без schedule.edit работу не создать');
select throws_ok(format($$select public.recalculate_schedule(%L)$$, :'zk7'), '42501', null, 'и график не пересчитать');
select ok((select count(*)::int from public.schedule_activities) > 0, 'но смотреть график можно');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.schedule_activities), 0, 'внешний график не видит');
select pg_temp.back();

-- цикл через несколько связей находится и при расчёте не зависает: данные без цикла считаются повторно без ошибок
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.recalculate_schedule(%L)$$, :'zk7'), 'повторный расчёт проходит');
select pg_temp.back();

select * from finish();
rollback;
