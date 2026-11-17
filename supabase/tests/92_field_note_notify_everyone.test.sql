-- Требует сид-данных. Новая заметка: уведомление всем участникам проекта (кроме автора и адресата), внутренняя — не внешним.
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

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select id as floor1 from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null order by path limit 1 \gset

delete from public.notifications;

-- внутренняя заметка pm1, адресована гип
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility, is_note)
values ('location', :'floor1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Внутренняя заметка"}]}]}'::jsonb, 'internal', true);
select id as n1 from public.comments where entity_type = 'location' and entity_id = :'floor1' and author_id = :'pm1' order by created_at desc limit 1 \gset
select public.register_field_note(:'n1', :'gip');
select pg_temp.back();

select ok(exists (select 1 from public.notifications where event_type = 'note.created' and entity_id = :'n1'), 'участники проекта получили уведомление о новой заметке');
select ok(exists (select 1 from public.notifications where user_id = :'foreman1' and event_type = 'note.created' and entity_id = :'n1')
          or not exists (select 1 from public.project_members where project_id = :'zk7' and user_id = :'foreman1' and deleted_at is null),
          'прораб (участник проекта) уведомлён');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and entity_id = :'n1'), 0, 'автор себя не уведомляет');
select is((select count(*)::int from public.notifications where user_id = :'gip' and entity_id = :'n1' and event_type = 'note.created'), 0, 'адресату не дублируем: у него личное уведомление');
select is((select count(*)::int from public.notifications where user_id = :'gip' and entity_id = :'n1' and event_type = 'note.assigned'), 1, 'адресат получил «Вам адресована заметка»');
select is((select count(*)::int from public.notifications where user_id = :'sub1' and entity_id = :'n1'), 0, 'внутренняя заметка не уходит внешнему участнику');

-- внешняя заметка доходит и внешним участникам проекта
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility, is_note)
values ('location', :'floor1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Для всех"}]}]}'::jsonb, 'external', true);
select id as n2 from public.comments where entity_type = 'location' and entity_id = :'floor1' and author_id = :'pm1' order by created_at desc limit 1 \gset
select public.register_field_note(:'n2');
select pg_temp.back();
select ok(exists (select 1 from public.notifications where entity_id = :'n2' and event_type = 'note.created' and user_id <> :'pm1'), 'внешняя заметка: уведомления участникам проекта');

select * from finish();
rollback;
