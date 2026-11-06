-- Требует сид-данных. Мебель и оборудование по номерам: каталог, типы номеров, спецификация номера, статусы, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset

select pg_temp.act_as('pm1@demo.test');
select is(public.generate_rooms(:'zk7', :'f5', 2, 'floor', 'hotel_room'), 2, 'на этаже созданы два номера');
select id as r1 from public.locations where parent_id = :'f5' and kind = 'room' order by sort limit 1 \gset
select id as r2 from public.locations where parent_id = :'f5' and kind = 'room' order by sort desc limit 1 \gset

-- каталог
select public.ffe_upsert_item(:'zk7', null, 'T44-BED', 'Кровать King', 'Кровати', 'шт', null, null) as bed \gset
select public.ffe_upsert_item(:'zk7', null, 'T44-NS', 'Тумбочка', 'Тумбочки') as ns \gset
select throws_ok(format($$select public.ffe_upsert_item(%L, null, 't44-bed', 'Дубль')$$, :'zk7'), '23505', 'code_exists', 'код позиции уникален без учёта регистра');
select is((public.ffe_import_items(:'zk7', '[{"code":"T44-WD","name":"Шкаф","category":"Шкафы"},{"code":"T44-NS","name":"Тумбочка прикроватная","unit":"шт"}]'::jsonb) ->> 'created')::int, 1, 'импорт: одна новая позиция');
select is((select name from public.ffe_items where id = :'ns'), 'Тумбочка прикроватная', 'импорт: существующий код обновлён');

-- тип номера и его состав
select public.room_type_upsert(:'zk7', null, 'T44 King', 32.5, 'Вид во двор') as kind \gset
select public.room_type_set_item(:'zk7', :'kind', :'bed', 1);
select public.room_type_set_item(:'zk7', :'kind', :'ns', 2);
select is(public.apply_room_type(:'zk7', array[:'r1', :'r2']::uuid[], :'kind'), 2, 'тип назначен двум номерам');
select is((select count(*)::int from public.room_ffe where location_id = :'r1'), 2, 'в номере две позиции по типу');
select is((select qty from public.room_ffe where location_id = :'r2' and item_id = :'ns'), 2, 'две тумбочки в номере');

-- изменение типа доходит до номеров, своя правка сохраняется
select public.room_ffe_set(:'zk7', :'r1', :'ns', 3);
select public.room_type_set_item(:'zk7', :'kind', :'ns', 4);
select is((select qty from public.room_ffe where location_id = :'r2' and item_id = :'ns'), 4, 'изменение типа обновило номер без правок');
select is((select qty from public.room_ffe where location_id = :'r1' and item_id = :'ns'), 3, 'своя правка номера не затёрта типом');

-- статус
select is(public.room_ffe_set_status(:'zk7', (select array_agg(id) from public.room_ffe where location_id = :'r2'), 'installed'), 2, 'статус «установлено» поставлен двум строкам');
select public.room_type_set_item(:'zk7', :'kind', :'bed', 0);
select is((select count(*)::int from public.room_ffe where location_id = :'r2' and item_id = :'bed'), 1, 'установленная кровать остаётся в номере после правки типа');
select is((select source from public.room_ffe where location_id = :'r2' and item_id = :'bed'), 'manual', 'и становится ручной позицией');

-- защита
select throws_ok(format($$select public.room_type_delete(%L, %L)$$, :'zk7', :'kind'), '23503', 'in_use', 'тип, назначенный номерам, удалить нельзя');
select throws_ok(format($$select public.ffe_delete_item(%L, %L)$$, :'zk7', :'ns'), '23503', 'in_use', 'позицию, которая в номерах, удалить нельзя');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.ffe_upsert_item(%L, null, 'T44-X', 'Чужая')$$, :'zk7'), '42501', null, 'подрядчик не может править каталог');
select is((select count(*)::int from public.ffe_items), 0, 'подрядчик не видит каталог');
select pg_temp.back();

select * from finish();
rollback;
