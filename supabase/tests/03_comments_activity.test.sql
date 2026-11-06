-- Требует сид-данных. Проверяет комментарии, видимость internal/external, вложения и ленту событий.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select p.id as zk7, p.tenant_id as tenant from public.projects p where p.code = 'ZK7' \gset
select id as bc2 from public.projects where code = 'BC2' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset

-- Документ Tiptap с упоминанием foreman1
select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
  jsonb_build_object('type', 'text', 'text', 'Проверьте армирование'),
  jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('id', :'foreman1', 'label', 'Фёдор Прорабов'))
)))) as doc \gset

-- 1. РП пишет внутренний комментарий
select pg_temp.act_as('pm1@demo.test');
select lives_ok(
  format($$insert into public.comments (entity_type, entity_id, body, visibility) values ('project', %L, %L::jsonb, 'internal')$$, :'zk7', :'doc'),
  'РП создаёт внутренний комментарий');
select is((select body_text from public.comments order by created_at desc limit 1), 'Проверьте армирование @Фёдор Прорабов',
          'body_text строится на сервере из документа и упоминаний');
select is((select (mentions -> 0 ->> 'id') from public.comments order by created_at desc limit 1), :'foreman1',
          'упоминания извлекаются на сервере');
select is((select author_id from public.comments order by created_at desc limit 1), (select id from public.users where email = 'pm1@demo.test'),
          'автор проставляется сервером');
select throws_ok(
  format($$insert into public.comments (entity_type, entity_id, body, author_id) values ('project', %L, %L::jsonb, %L)$$, :'zk7', :'doc', :'foreman1'),
  '42501', null, 'нельзя подставить чужого автора (нет права на колонку)');
select pg_temp.back();

-- 2. Внешний не видит внутренние комментарии и события, не может писать внутренние
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.comments where visibility = 'internal'), 0, 'субподрядчик не видит internal-комментарии');
select throws_ok(
  format($$insert into public.comments (entity_type, entity_id, body, visibility) values ('project', %L, %L::jsonb, 'internal')$$, :'zk7', :'doc'),
  '42501', null, 'субподрядчик не может писать internal-комментарии');
select lives_ok(
  format($$insert into public.comments (entity_type, entity_id, body, visibility) values ('project', %L, %L::jsonb, 'external')$$, :'zk7', :'doc'),
  'субподрядчик пишет внешний комментарий');
select is((select count(*)::int from public.entity_events where event_type = 'member_added'), 0, 'внешний не видит служебные события (участники)');
select pg_temp.back();

-- 3. Чужой проект
select pg_temp.act_as('pm1@demo.test');
select throws_ok(
  format($$insert into public.comments (entity_type, entity_id, body, visibility) values ('project', %L, %L::jsonb, 'internal')$$, :'bc2', :'doc'),
  '42501', null, 'нельзя комментировать недоступный проект');
select pg_temp.back();

-- 4. Правка чужого комментария
select pg_temp.act_as('foreman1@demo.test');
update public.comments set body = jsonb_build_object('type', 'doc', 'content', '[]'::jsonb) where visibility = 'internal';
select pg_temp.back();
select ok((select body_text from public.comments where visibility = 'internal' and author_id <> :'foreman1' order by created_at desc limit 1) like 'Проверьте%',
          'прораб не может переписать чужой комментарий');

-- 5. Лента событий
select pg_temp.act_as('pm1@demo.test');
select ok(exists (select 1 from public.entity_events where event_type = 'commented' and entity_id = :'zk7'), 'комментарий попал в ленту событий');
select throws_ok($$insert into public.entity_events (tenant_id, entity_type, entity_id, event_type) select tenant_id, 'project', id, 'fake' from public.projects limit 1$$,
                 '42501', null, 'клиент не может писать в журнал событий напрямую');
select pg_temp.back();

-- 6. Файлы: ключ должен лежать в папке своего тенанта и проекта
select pg_temp.act_as('pm1@demo.test');
select throws_ok(
  format($$insert into public.files (project_id, storage_key, name, mime, size_bytes) values (%L, 'evil/path/x.pdf', 'x.pdf', 'application/pdf', 1)$$, :'zk7'),
  '23514', null, 'storage_key вне папки тенанта/проекта отклоняется');
select pg_temp.back();

select * from finish();
rollback;
