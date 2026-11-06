-- Требует сид-данных. Сводка по мебели для главной страницы: штуки по статусам и типам, доступ только внутренним участникам.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

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
select id as f8 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F08' \gset

select pg_temp.act_as('pm1@demo.test');
select public.generate_rooms(:'zk7', :'f8', 2, 'floor', 'hotel_room');
select id as r1 from public.locations where parent_id = :'f8' and kind = 'room' order by sort limit 1 \gset
select id as r2 from public.locations where parent_id = :'f8' and kind = 'room' order by sort desc limit 1 \gset
select public.ffe_upsert_item(:'zk7', null, 'T47-BED', 'Кровать') as bed \gset
select public.room_type_upsert(:'zk7', null, 'T47 Type', null, null) as ty \gset
select public.room_type_set_item(:'zk7', :'ty', :'bed', 3);
select public.apply_room_type(:'zk7', array[:'r1', :'r2']::uuid[], :'ty');
select public.room_ffe_set_status(:'zk7', (select array_agg(id) from public.room_ffe where location_id = :'r1'), 'installed');

select is(((public.ffe_overview(:'zk7') -> 'by_status') ->> 'installed')::int >= 3, true, 'установленные штуки учтены в сводке');
select is(((public.ffe_overview(:'zk7') -> 'by_type') ->> :'ty')::int, 6, 'по типу: два номера по три штуки');
select is(((public.ffe_overview(:'zk7') -> 'by_status') ->> 'planned')::int >= 3, true, 'запланированные штуки учтены');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.ffe_overview(%L)$$, :'zk7'), '42501', null, 'подрядчик сводку не видит');
select pg_temp.back();

select * from finish();
rollback;
