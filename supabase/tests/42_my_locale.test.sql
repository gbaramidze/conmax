-- Требует сид-данных. Язык интерфейса: меняется только своей функцией, допустимы ru, ka, en.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;

select id as pm from public.users where email = 'pm1@demo.test' \gset
select id as sub from public.users where email = 'sub1@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');

select lives_ok($$select public.set_my_locale('ka')$$, 'грузинский язык ставится');
select is((select locale from public.users where id = :'pm'), 'ka', 'язык сохранён в профиле');
select throws_ok($$select public.set_my_locale('de')$$, '22023', null, 'неизвестный язык нельзя');
select throws_ok($$select public.set_my_locale(null)$$, '22023', null, 'пустой язык нельзя');
select is((select locale from public.users where id = :'sub'), 'ru', 'язык другого пользователя не изменился');

select * from finish();
rollback;
