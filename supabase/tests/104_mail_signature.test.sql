-- Требует сид-данных. Подпись почты: владелец читает и меняет свою подпись и видит выданные права;
-- чужое подключение не видно и не меняется; токены по-прежнему не читаются и не меняются.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset

insert into public.mail_accounts (user_id, tenant_id, email, refresh_token_enc, scopes)
values (:'pm1', :'tenant', 'pm1@outlook.test', 'v1.secret.token', 'Mail.ReadWrite Mail.Send')
on conflict (user_id) do update set signature = null, scopes = excluded.scopes;
insert into public.mail_accounts (user_id, tenant_id, email, refresh_token_enc)
values (:'master', :'tenant', 'master@outlook.test', 'v1.other.token')
on conflict (user_id) do update set signature = null;

create function pg_temp.act_as(p_user uuid, p_tenant uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'tenant_id', p_tenant)::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.act_as(:'pm1', :'tenant');
select is((select scopes from public.mail_accounts), 'Mail.ReadWrite Mail.Send', 'свои права видны');
update public.mail_accounts set signature = '<p>С уважением, ПМ</p>', signature_on_reply = false;
select is((select signature from public.mail_accounts where user_id = :'pm1'), '<p>С уважением, ПМ</p>', 'подпись сохраняется');
select is((select signature_on_reply from public.mail_accounts where user_id = :'pm1'), false, 'и настройка «к ответам»');
select is((select count(*)::int from public.mail_accounts), 1, 'чужое подключение не видно');
select throws_ok($$ update public.mail_accounts set refresh_token_enc = 'x' $$, '42501', null, 'токен изменить нельзя');
select throws_ok($$ select refresh_token_enc from public.mail_accounts $$, '42501', null, 'и прочитать тоже');
update public.mail_accounts set signature = 'взлом' where user_id = :'master';
reset role;
select is((select signature from public.mail_accounts where user_id = :'master'), null, 'чужую подпись не поменять');

select * from finish();
rollback;
