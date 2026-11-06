-- Технический план типа номера: к типу («STANDARD KING 2») можно привязать документы проекта (PDF-план, чертежи) через общую привязку `document_links`.
--
-- План один на тип, а не на каждую комнату: на странице каждого номера этого типа он показывается среди чертежей (как «план типа номера»),
-- а новая ревизия документа действует сразу для всех номеров типа. Права прежние: привязывает автор документа или выпускающий,
-- загружает тот, у кого `document.upload`. Так же устроены чертежи позиций мебели (миграция 56).
-- Отчёт об инспекции номера предлагает такой план схемой (после схем места и до планов вышестоящих узлов).
-- См. docs: 05-roadmap/05-backlog.md, раздел «Технический план типа номера».

alter table public.document_links drop constraint document_links_entity_type_check;
alter table public.document_links add constraint document_links_entity_type_check check (entity_type in ('location', 'task', 'ffe_item', 'room_type'));

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'   then (select id from public.projects where id = p_id)
    when 'task'      then (select project_id from public.tasks where id = p_id)
    when 'location'  then (select project_id from public.locations where id = p_id)
    when 'document'  then (select project_id from public.documents where id = p_id)
    when 'meeting'   then (select project_id from public.meetings where id = p_id)
    when 'ffe_item'  then (select project_id from public.ffe_items where id = p_id)
    when 'signal'    then (select project_id from public.signals where id = p_id)
    when 'room_type' then (select project_id from public.room_types where id = p_id)
  end;
$$;

-- Варианты схемы для места: добавлены чертежи и планы, привязанные к типу номера
create or replace function public.inspection_scheme_options(p_location uuid)
returns table (kind text, file_id uuid, version_id uuid, title text, name text, storage_key text, mime text, source text, ord integer)
language sql stable security definer set search_path = '' as $$
  with loc as (
    select l.id, l.path, l.project_id from public.locations l
     where l.id = p_location and l.tenant_id = private.tenant_id() and l.deleted_at is null
       and private.can_see_project(l.project_id)
  ),
  anc as (
    select loc.id, loc.project_id, 1 as rank from loc
    union all
    select a.id, loc.project_id, 3 + (1000 - length(a.path::text))
      from loc join public.locations a on a.project_id = loc.project_id and a.deleted_at is null and loc.path::text like a.path::text || '.%'
  ),
  cand as (
    -- изображения места и вышестоящих узлов, отмеченные как схема
    select 'file'::text as kind, i.file_id, null::uuid as version_id, coalesce(i.caption, f.name) as title, f.name, f.storage_key, f.mime,
           case when anc.rank = 1 then 'location' else 'parent' end as source, anc.rank, 0 as pri, i.is_cover, i.sort
      from anc
      join public.entity_images i on i.entity_type = 'location' and i.entity_id = anc.id and i.project_id = anc.project_id and i.is_plan
      join public.files f on f.id = i.file_id and f.mime like 'image/%'
    union all
    -- изображения типа номера, отмеченные как схема
    select 'file', i.file_id, null::uuid, coalesce(i.caption, f.name), f.name, f.storage_key, f.mime, 'room_type', 2, 0, i.is_cover, i.sort
      from loc
      join public.room_specs rs on rs.location_id = loc.id
      join public.entity_images i on i.entity_type = 'room_type' and i.entity_id = rs.type_id and i.project_id = loc.project_id and i.is_plan
      join public.files f on f.id = i.file_id and f.mime like 'image/%'
    union all
    -- чертежи и планы, привязанные к месту или вышестоящему узлу
    select 'document', null::uuid, v.id, d.title, f.name, f.storage_key, f.mime,
           case when anc.rank = 1 then 'location' else 'parent' end, anc.rank, case when d.doc_type = 'plan' then 1 else 2 end, false, 0
      from anc
      join public.document_links dl on dl.entity_type = 'location' and dl.entity_id = anc.id and dl.project_id = anc.project_id
      join public.documents d on d.id = dl.document_id and d.deleted_at is null and d.doc_type in ('plan', 'drawing')
      join public.document_versions v on v.id = d.current_version_id
      join public.files fm on fm.id = v.file_id
      join public.files f on f.id = case when fm.mime = 'application/pdf' or fm.mime like 'image/%' then fm.id else v.preview_file_id end
                         and (f.mime = 'application/pdf' or f.mime like 'image/%')
    union all
    -- чертежи и планы, привязанные к типу номера
    select 'document', null::uuid, v.id, d.title, f.name, f.storage_key, f.mime, 'room_type', 2, case when d.doc_type = 'plan' then 1 else 2 end, false, 0
      from loc
      join public.room_specs rs on rs.location_id = loc.id
      join public.document_links dl on dl.entity_type = 'room_type' and dl.entity_id = rs.type_id and dl.project_id = loc.project_id
      join public.documents d on d.id = dl.document_id and d.deleted_at is null and d.doc_type in ('plan', 'drawing')
      join public.document_versions v on v.id = d.current_version_id
      join public.files fm on fm.id = v.file_id
      join public.files f on f.id = case when fm.mime = 'application/pdf' or fm.mime like 'image/%' then fm.id else v.preview_file_id end
                         and (f.mime = 'application/pdf' or f.mime like 'image/%')
  )
  select c.kind, c.file_id, c.version_id, c.title, c.name, c.storage_key, c.mime, c.source,
         (row_number() over (order by c.rank, c.pri, c.is_cover desc, c.sort, c.title))::integer as ord
    from cand c
   order by ord
$$;
revoke execute on function public.inspection_scheme_options(uuid) from public, anon;
grant execute on function public.inspection_scheme_options(uuid) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
notify pgrst, 'reload schema';
