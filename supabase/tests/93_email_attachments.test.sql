-- Требует сид-данных. Письмо-уведомление получает файлы комментария-источника (упоминание, заметка).
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

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip, email as gip_email from public.users where email = 'gip@demo.test' \gset
select id as floor1 from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null order by path limit 1 \gset

delete from public.notifications;
delete from public.email_outbox;

-- упоминание в комментарии с фото
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(
  jsonb_build_object('type','text','text','Смотри фото '), jsonb_build_object('type','mention','attrs',jsonb_build_object('id', :'gip', 'label', 'G')))))), 'internal');
select id as c1 from public.comments where author_id = :'pm1' and entity_id = :'zk7' order by created_at desc limit 1 \gset
select pg_temp.back();
select :'tenant' || '/' || :'zk7' || '/' || gen_random_uuid() || '.jpg' as skey \gset
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes) values (:'tenant', :'zk7', :'skey', 'crack.jpg', 'image/jpeg', 1234);
insert into public.attachments (tenant_id, project_id, entity_type, entity_id, file_id, comment_id)
select :'tenant', :'zk7', 'project', :'zk7', f.id, :'c1' from public.files f where f.storage_key = :'skey';

select is((select payload ->> 'comment_id' from public.notifications where user_id = :'gip' and category = 'mentioned'), :'c1', 'уведомление помнит комментарий-источник');

update public.email_outbox set send_after = now();
create temp table claimed as select e from jsonb_array_elements(public.claim_emails(1000)) e where e ->> 'to' = :'gip_email';
select is((select count(*)::int from claimed), 1, 'письмо упомянутому выдано воркеру');
select is((select jsonb_array_length(e -> 'attachments') from claimed), 1, 'в письме есть файл комментария');
select is((select e -> 'attachments' -> 0 ->> 'name' from claimed), 'crack.jpg', 'имя файла передано');
select is((select e -> 'attachments' -> 0 ->> 'storage_key' from claimed), :'skey', 'ключ файла в хранилище передан');

select * from finish();
rollback;
