-- Требует сид-данных. Подрядчик ведёт свои задачи: создаёт для себя, прикладывает файлы, не видит чужое.
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
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select id as sub_org from public.organizations where name = 'МонолитСтрой' \gset

-- 1. Создание: исполнитель — сам подрядчик, организация — его
select pg_temp.act_as('sub1@demo.test');
select id as mine from public.create_task(:'zk7', 'Тест подрядчика: приёмка') \gset
select is((select assignee_id from public.tasks where id = :'mine'), :'sub1'::uuid, 'задача подрядчика без исполнителя назначается на него самого');
select is((select organization_id from public.tasks where id = :'mine'), :'sub_org'::uuid, 'организация задачи — организация подрядчика');
select throws_ok(format($$select public.create_task(%L, 'Чужому', 'task', %L)$$, :'zk7', (select id from public.users where email = 'foreman1@demo.test')),
                 '42501', null, 'назначать других подрядчик по-прежнему не может');
select pg_temp.back();

-- 2. Файлы, прикреплённые прямо к задаче
select pg_temp.act_as('sub1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/contractor-own.pdf', 'акт.pdf', 'application/pdf', 100);
insert into public.attachments (entity_type, entity_id, file_id)
select 'task', :'mine', id from public.files where storage_key like '%/contractor-own.pdf';
select is((select count(*)::int from public.attachments where entity_id = :'mine'), 1, 'подрядчик видит файл, который сам приложил к своей задаче');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.attachments where entity_id = :'mine'), 1, 'РП видит файл подрядчика');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/pm-internal.pdf', 'внутреннее.pdf', 'application/pdf', 100);
insert into public.attachments (entity_type, entity_id, file_id)
select 'task', :'mine', id from public.files where storage_key like '%/pm-internal.pdf';
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.attachments where entity_id = :'mine'), 1, 'внутренний файл РП подрядчику не виден');
select is((select count(*)::int from public.work_checks), 0, 'подрядчик не видит проверки и расхождения');
select pg_temp.back();

-- 3. Внутренняя задача другого исполнителя подрядчику не видна
select is((select count(*)::int from public.tasks where project_id = :'zk7' and key = 'ZK7-T-1'), 1, 'контроль: задача существует');
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.tasks where key = 'ZK7-T-1'), 0, 'чужая внутренняя задача подрядчику не видна');
select pg_temp.back();

select * from finish();
rollback;
