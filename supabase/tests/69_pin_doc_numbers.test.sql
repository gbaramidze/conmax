-- Требует сид-данных. Булавки замечаний: у каждого документа своя нумерация, номера не переиспользуются.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as d1 from public.documents where project_id = :'zk7' and deleted_at is null order by created_at, id limit 1 \gset
select id as d2 from public.documents where project_id = :'zk7' and deleted_at is null and id <> :'d1' order by created_at, id limit 1 \gset
select id as t1 from public.tasks where project_id = :'zk7' and deleted_at is null order by created_at, id limit 1 \gset
select id as t2 from public.tasks where project_id = :'zk7' and deleted_at is null order by created_at, id limit 1 offset 1 \gset
select id as t3 from public.tasks where project_id = :'zk7' and deleted_at is null order by created_at, id limit 1 offset 2 \gset

select set_config('request.jwt.claims', json_build_object('tenant_id', :'ten', 'sub', :'pm1')::text, true);
delete from public.task_pins where project_id = :'zk7';
delete from public.project_counters where project_id = :'zk7' and kind like 'pin:%';

insert into public.task_pins (tenant_id, project_id, task_id, document_id, page, x, y) values (:'ten', :'zk7', :'t1', :'d1', 1, 0.1, 0.1);
insert into public.task_pins (tenant_id, project_id, task_id, document_id, page, x, y) values (:'ten', :'zk7', :'t2', :'d1', 1, 0.2, 0.2);
insert into public.task_pins (tenant_id, project_id, task_id, document_id, page, x, y) values (:'ten', :'zk7', :'t1', :'d2', 1, 0.3, 0.3);

select is((select doc_no from public.task_pins where task_id = :'t1' and document_id = :'d1'), 1, 'первая булавка документа — 1');
select is((select doc_no from public.task_pins where task_id = :'t2' and document_id = :'d1'), 2, 'вторая — 2');
select is((select doc_no from public.task_pins where task_id = :'t1' and document_id = :'d2'), 1, 'в другом документе нумерация начинается с 1');

delete from public.task_pins where task_id = :'t2' and document_id = :'d1';
insert into public.task_pins (tenant_id, project_id, task_id, document_id, page, x, y) values (:'ten', :'zk7', :'t3', :'d1', 1, 0.4, 0.4);
select is((select doc_no from public.task_pins where task_id = :'t3' and document_id = :'d1'), 3, 'номер убранной булавки не переиспользуется');
select is((select count(distinct doc_no)::int from public.task_pins where document_id = :'d1'), 2, 'номера в документе не повторяются');
select throws_ok(format($$update public.task_pins set doc_no = 1 where task_id = %L and document_id = %L$$, :'t3', :'d1'), '23505', null, 'два одинаковых номера в документе невозможны');

select * from finish();
rollback;
