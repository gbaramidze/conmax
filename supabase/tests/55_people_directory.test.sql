-- Требует сид-данных. Справочник людей: внутренний видит всех, внешний — только свою организацию и внутреннюю команду проекта, с проектами и должностями.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
update public.users set job_title = 'Главный инженер проекта', phone = '+7 900 000-00-01' where email = 'gip@demo.test';
update public.users set status = 'blocked' where email = 'observer@demo.test';

select pg_temp.act_as('pm1@demo.test');
select ok((select count(*) from public.people_directory()) >= 10, 'руководитель видит всех сотрудников компании');
select is((select count(*)::int from public.people_directory() where email = 'observer@demo.test'), 0, 'заблокированный не показывается');
select is((select job_title from public.people_directory() where email = 'gip@demo.test'), 'Главный инженер проекта', 'должность и контакты на месте');
select ok((select projects @> jsonb_build_array(jsonb_build_object('code', 'ZK7')) from public.people_directory() where email = 'gip@demo.test'), 'в карточке есть проекты, где человек участвует');
select ok((select count(*) from public.people_directory() where email = 'sub1@demo.test') = 1, 'внешний подрядчик виден руководителю');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.people_directory() where email = 'client@demo.test'), 0, 'подрядчик не видит заказчика');
select is((select count(*)::int from public.people_directory() where email = 'pm2@demo.test'), 0, 'и сотрудников из чужих проектов');
select ok((select count(*) from public.people_directory() where email in ('sub1@demo.test', 'pm1@demo.test')) = 2, 'видит себя и внутреннюю команду своего проекта');
select pg_temp.back();

select * from finish();
rollback;
