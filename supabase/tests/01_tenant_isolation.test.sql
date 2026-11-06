begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Хелпер: войти как пользователь (с claim-ами, как после custom access token hook)
create function pg_temp.act_as(uid uuid, tid uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'tenant_id', tid)::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.back_to_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;

-- Пользователи auth
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin-a@test.dev', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'admin-b@test.dev', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'worker-a@test.dev', 'authenticated', 'authenticated');

-- Bootstrap двух тенантов
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select public.bootstrap_tenant('Компания A', 'company-a', 'Админ A') as tenant_a \gset
select pg_temp.back_to_admin();
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000001');
select public.bootstrap_tenant('Компания B', 'company-b', 'Админ B') as tenant_b \gset
select pg_temp.back_to_admin();

-- Сотрудник A без ролей проекта (создаётся сервером, как будто по приглашению)
insert into public.users (id, tenant_id, email, full_name, status)
values ('aaaaaaaa-0000-0000-0000-000000000002', :'tenant_a', 'worker-a@test.dev', 'Сотрудник A', 'active');
insert into public.user_tenant_roles (tenant_id, user_id, role_id)
select :'tenant_a', 'aaaaaaaa-0000-0000-0000-000000000002', id
from public.roles where tenant_id = :'tenant_a' and code = 'member';

-- 1. Изоляция тенантов
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001', :'tenant_a');
select is((select count(*)::int from public.tenants), 1, 'A видит только свой тенант');
select is((select count(*)::int from public.organizations), 1, 'A видит только свои организации');
select is((select count(*)::int from public.roles where tenant_id = :'tenant_b'), 0, 'A не видит роли B');

select throws_ok(
  format($$insert into public.organizations (tenant_id, name, kind) values (%L, 'Чужая', 'other')$$, :'tenant_b'),
  '42501', null, 'A не может писать в тенант B');

-- 2. Админ создаёт проект
select lives_ok(
  format($$insert into public.projects (tenant_id, code, name) values (%L, 'ZK7', 'Жилой комплекс 7')$$, :'tenant_a'),
  'tenant_admin создаёт проект');
select is((select count(*)::int from public.projects), 1, 'админ A видит проект (project.view.all)');

select pg_temp.back_to_admin();

-- 3. Тенант B проект не видит
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000001', :'tenant_b');
select is((select count(*)::int from public.projects), 0, 'B не видит проекты A');
select is((select count(*)::int from public.users), 1, 'B видит только своих пользователей');
select pg_temp.back_to_admin();

-- 4. Сотрудник без членства не видит проект
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002', :'tenant_a');
select is((select count(*)::int from public.projects), 0, 'не-участник не видит проект');
select throws_ok(
  format($$insert into public.projects (tenant_id, code, name) values (%L, 'XX1', 'Нельзя')$$, :'tenant_a'),
  '42501', null, 'без project.create проект не создать');
select pg_temp.back_to_admin();

-- 5. Админ добавляет сотрудника в проект ролью «Прораб» → проект виден
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001', :'tenant_a');
select lives_ok(
  format($$insert into public.project_members (tenant_id, project_id, user_id, role_id)
    select %L, p.id, 'aaaaaaaa-0000-0000-0000-000000000002', r.id
    from public.projects p, public.roles r
    where p.code = 'ZK7' and r.tenant_id = %L and r.code = 'foreman'$$, :'tenant_a', :'tenant_a'),
  'админ добавляет участника проекта');
select pg_temp.back_to_admin();

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002', :'tenant_a');
select is((select count(*)::int from public.projects), 1, 'участник видит свой проект');
select ok('task.create' = any (public.my_permissions((select id from public.projects limit 1))), 'прораб: task.create в my_permissions');
select pg_temp.back_to_admin();

select * from finish();
rollback;
