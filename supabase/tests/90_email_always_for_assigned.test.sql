-- Требует сид-данных. Письмо о назначении уходит, даже если уведомление уже прочитано в приложении; письмо наблюдателя по прочитанному — нет;
-- адрес берётся из актуального профиля.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
select id as fm from public.users where email = 'foreman1@demo.test' \gset

delete from public.email_outbox;
delete from public.notifications;

-- pm1 выдаёт задачу прорабу
select pg_temp.act_as('pm1@demo.test');
select id as t1 from public.create_task(:'zk7', 'Письмо при назначении', 'task', :'fm') \gset
select pg_temp.back();

select ok(exists (select 1 from public.email_outbox where user_id = :'fm' and kind = 'instant'), 'письмо исполнителю поставлено в очередь');

-- исполнитель сразу открыл уведомление в приложении
update public.notifications set read_at = now() where user_id = :'fm' and entity_id = :'t1';
update public.email_outbox set send_after = now() - interval '1 minute';

select is(jsonb_array_length(public.claim_emails(1000)), 1, 'прочитанное в приложении назначение всё равно уходит письмом');
select is((select status from public.email_outbox where user_id = :'fm'), 'sending', 'письмо о назначении не отменено');

-- письмо уходит на актуальный адрес профиля, а не на тот, что был при постановке в очередь
update public.email_outbox set status = 'pending', send_after = now() - interval '1 minute';
update public.users set email = 'new-foreman@example.test' where id = :'fm';
select is((public.claim_emails(1000) -> 0 ->> 'to'), 'new-foreman@example.test', 'письмо идёт на текущую почту профиля');

-- наблюдатель: прочитанное письмом не дублируем
update public.email_outbox set status = 'pending', send_after = now() - interval '1 minute';
update public.notifications set category = 'watching', priority = 'normal', read_at = now() where user_id = :'fm' and entity_id = :'t1';
select is(jsonb_array_length(public.claim_emails(1000)), 0, 'прочитанное «наблюдаю» письмом не дублируется');
select is((select status from public.email_outbox where user_id = :'fm'), 'skipped', 'письмо наблюдателю по прочитанному отменено');

select * from finish();
rollback;
