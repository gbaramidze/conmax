-- Требует сид-данных. Push о сообщениях чата: подписка устройства, кому уходит push (не автору, только видящим канал, не в тихие часы), отписка.
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

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset
select id as director from public.users where email = 'director@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset

delete from public.chat_messages;
delete from public.chat_channels;

-- подписка устройства
select pg_temp.act_as('pm1@demo.test');
select lives_ok($$select public.push_subscribe('https://push.example/pm1', 'key-1', 'auth-1', 'Chrome')$$, 'устройство подписывается');
select throws_ok($$select public.push_subscribe('http://push.example/bad', 'key-1', 'auth-1')$$, '22023', null, 'адрес не по https отклоняется');
select isnt(public.push_public_key(), null, 'публичный ключ VAPID доступен вошедшему');
select public.chat_open(null, 'direct', null, :'sub1') as dm \gset
select public.chat_send(:'dm', 'Привет') as m1 \gset
select public.chat_group_create('Планёрка', array[:'director', :'pm2']::uuid[]) as grp \gset
select public.chat_send(:'grp', 'Всем привет') as m2 \gset
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select public.push_subscribe('https://push.example/sub1', 'key-2', 'auth-2', 'Safari');
select pg_temp.back();

select pg_temp.act_as('director@demo.test');
select public.push_subscribe('https://push.example/director', 'key-3', 'auth-3', 'Firefox');
select pg_temp.back();

-- в личной переписке push получает собеседник, автор — нет
select is((select array_agg(user_id) from public.chat_push_targets(:'m1')), array[:'sub1']::uuid[], 'личное сообщение: push только собеседнику');
-- в группе — только участник с подпиской (pm2 не подписан, sub1 в группе не состоит, автор исключён)
select is((select array_agg(user_id) from public.chat_push_targets(:'m2')), array[:'director']::uuid[], 'группа: push только участникам с подпиской');

-- тихие часы получателя
insert into public.user_notification_settings (user_id, tenant_id, timezone, quiet_enabled, quiet_start, quiet_end)
values (:'director', (select tenant_id from public.users where id = :'director'), 'UTC', true,
        (now() at time zone 'UTC')::time - interval '1 hour', (now() at time zone 'UTC')::time + interval '1 hour')
on conflict (user_id) do update
  set timezone = excluded.timezone, quiet_enabled = excluded.quiet_enabled, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end;
select is((select count(*)::int from public.chat_push_targets(:'m2')), 0, 'в тихие часы push не уходит');

-- удалённое сообщение
select pg_temp.act_as('pm1@demo.test');
select public.chat_delete(:'m1');
select pg_temp.back();
select is((select count(*)::int from public.chat_push_targets(:'m1')), 0, 'про удалённое сообщение push не уходит');

-- отписка: чужую подписку удалить нельзя, свою можно
select pg_temp.act_as('sub1@demo.test');
select public.push_unsubscribe('https://push.example/pm1');
select pg_temp.back();
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example/pm1'), 1, 'чужую подписку не удалить');
select pg_temp.act_as('sub1@demo.test');
select public.push_unsubscribe('https://push.example/sub1');
select pg_temp.back();
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example/sub1'), 0, 'свою подписку можно убрать');

-- общий телефон: устройство, подписанное под другим человеком, переходит к тому, кто вошёл
select pg_temp.act_as('sub1@demo.test');
select public.push_subscribe('https://push.example/pm1', 'key-9', 'auth-9', 'Chrome');
select pg_temp.back();
select is((select user_id from public.push_subscriptions where endpoint = 'https://push.example/pm1'), :'sub1'::uuid, 'подписка устройства переходит к вошедшему');

select * from finish();
rollback;
