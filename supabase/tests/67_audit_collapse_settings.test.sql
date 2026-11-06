-- Требует сид-данных. Лента проекта: переключения настроек схлопываются, остальные изменения пишутся по-прежнему.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset

delete from public.entity_events where entity_type = 'project' and entity_id = :'zk7' and event_type = 'field_changed';
update public.projects set settings = '{}'::jsonb where id = :'zk7';
delete from public.entity_events where entity_type = 'project' and entity_id = :'zk7' and event_type = 'field_changed';

-- первый человек переключает настройку трижды
select set_config('request.jwt.claims', json_build_object('sub', :'pm1', 'tenant_id', :'ten')::text, true);
update public.projects set settings = '{"progress_approval": true}' where id = :'zk7';
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed'), 1, 'первое переключение записано');
update public.projects set settings = '{"progress_approval": false}' where id = :'zk7';
update public.projects set settings = '{"progress_approval": true}' where id = :'zk7';
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed'), 1, 'повторные переключения не плодят записи');
select is((select changes -> 'settings' ->> 0 from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed'), '{}', '«было» остаётся от первого переключения');
select is((select changes -> 'settings' -> 1 ->> 'progress_approval' from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed'), 'true', '«стало» берётся от последнего');

-- вернули как было — записи нет совсем
update public.projects set settings = '{}'::jsonb where id = :'zk7';
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed'), 0, 'вернули исходное значение: запись исчезла');

-- другой человек: своя запись
update public.projects set settings = '{"progress_approval": true}' where id = :'zk7';
select set_config('request.jwt.claims', json_build_object('sub', :'pm2', 'tenant_id', :'ten')::text, true);
update public.projects set settings = '{"progress_approval": false}' where id = :'zk7';
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed'), 2, 'изменение другим человеком не склеивается с чужим');

-- другие поля пишутся отдельной записью всегда
update public.projects set address = 'Тестовая улица, 1' where id = :'zk7';
update public.projects set address = 'Тестовая улица, 2' where id = :'zk7';
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed' and changes ? 'address'), 2, 'обычные поля не склеиваются');
-- настройки вместе с другим полем — тоже обычная запись
update public.projects set address = 'Тестовая улица, 3', settings = '{"progress_approval": true}' where id = :'zk7';
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'field_changed' and changes ? 'address' and changes ? 'settings'), 1, 'настройки вместе с другим полем пишутся как есть');

select * from finish();
rollback;
