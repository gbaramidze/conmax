-- Требует сид-данных. Зоны на планах: рисование, проверка точек, права, данные места (мебель и задачи, в том числе внутри этажа).
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as floor7 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F07' \gset

-- два помещения на этаже с мебелью, документ-план
select set_config('request.jwt.claims', json_build_object('tenant_id', :'tenant', 'sub', :'pm1')::text, true);
insert into public.locations (project_id, parent_id, kind, code, name, sort) values
  (:'zk7', :'floor7', 'room', 'T60A', 'Номер 7001', 1), (:'zk7', :'floor7', 'room', 'T60B', 'Номер 7002', 2);
select id as ra from public.locations where parent_id = :'floor7' and code = 'T60A' \gset
select id as rb from public.locations where parent_id = :'floor7' and code = 'T60B' \gset
insert into public.ffe_items (tenant_id, project_id, code, name, category, unit) values (:'tenant', :'zk7', 'T60-BED', 'Кровать', 'Кровати', 'шт');
select id as item from public.ffe_items where project_id = :'zk7' and code = 'T60-BED' \gset
insert into public.room_ffe (tenant_id, project_id, location_id, item_id, qty, status) values
  (:'tenant', :'zk7', :'ra', :'item', 2, 'installed'), (:'tenant', :'zk7', :'rb', :'item', 2, 'planned');
select id as doc from public.documents where project_id = :'zk7' and deleted_at is null limit 1 \gset
select set_config('request.jwt.claims', '', true);

select pg_temp.act_as('pm1@demo.test');
select public.plan_zone_set(:'zk7', :'doc', 1, :'ra', '[[0.1,0.1],[0.3,0.1],[0.3,0.3],[0.1,0.3]]'::jsonb) as za \gset
select public.plan_zone_set(:'zk7', :'doc', 1, :'rb', '[[0.4,0.1],[0.6,0.1],[0.6,0.3]]'::jsonb) as zb \gset
select is((select count(*)::int from public.plan_zones where document_id = :'doc'), 2, 'две зоны нарисованы');
select is(public.plan_zone_set(:'zk7', :'doc', 1, :'ra', '[[0.1,0.1],[0.35,0.1],[0.35,0.35],[0.1,0.35]]'::jsonb), :'za'::uuid, 'повторное рисование обновляет зону, а не плодит новые');
select is((select count(*)::int from public.plan_zones where document_id = :'doc'), 2, 'зон по-прежнему две');
select throws_ok(format($$select public.plan_zone_set(%L, %L, 1, %L, '[[0.1,0.1],[0.3,0.1]]'::jsonb)$$, :'zk7', :'doc', :'ra'), '22023', 'position_invalid', 'меньше трёх точек — не зона');
select throws_ok(format($$select public.plan_zone_set(%L, %L, 1, %L, '[[0.1,0.1],[1.5,0.1],[0.3,0.3]]'::jsonb)$$, :'zk7', :'doc', :'ra'), '22023', 'position_invalid', 'точка вне листа отвергается');
select throws_ok(format($$select public.plan_zone_set(%L, %L, 0, %L, '[[0.1,0.1],[0.3,0.1],[0.3,0.3]]'::jsonb)$$, :'zk7', :'doc', :'ra'), '22023', 'position_invalid', 'страница должна быть положительной');

-- данные места: мебель своя у помещения, сумма — у этажа
select public.plan_zone_set(:'zk7', :'doc', 1, :'floor7', '[[0.05,0.05],[0.9,0.05],[0.9,0.9],[0.05,0.9]]'::jsonb);
select is((select ffe_installed || '/' || ffe_total from public.plan_zones(:'doc') where location_id = :'ra'), '2/2', 'у помещения своя мебель');
select ok((select ffe_total >= 4 from public.plan_zones(:'doc') where location_id = :'floor7'), 'у этажа — сумма по помещениям внутри');
select is(public.plan_zone_set_many(:'zk7', :'doc', 1, array[:'ra', :'rb', :'ra']::uuid[], '[[0.5,0.5],[0.7,0.5],[0.7,0.7]]'::jsonb), 2, 'типовой контур ставится разом на несколько мест, повторы не считаются');
select is((select count(*)::int from public.plan_zones where document_id = :'doc' and points = '[[0.5,0.5],[0.7,0.5],[0.7,0.7]]'::jsonb), 2, 'зоны есть у обоих мест');
select throws_ok(format($$select public.plan_zone_set_many(%L, %L, 1, array[%L]::uuid[], '[[0.5,0.5],[2,0.5],[0.7,0.7]]'::jsonb)$$, :'zk7', :'doc', :'ra'), '22023', 'position_invalid', 'неверный контур отвергается и при пакетной постановке');
select pg_temp.back();

-- права
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.plan_zone_delete(%L)$$, :'za'), '42501', null, 'без права управлять структурой зону не удалить');
select is((select count(*)::int from public.plan_zones(:'doc')), 3, 'но смотреть зоны можно');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.plan_zone_delete(%L)$$, :'zb'), 'руководитель удаляет зону');
select is((select count(*)::int from public.plan_zones where document_id = :'doc'), 2, 'зон стало меньше');
select pg_temp.back();

select * from finish();
rollback;
