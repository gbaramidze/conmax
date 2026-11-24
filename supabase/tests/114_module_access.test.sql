-- Требует сид-данных. Доступ к модулям: ограничение модуля людьми и ролями закрывает его данные и права на сервере.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select role_id as eco_role from public.project_members pm join public.users u on u.id = pm.user_id
 where pm.project_id = :'zk7' and u.email = 'economist@demo.test' and pm.deleted_at is null limit 1 \gset
delete from public.project_module_access where project_id = :'zk7';
delete from public.project_module_restrictions where project_id = :'zk7';
-- своя статья, чтобы не зависеть от данных бюджета
insert into public.cbs_items (tenant_id, project_id, code, name)
select tenant_id, id, 'T-MA', 'Проверка доступа' from public.projects where id = :'zk7';

select pg_temp.act_as('economist@demo.test');
select ok((select count(*) from public.cbs_items where code = 'T-MA') = 1, 'до ограничения экономист видит бюджет');
select throws_ok(format($$select public.set_project_module_access(%L, 'budget', true, array[%L]::uuid[])$$, :'zk7', :'pm1'), '42501', null, 'ограничивать модуль может только тот, кто настраивает проект');
select pg_temp.back();

-- руководитель закрывает бюджет: открыт только ему
select pg_temp.act_as('pm1@demo.test');
select public.set_project_module_access(:'zk7', 'budget', true, array[:'pm1']::uuid[], '{}');
select is((select count(*)::int from public.cbs_items where code = 'T-MA'), 1, 'руководитель видит закрытый модуль');
select pg_temp.back();

select pg_temp.act_as('economist@demo.test');
select is((select count(*)::int from public.cbs_items where code = 'T-MA'), 0, 'экономист больше не видит статьи бюджета');
select is(public.my_blocked_modules(:'zk7'), array['budget'], 'модуль бюджета закрыт для экономиста');
select ok(not ('budget.view' = any (public.my_permissions(:'zk7'))), 'права модуля пропали из прав для интерфейса');
select ok('task.view' = any (public.my_permissions(:'zk7')) or not exists (select 1), 'права вне модуля остаются');
select throws_ok(format($$select public.budget_upsert_item(%L, null, null, 'T-MA2', 'Попытка')$$, :'zk7'), '42501', null, 'менять бюджет закрытого модуля нельзя');
select pg_temp.back();

-- открыть роли экономиста
select pg_temp.act_as('pm1@demo.test');
select public.set_project_module_access(:'zk7', 'budget', true, array[:'pm1']::uuid[], array[:'eco_role']::uuid[]);
select pg_temp.back();
select pg_temp.act_as('economist@demo.test');
select is((select count(*)::int from public.cbs_items where code = 'T-MA'), 1, 'доступ по роли возвращает данные');
select is(public.my_blocked_modules(:'zk7'), '{}'::text[], 'по роли модуль открыт');
select pg_temp.back();

-- снять ограничение
select pg_temp.act_as('pm1@demo.test');
select public.set_project_module_access(:'zk7', 'budget', false);
select is((select count(*)::int from public.project_module_restrictions where project_id = :'zk7'), 0, 'ограничение снято');
select pg_temp.back();
select pg_temp.act_as('economist@demo.test');
select is((select count(*)::int from public.cbs_items where code = 'T-MA'), 1, 'после снятия ограничения всё видно');
select pg_temp.back();

select * from finish();
rollback;
