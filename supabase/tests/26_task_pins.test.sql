-- Требует сид-данных. Замечания на плане: булавки задач, права, ревизия плана.
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
select id as bc2 from public.projects where code = 'BC2' \gset
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset

select pg_temp.act_as('pm1@demo.test');
-- план этажа 5: документ с файлом, привязан к месту, выпущен
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/plan-f5.pdf', 'План 5 этажа.pdf', 'application/pdf', 5000) returning id as fl \gset
select public.create_document(:'zk7', 'План 5 этажа', 'AR-05', 'plan', null, 'internal', false, :'fl', 'A', null,
                              array[:'f5']::uuid[], '{}', true) as doc \gset

-- ---- замечание на плане ----
select (public.create_task_on_plan(:'zk7', :'doc', 1, 0.25, 0.5, 'Скол в углу', 'punch', null, current_date + 3, 'high')).id as t1 \gset
select is((select location_id from public.tasks where id = :'t1'), :'f5'::uuid, 'место замечания — этаж, к которому привязан план');
select is((select type from public.tasks where id = :'t1'), 'punch', 'тип — замечание');
select is((select x::text || ',' || y::text from public.task_pins where task_id = :'t1'), '0.250000,0.500000', 'булавка поставлена в указанную точку');
select is((select version_id from public.task_pins where task_id = :'t1'), (select current_version_id from public.documents where id = :'doc'), 'булавка помнит ревизию плана');

-- ---- перемещение ----
select lives_ok(format($$select public.pin_task(%L, %L, 1, 0.8, 0.1)$$, :'t1', :'doc'), 'булавку можно передвинуть');
select is((select count(*)::int from public.task_pins where task_id = :'t1'), 1, 'булавка по-прежнему одна');
select throws_ok(format($$select public.pin_task(%L, %L, 1, 1.5, 0.1)$$, :'t1', :'doc'), '22023', 'position_invalid', 'точка вне страницы отклоняется');

-- новая ревизия: повторная постановка обновляет ревизию булавки
select public.add_document_version(:'doc', :'fl', 'B', 'Правки', true);
select public.pin_task(:'t1', :'doc', 1, 0.8, 0.1);
select is((select v.revision from public.task_pins p join public.document_versions v on v.id = p.version_id where p.task_id = :'t1'), 'B', 'после проверки положения булавка привязана к новой ревизии');

-- ---- область вместо точки ----
select lives_ok(format($$select public.pin_task(%L, %L, 1, 0.2, 0.3, 0.6, 0.7)$$, :'t1', :'doc'), 'замечание можно отметить областью');
select is((select x2::text || ',' || y2::text from public.task_pins where task_id = :'t1'), '0.600000,0.700000', 'второй угол области сохранён');
select throws_ok(format($$select public.pin_task(%L, %L, 1, 0.6, 0.7, 0.2, 0.3)$$, :'t1', :'doc'), '22023', 'position_invalid', 'область с перевёрнутыми углами отклоняется');
select throws_ok(format($$select public.pin_task(%L, %L, 1, 0.2, 0.3, 0.6, null)$$, :'t1', :'doc'), '22023', 'position_invalid', 'половина второго угла — тоже ошибка');
select public.pin_task(:'t1', :'doc', 1, 0.8, 0.1);
select pg_temp.back();

-- ---- права ----
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.pin_task(%L, %L, 1, 0.5, 0.5)$$, :'t1', :'doc'), '42501', null, 'чужую задачу без права правки двигать нельзя');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.task_pins), 0, 'внешний не видит булавки внутренних задач и планов');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.create_task_on_plan(%L, %L, 1, 0.5, 0.5, 'Чужой план')$$, :'bc2', :'doc'), 'P0002', 'document_not_found', 'план из другого проекта не подходит');

select public.unpin_task(:'t1', :'doc');
select is((select count(*)::int from public.task_pins where task_id = :'t1'), 0, 'булавку можно убрать, задача остаётся');
select is((select count(*)::int from public.tasks where id = :'t1' and deleted_at is null), 1, 'сама задача на месте');
select pg_temp.back();

select * from finish();
rollback;
