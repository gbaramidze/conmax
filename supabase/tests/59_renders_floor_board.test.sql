-- Требует сид-данных. Рендеры мест и типов номеров: обложка, подпись, удаление, права; сводка этажа.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

-- помещения на этаже, тип номера и мебель (триггер locations берёт тенант из claims)
select set_config('request.jwt.claims', json_build_object('tenant_id', :'tenant', 'sub', :'pm1')::text, true);
insert into public.locations (project_id, parent_id, kind, code, name, sort) values
  (:'zk7', :'floor7', 'room', 'T59A', 'Номер 7001', 1), (:'zk7', :'floor7', 'room', 'T59B', 'Номер 7002', 2);
select id as ra from public.locations where parent_id = :'floor7' and code = 'T59A' \gset
select id as rb from public.locations where parent_id = :'floor7' and code = 'T59B' \gset
insert into public.room_types (tenant_id, project_id, name, area) values (:'tenant', :'zk7', 'Тест King', 32.5);
select id as typ from public.room_types where project_id = :'zk7' and name = 'Тест King' \gset
insert into public.room_specs (location_id, tenant_id, project_id, type_id) values (:'ra', :'tenant', :'zk7', :'typ');
insert into public.ffe_items (tenant_id, project_id, code, name, category, unit) values (:'tenant', :'zk7', 'T59-BED', 'Кровать', 'Кровати', 'шт');
select id as item from public.ffe_items where project_id = :'zk7' and code = 'T59-BED' \gset
insert into public.room_ffe (tenant_id, project_id, location_id, item_id, qty, status) values (:'tenant', :'zk7', :'ra', :'item', 2, 'installed');

-- три файла pm1 (ключ хранилища: <тенант>/<проект>/…)
select format('%s/%s/t59a.jpg', :'tenant', :'zk7') as ka, format('%s/%s/t59b.jpg', :'tenant', :'zk7') as kb, format('%s/%s/t59c.pdf', :'tenant', :'zk7') as kc \gset
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes, created_by) values
  (:'tenant', :'zk7', (:'ka'), 'a.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', (:'kb'), 'b.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', (:'kc'), 'c.pdf', 'application/pdf', 100, :'pm1');
select id as fa from public.files where storage_key = :'ka' \gset
select id as fb from public.files where storage_key = :'kb' \gset
select id as fc from public.files where storage_key = :'kc' \gset

select pg_temp.act_as('pm1@demo.test');
select public.entity_image_add(:'zk7', 'room_type', :'typ', :'fa', 'Спальня') as ia \gset
select public.entity_image_add(:'zk7', 'room_type', :'typ', :'fb', null) as ib \gset
select is((select is_cover from public.entity_images where id = :'ia'), true, 'первое изображение становится обложкой');
select is((select is_cover from public.entity_images where id = :'ib'), false, 'второе — нет');
select throws_ok(format($$select public.entity_image_add(%L, 'room_type', %L, %L)$$, :'zk7', :'typ', :'fc'), '23503', 'file_not_found', 'не изображение прикрепить нельзя');
select lives_ok(format($$select public.entity_image_set(%L, 'Ванная', true)$$, :'ib'), 'обложку можно сменить');
select is((select count(*)::int from public.entity_images where entity_type = 'room_type' and entity_id = :'typ' and is_cover), 1, 'обложка всегда одна');
select is((select caption from public.entity_images where id = :'ib'), 'Ванная', 'подпись сохранена');

-- сводка этажа: тип, площадь по типу, мебель, обложка типа
select is((select count(*)::int from public.floor_board(:'floor7') where code in ('T59A', 'T59B')), 2, 'сводка этажа содержит помещения');
select is((select ffe_installed || '/' || ffe_total from public.floor_board(:'floor7') where code = 'T59A'), '2/2', 'мебель посчитана');
select is((select type_name || ' ' || area from public.floor_board(:'floor7') where code = 'T59A'), 'Тест King 32.50', 'тип и площадь из типа номера');
select is((select cover_key from public.floor_board(:'floor7') where code = 'T59A'), :'kb', 'на плитке обложка типа номера');
select is((select cover_key from public.floor_board(:'floor7') where code = 'T59B'), null, 'без типа и без изображения обложки нет');

-- удаление обложки: ключ возвращается, обложкой становится оставшееся
select is(public.entity_image_delete(:'ib'), array[:'kb'], 'удаление возвращает ключи файлов');
select is((select is_cover from public.entity_images where id = :'ia'), true, 'после удаления обложки обложкой стало оставшееся изображение');
select pg_temp.back();

-- права
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.entity_image_set(%L, 'взлом', true)$$, :'ia'), '42501', null, 'без права управлять структурой менять нельзя');
select pg_temp.back();
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.entity_images where id = :'ia'), 1, 'участник проекта изображение видит');
select pg_temp.back();

select * from finish();
rollback;
