-- Доступ к файлам: видны только тем, кто видит вложение (с учётом internal/external комментариев).
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

select p.id as zk7, p.tenant_id as tenant from public.projects p where p.code = 'ZK7' \gset
select id as bc2 from public.projects where code = 'BC2' \gset
select gen_random_uuid() as internal_key, gen_random_uuid() as external_key \gset

-- Данные готовим как РП, через реальные пути записи (триггеры берут тенанта и автора из JWT)
select pg_temp.act_as('pm1@demo.test');

insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', '{"type":"doc","content":[]}', 'internal');
select id as c_internal from public.comments where visibility = 'internal' order by created_at desc limit 1 \gset
insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', '{"type":"doc","content":[]}', 'external');
select id as c_external from public.comments where visibility = 'external' order by created_at desc limit 1 \gset

insert into public.files (project_id, storage_key, name, mime, size_bytes) values
  (:'zk7', :'tenant' || '/' || :'zk7' || '/' || :'internal_key' || '.txt', 'internal.txt', 'text/plain', 1),
  (:'zk7', :'tenant' || '/' || :'zk7' || '/' || :'external_key' || '.txt', 'external.txt', 'text/plain', 1);

insert into public.attachments (entity_type, entity_id, file_id, comment_id)
select 'project', :'zk7', f.id, case f.name when 'internal.txt' then :'c_internal'::uuid else :'c_external'::uuid end
from public.files f where f.name in ('internal.txt', 'external.txt');

insert into storage.objects (bucket_id, name, owner_id)
select 'files', f.storage_key, auth.uid() from public.files f where f.name in ('internal.txt', 'external.txt');
select pg_temp.back();

-- Участник с правом внутренних данных видит оба файла
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'files'
            and name in (:'tenant' || '/' || :'zk7' || '/' || :'internal_key' || '.txt', :'tenant' || '/' || :'zk7' || '/' || :'external_key' || '.txt')),
          2, 'прораб видит оба файла в Storage');
select pg_temp.back();

-- Субподрядчик: только файл из внешнего комментария
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'files' and name = :'tenant' || '/' || :'zk7' || '/' || :'external_key' || '.txt'),
          1, 'субподрядчик видит файл из внешнего комментария');
select is((select count(*)::int from storage.objects where bucket_id = 'files' and name = :'tenant' || '/' || :'zk7' || '/' || :'internal_key' || '.txt'),
          0, 'субподрядчик не видит файл из внутреннего комментария');
-- (другие файлы проекта, загруженные вручную, на проверку не влияют — смотрим только файлы этого теста)
select is((select count(*)::int from public.files
            where storage_key in (:'tenant' || '/' || :'zk7' || '/' || :'internal_key' || '.txt', :'tenant' || '/' || :'zk7' || '/' || :'external_key' || '.txt')),
          1, 'в таблице files субподрядчик видит только файл внешнего комментария');
select throws_ok(
  format($$insert into storage.objects (bucket_id, name, owner_id) values ('files', %L, auth.uid())$$, :'tenant' || '/' || :'bc2' || '/evil.txt'),
  '42501', null, 'субподрядчик не может загрузить файл в папку чужого проекта');
select pg_temp.back();

select * from finish();
rollback;
