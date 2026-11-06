-- Требует сид-данных. Двухфакторная защита: при подтверждённом втором факторе токен только по паролю (aal1) данных не получает.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select id as pm1, tenant_id as ten from public.users where email = 'pm1@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset

create function pg_temp.act_as(p_user uuid, p_ten uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'tenant_id', p_ten, 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

-- без второго фактора ничего не меняется
select pg_temp.act_as(:'pm1', :'ten', 'aal1');
select is(private.tenant_id(), :'ten'::uuid, 'без второго фактора токен по паролю работает');
select ok((select count(*) from public.projects) > 0, 'и проекты видны');
select pg_temp.back();

-- пользователь включил второй фактор
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :'pm1', 'тест', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');

select pg_temp.act_as(:'pm1', :'ten', 'aal1');
select is(private.tenant_id(), null, 'токен только по паролю (aal1) при втором факторе: компания не определяется');
select is((select count(*) from public.projects)::int, 0, 'данные не отдаются');
select pg_temp.back();

select pg_temp.act_as(:'pm1', :'ten', 'aal2');
select is(private.tenant_id(), :'ten'::uuid, 'после ввода кода (aal2) доступ есть');
select ok((select count(*) from public.projects) > 0, 'проекты видны');
select pg_temp.back();

-- незавершённая регистрация фактора доступ не закрывает
update auth.mfa_factors set status = 'unverified' where user_id = :'pm1';
select pg_temp.act_as(:'pm1', :'ten', 'aal1');
select is(private.tenant_id(), :'ten'::uuid, 'неподтверждённый фактор доступ не закрывает');
select pg_temp.back();

-- чужой второй фактор на других не влияет
update auth.mfa_factors set status = 'verified' where user_id = :'pm1';
select pg_temp.act_as(:'pm2', :'ten', 'aal1');
select is(private.tenant_id(), :'ten'::uuid, 'у другого пользователя без фактора доступ прежний');
select pg_temp.back();

select * from finish();
rollback;
