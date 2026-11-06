-- Требует сид-данных. Роли и права: каталог, управление ролями, защита внешних ролей и последнего администратора.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

-- каталог
select is((select count(*)::int from public.permissions where tenant_only), 11, 'в каталоге 11 прав только для ролей компании');
select is((select count(*)::int from public.role_permissions rp left join public.permissions p on p.code = rp.permission where p.code is null), 0, 'все выданные права есть в каталоге');

-- обычный сотрудник
select pg_temp.act_as('pm1@demo.test');
select throws_ok($$select * from public.roles_overview()$$, '42501', null, 'обзор ролей без права admin.roles закрыт');
select throws_ok($$select public.role_create('project', 'Взлом')$$, '42501', null, 'создать роль без права нельзя');
select throws_ok($$select public.tenant_role_grant((select id from public.users where email = 'pm1@demo.test'), (select id from public.roles where code = 'tenant_admin' and scope = 'tenant' limit 1))$$, '42501', null, 'выдать роль компании без права admin.users нельзя');

-- администратор
select pg_temp.act_as('admin@demo.test');
select cmp_ok((select count(*)::int from public.roles_overview()), '>=', 15, 'администратор видит все роли');
select is((select permission_count from public.roles_overview() where code = 'foreman'), (select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'foreman'), 'число прав в обзоре верное');

select public.role_create('project', 'Тест: бригадир') is not null as created;
select throws_ok($$select public.role_create('project', '  тест: БРИГАДИР ')$$, '23505', null, 'название роли в пределах вида уникально без учёта регистра');
select throws_ok($$select public.role_create('project', '')$$, '22023', null, 'пустое название нельзя');
select is((select is_system from public.roles where name = 'Тест: бригадир'), false, 'новая роль не системная');

select lives_ok($$select public.role_set_permissions((select id from public.roles where name = 'Тест: бригадир'), array['task.view', 'task.create', 'task.view'])$$, 'права роли задаются списком');
select is((select count(*)::int from public.role_permissions where role_id = (select id from public.roles where name = 'Тест: бригадир')), 2, 'повторы в списке схлопнуты');
select throws_ok($$select public.role_set_permissions((select id from public.roles where name = 'Тест: бригадир'), array['task.view', 'task.fly'])$$, '22023', null, 'права вне каталога нельзя');
select throws_ok($$select public.role_set_permissions((select id from public.roles where name = 'Тест: бригадир'), array['admin.users'])$$, '22023', null, 'роль проекта не получает права только для компании');
select is((select count(*)::int from public.role_permissions where role_id = (select id from public.roles where name = 'Тест: бригадир')), 2, 'отклонённое изменение ничего не поменяло');

-- внешние роли
select throws_ok($$select public.role_set_permissions((select id from public.roles where code = 'subcontractor' and scope = 'project' limit 1), array['task.view', 'budget.view'])$$, '22023', null, 'внешней роли нельзя выдать внутреннее право');
select lives_ok($$select public.role_set_permissions((select id from public.roles where code = 'subcontractor' and scope = 'project' limit 1), array['project.view', 'task.view', 'task.create'])$$, 'внешней роли можно выдать безопасные права');

-- права действуют сразу
select pg_temp.back();
select pg_temp.act_as('admin@demo.test');
select public.role_create('tenant', 'Тест: аналитик', (select id from public.roles where code = 'director' and scope = 'tenant' limit 1)) is not null as created_tenant;
select is((select count(*)::int from public.role_permissions where role_id = (select id from public.roles where name = 'Тест: аналитик')), 6, 'копия роли берёт права образца');
select public.role_set_permissions((select id from public.roles where name = 'Тест: аналитик'), array['cost.record']);
select pg_temp.back();
select pg_temp.act_as('observer@demo.test');
select is(private.has_tenant_permission('cost.record'), false, 'до выдачи роли права нет');
select pg_temp.act_as('admin@demo.test');
select public.tenant_role_grant((select id from public.users where email = 'observer@demo.test'), (select id from public.roles where name = 'Тест: аналитик'));
select pg_temp.act_as('observer@demo.test');
select is(private.has_tenant_permission('cost.record'), true, 'после выдачи роли право действует сразу');
select pg_temp.act_as('admin@demo.test');
select throws_ok($$select public.tenant_role_grant((select id from public.users where email = 'sub1@demo.test'), (select id from public.roles where name = 'Тест: аналитик'))$$, 'P0002', null, 'внешнему пользователю роль компании не выдаётся');
select throws_ok($$select public.role_delete((select id from public.roles where name = 'Тест: аналитик'))$$, '23503', null, 'роль с людьми удалить нельзя');

-- удаление
select throws_ok($$select public.role_delete((select id from public.roles where code = 'foreman' and scope = 'project' limit 1))$$, '42501', null, 'системную роль удалить нельзя');
select lives_ok($$select public.role_delete((select id from public.roles where name = 'Тест: бригадир'))$$, 'неиспользуемую свою роль можно удалить');

-- последний администратор
select pg_temp.back();
delete from public.user_tenant_roles
 where role_id = (select id from public.roles where code = 'tenant_admin' and scope = 'tenant' limit 1)
   and user_id <> (select id from public.users where email = 'admin@demo.test');
select pg_temp.act_as('admin@demo.test');
select throws_ok($$select public.tenant_role_revoke((select id from public.users where email = 'admin@demo.test'), (select id from public.roles where code = 'tenant_admin' and scope = 'tenant' limit 1))$$, '23514', null, 'нельзя забрать роль у последнего администратора');
select throws_ok($$select public.role_set_permissions((select id from public.roles where code = 'tenant_admin' and scope = 'tenant' limit 1), array['project.view'])$$, '23514', null, 'нельзя убрать право «Роли и права» у последнего администратора');

select * from finish();
rollback;
