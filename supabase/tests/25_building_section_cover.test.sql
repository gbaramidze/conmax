-- Требует сид-данных. Разрез здания: сводка по этажам; фото проекта: права и видимость.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset
select id as f6 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F06' \gset
select count(*)::int as floors from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null \gset

select pg_temp.act_as('pm1@demo.test');

-- ---- разрез здания ----
select is(jsonb_array_length(public.building_section(:'zk7')), :floors, 'в разрезе по строке на каждый этаж проекта');
select is((select count(*)::int from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'building' = 'K1' and c ->> 'section' = 'S1'), 10, 'у корпуса с секциями этажи знают свою секцию');
select is((select count(*)::int from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'building' = 'K2' and c ->> 'section' is null), 16, 'у корпуса без секций секции нет');

-- замечание с просроченным сроком на этаже 5 и обычная задача на этаже 6
select (public.create_task(:'zk7', 'Трещина в стяжке', 'punch', null, current_date - 3, 'high', null, null, :'f5')).id as t1 \gset
select (public.create_task(:'zk7', 'Заказать окна', 'task', null, current_date + 5, 'normal', null, null, :'f6')).id as t2 \gset
select (c ->> 'open_tasks')::int as f5_open, (c ->> 'overdue')::int as f5_over, (c ->> 'punch')::int as f5_punch
  from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'path' = 'K1.S1.F05' \gset
select ok(:f5_open >= 1 and :f5_over >= 1 and :f5_punch >= 1, 'просроченное замечание видно на этаже 5');
select is((select (c ->> 'overdue')::int from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'path' = 'K1.S1.F06'), 0, 'задача со сроком в будущем не просрочена');
select ok((select (c ->> 'open_tasks')::int >= 1 from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'path' = 'K1.S1.F06'), 'но считается открытой');
select is((select (c ->> 'overdue')::int from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'path' = 'K1.S2.F05'), 0, 'соседняя секция не затронута');

-- готовность считается по вложенным помещениям и ничего не теряет
select ok((select count(*) from jsonb_array_elements(public.building_section(:'zk7')) c where (c ->> 'items')::int > 0) > 0, 'у части этажей есть объёмы и готовность');

-- закрытая задача уходит из счётчиков (статус меняем напрямую: цепочка переходов здесь не проверяется)
select (c ->> 'open_tasks')::int as f6_before from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'path' = 'K1.S1.F06' \gset
select pg_temp.back();
update public.tasks set status_category = 'done' where id = :'t2';
select pg_temp.act_as('pm1@demo.test');
select is((select (c ->> 'open_tasks')::int from jsonb_array_elements(public.building_section(:'zk7')) c where c ->> 'path' = 'K1.S1.F06'), :f6_before - 1, 'закрытая задача не считается открытой');
select pg_temp.back();

-- внешний участник: внутренние сведения не отдаются
select pg_temp.act_as('client@demo.test');
select ok((select bool_and(c -> 'discrepancies' = 'null'::jsonb and c -> 'last_walk' = 'null'::jsonb) from jsonb_array_elements(public.building_section(:'zk7')) c),
          'заказчику не отдаются расхождения и обходы');
select pg_temp.back();

-- ---- фото проекта ----
select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/cover.jpg', 'Фасад.jpg', 'image/jpeg', 90000) returning id as cv \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/plan.pdf', 'План.pdf', 'application/pdf', 90000) returning id as pdf \gset
select throws_ok(format($$select public.set_project_cover(%L, %L)$$, :'zk7', :'pdf'), '23503', 'file_not_found', 'обложкой может быть только изображение');
select lives_ok(format($$select public.set_project_cover(%L, %L)$$, :'zk7', :'cv'), 'руководитель ставит фото проекта');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.files where id = :'cv'), 1, 'фото проекта видят и внешние участники проекта');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.set_project_cover(%L, null)$$, :'zk7'), '42501', null, 'без права редактирования проекта фото не сменить');
select pg_temp.back();

select * from finish();
rollback;
