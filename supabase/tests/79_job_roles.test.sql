-- Должностные роли проекта: заводятся для новой компании, права скопированы с образцов, повторный запуск ничего не ломает.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.tenants (name, slug) values ('Тест Должности', 'test-job-roles');
select id as t from public.tenants where slug = 'test-job-roles' \gset
select private.seed_tenant_defaults(:'t');

select is((select count(*)::int from public.roles where tenant_id = :'t' and scope = 'project' and not is_system), 14, 'у новой компании 14 должностных ролей проекта');
select is((select count(*)::int from public.roles where tenant_id = :'t' and is_system), 15, 'системные роли на месте (3 роли компании и 12 ролей проекта)');

select is(
  (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'architect'),
  (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'designer'),
  'у Architect те же права, что у Проектировщика');
select is(
  (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'main_architect'),
  (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'chief_engineer'),
  'у Main Architect те же права, что у ГИП');

select ok(exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'senior_financial_manager' and rp.permission = 'budget.approve'), 'старший финансовый менеджер утверждает бюджет');
select ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'financial_manager' and rp.permission = 'budget.approve'), 'обычный финансовый менеджер бюджет не утверждает');
select ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'project_owner' and rp.permission in ('task.edit.any', 'budget.edit')), 'Project Owner только смотрит');

-- повторный запуск: ничего не меняется и не падает
delete from public.role_permissions rp using public.roles r where r.id = rp.role_id and r.tenant_id = :'t' and r.code = 'architect' and rp.permission = 'task.create';
select private.seed_job_roles(:'t');
select is((select count(*)::int from public.roles where tenant_id = :'t' and scope = 'project' and not is_system), 14, 'повторный запуск не дублирует роли');
select ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'t' and r.code = 'architect' and rp.permission = 'task.create'), 'повторный запуск не возвращает права, убранные администратором');

select * from finish();
rollback;
