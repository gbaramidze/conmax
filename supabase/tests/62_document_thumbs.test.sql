-- Требует сид-данных. Миниатюры документов: отметка в files.meta, права, реестр отдаёт файл-источник и признак.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select d.id as doc, f.id as fid, f.storage_key as skey
  from public.documents d
  join public.document_versions v on v.id = d.current_version_id
  join public.files f on f.id = v.file_id
 where d.project_id = :'zk7' and d.deleted_at is null limit 1 \gset

select pg_temp.act_as('pm1@demo.test');
select is((select has_thumb from public.documents_overview where id = :'doc'), false, 'до отметки миниатюры нет');
select throws_ok(format($$select public.file_thumb_mark(%L)$$, :'fid'), 'P0002', 'thumb_missing', 'без объекта в хранилище отметить нельзя');
select pg_temp.back();

-- «загрузка» миниатюры (в тесте вставляем объект напрямую)
insert into storage.objects (bucket_id, name, owner, metadata) values ('files', :'skey' || '.thumb.jpg', null, '{"mimetype":"image/jpeg"}');

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.file_thumb_mark(%L)$$, :'fid'), 'после загрузки отметка ставится');
select is((select has_thumb from public.documents_overview where id = :'doc'), true, 'реестр видит миниатюру');
select ok((select thumb_source_key from public.documents_overview where id = :'doc') = :'skey', 'источник миниатюры — файл версии');
select pg_temp.back();

-- миниатюру читает тот, кто видит файл; посторонний организации — нет
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'files' and name = :'skey' || '.thumb.jpg'), 1, 'миниатюру видит тот, кто видит файл');
select pg_temp.back();

select throws_ok(format($$select public.file_thumb_mark(%L)$$, '00000000-0000-0000-0000-000000000000'), 'P0002', 'file_not_found', 'чужого или несуществующего файла нет');

-- без права комментировать отметку не поставить
select pg_temp.act_as('director@demo.test');
select throws_ok(format($$select public.file_thumb_mark(%L)$$, :'fid'), '42501', null, 'без права комментировать отметка запрещена');
select pg_temp.back();

select * from finish();
rollback;
