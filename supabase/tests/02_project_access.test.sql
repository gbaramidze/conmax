-- Требует сид-данных (supabase/seed.sql): тенант «Демо Строй».
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

-- Идентификаторы берём до смены роли (RLS скрывает чужие проекты); число участников ZK7 считаем по факту,
-- чтобы тест не зависел от правок, сделанных вручную в локальной БД
select p.id as zk7, p.tenant_id as tenant from public.projects p where p.code = 'ZK7' \gset
select id as bc2 from public.projects where code = 'BC2' \gset
select id as foreman_role from public.roles where scope = 'project' and code = 'foreman' and tenant_id = :'tenant' \gset
select id as admin_user from public.users where email = 'admin@demo.test' \gset
select id as foreman1_user from public.users where email = 'foreman1@demo.test' \gset
select count(distinct pm.user_id)::int as zk7_people from public.project_members pm
  where pm.project_id = :'zk7' and pm.deleted_at is null and pm.left_at is null \gset
-- подрядчик видит внутреннюю команду проекта и коллег по своей организации, но не других внешних (заказчика)
select count(distinct pm.user_id)::int as zk7_visible_to_sub from public.project_members pm
  join public.users u on u.id = pm.user_id
 where pm.project_id = :'zk7' and pm.deleted_at is null and pm.left_at is null
   and (not u.is_external or u.organization_id = (select organization_id from public.users where email = 'sub1@demo.test')) \gset

-- Видимость проектов
select pg_temp.act_as('director@demo.test');
select is((select count(*)::int from public.projects where code in ('ZK7','BC2','SK3')), 3, 'директор видит все проекты (project.view.all)');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select is((select array_agg(code order by code) from public.projects), array['BC2','SK3'], 'РП видит только свои проекты');
select pg_temp.back();

-- Внешние: только свой проект и коллеги по нему
select pg_temp.act_as('sub1@demo.test');
select is((select array_agg(code) from public.projects), array['ZK7'], 'субподрядчик видит только ZK7');
select is((select count(*)::int from public.users), :zk7_visible_to_sub, 'субподрядчик видит внутреннюю команду проекта и своих, но не других внешних и не всю компанию');
select ok(not ('project.members.manage' = any (public.my_permissions(:'zk7'))),
          'у субподрядчика нет права управлять участниками');
select pg_temp.back();

-- Управление участниками
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(
  format($$insert into public.project_members (tenant_id, project_id, user_id, role_id) values (%L, %L, %L, %L)$$,
         :'tenant', :'zk7', :'admin_user', :'foreman_role'),
  '42501', null, 'прораб не может добавлять участников');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(
  format($$insert into public.project_members (tenant_id, project_id, user_id, role_id) values (%L, %L, %L, %L)$$,
         :'tenant', :'zk7', :'admin_user', :'foreman_role'),
  'РП добавляет участника в свой проект');
select throws_ok(
  format($$insert into public.project_members (tenant_id, project_id, user_id, role_id) values (%L, %L, %L, %L)$$,
         :'tenant', :'bc2', :'foreman1_user', :'foreman_role'),
  '42501', null, 'РП не может добавлять участников в чужой проект');
select pg_temp.back();

-- Пользователь не может менять собственные служебные поля (колоночные права)
select pg_temp.act_as('pm1@demo.test');
select throws_ok(
  $$update public.users set is_external = true where email = 'pm1@demo.test'$$,
  '42501', null, 'нельзя самому сделать себя внешним (нет прав на колонку)');
select pg_temp.back();

select * from finish();
rollback;
