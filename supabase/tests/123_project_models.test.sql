-- Требует сид-данных. 3D-модель проекта: регистрация GLB, права, сопоставление этажей, перенос связей на новую версию,
-- отметки этажей в структуре, цифры для окраски.
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
select id as floor7 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F07' \gset
select id as floor8 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F08' \gset

-- файлы моделей в хранилище (сам GLB функции не читают — только проверяют, что объект есть)
insert into storage.objects (bucket_id, name) values
  ('models', :'tenant' || '/' || :'zk7' || '/t123-a.glb'),
  ('models', :'tenant' || '/' || :'zk7' || '/t123-b.glb');

select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.model_register(%L, %L, 'a.glb', 100, 0, '[{"gid":"S7","name":"7. Story","elevation":21.5,"y":21.5}]'::jsonb)$$,
  :'zk7', :'tenant' || '/' || :'zk7' || '/t123-a.glb'), '42501', null, 'без права управлять структурой модель не загрузить');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.model_register(%L, 'чужой/путь.glb', 'a.glb', 100, 0, '[{"gid":"S7","name":"7","elevation":1,"y":1}]'::jsonb)$$, :'zk7'),
  '22023', 'model_key_invalid', 'файл должен лежать в папке своего проекта');
select throws_ok(format($$select public.model_register(%L, %L, 'a.glb', 100, 0, '[{"gid":"S7","name":"7","elevation":1,"y":1}]'::jsonb)$$, :'zk7', :'tenant' || '/' || :'zk7' || '/нет.glb'),
  'P0002', 'model_file_missing', 'незагруженный файл не регистрируется');
select public.model_register(:'zk7', :'tenant' || '/' || :'zk7' || '/t123-a.glb', 'a.glb', 100, 0,
  '[{"gid":"S7","name":"7. Story","elevation":21.5,"y":21.5},{"gid":"S8","name":"8. Story","elevation":24.7,"y":24.7},{"gid":"R","name":"ROOF","elevation":30,"y":30}]'::jsonb) as m1 \gset
select is((select count(*)::int from public.project_model_storeys where model_id = :'m1'), 3, 'этажи модели записаны');

select lives_ok(format($$select public.model_set_storeys(%L, jsonb_build_array(jsonb_build_object('gid','S7','location_id',%L::text), jsonb_build_object('gid','S8','location_id',%L::text)))$$,
  :'m1', :'floor7', :'floor8'), 'этажи сопоставлены');
select is((select elevation from public.locations where id = :'floor7'), 21.5::numeric, 'отметка этажа записана в структуру');
select throws_ok(format($$select public.model_set_storeys(%L, '[{"gid":"НЕТ","location_id":null}]'::jsonb)$$, :'m1'), '22023', 'model_storeys_invalid', 'чужой этаж модели отвергается');
select throws_ok(format($$select public.model_set_storeys(%L, jsonb_build_array(jsonb_build_object('gid','R','location_id',%L::text)))$$, :'m1', gen_random_uuid()),
  'P0002', 'location_not_found', 'место не из проекта отвергается');

-- одно место — один этаж модели: повтор остаётся только у нижнего
select public.model_set_storeys(:'m1', jsonb_build_array(jsonb_build_object('gid','R','location_id', :'floor8'::text)));
select is((select gid from public.project_model_storeys where model_id = :'m1' and location_id = :'floor8'), 'S8', 'повтор места снят с верхнего этажа модели');

-- новая версия: прежняя убирается, связи переходят по GlobalId
select public.model_register(:'zk7', :'tenant' || '/' || :'zk7' || '/t123-b.glb', 'b.glb', 200, 5,
  '[{"gid":"S7","name":"7. Story","elevation":21.5,"y":21.5},{"gid":"NEW8","name":"8. Story","elevation":24.7,"y":24.7}]'::jsonb) as m2 \gset
select is((select count(*)::int from public.project_models where project_id = :'zk7' and deleted_at is null), 1, 'действующая модель в проекте одна');
select is((select location_id from public.project_model_storeys where model_id = :'m2' and gid = 'S7'), :'floor7'::uuid, 'связь перенесена по GlobalId');
select is((select location_id from public.project_model_storeys where model_id = :'m2' and gid = 'NEW8'), :'floor8'::uuid, 'и по названию, если GlobalId сменился');
select ok((select count(*) = 2 from public.model_floor_stats(:'zk7')), 'цифры для окраски — по сопоставленным этажам');
select pg_temp.back();

-- смотреть может любой участник проекта
select pg_temp.act_as('foreman1@demo.test');
select is((select spaces from public.project_models where project_id = :'zk7' and deleted_at is null), 5, 'прораб видит модель');
select pg_temp.back();

select * from finish();
rollback;
