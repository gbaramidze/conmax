-- Требует сид-данных. Папки документов: дерево, перенос, удаление, права, видимость.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
select tenant_id as ten from public.projects where code = 'ZK7' \gset

select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/f1.pdf', 'Файл1.pdf', 'application/pdf', 100) returning id as fl \gset
select public.create_document(:'zk7', 'Документ в папке', 'FLD-1', 'plan', null, 'external', false, :'fl', 'A', null, '{}', '{}', true) as doc \gset

-- ---- создание ----
select public.create_folder(:'zk7', null, 'Архитектура') as a \gset
select public.create_folder(:'zk7', :'a', 'Корпус 1') as k1 \gset
select is((select parent_id from public.document_folders where id = :'k1'), :'a'::uuid, 'вложенная папка создана');
select throws_ok(format($$select public.create_folder(%L, %L, 'корпус 1')$$, :'zk7', :'a'), '23505', 'folder_exists', 'имя среди соседей уникально без учёта регистра');
select throws_ok(format($$select public.create_folder(%L, null, '  ')$$, :'zk7'), '22023', 'name_required', 'пустое имя отклоняется');

-- путь: недостающее создаётся, существующее переиспользуется
select public.ensure_folder_path(:'zk7', null, array['Архитектура', 'Корпус 1', 'Этаж 5']) as f5 \gset
select is((select parent_id from public.document_folders where id = :'f5'), :'k1'::uuid, 'путь достроен до нужной папки');
select is(public.ensure_folder_path(:'zk7', null, array['Архитектура', 'Корпус 1', 'Этаж 5']), :'f5'::uuid, 'повторный вызов возвращает ту же папку');
select is((select count(*)::int from public.document_folders where project_id = :'zk7' and lower(name) = 'архитектура' and deleted_at is null), 1, 'дубликатов не появилось');

-- ---- перенос ----
select is(public.move_documents(array[:'doc']::uuid[], :'f5'), 1, 'документ перенесён в папку');
select is((select folder_id from public.documents_overview where id = :'doc'), :'f5'::uuid, 'реестр показывает папку документа');
select throws_ok(format($$select public.move_folder(%L, %L)$$, :'a', :'f5'), '23514', 'cycle_in_hierarchy', 'папку нельзя переместить в свою вложенную');
select lives_ok(format($$select public.move_folder(%L, null)$$, :'k1'), 'папку можно вынести в корень');
select pg_temp.back();

-- ---- права и видимость ----
select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$select public.create_folder(%L, null, 'Чужая')$$, :'zk7'), '42501', null, 'без права загружать документы папку не создать');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.document_folders), 0, 'внешние папок не видят');
select is((select count(*)::int from public.documents_overview where id = :'doc'), 1, 'но документ, открытый им, видят');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is(public.move_documents(array[:'doc']::uuid[], :'a'), 0, 'чужой документ без права правки не переносится');
select pg_temp.back();

-- ---- удаление поднимает содержимое ----
select pg_temp.act_as('pm1@demo.test');
select public.delete_folder(:'f5');
select is((select folder_id from public.documents where id = :'doc'), :'k1'::uuid, 'при удалении папки документ поднялся на уровень выше');
select is((select count(*)::int from public.document_folders where id = :'f5' and deleted_at is null), 0, 'удалённая папка не видна');
select pg_temp.back();

select * from finish();
rollback;
