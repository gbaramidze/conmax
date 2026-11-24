-- Требует сид-данных. Модули проекта: включение/выключение, права, порядок, журнал.
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

select id as bc2 from public.projects where code = 'BC2' \gset
update public.projects set modules = array['reporting'] where id = :'bc2';

select pg_temp.act_as('pm2@demo.test');
select is(public.set_project_modules(:'bc2', array['procurement', 'budget', 'budget', 'reporting']),
          array['budget', 'procurement', 'reporting'], 'РП включает модули: без повторов, в порядке каталога');
select throws_ok(format($$select public.set_project_modules(%L, array['mail'])$$, :'bc2'), '22023', 'unknown_module', 'почта — не модуль проекта');
select is((select count(*)::int from public.entity_events where entity_type = 'project' and entity_id = :'bc2' and event_type = 'field_changed' and changes ? 'modules'), 1,
          'смена модулей записана в историю проекта');
select is(public.set_project_modules(:'bc2', array['reporting', 'procurement', 'budget']), array['budget', 'procurement', 'reporting'], 'тот же набор — без изменений');
select is((select count(*)::int from public.entity_events where entity_type = 'project' and entity_id = :'bc2' and event_type = 'field_changed' and changes ? 'modules'), 1,
          'без изменений в историю ничего не пишется');
select pg_temp.back();

select pg_temp.act_as('foreman2@demo.test');
select is((select modules from public.projects where id = :'bc2'), array['budget', 'procurement', 'reporting'], 'участник проекта видит включённые модули');
select throws_ok(format($$select public.set_project_modules(%L, array['schedule'])$$, :'bc2'), '42501', null, 'прораб модули не меняет');
select pg_temp.back();

select pg_temp.act_as('admin@demo.test');
select is(public.set_project_modules(:'bc2', array[]::text[]), array[]::text[], 'администратор организации (не участник) может выключить все модули');
select pg_temp.back();

select ok(not private.project_has_module(:'bc2', 'reporting'), 'выключенный модуль виден серверу');
select throws_ok(format($$update public.projects set modules = array['nope'] where id = %L$$, :'bc2'), '23514', null, 'неизвестный ключ не пройдёт и мимо функции');

select * from finish();
rollback;
