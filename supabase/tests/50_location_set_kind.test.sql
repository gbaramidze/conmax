-- Требует сид-данных. Смена типа узла структуры: секция ↔ этаж ↔ зона, проверки номера, вложенных узлов и прав.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
select id as s1 from public.locations where project_id = :'zk7' and path::text = 'K1.S1' \gset

select pg_temp.act_as('pm1@demo.test');
-- секция, созданная вместо этажа «−3»
insert into public.locations (project_id, parent_id, kind, code, name, sort) values (:'zk7', :'s1', 'section', 'T50P', 'Паркинг', 40);
select id as sec from public.locations where parent_id = :'s1' and code = 'T50P' \gset

select throws_ok(format($$select public.location_set_kind(%L, %L, 'floor', null)$$, :'zk7', :'sec'), '22023', 'floor_number_required', 'для этажа нужен номер');
select throws_ok(format($$select public.location_set_kind(%L, %L, 'floor', 7)$$, :'zk7', :'sec'), '23505', 'floor_number_taken', 'номер этажа не должен повторяться у соседей');
select lives_ok(format($$select public.location_set_kind(%L, %L, 'floor', -3)$$, :'zk7', :'sec'), 'секция стала этажом −3');
select is((select kind || ':' || sort from public.locations where id = :'sec'), 'floor:-3', 'тип и номер изменились');
select is((select path::text from public.locations where id = :'sec'), 'K1.S1.T50P', 'путь остался прежним');
select lives_ok(format($$select public.location_set_kind(%L, %L, 'zone', null)$$, :'zk7', :'sec'), 'этаж можно сделать зоной');
select throws_ok(format($$select public.location_set_kind(%L, %L, 'floor', 50)$$, :'zk7', :'s1'), '22023', 'children_do_not_fit', 'секцию с этажами этажом не сделать');
select throws_ok(format($$select public.location_set_kind(%L, %L, 'section', null)$$, :'zk7', :'k1'), '22023', 'kind_change_not_allowed', 'тип корпуса не меняется');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.location_set_kind(%L, %L, 'zone', null)$$, :'zk7', :'sec'), '42501', null, 'без права управлять структурой нельзя');
select pg_temp.back();

select * from finish();
rollback;
