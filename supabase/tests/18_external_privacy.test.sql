-- Требует сид-данных. Внешний видит свою организацию и внутреннюю команду, но не других внешних.
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

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as sub_org from public.organizations where name = 'МонолитСтрой' \gset

-- коллега по организации подрядчика
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'colleague@demo.test', now(), now());
insert into public.users (id, tenant_id, email, full_name, organization_id, is_external, status)
select id, :'tenant', 'colleague@demo.test', 'Коллега Подрядчиков', :'sub_org', true, 'active' from auth.users where email = 'colleague@demo.test';
select id as colleague from public.users where email = 'colleague@demo.test' \gset
insert into public.project_members (tenant_id, project_id, user_id, role_id)
select :'tenant', :'zk7', :'colleague', r.id from public.roles r where r.code = 'subcontractor' and r.tenant_id = :'tenant';

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.users where email = 'client@demo.test'), 0, 'подрядчик не видит сотрудника заказчика');
select is((select count(*)::int from public.users where email = 'pm1@demo.test'), 1, 'но видит внутреннюю команду проекта');
select is((select count(*)::int from public.users where email = 'colleague@demo.test'), 1, 'и коллегу по своей организации');
select is((select count(*)::int from public.project_members pm join public.users u on u.id = pm.user_id where u.email = 'client@demo.test'), 0, 'в списке участников заказчика тоже нет');
select is((select count(*)::int from public.organizations where name = 'ГК Заказчик'), 0, 'организация заказчика подрядчику не видна');
select is((select count(*)::int from public.organizations where name in ('МонолитСтрой', 'Демо Строй')), 2, 'свою и собственную компанию видит');
select pg_temp.back();

-- заказчик, в свою очередь, не видит подрядчиков
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.users where email in ('sub1@demo.test', 'colleague@demo.test')), 0, 'заказчик не видит сотрудников подрядчика');
select pg_temp.back();

-- удаление своих сотрудников ответственным
update public.project_members set role_id = (select id from public.roles where code = 'subcontractor_lead' and tenant_id = :'tenant')
 where user_id = (select id from public.users where email = 'sub1@demo.test') and project_id = :'zk7';
select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.remove_org_member(%L)$$, (select id from public.project_members where user_id = (select id from public.users where email = 'foreman1@demo.test') and project_id = :'zk7')),
                 '42501', null, 'ответственный не может убрать чужого сотрудника');
select lives_ok(format($$select public.remove_org_member(%L)$$, (select id from public.project_members where user_id = :'colleague' and project_id = :'zk7')),
                'ответственный убирает сотрудника своей организации');
select pg_temp.back();
select ok((select left_at from public.project_members where user_id = :'colleague' and project_id = :'zk7') is not null, 'у убранного участника проставлена дата выхода');

select * from finish();
rollback;
