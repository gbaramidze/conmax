-- Требует сид-данных. Вложения карточек: свой файл или документ проекта; видят те, кто видит карточку;
-- чужой файл и документ другого проекта прикрепить нельзя; удаляет автор вложения или управляющий доской; история; «выполнено».
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' and tenant_id = :'tenant' \gset
select id as other from public.projects where tenant_id = :'tenant' and id <> :'zk7' order by created_at limit 1 \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset

-- документы: в этом проекте и в другом
insert into public.documents (tenant_id, project_id, title, code, visibility) values (:'tenant', :'other', 'Чужой документ', null, 'internal');
-- документ ZK7, который мастер видит: общий (external), с опубликованной версией. В сиде документов нет — заводим свой
-- (сессия руководителя проекта — для триггеров, берущих компанию из сессии; роль остаётся служебной)
select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated', 'tenant_id', tenant_id)::text, true)
  from public.users where email = 'pm1@demo.test';
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes)
values (:'tenant', :'zk7', :'tenant' || '/' || :'zk7' || '/plan-ar12.pdf', 'План 1 этажа.pdf', 'application/pdf', 5000) returning id as doc_file \gset
insert into public.documents (tenant_id, project_id, title, code, doc_type, visibility)
values (:'tenant', :'zk7', 'План 1 этажа', 'АР-12', 'plan', 'external') returning id as doc \gset
insert into public.document_versions (tenant_id, project_id, document_id, version_no, file_id, status, published_at)
values (:'tenant', :'zk7', :'doc', 1, :'doc_file', 'published', now()) returning id as doc_ver \gset
update public.documents set current_version_id = :'doc_ver' where id = :'doc';
\set doc_name 'АР-12 — План 1 этажа'
select id as doc_other from public.documents where title = 'Чужой документ' and project_id = :'other' \gset

-- доска: master — участник доски и карточки, foreman1 — участник доски, но не карточки
select pg_temp.act_as('pm1@demo.test');
select public.board_create(:'zk7', 'shared', 'Вложения', 'blue', false, array['Сделать']) as board \gset
insert into public.board_members (board_id, user_id) values (:'board', :'master'), (:'board', :'foreman1');
insert into public.board_cards (board_id, list_id, title) select :'board', id, 'Отделка холла' from public.board_lists where board_id = :'board';
select id as card from public.board_cards where board_id = :'board' and title = 'Отделка холла' \gset
insert into public.board_card_members (card_id, user_id, board_id) values (:'card', :'master', :'board');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/pm-file.pdf', 'Смета.pdf', 'application/pdf', 1000) returning id as pm_file \gset
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/master-photo.jpg', 'Фото стены.jpg', 'image/jpeg', 2000) returning id as m_file \gset
select lives_ok(format($$insert into public.board_card_attachments (board_id, card_id, file_id, name) values (%L, %L, %L, 'подмена')$$, :'board', :'card', :'m_file'),
  'участник карточки прикрепляет свой файл');
select is((select name from public.board_card_attachments where file_id = :'m_file'), 'Фото стены.jpg', 'название берётся из файла');
select throws_ok(format($$insert into public.board_card_attachments (board_id, card_id, file_id, name) values (%L, %L, %L, 'x')$$, :'board', :'card', :'pm_file'),
  '42501', null, 'чужой файл прикрепить нельзя');
select lives_ok(format($$insert into public.board_card_attachments (board_id, card_id, document_id, name) values (%L, %L, %L, 'x')$$, :'board', :'card', :'doc'),
  'документ проекта прикрепляется');
select is((select name from public.board_card_attachments where document_id = :'doc'), :'doc_name', 'с шифром и названием документа');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$insert into public.board_card_attachments (board_id, card_id, document_id, name) values (%L, %L, %L, 'x')$$, :'board', :'card', :'doc_other'),
  '42501', null, 'документ другого проекта прикрепить нельзя');
select is((select count(*)::int from public.board_card_attachments where card_id = :'card'), 2, 'руководитель видит вложения');
select is((select name from public.files where id = :'m_file'), 'Фото стены.jpg', 'и сам загруженный файл');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.board_card_attachments where card_id = :'card'), 0, 'участник доски, который не видит карточку, вложений не видит');
select is((select count(*)::int from public.files where id = :'m_file'), 0, 'и файла тоже');
select pg_temp.back();

select is((select count(*)::int from public.board_activity where card_id = :'card' and kind = 'attached'), 2, 'история: «прикрепил»');

-- удаление
select pg_temp.act_as('pm1@demo.test');
insert into public.board_card_attachments (board_id, card_id, file_id, name) values (:'board', :'card', :'pm_file', 'x');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
delete from public.board_card_attachments where file_id = :'pm_file';
select is((select count(*)::int from public.board_card_attachments where file_id = :'pm_file'), 1, 'чужое вложение участник не удаляет');
update public.board_cards set completed = true where id = :'card';
select pg_temp.back();
select ok((select completed from public.board_cards where id = :'card'), 'участник отмечает карточку выполненной');

select pg_temp.act_as('pm1@demo.test');
delete from public.board_card_attachments where file_id = :'m_file';
select pg_temp.back();
select is((select count(*)::int from public.board_card_attachments where file_id = :'m_file'), 0, 'управляющий доской удаляет любое вложение');
select is((select count(*)::int from public.board_card_attachments where document_id = :'doc'), 1, 'остальные на месте');

-- файлы проекта: каталог и прикрепление чужого, но видимого файла
select pg_temp.act_as('pm1@demo.test');
select ok((select count(*) from public.project_file_catalog(:'zk7') where kind = 'plan') > 0, 'каталог файлов проекта: есть чертежи и схемы');
select is((select count(*)::int from public.project_file_catalog(:'zk7') c where c.document_id is not null
            and not private.user_can_view_document(auth.uid(), c.document_id)), 0, 'в каталоге только видимые мне документы');
select pg_temp.back();
-- файл руководителя (прикреплён к карточке выше) мастер видит — и может прикрепить его к своей карточке
select pg_temp.act_as('master@demo.test');
insert into public.board_cards (board_id, list_id, title) select :'board', id, 'Карточка мастера' from public.board_lists where board_id = :'board';
select lives_ok(format($$insert into public.board_card_attachments (board_id, card_id, file_id, name)
  select %L, id, %L, 'x' from public.board_cards where board_id = %L and title = 'Карточка мастера'$$, :'board', :'pm_file', :'board'),
  'видимый файл проекта, загруженный другим человеком, прикрепляется');
select pg_temp.back();
-- файл другого проекта той же компании
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes)
values (:'tenant', :'other', :'tenant' || '/' || :'other' || '/foreign.jpg', 'Чужое фото.jpg', 'image/jpeg', 1000) returning id as foreign_file \gset
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$insert into public.board_card_attachments (board_id, card_id, file_id, name) values (%L, %L, %L, 'x')$$, :'board', :'card', :'foreign_file'),
  '42501', null, 'файл другого проекта прикрепить нельзя');
select pg_temp.back();

select * from finish();
rollback;
