-- PDF (или изображение) для просмотра у версии документа: исходник (DWG, DXF и т. п.) остаётся для скачивания,
-- а на плане и в просмотрщике открывается его PDF-печать. Показывается и защищается так же, как сама версия.

alter table public.document_versions add column preview_file_id uuid references public.files(id) on delete set null;

-- Файл просмотра виден тем, кто видит версию (политика document_versions уже учитывает черновики и внешних)
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id or v.preview_file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), files.id)
         or exists (select 1 from public.projects p
                     where p.cover_file_id = files.id and p.deleted_at is null and private.can_see_project(p.id)))
  );

-- Поставить, заменить (p_file) или убрать (null) файл просмотра. Вправе тот же круг, что и добавляет версии.
create or replace function public.set_version_preview(p_version uuid, p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.document_versions;
  d public.documents;
begin
  select * into v from public.document_versions where id = p_version and tenant_id = private.tenant_id();
  if not found or not private.user_can_view_version(auth.uid(), v.id) then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  select * into d from public.documents where id = v.document_id;
  if not private.user_can_edit_document(auth.uid(), d.id) or not private.has_project_permission(d.project_id, 'document.upload') then
    raise exception 'permission denied: document.upload' using errcode = '42501';
  end if;
  if p_file is not null then
    if not exists (select 1 from public.files f
                    where f.id = p_file and f.project_id = d.project_id and f.tenant_id = d.tenant_id and f.created_by = auth.uid()) then
      raise exception 'file_not_found' using errcode = '23503';
    end if;
    if not exists (select 1 from public.files f where f.id = p_file and (f.mime = 'application/pdf' or f.mime like 'image/%')) then
      raise exception 'invalid_preview' using errcode = '22023';
    end if;
  end if;
  update public.document_versions set preview_file_id = p_file where id = v.id;
  perform private.record_event(d.tenant_id, d.project_id, 'document', d.id, 'preview_set',
                               jsonb_build_object('version_no', v.version_no, 'removed', p_file is null), 'internal');
end;
$$;
revoke execute on function public.set_version_preview(uuid, uuid) from public, anon;
grant  execute on function public.set_version_preview(uuid, uuid) to authenticated;

-- Реестр: файл просмотра действующей (иначе последней) версии
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
       pf.name as preview_name, pf.mime as preview_mime, pf.storage_key as preview_storage_key
  from public.documents d
  left join public.document_versions cv on cv.id = d.current_version_id
  left join lateral (select v.* from public.document_versions v where v.document_id = d.id order by v.version_no desc limit 1) lv on true
  left join public.files f on f.id = coalesce(cv.file_id, lv.file_id)
  left join public.files pf on pf.id = case when cv.id is not null then cv.preview_file_id else lv.preview_file_id end
 where d.deleted_at is null;
grant select on public.documents_overview to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
