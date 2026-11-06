-- Миниатюры первой страницы PDF и картинок в реестре документов.
-- Миниатюру рисует браузер (pdf.js) при первом показе строки реестра и кладёт рядом с файлом: `<ключ файла>.thumb.jpg`
-- в том же бакете; в `files.meta` ставится отметка `thumb`, чтобы реестр знал, какие миниатюры уже есть.
-- Миниатюра видна тем, кому виден сам файл (политика ниже смотрит таблицу files с её RLS) и не хранится как отдельная запись files.
-- Так заполняются и уже загруженные документы, без пакетной обработки на сервере.
-- Миниатюра берётся от файла просмотра версии (PDF-печать чертежа DWG), а если его нет — от самого файла.
-- Рисовать вправе те же, кто комментирует в проекте (`comment.create`): им же открыта запись в бакет.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Миниатюры документов».

-- Читать миниатюру может тот, кто видит файл, от которого она сделана
create policy files_storage_select_thumb on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and name like '%.thumb.jpg'
    and exists (select 1 from public.files f where f.storage_key || '.thumb.jpg' = name)
  );

-- Отметить, что миниатюра файла нарисована и лежит в хранилище
create or replace function public.file_thumb_mark(p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.files;
begin
  select * into f from public.files where id = p_file and tenant_id = private.tenant_id();
  if not found then raise exception 'file_not_found' using errcode = 'P0002'; end if;
  if not private.has_project_permission(f.project_id, 'comment.create') then
    raise exception 'permission denied: comment.create' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = f.storage_key || '.thumb.jpg') then
    raise exception 'thumb_missing' using errcode = 'P0002';
  end if;
  update public.files set meta = meta || '{"thumb": true}'::jsonb where id = f.id;
end;
$$;
revoke execute on function public.file_thumb_mark(uuid) from public, anon;
grant execute on function public.file_thumb_mark(uuid) to authenticated;

-- Реестр: файл, от которого рисуется миниатюра (просмотр версии или сам файл), и есть ли она уже
create or replace view public.documents_overview with (security_invoker = true) as
select d.id, d.project_id, d.code, d.title, d.doc_type, d.discipline_id, d.visibility, d.requires_ack,
       d.created_by, d.created_at, d.updated_at,
       cv.id as current_version_id, cv.revision as current_revision, cv.version_no as current_version_no, cv.published_at,
       lv.id as latest_version_id, lv.status as latest_status, lv.revision as latest_revision,
       f.name as file_name, f.mime as file_mime, f.size_bytes as file_size, f.storage_key,
       (select count(*)::integer from public.document_versions v where v.document_id = d.id) as versions,
       coalesce((select array_agg(l.path::text order by l.path)
                   from public.document_links dl join public.locations l on l.id = dl.entity_id
                  where dl.document_id = d.id and dl.entity_type = 'location'), '{}') as location_paths,
       (select count(*)::integer from public.document_links dl where dl.document_id = d.id and dl.entity_type = 'task') as task_links,
       exists (select 1 from public.document_acks a
                where a.version_id = d.current_version_id and a.user_id = auth.uid() and a.acked_at is null) as ack_pending,
       pf.name as preview_name, pf.mime as preview_mime, pf.storage_key as preview_storage_key,
       d.folder_id,
       sf.id as thumb_file_id, sf.storage_key as thumb_source_key, sf.mime as thumb_source_mime,
       coalesce((sf.meta ->> 'thumb')::boolean, false) as has_thumb
  from public.documents d
  left join public.document_versions cv on cv.id = d.current_version_id
  left join lateral (select v.* from public.document_versions v where v.document_id = d.id order by v.version_no desc limit 1) lv on true
  left join public.files f on f.id = coalesce(cv.file_id, lv.file_id)
  left join public.files pf on pf.id = case when cv.id is not null then cv.preview_file_id else lv.preview_file_id end
  left join public.files sf on sf.id = coalesce(pf.id, f.id)
 where d.deleted_at is null;
grant select on public.documents_overview to authenticated;
notify pgrst, 'reload schema';
