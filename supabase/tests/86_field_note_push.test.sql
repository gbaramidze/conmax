-- Требует сид-данных. Push о заметке с площадки (комментарий к месту): кому уходит, что показывается в уведомлении, защита от повторов и чужих вызовов.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as floor1 from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null order by path limit 1 \gset

-- подписки устройств: автор (pm1), ГИП (видит внутреннее), директор и подрядчик (видят только внешнее), второй РП (не на проекте)
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth) values
  (:'tenant', :'pm1', 'https://push.example/n-pm1', 'k', 'a'),
  (:'tenant', :'director', 'https://push.example/n-director', 'k', 'a'),
  (:'tenant', :'gip', 'https://push.example/n-gip', 'k', 'a'),
  (:'tenant', :'pm2', 'https://push.example/n-pm2', 'k', 'a'),
  (:'tenant', :'sub1', 'https://push.example/n-sub1', 'k', 'a');

-- пишем внутреннюю заметку pm1 к этажу
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('location', :'floor1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Трещина в стяжке"}]}]}'::jsonb, 'internal');
select pg_temp.back();
select id as note from public.comments where entity_type = 'location' and entity_id = :'floor1' and author_id = :'pm1' order by created_at desc limit 1 \gset

-- внутренняя заметка: автору не приходит, видящим внутренние комментарии — приходит, остальным — нет
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'pm1'), 0, 'автору push о его заметке не уходит');
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'gip'), 1, 'ГИП получает push о внутренней заметке');
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'director'), 0, 'внутренняя заметка не уходит тому, кто видит только внешнее');
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'sub1'), 0, 'внутренняя заметка не уходит подрядчику');

-- заметка «для подрядчиков и заказчика» уходит и тем, кто видит только внешнее (если он участник проекта)
update public.comments set visibility = 'external' where id = :'note';
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'director'), 1, 'внешняя заметка уходит директору');
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'sub1'),
          (select (private.user_can_see_project(:'sub1', :'zk7'))::int), 'внешняя заметка уходит подрядчику, если он на проекте');

-- что показать в уведомлении
select is((select body_text from public.field_note_push_info(:'note')), 'Трещина в стяжке', 'в уведомлении текст заметки');
select ok((select location_label from public.field_note_push_info(:'note')) like '%' || (select name from public.locations where id = :'floor1'), 'в уведомлении этаж');
select is((select photo_count from public.field_note_push_info(:'note')), 0, 'без фото число фото равно нулю');

-- рассылка: чужую заметку разослать нельзя, свою — один раз
select pg_temp.act_as('pm2@demo.test');
select public.field_note_notify(:'note');
select pg_temp.back();
select is((select count(*)::int from private.field_note_pushes where comment_id = :'note'), 0, 'чужую заметку разослать нельзя');
select pg_temp.act_as('pm1@demo.test');
select public.field_note_notify(:'note');
select public.field_note_notify(:'note');
select pg_temp.back();
select is((select count(*)::int from private.field_note_pushes where comment_id = :'note'), 1, 'свою заметку — один раз, повтор ничего не меняет');

-- тихие часы получателя (настройки пишет сам получатель, как на сайте)
select pg_temp.act_as('director@demo.test');
insert into public.user_notification_settings (timezone, quiet_enabled, quiet_start, quiet_end)
values ('UTC', true, (now() at time zone 'UTC')::time - interval '1 hour', (now() at time zone 'UTC')::time + interval '1 hour')
on conflict (user_id) do update
  set timezone = excluded.timezone, quiet_enabled = excluded.quiet_enabled, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end;
select pg_temp.back();
select is((select count(*)::int from public.field_note_push_targets(:'note') where user_id = :'director'), 0, 'в тихие часы push о заметке не уходит');

select * from finish();
rollback;
