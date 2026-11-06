-- Требует сид-данных. Технический план типа номера: документ привязывается к типу, виден через тип, попадает в варианты схемы инспекции номера.
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7, tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset

select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/type-plan.pdf', 'type-plan.pdf', 'application/pdf', 5000) returning id as fplan \gset
select public.generate_rooms(:'zk7', :'f5', 2, 'floor', 'hotel_room');
select id as r1 from public.locations where parent_id = :'f5' and kind = 'room' order by sort limit 1 \gset
select id as r2 from public.locations where parent_id = :'f5' and kind = 'room' order by sort desc limit 1 \gset
select public.room_type_upsert(:'zk7', null, 'T77 King', 32.5, null) as kind \gset
select public.room_type_upsert(:'zk7', null, 'T77 Twin', 28, null) as twin \gset
select public.apply_room_type(:'zk7', array[:'r1']::uuid[], :'kind');
select public.apply_room_type(:'zk7', array[:'r2']::uuid[], :'twin');

-- технический план: PDF-документ вида «план», выпущен
select public.create_document(:'zk7', 'T77 King, технический план', 'T77-KING-TP', 'plan', null, 'internal', false, :'fplan', 'A', '', '{}', '{}', true) as doc \gset
select lives_ok(format($$insert into public.document_links (document_id, entity_type, entity_id) values (%L, 'room_type', %L)$$, :'doc', :'kind'), 'документ привязан к типу номера');
select throws_ok(format($$insert into public.document_links (document_id, entity_type, entity_id) values (%L, 'room_type', %L)$$, :'doc', gen_random_uuid()), '23514', 'entity belongs to another project', 'несуществующий тип не привязать');
select is((select count(*)::int from public.document_links where entity_type = 'room_type' and entity_id = :'kind'), 1, 'у типа один план');
select is((select count(*)::int from public.document_links where entity_type = 'room_type' and entity_id = :'twin'), 0, 'у соседнего типа плана нет');

-- схема инспекции: номер типа King получает план типа, номер другого типа — нет
select is((select count(*)::int from public.inspection_scheme_options(:'r1') where source = 'room_type' and kind = 'document'), 1, 'в вариантах схемы номера — план его типа');
select is((select title from public.inspection_scheme_options(:'r1') where source = 'room_type' limit 1), 'T77 King, технический план', 'это тот самый документ');
select is((select count(*)::int from public.inspection_scheme_options(:'r2') where source = 'room_type'), 0, 'номеру другого типа план чужого типа не предлагается');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.document_links where entity_type = 'room_type'), 0, 'подрядчик не видит привязки внутреннего плана типа');
select pg_temp.back();

select * from finish();
rollback;
