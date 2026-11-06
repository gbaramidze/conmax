-- Требует сид-данных. Помещения по диапазону этажей: только выбранные этажи, пустой диапазон и перевёрнутые границы отклоняются.
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
select id as sec from public.locations where project_id = :'zk7' and path::text = 'K1.S1' \gset

select pg_temp.act_as('pm1@demo.test');
select is(public.generate_rooms(:'zk7', :'sec', 3, 'floor', 'hotel_room', 3, 4), 6, 'на этажах 3–4 по три номера: шесть помещений');
select is((select count(*)::int from public.locations where project_id = :'zk7' and kind = 'room' and path::text like 'K1.S1.F03.%'), 3, 'на третьем этаже три помещения');
select is((select count(*)::int from public.locations where project_id = :'zk7' and kind = 'room' and path::text like 'K1.S1.F04.%'), 3, 'на четвёртом этаже три помещения');
select is((select count(*)::int from public.locations where project_id = :'zk7' and kind = 'room' and path::text like 'K1.S1.F05.%' and purpose = 'hotel_room'), 0, 'вне диапазона помещений не появилось');
select throws_ok(format($$select public.generate_rooms(%L, %L, 2, 'floor', 'office', 8, 3)$$, :'zk7', :'sec'), '22023', 'invalid generator parameters', 'перевёрнутый диапазон отклоняется');
select throws_ok(format($$select public.generate_rooms(%L, %L, 2, 'floor', 'office', 90, 95)$$, :'zk7', :'sec'), '22023', 'no floors under this location', 'диапазон без этажей отклоняется');
select is(public.generate_rooms(:'zk7', :'sec', 3, 'floor', 'hotel_room', 3, 4), 6, 'повторный запуск — новая партия, нумерация продолжается');
select is((select count(*)::int from public.locations where project_id = :'zk7' and kind = 'room' and path::text like 'K1.S1.F03.%'), 6, 'на третьем этаже теперь шесть помещений без повторов');
select pg_temp.back();

select * from finish();
rollback;
