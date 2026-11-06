-- Требует сид-данных. Привязка объектов слоёв к помещениям по зонам листа: попадание, вложенные зоны, типовой план, пересчёт.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
select id as doc from public.documents where project_id = :'zk7' and deleted_at is null limit 1 \gset

select set_config('request.jwt.claims', json_build_object('tenant_id', :'tenant', 'sub', :'pm1')::text, true);
insert into public.locations (project_id, parent_id, kind, code, name, sort) values
  (:'zk7', :'floor7', 'room', 'T65A', 'Номер 6501', 1), (:'zk7', :'floor7', 'room', 'T65B', 'Номер 6502', 2);
select id as ra from public.locations where parent_id = :'floor7' and code = 'T65A' \gset
select id as rb from public.locations where parent_id = :'floor7' and code = 'T65B' \gset
delete from public.plan_objects where project_id = :'zk7';
delete from public.plan_zones where document_id = :'doc';
select set_config('request.jwt.claims', '', true);

select pg_temp.act_as('pm1@demo.test');
-- объект поставлен раньше зон: помещения пока нет
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.2,0.2]]'::jsonb, 'К-1') as cam \gset
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.8,0.8]]'::jsonb, 'К-2') as far \gset
select public.plan_object_set(:'zk7', :'doc', 1, 'pipe_water', 'line', '[[0.1,0.1],[0.3,0.3]]'::jsonb, 'Т-1') as pipe \gset
select is((select location_id from public.plan_objects where id = :'cam'), null, 'без зоны помещения нет');

-- нарисовали зону номера: камера внутри получает помещение (порядок «объекты, потом зоны» не важен)
select public.plan_zone_set(:'zk7', :'doc', 1, :'ra', '[[0.1,0.1],[0.4,0.1],[0.4,0.4],[0.1,0.4]]'::jsonb);
select is((select location_id from public.plan_objects where id = :'cam'), :'ra'::uuid, 'камера в контуре зоны получила помещение');
select is((select location_id from public.plan_objects where id = :'far'), null, 'камера вне зон остаётся без помещения');
select is((select location_id from public.plan_objects where id = :'pipe'), null, 'у трассы помещения нет');

-- вложенные зоны: этаж большой, номер внутри него меньше — выбирается номер
select public.plan_zone_set(:'zk7', :'doc', 1, :'floor7', '[[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]]'::jsonb);
select is((select location_id from public.plan_objects where id = :'cam'), :'ra'::uuid, 'при вложенных зонах берётся меньшая');
select is((select location_id from public.plan_objects where id = :'far'), :'floor7'::uuid, 'вне номера, но внутри этажа — этаж');

-- перенос объекта пересчитывает помещение
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.5,0.5]]'::jsonb, 'К-1', 'installed', '', :'cam');
select is((select location_id from public.plan_objects where id = :'cam'), :'floor7'::uuid, 'после переноса помещение пересчитано');

-- перерисовали зону номера и убрали: привязка следует за зонами
select public.plan_zone_set(:'zk7', :'doc', 1, :'ra', '[[0.45,0.45],[0.6,0.45],[0.6,0.6],[0.45,0.6]]'::jsonb);
select is((select location_id from public.plan_objects where id = :'cam'), :'ra'::uuid, 'перерисованная зона подхватила объект');
select public.plan_zone_delete((select id from public.plan_zones where document_id = :'doc' and location_id = :'ra'));
select is((select location_id from public.plan_objects where id = :'cam'), :'floor7'::uuid, 'зону убрали — объект вернулся в этаж');

-- типовой план: один контур у двух помещений — однозначно выбрать нельзя
select public.plan_zone_set_many(:'zk7', :'doc', 1, array[:'ra', :'rb']::uuid[], '[[0.45,0.45],[0.6,0.45],[0.6,0.6],[0.45,0.6]]'::jsonb);
select is((select location_id from public.plan_objects where id = :'cam'), null, 'совпадающие контуры (типовой план): помещение не назначается');
select pg_temp.back();

select * from finish();
rollback;
