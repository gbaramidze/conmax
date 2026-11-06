-- Требует сид-данных. Загрузка файлов в проект: участники с правом комментировать, загружать документы или править проект.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

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

select pg_temp.act_as('admin@demo.test');
select lives_ok(format($$insert into public.files (project_id, storage_key, name, mime, size_bytes) values (%L, %L, 'Фото.jpg', 'image/jpeg', 10)$$, :'zk7', :'ten' || '/' || :'zk7' || '/adm1.jpg'),
  'администратор организации (не участник проекта) может загрузить файл');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('files', %L, (select auth.uid())::text)$$, :'ten' || '/' || :'zk7' || '/adm2.jpg'), 'и положить объект в хранилище');
select pg_temp.back();

select pg_temp.act_as('director@demo.test');
select throws_ok(format($$insert into public.files (project_id, storage_key, name, mime, size_bytes) values (%L, %L, 'x.jpg', 'image/jpeg', 10)$$, :'zk7', :'ten' || '/' || :'zk7' || '/dir1.jpg'), '42501', null, 'директор без права загружать файлы не может');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$insert into public.files (project_id, storage_key, name, mime, size_bytes) values (%L, %L, 'p.jpg', 'image/jpeg', 10)$$, :'zk7', :'ten' || '/' || :'zk7' || '/pm1.jpg'), 'руководитель проекта загружает как обычно');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select lives_ok(format($$insert into public.files (project_id, storage_key, name, mime, size_bytes) values (%L, %L, 'c.jpg', 'image/jpeg', 10)$$, :'zk7', :'ten' || '/' || :'zk7' || '/cl1.jpg'), 'заказчик с правом комментировать прикладывает файлы, как и раньше');
select pg_temp.back();

select * from finish();
rollback;
