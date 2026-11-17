-- Требует сид-данных. Push на уведомления, письма наблюдателям сразу, любые изменения карточки задачи для наблюдателей, адресат заметки.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
-- действие «от имени» человека без смены роли (для прямых правок таблиц из теста)
create function pg_temp.claims_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as floor1 from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null order by path limit 1 \gset

delete from public.notifications;
delete from public.email_outbox;

-- 1. Наблюдатель: gip следит за задачей, pm1 меняет карточку
select pg_temp.act_as('pm1@demo.test');
select id as t1 from public.create_task(:'zk7', 'Задача для наблюдателей', 'task', :'foreman1') \gset
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
insert into public.watchers (entity_type, entity_id, user_id) values ('task', :'t1', :'gip');
select pg_temp.back();

select pg_temp.claims_as('pm1@demo.test');
update public.tasks set priority = 'high', title = 'Задача для наблюдателей (правка)' where id = :'t1';

select ok(exists (select 1 from public.notifications where user_id = :'gip' and entity_id = :'t1' and (payload -> 'counts') ? 'changed'),
          'наблюдатель получил уведомление об изменении приоритета и названия');
select ok((select body from public.notifications where user_id = :'gip' and entity_id = :'t1') ilike '%приоритет%',
          'в тексте перечислено, что изменилось');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and entity_id = :'t1'), 0, 'автор правки себя не уведомляет');

-- описание: тоже изменение карточки
update public.tasks set description = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Новый текст"}]}]}'::jsonb where id = :'t1';
select ok((select (payload -> 'counts' ->> 'changed')::int from public.notifications where user_id = :'gip' and entity_id = :'t1') >= 2,
          'следующее изменение дополняет то же уведомление (счётчик изменений)');

-- 2. Письмо наблюдателю — «сразу» по умолчанию (раньше — сводка)
select is(private.channel_mode(:'gip', 'watching', 'email'), 'instant', 'письма «наблюдаю» по умолчанию приходят сразу');
select ok(exists (select 1 from public.email_outbox o join public.notifications n on n.id = o.notification_id
                   where o.user_id = :'gip' and o.kind = 'instant' and n.entity_id = :'t1'), 'письмо наблюдателю поставлено в очередь');
select is(private.channel_mode(:'gip', 'mentioned', 'push'), 'instant', 'push по умолчанию включён');

-- 3. Push на уведомление
select id as n1 from public.notifications where user_id = :'gip' and entity_id = :'t1' \gset
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
values (:'tenant', :'gip', 'https://push.example/gip-phone', 'k', 'a');
select is((select count(*)::int from public.notification_push_targets(:'n1')), 1, 'push уходит на устройство получателя');

select pg_temp.claims_as('gip@demo.test');
insert into public.notification_preferences (category, channel, mode) values ('watching', 'push', 'off');
select is((select count(*)::int from public.notification_push_targets(:'n1')), 0, 'канал push по категории можно выключить');
delete from public.notification_preferences where user_id = :'gip';

update public.notifications set read_at = now() where id = :'n1';
select is((select count(*)::int from public.notification_push_targets(:'n1')), 0, 'прочитанное уведомление не отправляется');
update public.notifications set read_at = null where id = :'n1';

-- 4. Заметка, адресованная человеку
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('location', :'floor1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Трещина у окна"}]}]}'::jsonb, 'internal');
select id as note from public.comments where entity_type = 'location' and entity_id = :'floor1' and author_id = :'pm1' order by created_at desc limit 1 \gset
select public.register_field_note(:'note', :'gip', null, null);
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = :'gip' and event_type = 'note.assigned'), 1, 'адресат заметки получил уведомление');
select ok((select payload ->> 'link' from public.notifications where user_id = :'gip' and event_type = 'note.assigned') like '/projects/ZK7/locations/%',
          'уведомление ведёт к месту заметки');

select pg_temp.act_as('pm1@demo.test');
select public.register_field_note(:'note', :'gip', null, null);
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'gip' and event_type = 'note.assigned'), 1, 'повторная регистрация с тем же адресатом не дублирует уведомление');

select pg_temp.act_as('pm1@demo.test');
select public.set_field_note_addressee(:'note', :'foreman1', null);
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'foreman1' and event_type = 'note.assigned'), 1, 'новый адресат при передаче заметки получил уведомление');

-- общий push «Новая заметка» адресату не дублируется
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
values (:'tenant', :'foreman1', 'https://push.example/foreman-phone', 'k', 'a');
select ok(not exists (select 1 from public.field_note_push_targets(:'note') where user_id = :'foreman1'), 'адресату общий push о заметке не уходит: у него личное уведомление');

select * from finish();
rollback;
