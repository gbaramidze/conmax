-- Требует сид-данных. Зоны типов номеров на плане этажа: рисуют те, кто управляет структурой; видят все, кто видит проект.
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

select id as zk7, tenant_id as ten from public.projects where code = 'ZK7' \gset

select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/floor.pdf', 'floor.pdf', 'application/pdf', 5000) returning id as ff \gset
select public.create_document(:'zk7', 'T82 план этажа', 'T82-FP', 'plan', null, 'internal', false, :'ff', 'A', '', '{}', '{}', true) as doc \gset
select public.room_type_upsert(:'zk7', null, 'T82 King', 32, null) as kt \gset
select public.room_type_upsert(:'zk7', null, 'T82 Twin', 28, null) as tw \gset

select lives_ok(format($$select public.plan_type_zone_set(%L, %L, 1, %L, '[[0.1,0.1],[0.3,0.1],[0.3,0.3],[0.1,0.3]]'::jsonb)$$, :'zk7', :'doc', :'kt'), 'руководитель обводит зону типа');
select public.plan_type_zone_set(:'zk7', :'doc', 1, :'kt', '[[0.5,0.1],[0.7,0.1],[0.7,0.3],[0.5,0.3]]'::jsonb) as z2 \gset
select is((select count(*)::int from public.plan_type_zones(:'doc') where type_id = :'kt'), 2, 'на этаже может быть несколько зон одного типа');
select is((select type_name from public.plan_type_zones(:'doc') where id = :'z2'), 'T82 King', 'в зоне название типа');
select lives_ok(format($$select public.plan_type_zone_set(%L, %L, 1, %L, '[[0.5,0.1],[0.7,0.1],[0.7,0.3],[0.5,0.3]]'::jsonb, %L)$$, :'zk7', :'doc', :'tw', :'z2'), 'тип готовой зоны меняется');
select is((select type_name from public.plan_type_zones(:'doc') where id = :'z2'), 'T82 Twin', 'тип сменился');
select throws_ok(format($$select public.plan_type_zone_set(%L, %L, 1, %L, '[[0.1,0.1],[0.2,0.2]]'::jsonb)$$, :'zk7', :'doc', :'kt'), '22023', 'position_invalid', 'меньше трёх точек не принимается');

select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$select public.plan_type_zone_delete(%L)$$, :'z2'), '42501', null, 'наблюдатель зону убрать не может');
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.plan_type_zone_delete(%L)$$, :'z2'), 'руководитель убирает зону');
select is((select count(*)::int from public.plan_type_zones(:'doc')), 1, 'осталась одна зона');

select * from finish();
rollback;
