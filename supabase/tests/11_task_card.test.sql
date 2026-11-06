-- Требует сид-данных. Чек-листы задачи и удаление вложений.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as task from public.tasks where project_id = :'zk7' and key = 'ZK7-T-1' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset

-- 1. Чек-лист и пункты: правит тот, кто правит задачу
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$insert into public.checklists (entity_type, entity_id, title) values ('task', %L, '  Тестовый чек-лист pgTAP  ')$$, :'task'), 'РП создаёт чек-лист');
select is((select title from public.checklists where entity_id = :'task' and title like 'Тестовый%'), 'Тестовый чек-лист pgTAP', 'название чек-листа обрезается по краям');
select id as cl from public.checklists where entity_id = :'task' and title like 'Тестовый%' \gset
select lives_ok(format($$insert into public.checklist_items (checklist_id, text) values (%L, 'Проверить сертификаты')$$, :'cl'), 'РП добавляет пункт');
select throws_ok(format($$insert into public.checklist_items (checklist_id, text) values (%L, '   ')$$, :'cl'), '23514', null, 'пустой пункт отклоняется');
select id as item from public.checklist_items where checklist_id = :'cl' \gset

update public.checklist_items set done = true where id = :'item';
select is((select done_by from public.checklist_items where id = :'item'), :'pm1'::uuid, 'при отметке запоминается, кто отметил');
update public.checklist_items set done = false where id = :'item';
select is((select done_at from public.checklist_items where id = :'item'), null, 'при снятии отметки время сбрасывается');
select pg_temp.back();

-- 2. Наблюдатель видит, но не правит
select pg_temp.act_as('observer@demo.test');
select is((select count(*)::int from public.checklists where id = :'cl'), 1, 'наблюдатель видит чек-лист задачи');
select throws_ok(format($$insert into public.checklists (entity_type, entity_id, title) values ('task', %L, 'Лишний')$$, :'task'), '42501', null, 'наблюдатель не создаёт чек-листы');
update public.checklist_items set done = true where id = :'item';   -- RLS молча отфильтрует строку
select pg_temp.back();
select is((select done from public.checklist_items where id = :'item'), false, 'наблюдатель не отмечает пункты');

-- 3. Подрядчик не видит чек-лист чужой задачи
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.checklists where id = :'cl'), 0, 'подрядчик не видит чек-лист недоступной ему задачи');
select pg_temp.back();

-- 4. Вложения: удалить может автор; запись о файле уходит с последним вложением
select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/test-card.pdf', 'схема.pdf', 'application/pdf', 1000);
insert into public.attachments (entity_type, entity_id, file_id)
select 'task', :'task', id from public.files where storage_key = :'tenant' || '/' || :'zk7' || '/test-card.pdf';
select pg_temp.back();
select pg_temp.act_as('observer@demo.test');
delete from public.attachments where entity_id = :'task' and file_id = (select id from public.files where storage_key like '%/test-card.pdf');
select pg_temp.back();
select is((select count(*)::int from public.attachments a join public.files f on f.id = a.file_id where a.entity_id = :'task' and f.storage_key like '%/test-card.pdf'), 1, 'чужое вложение наблюдатель удалить не может');
select pg_temp.act_as('pm1@demo.test');
delete from public.attachments where entity_id = :'task' and file_id = (select id from public.files where storage_key like '%/test-card.pdf');
select pg_temp.back();
select is((select count(*)::int from public.attachments a join public.files f on f.id = a.file_id where a.entity_id = :'task' and f.storage_key like '%/test-card.pdf'), 0, 'автор удаляет своё вложение');
select is((select count(*)::int from public.files where storage_key = :'tenant' || '/' || :'zk7' || '/test-card.pdf'), 0, 'запись о файле удалена вместе с последним вложением');

select * from finish();
rollback;
