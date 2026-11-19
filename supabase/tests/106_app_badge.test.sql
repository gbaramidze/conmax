-- Требует сид-данных. Число на значке иконки: только у включивших, чат (с видимостью каналов) + «Входящие» Outlook, служебная функция.
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

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as director from public.users where email = 'director@demo.test' \gset
select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset

select throws_ok($$ set local role authenticated; select * from public.app_badge_counts(array[gen_random_uuid()]) $$, '42501', null, 'сайту функция недоступна');
reset role;

select is((select count(*)::int from public.app_badge_counts(array[:'pm1'::uuid])), 0, 'по умолчанию значок выключен');

-- человек включает значок сам
select pg_temp.act_as('pm1@demo.test');
insert into public.user_notification_settings (app_badge) values (true)
  on conflict (user_id) do update set app_badge = excluded.app_badge;
select pg_temp.back();
select is((select app_badge from public.user_notification_settings where user_id = :'pm1'), true, 'настройка сохранена');

-- непрочитанное в чате до сообщения директора — для сравнения
select pg_temp.act_as('pm1@demo.test');
select public.chat_unread_count() as before \gset
select pg_temp.back();

select pg_temp.act_as('director@demo.test');
select public.chat_open(null, 'direct', null, :'pm1') as dm \gset
select public.chat_send(:'dm', 'Привет, как дела на объекте?');
select public.chat_send(:'dm', 'Жду отчёт');
select pg_temp.back();

select is((select badge from public.app_badge_counts(array[:'pm1'::uuid, :'director'::uuid]) where user_id = :'pm1'), :before + 2,
  'чат: два новых сообщения');
select is((select count(*)::int from public.app_badge_counts(array[:'pm1'::uuid, :'director'::uuid])), 1, 'у невключивших числа нет');

insert into public.mail_accounts (user_id, tenant_id, email, refresh_token_enc, inbox_unread)
values (:'pm1', :'tenant', 'pm1@outlook.test', 'v1.x.y', 5)
on conflict (user_id) do update set inbox_unread = 5;
select is((select badge from public.app_badge_counts(array[:'pm1'::uuid])), :before + 2 + 5, 'плюс непрочитанные во «Входящих»');

select current_setting('request.jwt.claims', true) as claims_before \gset
select count(*) from public.app_badge_counts(array[:'pm1'::uuid]);
select is(current_setting('request.jwt.claims', true), :'claims_before', 'сессия вызывающего восстановлена');

select * from finish();
rollback;
