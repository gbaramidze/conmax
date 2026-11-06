-- Требует сид-данных. Назначение помещений: партии разного назначения на этаже, продолжение нумерации, смена назначения.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
select id as f9 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.locations where parent_id = :'f9' and kind = 'room'), 0, 'на этаже пока нет помещений');
select is(public.generate_rooms(:'zk7', :'f9', 6, 'floor', 'hotel_room'), 6, 'создано шесть гостиничных номеров');
select is(public.generate_rooms(:'zk7', :'f9', 2, 'floor', 'commercial'), 2, 'и два коммерческих помещения следом');
select is((select count(*)::int from public.locations where parent_id = :'f9' and kind = 'room'), 8, 'всего на этаже восемь помещений, номера не пересеклись');
select is((select count(*)::int from public.locations where parent_id = :'f9' and purpose = 'commercial'), 2, 'назначение сохранено у каждой партии');
select ok((select name from public.locations where parent_id = :'f9' and purpose = 'hotel_room' order by sort limit 1) like 'Номер %', 'название по назначению: «Номер …»');
select is(public.set_location_purpose(:'zk7', (select array_agg(id) from public.locations where parent_id = :'f9' and purpose = 'commercial'), 'office'), 2, 'назначение можно сменить у выбранных помещений');
select throws_ok(format($$select public.generate_rooms(%L, %L, 2, 'floor', 'castle')$$, :'zk7', :'f9'), '22023', 'invalid generator parameters', 'неизвестное назначение отклоняется');
select pg_temp.back();

select * from finish();
rollback;
