-- Требует сид-данных. Закреплённые письма: только свои, не больше 20, повтор не дублируется.
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select pg_temp.act_as('pm1@demo.test');
insert into public.mail_pins (message_id, folder) values ('AAMk1', 'inbox');
select is((select count(*)::int from public.mail_pins), 1, 'письмо закреплено');
select throws_ok($$ insert into public.mail_pins (message_id, folder) values ('AAMk1', 'inbox') $$, '23505', null, 'повторно то же письмо не закрепить');
insert into public.mail_pins (message_id, folder) select 'M' || g, 'inbox' from generate_series(2, 20) g;
select throws_ok($$ insert into public.mail_pins (message_id, folder) values ('M21', 'inbox') $$, '23514', null, 'больше 20 нельзя');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select is((select count(*)::int from public.mail_pins), 0, 'чужие закреплённые не видно');
select lives_ok($$ delete from public.mail_pins where message_id = 'AAMk1' $$, 'удаление чужого молча ничего не делает');
select pg_temp.back();

select * from finish();
rollback;
