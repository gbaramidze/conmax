-- API хранилища перед удалением объекта его находит (читает). После удаления записи о файле объект «осиротел»,
-- поэтому ведущему и организаторам нужно разрешить читать осиротевшие объекты своего проекта — чтобы убрать их.
-- Содержимое чужим по-прежнему не открывается: для остальных объект без строки в files невидим.
create policy files_storage_select_orphan on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and not exists (select 1 from public.files f where f.storage_key = objects.name)
    and (private.has_project_permission(((storage.foldername(name))[2])::uuid, 'meeting.conduct')
         or private.has_project_permission(((storage.foldername(name))[2])::uuid, 'meeting.manage'))
  );
