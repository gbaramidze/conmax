-- Требует сид-данных. Сверка версий читает файлы и текст на стороне клиента, поэтому права держатся на тех же правилах, что и документы:
-- версии, файлы и извлечённый текст скрытых версий недоступны, внешним виден только действующий выпуск.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as designer from public.users where email = 'designer@demo.test' \gset

-- Три файла-таблицы: версии 1 (станет «заменённой»), 2 (действует), 3 (черновик)
select set_config('request.jwt.claims', json_build_object('sub', :'designer'::text, 'role', 'authenticated', 'tenant_id', :'tenant'::text)::text, true);
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/cmp-1.xlsx', 'Смета ред1.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1000),
       (:'zk7', :'tenant' || '/' || :'zk7' || '/cmp-2.xlsx', 'Смета ред2.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1100),
       (:'zk7', :'tenant' || '/' || :'zk7' || '/cmp-3.xlsx', 'Смета ред3.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1200);
select set_config('request.jwt.claims', '', true);
select id as f1 from public.files where storage_key like '%/cmp-1.xlsx' \gset
select id as f2 from public.files where storage_key like '%/cmp-2.xlsx' \gset
select id as f3 from public.files where storage_key like '%/cmp-3.xlsx' \gset
select public.finish_file_text(:'f1', 'done', 'xlsx', 'Лист1' || E'\n' || 'Штукатурка | 100');
select public.finish_file_text(:'f2', 'done', 'xlsx', 'Лист1' || E'\n' || 'Штукатурка | 110');
select public.finish_file_text(:'f3', 'done', 'xlsx', 'Лист1' || E'\n' || 'Штукатурка | 120');

-- Документ для всех внешних участников: v1 выпущена, затем заменена v2, v3 — черновик
select pg_temp.act_as('designer@demo.test');
select public.create_document(:'zk7', 'Смета на отделку', 'ZK7-CMP-0001', 'spec', null, 'external', false, :'f1', 'A', 'Первая редакция', '{}'::uuid[], '{}'::uuid[], false) as doc \gset
select pg_temp.back();
select id as v1 from public.document_versions where document_id = :'doc' and version_no = 1 \gset
select pg_temp.act_as('pm1@demo.test');
select public.publish_document_version(:'v1');
select pg_temp.back();
select pg_temp.act_as('designer@demo.test');
select public.add_document_version(:'doc', :'f2', 'B', 'Цены обновлены', false) as v2 \gset
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.publish_document_version(:'v2');
select pg_temp.back();
select pg_temp.act_as('designer@demo.test');
select public.add_document_version(:'doc', :'f3', 'C', 'Черновик новой редакции', false) as v3 \gset
select pg_temp.back();

-- 1. Выпускающий видит все три версии и их текст — сравнивать может любые
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.document_versions where document_id = :'doc'), 3, 'выпускающий видит три версии');
select is((select count(*)::int from public.file_texts where file_id in (:'f1', :'f2', :'f3')), 3, 'выпускающий читает текст всех трёх файлов');
select pg_temp.back();

-- 2. Участник команды: действующая и заменённая видны, чужой черновик — нет
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.document_versions where document_id = :'doc'), 2, 'прораб видит действующую и заменённую версии, но не чужой черновик');
select is((select count(*)::int from public.file_texts where file_id = :'f3'), 0, 'текст чужого черновика прорабу не отдаётся');
select is((select count(*)::int from public.files where id = :'f3'), 0, 'файл чужого черновика прорабу не виден');
select pg_temp.back();

-- 3. Внешний участник: только действующая версия
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.document_versions where document_id = :'doc'), 1, 'подрядчик видит одну версию');
select is((select id from public.document_versions where document_id = :'doc'), :'v2'::uuid, 'это действующая версия');
select is((select count(*)::int from public.file_texts where file_id in (:'f1', :'f3')), 0, 'текст заменённой версии и черновика подрядчику не отдаётся');
select is((select count(*)::int from public.files where id in (:'f1', :'f3')), 0, 'файлы заменённой версии и черновика подрядчику не видны');
select pg_temp.back();

select * from finish();
rollback;
