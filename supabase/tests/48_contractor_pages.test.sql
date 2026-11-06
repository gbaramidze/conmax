-- Требует сид-данных. Страницы подрядчиков: направления организации, должность и направление сотрудника, права, видимость.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
select id as bc2 from public.projects where code = 'BC2' \gset
select organization_id as org from public.users where email = 'sub1@demo.test' \gset
select id as other_org from public.organizations where kind = 'subcontractor' and id <> :'org' limit 1 \gset
select array_agg(id order by code) as ds from (select id, code from public.disciplines where project_id = :'zk7' and deleted_at is null order by code limit 3) x \gset
select id as d1 from public.disciplines where project_id = :'zk7' and deleted_at is null order by code limit 1 \gset
select id as d_other from public.disciplines where project_id = :'bc2' and deleted_at is null limit 1 \gset
select pm.id as sub_member from public.project_members pm join public.users u on u.id = pm.user_id where u.email = 'sub1@demo.test' and pm.project_id = :'zk7' \gset
select pm.id as pm_member from public.project_members pm join public.users u on u.id = pm.user_id where u.email = 'pm1@demo.test' and pm.project_id = :'zk7' \gset

-- руководитель проекта задаёт направления подрядчика
select pg_temp.act_as('pm1@demo.test');
select is(public.org_disciplines_set(:'zk7', :'org', :'ds'::uuid[]), 3, 'РП задал три направления организации');
select is((select cardinality(discipline_ids) from public.project_orgs_overview(:'zk7') where organization_id = :'org'), 3, 'сводка показывает направления');
select ok((select count(*) from public.project_orgs_overview(:'zk7')) >= 1, 'внутренний видит организации проекта');
select throws_ok(format($$select public.org_disciplines_set(%L, %L, array[%L]::uuid[])$$, :'zk7', :'org', :'d_other'), '22023', 'discipline_not_in_project', 'направление чужого проекта не принимается');
select lives_ok(format($$select public.org_member_update(%L, 'Прораб', %L)$$, :'sub_member', :'d1'), 'РП задал должность и направление сотруднику');
select pg_temp.back();

-- обычный субподрядчик править не может
select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.org_disciplines_set(%L, %L, array[]::uuid[])$$, :'zk7', :'org'), '42501', null, 'рядовой субподрядчик направления не меняет');
select pg_temp.back();

-- ответственный от подрядчика: своя организация — да, чужая и внутренняя команда — нет
update public.project_members set role_id = (select id from public.roles where code = 'subcontractor_lead' and scope = 'project' limit 1) where id = :'sub_member';
select pg_temp.act_as('sub1@demo.test');
select is(public.org_disciplines_set(:'zk7', :'org', array[:'d1']::uuid[]), 1, 'ответственный от подрядчика выбрал направление своей организации');
select throws_ok(format($$select public.org_disciplines_set(%L, %L, array[%L]::uuid[])$$, :'zk7', :'other_org', :'d1'), '42501', null, 'чужую организацию править нельзя');
select throws_ok(format($$select public.org_member_update(%L, 'Директор', null)$$, :'pm_member'), '42501', null, 'сотрудника внутренней команды править нельзя');
select lives_ok(format($$select public.org_member_update(%L, 'Главный по бетону', null)$$, :'sub_member'), 'ответственный правит своего сотрудника');
select is((select count(*)::int from public.project_orgs_overview(:'zk7')), 1, 'внешний видит в сводке только свою организацию');
select is((select title from public.project_members where id = :'sub_member'), 'Главный по бетону', 'должность сохранилась');
select is((select count(*)::int from public.project_org_disciplines where project_id = :'zk7'), 1, 'внешний видит направления только своей организации');
select pg_temp.back();

select * from finish();
rollback;
