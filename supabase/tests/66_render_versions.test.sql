-- Требует сид-данных. Рендеры: папки с подпапками и версии (новая, вернуть прежнюю, удалить), права, видимость файлов версий.
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

select set_config('request.jwt.claims', json_build_object('tenant_id', :'tenant', 'sub', :'pm1')::text, true);
insert into public.locations (project_id, parent_id, kind, code, name, sort) values (:'zk7', :'floor7', 'room', 'T66A', 'Номер 7066', 1);
select id as ra from public.locations where parent_id = :'floor7' and code = 'T66A' \gset

select format('%s/%s/t66a.jpg', :'tenant', :'zk7') as ka, format('%s/%s/t66b.jpg', :'tenant', :'zk7') as kb, format('%s/%s/t66c.jpg', :'tenant', :'zk7') as kc \gset
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes, created_by) values
  (:'tenant', :'zk7', (:'ka'), 'sleep.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', (:'kb'), 'sleep-v2.jpg', 'image/jpeg', 100, :'pm1'),
  (:'tenant', :'zk7', (:'kc'), 'sleep-v3.jpg', 'image/jpeg', 100, :'pm1');
select id as fa from public.files where storage_key = :'ka' \gset
select id as fb from public.files where storage_key = :'kb' \gset
select id as fc from public.files where storage_key = :'kc' \gset
select set_config('request.jwt.claims', '', true);

select pg_temp.act_as('pm1@demo.test');

-- папки: путь с подпапками сохраняется, лишние слэши по краям убираются, двойной слэш и слишком длинный путь — ошибка
select public.entity_image_add(:'zk7', 'location', :'ra', :'fa', 'Спальня', '/Спальня/Ночь/') as img \gset
select is((select folder from public.entity_images where id = :'img'), 'Спальня/Ночь', 'папка с подпапкой сохранена, слэши по краям убраны');
select throws_ok(format($$select public.entity_image_add(%L, 'location', %L, %L, null, 'а//б')$$, :'zk7', :'ra', :'fb'), '22023', 'invalid_folder', 'пустая подпапка отвергается');
select lives_ok(format($$select public.entity_image_move(%L, 'Ванная')$$, :'img'), 'изображение переносится в другую папку');
select is((select folder from public.entity_images where id = :'img'), 'Ванная', 'папка сменилась');

-- первая версия появляется сама
select is((select count(*)::int from public.entity_image_versions where image_id = :'img'), 1, 'у нового изображения есть версия 1');

-- новая версия становится текущей, история сохраняется
select is(public.entity_image_add_version(:'img', :'fb', 'новый свет'), 2, 'вторая версия получает номер 2');
select is((select file_id from public.entity_images where id = :'img'), :'fb'::uuid, 'текущий файл — файл новой версии');
select public.entity_image_add_version(:'img', :'fc', null);
select is((select max(version_no)::int from public.entity_image_versions where image_id = :'img'), 3, 'третья версия');

-- вернуть прежнюю
select lives_ok(format($$select public.entity_image_restore(%L, 1)$$, :'img'), 'прежняя версия возвращается текущей');
select is((select file_id from public.entity_images where id = :'img'), :'fa'::uuid, 'текущий файл снова из версии 1');
select throws_ok(format($$select public.entity_image_version_delete(%L, 1)$$, :'img'), '22023', 'version_is_current', 'текущую версию удалить нельзя');
select is(public.entity_image_version_delete(:'img', 3), :'kc', 'прежняя версия удаляется, возвращается ключ файла');
select pg_temp.back();

-- видимость и права
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.files where id = :'fb'), 1, 'файл прежней версии виден тем, кто видит рендер');
select throws_ok(format($$select public.entity_image_add_version(%L, %L, null)$$, :'img', :'fb'), '42501', null, 'без права управлять структурой версию не добавить');
select pg_temp.back();

-- удаление изображения целиком возвращает ключи всех версий
select pg_temp.act_as('pm1@demo.test');
select is((select cardinality(public.entity_image_delete(:'img'))), 2, 'удаление возвращает ключи файлов всех оставшихся версий');
select pg_temp.back();

select * from finish();
rollback;
