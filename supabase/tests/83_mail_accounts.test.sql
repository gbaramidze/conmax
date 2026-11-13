-- Требует сид-данных. Подключение личной почты: видит и удаляет только владелец, токены недоступны из API, право выдано сотрудникам.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as u1, tenant_id as t1 from public.users where email = 'pm1@demo.test' \gset
select id as u2 from public.users where tenant_id = :'t1' and email <> 'pm1@demo.test' and is_external = false order by email limit 1 \gset

delete from public.mail_accounts where user_id in (:'u1', :'u2');
insert into public.mail_accounts (user_id, tenant_id, email, display_name, refresh_token_enc)
values (:'u1', :'t1', 'pm1@contoso.test', 'PM One', 'enc-1'), (:'u2', :'t1', 'other@contoso.test', 'Other', 'enc-2');

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.mail_accounts), 1, 'видно только своё подключение');
select is((select email from public.mail_accounts), 'pm1@contoso.test', 'и это именно моё');
select lives_ok($$select user_id, email, display_name, connected_at, last_error from public.mail_accounts$$, 'публичные столбцы читаются');
select throws_ok($$select refresh_token_enc from public.mail_accounts$$, '42501', null, 'токен обновления из API не прочитать');
select throws_ok($$select access_token_enc from public.mail_accounts$$, '42501', null, 'токен доступа из API не прочитать');
select throws_ok(format($$insert into public.mail_accounts (user_id, tenant_id, email, refresh_token_enc) values (%L, %L, 'x@y.z', 'e')$$, :'u1', :'t1'), '42501', null, 'подключение через API не создать: только функция');
select throws_ok($$update public.mail_accounts set email = 'evil@x.y'$$, '42501', null, 'и не изменить');

delete from public.mail_accounts;
select pg_temp.back();
select is((select count(*)::int from public.mail_accounts where user_id = :'u1'), 0, 'своё подключение можно удалить (отключить почту)');
select is((select count(*)::int from public.mail_accounts where user_id = :'u2'), 1, 'чужое осталось');

select is((select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where rp.permission = 'mail.connect' and r.code = 'member' and r.scope = 'tenant'),
          (select count(*)::int from public.roles where code = 'member' and scope = 'tenant' and deleted_at is null), 'право есть у роли «Сотрудник» в каждой компании');
select ok(exists (select 1 from public.permissions where code = 'mail.connect' and tenant_only and not external_ok), 'право в каталоге: только для ролей компании, внешним нельзя');

select * from finish();
rollback;
