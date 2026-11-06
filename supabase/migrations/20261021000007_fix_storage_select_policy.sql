-- Исправление: в подзапросе `name` разрешался в колонку files.name, а не storage.objects.name,
-- поэтому политика не пропускала никого и файлы нельзя было скачать.
drop policy if exists files_storage_select on storage.objects;
create policy files_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and exists (select 1 from public.files f where f.storage_key = objects.name)
  );
