-- Требует сид-данных. Масштаб листа плана (метров в ширине листа) и назначение помещения в зонах.
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
select tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as doc from public.documents where project_id = :'zk7' and deleted_at is null limit 1 \gset
select id as floor7 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F07' \gset
delete from public.plan_scales where document_id = :'doc';

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.plan_scale_set(%L, %L, 1, 42.5)$$, :'zk7', :'doc'), 'масштаб задан');
select is((select meters_per_width from public.plan_scales where document_id = :'doc' and page = 1), 42.500::numeric, 'масштаб сохранён');
select public.plan_scale_set(:'zk7', :'doc', 1, 60);
select is((select count(*)::int from public.plan_scales where document_id = :'doc'), 1, 'повторная установка обновляет, а не плодит');
select throws_ok(format($$select public.plan_scale_set(%L, %L, 1, -3)$$, :'zk7', :'doc'), '22023', 'scale_invalid', 'отрицательный масштаб отвергается');
select throws_ok(format($$select public.plan_scale_set(%L, %L, 0, 10)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'лист должен быть положительным');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.plan_scales where document_id = :'doc'), 1, 'смотреть масштаб можно всем, кто видит проект');
select throws_ok(format($$select public.plan_scale_set(%L, %L, 1, 10)$$, :'zk7', :'doc'), '42501', null, 'без права задавать масштаб нельзя');
select pg_temp.back();

-- назначение помещения в зонах
select set_config('request.jwt.claims', json_build_object('tenant_id', :'tenant', 'sub', :'pm1')::text, true);
insert into public.locations (project_id, parent_id, kind, code, name, sort, purpose) values (:'zk7', :'floor7', 'room', 'T63A', 'Парковка 7', 1, 'parking');
select id as pk from public.locations where parent_id = :'floor7' and code = 'T63A' \gset
select set_config('request.jwt.claims', '', true);
select pg_temp.act_as('pm1@demo.test');
select public.plan_zone_set(:'zk7', :'doc', 1, :'pk', '[[0.1,0.1],[0.3,0.1],[0.3,0.3]]'::jsonb);
select is((select purpose from public.plan_zones(:'doc') where location_id = :'pk'), 'parking', 'зона отдаёт назначение помещения');
select lives_ok(format($$select public.plan_scale_set(%L, %L, 1, null)$$, :'zk7', :'doc'), 'масштаб можно сбросить');
select pg_temp.back();

select * from finish();
rollback;
