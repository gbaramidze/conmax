-- Загружать файлы в проект могут не только те, кто пишет комментарии (comment.create), но и те, кто вправе загружать документы
-- или настраивать проект (фото проекта): например, администратор организации, который не состоит в проекте.
-- Просмотр файлов по-прежнему определяется правилами видимости самих объектов.

create or replace function private.can_upload_file(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_project_permission(p_project, 'comment.create')
      or private.has_project_permission(p_project, 'document.upload')
      or private.has_project_permission(p_project, 'project.edit');
$$;
grant execute on function private.can_upload_file(uuid) to authenticated;

drop policy files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (private.can_see_project(project_id) and private.can_upload_file(project_id));

drop policy files_storage_insert on storage.objects;
create policy files_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and private.can_upload_file(((storage.foldername(name))[2])::uuid)
  );

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
