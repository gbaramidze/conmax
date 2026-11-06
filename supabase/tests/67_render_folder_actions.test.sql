-- Требует сид-данных. Рендеры: действия над папкой — свести ревизии в версии, переименовать, перенести в другое место, удалить; права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

select set_config('request.jwt.claims', json_build_object('tenant_id', :'tenant', 'sub', :'pm1')::text, true);
insert into public.locations (project_id, parent_id, kind, code, name, sort) values
  (:'zk7', :'floor7', 'room', 'T67A', 'Номер 7067', 1), (:'zk7', :'floor7', 'room', 'T67B', 'Номер 7068', 2);
select id as ra from public.locations where parent_id = :'floor7' and code = 'T67A' \gset
select id as rb from public.locations where parent_id = :'floor7' and code = 'T67B' \gset

insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes, created_by) values
  (:'tenant', :'zk7', :'tenant' || '/' || :'zk7' || '/t67-1.jpg', 'one.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', :'tenant' || '/' || :'zk7' || '/t67-2.jpg', 'two.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', :'tenant' || '/' || :'zk7' || '/t67-3.jpg', 'one.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', :'tenant' || '/' || :'zk7' || '/t67-4.jpg', 'new.jpg', 'image/jpeg', 100, :'pm1');
select id as f1 from public.files where storage_key = :'tenant' || '/' || :'zk7' || '/t67-1.jpg' \gset
select id as f2 from public.files where storage_key = :'tenant' || '/' || :'zk7' || '/t67-2.jpg' \gset
select id as f3 from public.files where storage_key = :'tenant' || '/' || :'zk7' || '/t67-3.jpg' \gset
select id as f4 from public.files where storage_key = :'tenant' || '/' || :'zk7' || '/t67-4.jpg' \gset
select set_config('request.jwt.claims', '', true);

select pg_temp.act_as('pm1@demo.test');
-- две ревизии одного набора: 01.1 (старая) и 01.2 (новая); one.jpg есть в обеих
select public.entity_image_add(:'zk7', 'location', :'ra', :'f1', null, 'Набор/01.1');
select public.entity_image_add(:'zk7', 'location', :'ra', :'f2', null, 'Набор/01.1');
select public.entity_image_add(:'zk7', 'location', :'ra', :'f3', null, 'Набор/01.2');
select public.entity_image_add(:'zk7', 'location', :'ra', :'f4', null, 'Набор/01.2');

select is(public.entity_image_folders_merge(:'zk7', 'location', :'ra', array['Набор/01.1', 'Набор/01.2'], 'Набор'), 1, 'одноимённый файл новой ревизии стал версией, добавлена одна версия');
select is((select count(*)::int from public.entity_images where entity_type = 'location' and entity_id = :'ra'), 3, 'из четырёх файлов осталось три изображения');
select is((select file_id from public.entity_images i join public.files f on f.id = i.file_id where i.entity_id = :'ra' and f.name = 'one.jpg'), :'f3'::uuid, 'текущая версия — из новой ревизии (01.2)');
select is((select count(*)::int from public.entity_image_versions v join public.entity_images i on i.id = v.image_id where i.entity_id = :'ra' and v.file_id in (:'f1', :'f3')), 2, 'обе версии one.jpg хранятся у одного изображения');
select is((select count(distinct folder)::int from public.entity_images where entity_id = :'ra'), 1, 'всё собрано в одну папку');
select is((select count(*)::int from public.entity_images where entity_id = :'ra' and is_cover), 1, 'обложка по-прежнему одна');

-- переименовать
select is(public.entity_image_folder_move(:'zk7', 'location', :'ra', 'Набор', null, null, 'Дизайн/Финал'), 3, 'переименование затрагивает все изображения папки');
select is((select min(folder) from public.entity_images where entity_id = :'ra'), 'Дизайн/Финал', 'папка получила новое имя');

-- перенести в другое место
select is(public.entity_image_folder_move(:'zk7', 'location', :'ra', 'Дизайн', 'location', :'rb', 'Дизайн'), 3, 'папка вместе с подпапкой перенесена в другое место');
select is((select count(*)::int from public.entity_images where entity_id = :'ra'), 0, 'в прежнем месте изображений не осталось');
select is((select count(*)::int from public.entity_images where entity_id = :'rb' and is_cover), 1, 'у нового места появилась ровно одна обложка');
select pg_temp.back();

-- права
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.entity_image_folder_delete(%L, 'location', %L, 'Дизайн')$$, :'zk7', :'rb'), '42501', null, 'без права управлять структурой папку удалить нельзя');
select pg_temp.back();

-- удалить
select pg_temp.act_as('pm1@demo.test');
select is((select cardinality(public.entity_image_folder_delete(:'zk7', 'location', :'rb', 'Дизайн'))), 4, 'удаление папки возвращает ключи файлов всех версий');
select is((select count(*)::int from public.entity_images where entity_id = :'rb'), 0, 'изображения папки удалены');
select pg_temp.back();

select * from finish();
rollback;
