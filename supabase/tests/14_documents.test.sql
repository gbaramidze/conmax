-- Требует сид-данных. Документы: версии, выпуск, доступ, привязка, ознакомление.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as kr from public.disciplines where project_id = :'zk7' and code = 'KR' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset
select id as task1 from public.tasks where project_id = :'zk7' and key = 'ZK7-T-1' \gset
select id as sub_org from public.organizations where name = 'МонолитСтрой' \gset
select id as client_org from public.organizations where name = 'ГК Заказчик' \gset

-- Два файла (загрузка в Storage здесь не нужна — проверяем права и записи)
-- триггер files берёт тенанта и автора из JWT: задаём их, оставаясь владельцем таблицы
select set_config('request.jwt.claims', json_build_object('sub', :'designer'::text, 'role', 'authenticated', 'tenant_id', :'tenant'::text)::text, true);
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/doc-a.pdf', 'План 5 этажа A.pdf', 'application/pdf', 1000),
       (:'zk7', :'tenant' || '/' || :'zk7' || '/doc-b.pdf', 'План 5 этажа B.pdf', 'application/pdf', 1100);
select set_config('request.jwt.claims', '', true);
select id as file_a from public.files where storage_key like '%/doc-a.pdf' \gset
select id as file_b from public.files where storage_key like '%/doc-b.pdf' \gset

-- 1. Проектировщик загружает черновик; выпустить сам не может
select pg_temp.act_as('designer@demo.test');
select lives_ok(format($$select public.create_document(%L, 'План 5 этажа', 'ZK7-K1-AR-0005', 'plan', %L, 'internal', true, %L, 'A', 'Первая выдача', array[%L]::uuid[], '{}'::uuid[], false)$$,
                       :'zk7', :'kr', :'file_a', :'f5'), 'проектировщик загружает документ черновиком');
select throws_ok(format($$select public.create_document(%L, 'Ещё', 'ZK7-X', 'plan', null, 'internal', false, %L, 'A', null, '{}'::uuid[], '{}'::uuid[], true)$$, :'zk7', :'file_a'),
                 '42501', null, 'проектировщик не может выпускать');
select throws_ok(format($$select public.create_document(%L, 'Дубль шифра', 'zk7-k1-ar-0005', 'plan', null, 'internal', false, %L, 'A', null, '{}'::uuid[], '{}'::uuid[], false)$$, :'zk7', :'file_a'),
                 '23505', 'code_taken', 'шифр уникален в проекте (без учёта регистра)');
select pg_temp.back();
select id as doc from public.documents where code = 'ZK7-K1-AR-0005' \gset
select id as v1 from public.document_versions where document_id = :'doc' and version_no = 1 \gset

-- 2. Черновик видят автор и выпускающие, остальным он не виден
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.documents where id = :'doc'), 0, 'прораб не видит чужой черновик');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.documents where id = :'doc'), 1, 'РП видит черновик (может выпустить)');

-- привязка к задаче и выпуск
insert into public.document_links (document_id, entity_type, entity_id) values (:'doc', 'task', :'task1');
select lives_ok(format($$select public.publish_document_version(%L)$$, :'v1'), 'РП выпускает версию');
select pg_temp.back();

select is((select current_version_id from public.documents where id = :'doc'), :'v1'::uuid, 'версия стала действующей');
select ok(exists (select 1 from public.notifications where user_id = :'fm1' and entity_type = 'document' and entity_id = :'doc' and body like 'Требуется ознакомление: Новая ревизия A%'),
          'исполнитель привязанной задачи уведомлён о выпуске');
select is((select count(*)::int from public.document_acks where version_id = :'v1' and user_id = :'fm1' and acked_at is null), 1, 'для него заведена отметка «ознакомлен» (ещё не поставлена)');

-- 3. После выпуска видят все внутренние; ознакомление
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.documents where id = :'doc'), 1, 'после выпуска прораб видит документ');
select is((select count(*)::int from public.files where id = :'file_a'), 1, 'прораб видит файл выпущенной версии');
select lives_ok(format($$select public.ack_document(%L)$$, :'v1'), 'прораб отмечает «ознакомлен»');
select is((select count(*)::int from public.document_acks where version_id = :'v1'), 1, 'прораб видит только свою отметку');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select ok((select count(*) from public.document_acks where version_id = :'v1') >= 1 and (select count(*) from public.document_acks where version_id = :'v1' and acked_at is not null) = 1,
          'выпускающий видит прогресс ознакомления');
select pg_temp.back();

-- 4. Подрядчик: внутренний документ не виден; открытый для всех внешних — виден; ограничение по организации
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.documents where id = :'doc'), 0, 'внутренний документ подрядчику не виден');
select pg_temp.back();
update public.documents set visibility = 'external' where id = :'doc';
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.documents where id = :'doc'), 1, 'документ для внешних виден подрядчику');
select pg_temp.back();
insert into public.document_orgs (document_id, organization_id, tenant_id) values (:'doc', :'client_org', :'tenant');
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.documents where id = :'doc'), 0, 'документ, открытый только заказчику, подрядчику не виден');
select pg_temp.back();

-- 5. Новая версия: внутренние видят обе, внешние — только действующую
delete from public.document_orgs where document_id = :'doc';
select pg_temp.act_as('designer@demo.test');
select public.add_document_version(:'doc', :'file_b', 'B', 'Сдвинули перегородку', false) as v2 \gset
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.publish_document_version(:'v2');
select pg_temp.back();
select is((select status from public.document_versions where id = :'v1'), 'superseded', 'прежняя версия стала «заменённой»');
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.document_versions where document_id = :'doc'), 1, 'подрядчик видит только действующую версию');
select pg_temp.back();

select * from finish();
rollback;
