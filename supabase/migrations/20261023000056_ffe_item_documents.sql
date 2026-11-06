-- Чертежи и файлы мебели: к каждой позиции каталога можно привязать несколько документов проекта
-- (чертёж, каталожный лист, фото образца) через общую привязку документов `document_links`.
-- Прежнее единственное поле ffe_items.document_id переносится в привязки и больше не используется.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Мебель и оборудование по номерам».

alter table public.document_links drop constraint document_links_entity_type_check;
alter table public.document_links add constraint document_links_entity_type_check check (entity_type in ('location', 'task', 'ffe_item'));

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id)
    when 'task'     then (select project_id from public.tasks where id = p_id)
    when 'location' then (select project_id from public.locations where id = p_id)
    when 'document' then (select project_id from public.documents where id = p_id)
    when 'meeting'  then (select project_id from public.meetings where id = p_id)
    when 'ffe_item' then (select project_id from public.ffe_items where id = p_id)
  end;
$$;

-- Перенос уже привязанных чертежей
insert into public.document_links (tenant_id, project_id, document_id, entity_type, entity_id)
select i.tenant_id, i.project_id, i.document_id, 'ffe_item', i.id
  from public.ffe_items i
 where i.document_id is not null and i.deleted_at is null
on conflict (document_id, entity_type, entity_id) do nothing;
update public.ffe_items set document_id = null where document_id is not null;

-- Импорт каталога: шифр чертежа в таблице становится привязкой документа к позиции
create or replace function public.ffe_import_items(p_project uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_created integer := 0;
  v_updated integer := 0;
  v_unknown integer := 0;
  v_doc uuid;
  v_id uuid;
begin
  perform private.ffe_guard(p_project);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'bad_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(code text, name text, category text, unit text, document_code text) loop
    if btrim(coalesce(r.code, '')) = '' or btrim(coalesce(r.name, '')) = '' then raise exception 'title_required' using errcode = '22023'; end if;
    v_doc := null;
    if btrim(coalesce(r.document_code, '')) <> '' then
      select id into v_doc from public.documents where project_id = p_project and lower(code) = lower(btrim(r.document_code)) and deleted_at is null;
      if v_doc is null then v_unknown := v_unknown + 1; end if;
    end if;
    select id into v_id from public.ffe_items where project_id = p_project and lower(code) = lower(btrim(r.code)) and deleted_at is null;
    if v_id is null then
      insert into public.ffe_items (tenant_id, project_id, code, name, category, unit)
      values (private.tenant_id(), p_project, btrim(r.code), btrim(r.name), nullif(btrim(coalesce(r.category, '')), ''), coalesce(nullif(btrim(r.unit), ''), 'шт'))
      returning id into v_id;
      v_created := v_created + 1;
    else
      update public.ffe_items set name = btrim(r.name), category = nullif(btrim(coalesce(r.category, '')), ''),
             unit = coalesce(nullif(btrim(r.unit), ''), unit)
       where id = v_id;
      v_updated := v_updated + 1;
    end if;
    if v_doc is not null then
      insert into public.document_links (tenant_id, project_id, document_id, entity_type, entity_id)
      values (private.tenant_id(), p_project, v_doc, 'ffe_item', v_id)
      on conflict (document_id, entity_type, entity_id) do nothing;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unknown_documents', v_unknown);
end;
$$;
revoke execute on function public.ffe_import_items(uuid, jsonb) from public, anon;
grant  execute on function public.ffe_import_items(uuid, jsonb) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
