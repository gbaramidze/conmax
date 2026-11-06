-- Требует сид-данных. Файлы мебели: документы привязываются к позиции каталога (несколько на позицию), импорт по шифру чертежа.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
select id as pm, tenant_id as ten from public.users where email = 'pm1@demo.test' \gset
insert into public.documents (tenant_id, project_id, title, code, doc_type, created_by) values (:'ten', :'zk7', 'Чертёж кровати', 'FF-DWG-1', 'drawing', :'pm') returning id as d1 \gset
insert into public.documents (tenant_id, project_id, title, code, doc_type, created_by) values (:'ten', :'zk7', 'Каталожный лист', 'FF-DWG-2', 'spec', :'pm') returning id as d2 \gset

select pg_temp.act_as('pm1@demo.test');
select public.ffe_upsert_item(:'zk7', null, 'BED-T', 'Кровать тест') as bed \gset
select lives_ok(format($$insert into public.document_links (document_id, entity_type, entity_id) values (%L, 'ffe_item', %L)$$, :'d1', :'bed'), 'чертёж привязан к позиции');
select lives_ok(format($$insert into public.document_links (document_id, entity_type, entity_id) values (%L, 'ffe_item', %L)$$, :'d2', :'bed'), 'второй файл привязан к той же позиции');
select is((select count(*)::int from public.document_links where entity_type = 'ffe_item' and entity_id = :'bed'), 2, 'у позиции два файла');

-- импорт по шифру чертежа создаёт привязку
select public.ffe_import_items(:'zk7', '[{"code":"NS-T","name":"Тумбочка тест","document_code":"FF-DWG-1"},{"code":"NS-U","name":"Тумбочка без чертежа","document_code":"NOPE"}]'::jsonb) as res \gset
select is((:'res'::jsonb ->> 'unknown_documents')::int, 1, 'неизвестный шифр чертежа посчитан');
select is((select count(*)::int from public.document_links l join public.ffe_items i on i.id = l.entity_id where l.entity_type = 'ffe_item' and i.code = 'NS-T'), 1, 'импорт привязал чертёж по шифру');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.document_links where entity_type = 'ffe_item'), 0, 'подрядчик не видит привязки мебели');
select pg_temp.back();

select * from finish();
rollback;
