-- Требует сид-данных. PDF для просмотра у версии документа (DWG и др.): права, виды файлов, видимость.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
select tenant_id as ten from public.projects where code = 'ZK7' \gset

select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/plan.dwg', 'План.dwg', 'application/octet-stream', 9000) returning id as dwg \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/plan-print.pdf', 'План печать.pdf', 'application/pdf', 4000) returning id as pdf \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/other.dwg', 'Другой.dwg', 'application/octet-stream', 9000) returning id as dwg2 \gset

-- внешний документ: заказчик видит только выпущенное
select public.create_document(:'zk7', 'План на DWG', 'AR-DWG', 'plan', null, 'external', false, :'dwg', 'A', null, '{}', '{}', true) as doc \gset
select current_version_id as ver from public.documents where id = :'doc' \gset

select is((select preview_storage_key from public.documents_overview where id = :'doc'), null, 'пока PDF-просмотра нет');
select lives_ok(format($$select public.set_version_preview(%L, %L)$$, :'ver', :'pdf'), 'руководитель прикладывает PDF для просмотра');
select is((select preview_mime from public.documents_overview where id = :'doc'), 'application/pdf', 'реестр отдаёт файл просмотра действующей версии');
select throws_ok(format($$select public.set_version_preview(%L, %L)$$, :'ver', :'dwg2'), '22023', 'invalid_preview', 'для просмотра годится только PDF или изображение');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.files where id = :'pdf'), 1, 'заказчик видит PDF-просмотр выпущенной версии внешнего документа');
select is((select preview_storage_key is not null from public.documents_overview where id = :'doc'), true, 'и получает его в реестре');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.set_version_preview(%L, null)$$, :'ver'), '42501', null, 'без права править документ просмотр не снять');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.set_version_preview(%L, null)$$, :'ver'), 'просмотр можно убрать');
select is((select preview_storage_key from public.documents_overview where id = :'doc'), null, 'после этого в реестре его нет');
select throws_ok(format($$select public.set_version_preview(%L, %L)$$, :'ver', (select '00000000-0000-0000-0000-000000000000'::uuid)), '23503', 'file_not_found', 'чужой или несуществующий файл не принимается');
select pg_temp.back();

select * from finish();
rollback;
