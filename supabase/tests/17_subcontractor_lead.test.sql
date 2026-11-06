-- Требует сид-данных. Ответственный от подрядчика назначает задачи только внутри своей организации.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as sub_org from public.organizations where name = 'МонолитСтрой' \gset

select is((select count(*)::int from public.roles where code = 'subcontractor_lead'), (select count(*)::int from public.tenants), 'у каждого тенанта есть роль «ответственный от подрядчика»');
select ok(exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'subcontractor_lead' and rp.permission = 'project.members.invite_org'),
          'у роли есть право приглашать сотрудников организации');

-- второй сотрудник организации подрядчика (без входа: проверяем только права на назначение)
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'worker@demo.test', now(), now());
insert into public.users (id, tenant_id, email, full_name, organization_id, is_external, status)
select id, :'tenant', 'worker@demo.test', 'Рабочий Подрядчиков', :'sub_org', true, 'active' from auth.users where email = 'worker@demo.test';
select id as worker from public.users where email = 'worker@demo.test' \gset
insert into public.project_members (tenant_id, project_id, user_id, role_id)
select :'tenant', :'zk7', :'worker', r.id from public.roles r where r.code = 'subcontractor' and r.tenant_id = :'tenant';

-- 1. Рядовой подрядчик по-прежнему не назначает
select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.create_task(%L, 'Своему рабочему', 'task', %L)$$, :'zk7', :'worker'), '42501', null, 'рядовой подрядчик назначать не может');
select pg_temp.back();

-- 2. Делаем его ответственным: назначать своих может, чужих — нет
update public.project_members set role_id = (select id from public.roles where code = 'subcontractor_lead' and tenant_id = :'tenant')
 where user_id = :'sub1' and project_id = :'zk7';
select pg_temp.act_as('sub1@demo.test');
select lives_ok(format($$select public.create_task(%L, 'Своему рабочему', 'task', %L)$$, :'zk7', :'worker'), 'ответственный назначает сотрудника своей организации');
select throws_ok(format($$select public.create_task(%L, 'Прорабу заказчика', 'task', %L)$$, :'zk7', :'fm1'), '42501', null, 'сотрудника другой организации назначить нельзя');
select pg_temp.back();

-- 3. Переназначение существующей задачи подчиняется тому же правилу
select pg_temp.act_as('sub1@demo.test');
select id as mine from public.create_task(:'zk7', 'Для переназначения') \gset
select throws_ok(format($$update public.tasks set assignee_id = %L where id = %L$$, :'fm1', :'mine'), '42501', null, 'при переназначении чужого сотрудника тоже нельзя');
select lives_ok(format($$update public.tasks set assignee_id = %L where id = %L$$, :'worker', :'mine'), 'а своего — можно');
select pg_temp.back();

select * from finish();
rollback;
