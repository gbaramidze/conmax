-- Требует сид-данных. Объекты на плане: свой цвет и характеристики (мегапиксели и т. п.), проверка вида данных.
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as doc from public.documents where project_id = :'zk7' and deleted_at is null limit 1 \gset
delete from public.plan_objects where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, 'К-1', 'installed', '', null, 'dome', 90, 1, '#7C3AED', '{"mp": 4, "lens": "2.8"}'::jsonb) as cam \gset

select is((select color from public.plan_objects where id = :'cam'), '#7c3aed', 'цвет сохраняется в нижнем регистре');
select is((select (specs ->> 'mp')::int from public.plan_objects where id = :'cam'), 4, 'мегапиксели сохраняются числом');
select is((select specs ->> 'lens' from public.plan_objects where id = :'cam'), '2.8', 'объектив сохраняется строкой');

-- правка без цвета и характеристик сбрасывает их (поведение «что пришло, то и хранится»)
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, 'К-1', 'installed', '', :'cam', 'dome', 90, 1);
select is((select color from public.plan_objects where id = :'cam'), null, 'без цвета в правке цвет сбрасывается на цвет типа');
select is((select specs from public.plan_objects where id = :'cam'), '{}'::jsonb, 'без характеристик в правке они очищаются');

select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'installed', '', null, null, 0, 1, 'red', '{}')$$, :'zk7', :'doc'), '22023', 'position_invalid', 'цвет только в виде #rrggbb');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'installed', '', null, null, 0, 1, null, '{"Bad Key": 1}')$$, :'zk7', :'doc'), '22023', 'position_invalid', 'ключ характеристики из латиницы');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'installed', '', null, null, 0, 1, null, '{"mp": [1]}')$$, :'zk7', :'doc'), '22023', 'position_invalid', 'значение характеристики — строка или число');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'installed', '', null, null, 0, 1, null, %L::jsonb)$$, :'zk7', :'doc', json_build_object('mp', repeat('x', 41))::text), '22023', 'position_invalid', 'значение не длиннее 40 знаков');
select pg_temp.back();

select * from finish();
rollback;
