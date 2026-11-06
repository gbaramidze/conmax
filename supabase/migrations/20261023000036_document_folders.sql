-- Папки документов: дерево внутри проекта (как в проводнике). Документ лежит в одной папке или в корне.
-- Папки видит только внутренняя команда; внешние участники по-прежнему видят плоский список доступных им документов.

create table public.document_folders (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id  uuid references public.document_folders(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users(id),
  deleted_at timestamptz
);
create index on public.document_folders (project_id, parent_id) where deleted_at is null;
-- имя уникально среди соседей (без учёта регистра)
create unique index document_folders_name_uniq on public.document_folders
  (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null;

alter table public.documents add column folder_id uuid references public.document_folders(id) on delete set null;
create index on public.documents (folder_id) where folder_id is not null;

alter table public.document_folders enable row level security;
alter table public.document_folders force row level security;
create policy document_folders_select on public.document_folders for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id));
revoke insert, update, delete on public.document_folders from authenticated;

-- ---------------------------------------------------------------------------
-- Функции (права: document.upload; удалять — document.publish или автор папки)
-- ---------------------------------------------------------------------------
create or replace function private.folder_guard(p_project uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = private.tenant_id())
     or not private.can_see_project(p_project) or not private.can_see_internal(p_project)
     or not private.has_project_permission(p_project, 'document.upload') then
    raise exception 'permission denied: document.upload' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_folder(p_project uuid, p_parent uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.folder_guard(p_project);
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if p_parent is not null and not exists (
    select 1 from public.document_folders f where f.id = p_parent and f.project_id = p_project and f.deleted_at is null) then
    raise exception 'folder_not_found' using errcode = 'P0002';
  end if;
  begin
    insert into public.document_folders (tenant_id, project_id, parent_id, name, created_by)
    values (private.tenant_id(), p_project, p_parent, btrim(p_name), auth.uid()) returning id into v_id;
  exception when unique_violation then
    raise exception 'folder_exists' using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- Путь папок (например, «Корпус 1» → «Этаж 5»): недостающие создаёт, существующие переиспользует
create or replace function public.ensure_folder_path(p_project uuid, p_base uuid, p_path text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_parent uuid := p_base;
  v_name   text;
  v_id     uuid;
begin
  perform private.folder_guard(p_project);
  if coalesce(array_length(p_path, 1), 0) > 8 then raise exception 'path_too_deep' using errcode = '22023'; end if;
  if p_base is not null and not exists (
    select 1 from public.document_folders f where f.id = p_base and f.project_id = p_project and f.deleted_at is null) then
    raise exception 'folder_not_found' using errcode = 'P0002';
  end if;
  foreach v_name in array coalesce(p_path, '{}') loop
    v_name := left(btrim(v_name), 120);
    continue when v_name = '';
    select f.id into v_id from public.document_folders f
     where f.project_id = p_project and f.parent_id is not distinct from v_parent and lower(f.name) = lower(v_name) and f.deleted_at is null;
    if v_id is null then
      insert into public.document_folders (tenant_id, project_id, parent_id, name, created_by)
      values (private.tenant_id(), p_project, v_parent, v_name, auth.uid()) returning id into v_id;
    end if;
    v_parent := v_id;
    v_id := null;
  end loop;
  return v_parent;
end;
$$;

create or replace function public.rename_folder(p_folder uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.document_folders;
begin
  select * into f from public.document_folders where id = p_folder and deleted_at is null and tenant_id = private.tenant_id();
  if not found then raise exception 'folder_not_found' using errcode = 'P0002'; end if;
  perform private.folder_guard(f.project_id);
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  begin
    update public.document_folders set name = btrim(p_name) where id = f.id;
  exception when unique_violation then
    raise exception 'folder_exists' using errcode = '23505';
  end;
end;
$$;

create or replace function public.move_folder(p_folder uuid, p_parent uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.document_folders;
begin
  select * into f from public.document_folders where id = p_folder and deleted_at is null and tenant_id = private.tenant_id();
  if not found then raise exception 'folder_not_found' using errcode = 'P0002'; end if;
  perform private.folder_guard(f.project_id);
  if p_parent is not null then
    if not exists (select 1 from public.document_folders x where x.id = p_parent and x.project_id = f.project_id and x.deleted_at is null) then
      raise exception 'folder_not_found' using errcode = 'P0002';
    end if;
    -- нельзя переместить папку в саму себя или в свою вложенную
    if exists (
      with recursive up(id, parent_id) as (
        select x.id, x.parent_id from public.document_folders x where x.id = p_parent
        union all
        select x.id, x.parent_id from public.document_folders x join up on x.id = up.parent_id)
      select 1 from up where id = f.id) then
      raise exception 'cycle_in_hierarchy' using errcode = '23514';
    end if;
  end if;
  begin
    update public.document_folders set parent_id = p_parent where id = f.id;
  exception when unique_violation then
    raise exception 'folder_exists' using errcode = '23505';
  end;
end;
$$;

-- Удаление: содержимое (документы и вложенные папки) поднимается на уровень выше, ничего не пропадает
create or replace function public.delete_folder(p_folder uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.document_folders;
begin
  select * into f from public.document_folders where id = p_folder and deleted_at is null and tenant_id = private.tenant_id();
  if not found then raise exception 'folder_not_found' using errcode = 'P0002'; end if;
  perform private.folder_guard(f.project_id);
  if f.created_by is distinct from auth.uid() and not private.has_project_permission(f.project_id, 'document.publish') then
    raise exception 'permission denied: document.publish' using errcode = '42501';
  end if;
  update public.documents set folder_id = f.parent_id where folder_id = f.id;
  -- вложенные папки поднимаем; при совпадении имён с соседями добавляем число
  update public.document_folders c set parent_id = f.parent_id,
         name = case when exists (select 1 from public.document_folders s
                                   where s.project_id = c.project_id and s.parent_id is not distinct from f.parent_id
                                     and lower(s.name) = lower(c.name) and s.deleted_at is null and s.id <> c.id)
                     then left(c.name, 110) || ' (' || left(f.name, 8) || ')' else c.name end
   where c.parent_id = f.id and c.deleted_at is null;
  update public.document_folders set deleted_at = now() where id = f.id;
end;
$$;

-- Переместить документы в папку (null — в корень). Двигает только то, что пользователь вправе править.
create or replace function public.move_documents(p_documents uuid[], p_folder uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_count   integer;
begin
  if coalesce(array_length(p_documents, 1), 0) = 0 then return 0; end if;
  if array_length(p_documents, 1) > 500 then raise exception 'too_many_documents' using errcode = '22023'; end if;
  if p_folder is not null then
    select project_id into v_project from public.document_folders where id = p_folder and deleted_at is null and tenant_id = private.tenant_id();
    if v_project is null then raise exception 'folder_not_found' using errcode = 'P0002'; end if;
    perform private.folder_guard(v_project);
  else
    select project_id into v_project from public.documents where id = p_documents[1] and tenant_id = private.tenant_id();
    if v_project is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
    perform private.folder_guard(v_project);
  end if;

  update public.documents d set folder_id = p_folder
   where d.id = any (p_documents) and d.project_id = v_project and d.deleted_at is null
     and private.user_can_edit_document(auth.uid(), d.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_folder(uuid,uuid,text)', 'ensure_folder_path(uuid,uuid,text[])', 'rename_folder(uuid,text)',
    'move_folder(uuid,uuid)', 'delete_folder(uuid)', 'move_documents(uuid[],uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Реестр: добавлена папка документа
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
       d.folder_id
  from public.documents d
  left join public.document_versions cv on cv.id = d.current_version_id
  left join lateral (select v.* from public.document_versions v where v.document_id = d.id order by v.version_no desc limit 1) lv on true
  left join public.files f on f.id = coalesce(cv.file_id, lv.file_id)
  left join public.files pf on pf.id = case when cv.id is not null then cv.preview_file_id else lv.preview_file_id end
 where d.deleted_at is null;
grant select on public.documents_overview to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
