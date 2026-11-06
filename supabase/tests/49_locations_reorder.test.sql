-- Требует сид-данных. Порядок узлов структуры: перестановка соседей, этажи — только по номеру, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
select id as k1 from public.locations where project_id = :'zk7' and path::text = 'K1' \gset
select id as k2 from public.locations where project_id = :'zk7' and path::text = 'K2' \gset
select id as s1 from public.locations where project_id = :'zk7' and path::text = 'K1.S1' \gset
select id as s2 from public.locations where project_id = :'zk7' and path::text = 'K1.S2' \gset
select id as f7 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F07' \gset

select pg_temp.act_as('pm1@demo.test');
-- позже добавленный узел верхнего уровня (например, «Паркинг») встаёт в конец
insert into public.locations (project_id, parent_id, kind, code, name, sort) values (:'zk7', null, 'zone', 'T49PARK', 'Паркинг', 3);
select id as park from public.locations where project_id = :'zk7' and code = 'T49PARK' \gset
select is((select array_agg(code order by coalesce(position, sort)) from public.locations where project_id = :'zk7' and parent_id is null and deleted_at is null), array['K1','K2','T49PARK'], 'новый узел в конце');

-- и переставляется в начало
select is(public.locations_reorder(:'zk7', null, array[:'park', :'k1', :'k2']::uuid[]), 3, 'порядок задан');
select is((select array_agg(code order by coalesce(position, sort)) from public.locations where project_id = :'zk7' and parent_id is null and deleted_at is null), array['T49PARK','K1','K2'], 'паркинг теперь первый');

-- секции внутри корпуса
select is(public.locations_reorder(:'zk7', :'k1', array[:'s2', :'s1']::uuid[]), 2, 'секции переставлены');
select is((select array_agg(code order by coalesce(position, sort)) from public.locations where parent_id = :'k1' and deleted_at is null), array['S2','S1'], 'S2 перед S1');

-- ошибки: неполный список, этажи вразнобой
select throws_ok(format($$select public.locations_reorder(%L, %L, array[%L]::uuid[])$$, :'zk7', :'k1', :'s1'), '22023', 'order must list all siblings', 'нужен полный список соседей');

-- корпус с этажами и «паркингом» рядом: паркинг встаёт до этажей, между ними и после
insert into public.locations (project_id, parent_id, kind, code, name, sort) values (:'zk7', :'s1', 'zone', 'T49Z', 'Паркинг', 999);
select id as zone from public.locations where parent_id = :'s1' and code = 'T49Z' \gset
select array_agg(id order by sort) as floors from public.locations where parent_id = :'s1' and kind = 'floor' and deleted_at is null \gset
select is(public.locations_reorder(:'zk7', :'s1', (select array[:'zone'::uuid] || :'floors'::uuid[])), cardinality(:'floors'::uuid[]) + 1, 'паркинг поставлен выше всех этажей');
select is((select code from public.locations where parent_id = :'s1' and deleted_at is null order by coalesce(position, sort) limit 1), 'T49Z', 'паркинг первый');
select is(public.locations_reorder(:'zk7', :'s1', (select (:'floors'::uuid[])[1:2] || array[:'zone'::uuid] || (:'floors'::uuid[])[3:cardinality(:'floors'::uuid[])])), cardinality(:'floors'::uuid[]) + 1, 'паркинг поставлен между этажами');
select is((select array_agg(code order by coalesce(position, sort)) from (select code, position, sort from public.locations where parent_id = :'s1' and deleted_at is null order by coalesce(position, sort) limit 4) x), (select array[l1.code, l2.code, 'T49Z', l3.code] from public.locations l1, public.locations l2, public.locations l3 where l1.id = (:'floors'::uuid[])[1] and l2.id = (:'floors'::uuid[])[2] and l3.id = (:'floors'::uuid[])[3]), 'после второго этажа идёт паркинг, номера этажей не менялись');
select throws_ok(format($$select public.locations_reorder(%L, %L, %L::uuid[])$$, :'zk7', :'s1', (select array[:'zone'::uuid] || (select array_agg(x order by ord desc) from unnest(:'floors'::uuid[]) with ordinality t(x, ord)))), '22023', 'floors_ordered_by_number', 'этажи переставлять нельзя');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.locations_reorder(%L, null, array[%L]::uuid[])$$, :'zk7', :'k1'), '42501', null, 'без права управлять структурой нельзя');
select pg_temp.back();

select * from finish();
rollback;
