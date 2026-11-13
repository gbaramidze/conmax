-- Требует сид-данных. Отключение и возврат доступа сотрудника: статус меняет только сервер, отключённого видит в справочнике один администратор.
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

-- сменить статус из браузера нельзя даже администратору: функция только для service_role
select pg_temp.act_as('admin@demo.test');
select throws_ok($$select public.set_user_blocked((select id from public.users where email = 'observer@demo.test'), true)$$, '42501', null, 'администратор не вызывает смену статуса напрямую, только через Edge Function');
select pg_temp.back();

-- отключение (так вызывает Edge Function)
select is(public.set_user_blocked((select id from public.users where email = 'observer@demo.test'), true), 'blocked', 'отключённый получает статус blocked');

select pg_temp.act_as('admin@demo.test');
select is((select count(*)::int from public.people_directory() where email = 'observer@demo.test'), 1, 'администратор видит отключённого, чтобы вернуть доступ');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.people_directory() where email = 'observer@demo.test'), 0, 'обычный сотрудник отключённого не видит');
select pg_temp.back();

-- возврат: кто входил — снова активен, кто так и не вошёл — снова приглашён
update public.users set last_login_at = now() where email = 'observer@demo.test';
select is(public.set_user_blocked((select id from public.users where email = 'observer@demo.test'), false), 'active', 'вошедший ранее после возврата активен');

update public.users set last_login_at = null where email = 'observer@demo.test';
do $$ begin perform public.set_user_blocked((select id from public.users where email = 'observer@demo.test'), true); end $$;
select is(public.set_user_blocked((select id from public.users where email = 'observer@demo.test'), false), 'invited', 'так и не вошедший после возврата снова приглашён');

select throws_ok($$select public.set_user_blocked('00000000-0000-0000-0000-000000000000', true)$$, 'P0002', null, 'несуществующего пользователя отключить нельзя');

select * from finish();
rollback;
