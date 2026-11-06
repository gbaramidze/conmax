-- Требует сид-данных. План объёмов, обходы с контролем полноты, факт, видимость для подрядчика, импорт.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
select id as f4 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F04' \gset
select id as sub_org from public.organizations where name = 'МонолитСтрой' \gset
select id as glass5 from public.work_items where location_id = :'f5' and name = 'Монтаж стеклопакетов' \gset

-- 1. План: кто может вести
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$insert into public.work_items (project_id, location_id, name, unit, planned_qty) values (%L, %L, 'Тест', 'м²', 10)$$, :'zk7', :'f5'),
                 '42501', null, 'прораб не может вносить план объёмов');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$insert into public.work_items (project_id, location_id, contractor_org_id, name, unit, planned_qty) values (%L, %L, %L, 'Окраска', 'м²', 200)$$, :'zk7', :'f5', :'sub_org'),
                'РП вносит позицию плана');
select throws_ok(format($$insert into public.work_items (project_id, location_id, name, unit, planned_qty) values (%L, %L, 'Отриц', 'м²', -1)$$, :'zk7', :'f5'),
                 '23514', null, 'отрицательный план отклоняется');
select pg_temp.back();

-- 2. Подрядчик видит только свои позиции
select pg_temp.act_as('sub1@demo.test');
select ok((select count(*) from public.work_items) > 0, 'подрядчик видит свои позиции');
select is((select count(*)::int from public.work_items where contractor_org_id is distinct from :'sub_org'), 0, 'подрядчик не видит позиции других организаций');
select pg_temp.back();

-- 3. Обход прораба на 5 этаже
select coalesce(done_qty, 0) as done_before from public.work_items_progress where id = :'glass5' \gset
select pg_temp.act_as('foreman1@demo.test');
select id as walk from public.start_walk(:'zk7', :'f5') \gset
select is((select id from public.start_walk(:'zk7', :'f5')), :'walk'::uuid, 'повторный старт возвращает тот же черновик');
select throws_ok(format($$select public.submit_walk(%L)$$, :'walk'), '22023', 'walk_incomplete', 'нельзя завершить обход, пока не заполнены все позиции');

-- заполняем все ожидаемые позиции: стеклопакеты — 30, остальные «не работали»
select public.save_walk_result(:'walk', :'glass5', 'progress', 30);
select public.save_walk_result(:'walk', wi.id, 'no_work')
  from public.work_items wi where wi.location_id = :'f5' and wi.id <> :'glass5' and wi.status = 'active' and wi.deleted_at is null;
select throws_ok(format($$select public.save_walk_result(%L, %L, 'progress', 0)$$, :'walk', :'glass5'), '22023', 'qty_required', 'факт без положительного объёма отклоняется');
select throws_ok(format($$select public.save_walk_result(%L, %L, 'blocked')$$, :'walk', :'glass5'), '22023', 'reason_required', '«не удалось» требует причину');
select throws_ok(format($$select public.save_walk_result(%L, (select id from public.work_items where location_id = %L limit 1), 'no_work')$$, :'walk', :'f4'),
                 '22023', 'item_not_expected', 'позиции другого этажа в этот обход не входят');
select lives_ok(format($$select public.submit_walk(%L)$$, :'walk'), 'при полном заполнении обход завершается');
select is((select done_qty from public.work_items_progress where id = :'glass5'), :'done_before'::numeric + 30, 'факт накапливается приращением: +30');
select pg_temp.back();

-- 4. Подтверждение факта (настройка проекта)
select pg_temp.act_as('pm1@demo.test');
update public.projects set settings = settings || '{"progress_approval": true}' where id = :'zk7';
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select id as walk2 from public.start_walk(:'zk7', :'f5') \gset
select public.save_walk_result(:'walk2', :'glass5', 'progress', 20);
select public.save_walk_result(:'walk2', wi.id, 'no_work')
  from public.work_items wi where wi.location_id = :'f5' and wi.id <> :'glass5' and wi.status = 'active' and wi.deleted_at is null;
select public.submit_walk(:'walk2');
select is((select pending_qty from public.work_items_progress where id = :'glass5'), 20::numeric, 'при включённом подтверждении факт ждёт подтверждения');
select throws_ok(format($$select public.approve_walk(%L)$$, :'walk2'), '42501', null, 'прораб не может подтверждать факт');
select pg_temp.back();
select pg_temp.act_as('pto@demo.test');
select lives_ok(format($$select public.approve_walk(%L)$$, :'walk2'), 'ПТО подтверждает факт');
select pg_temp.back();

-- 5. Импорт
select pg_temp.act_as('pm1@demo.test');
select is((public.import_work_items(:'zk7', '[{"location":"K1.S1.F05","discipline":"AR","contractor":"МонолитСтрой","name":"Грунтовка","unit":"м²","qty":"120,5"},{"location":"NOPE","name":"Х","unit":"м²","qty":"1"}]'::jsonb, true) -> 'errors' -> 0 ->> 'row')::int,
          2, 'импорт: ошибочная строка найдена и указана по номеру');
select pg_temp.back();

select * from finish();
rollback;
