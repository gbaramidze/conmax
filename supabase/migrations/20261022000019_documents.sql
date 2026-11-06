-- Документы (лёгкая версия): версии, привязка к местам и задачам, доступ по направлениям и организациям,
-- выпуск ревизии с уведомлением и отметкой «ознакомлен». См. docs: 04-modules/12-documents-drawings.md (§1, лёгкая версия).

-- ---------------------------------------------------------------------------
-- Права
-- ---------------------------------------------------------------------------
create or replace function private.document_permissions_for(p_scope text, p_code text) returns text[]
language sql immutable as $$
  select case
    when p_scope = 'project' and p_code in ('project_manager', 'chief_engineer', 'pto') then array['document.upload','document.publish']
    when p_scope = 'project' and p_code in ('designer', 'foreman', 'master')            then array['document.upload']
    when p_scope = 'tenant'  and p_code = 'tenant_admin'                                then array['document.publish']
    else array[]::text[]
  end;
$$;

create or replace function private.roles_document_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_system then
    insert into public.role_permissions (tenant_id, role_id, permission)
    select new.tenant_id, new.id, p from unnest(private.document_permissions_for(new.scope, new.code)) p
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger roles_document_permissions after insert on public.roles
  for each row execute function private.roles_document_permissions();

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, p
  from public.roles r, lateral unnest(private.document_permissions_for(r.scope, r.code)) p
 where r.is_system
on conflict do nothing;

insert into public.entity_types (code, module, features) values ('document', 'docs', array['comments','attachments','activity']);

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------
create table public.documents (
  id                 uuid primary key default public.uuidv7(),
  tenant_id          uuid not null references public.tenants(id),
  project_id         uuid not null references public.projects(id) on delete cascade,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid() references public.users(id),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  code               text check (code is null or length(btrim(code)) between 1 and 80),
  title              text not null check (length(btrim(title)) between 1 and 300),
  doc_type           text not null default 'other' check (doc_type in ('plan','drawing','spec','contract','report','photo','other')),
  discipline_id      uuid references public.disciplines(id),
  visibility         text not null default 'internal' check (visibility in ('internal','external')),
  requires_ack       boolean not null default false,
  current_version_id uuid
);
create unique index documents_code_uniq on public.documents (project_id, lower(code)) where code is not null and deleted_at is null;
create index on public.documents (tenant_id, project_id) where deleted_at is null;

create table public.document_versions (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  version_no   integer not null,
  revision     text not null default '' check (length(revision) <= 20),
  file_id      uuid not null references public.files(id),
  note         text check (note is null or length(note) <= 2000),
  status       text not null default 'draft' check (status in ('draft','published','superseded')),
  created_by   uuid default auth.uid() references public.users(id),
  created_at   timestamptz not null default now(),
  published_by uuid references public.users(id),
  published_at timestamptz,
  unique (document_id, version_no)
);
create index on public.document_versions (document_id, version_no desc);
create index on public.document_versions (file_id);
alter table public.documents add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) on delete set null;

-- Для каких внешних организаций документ открыт (пусто — для всех внешних участников проекта)
create table public.document_orgs (
  document_id     uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  tenant_id       uuid not null references public.tenants(id),
  primary key (document_id, organization_id)
);

-- Привязка к местам и задачам
create table public.document_links (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  entity_type text not null check (entity_type in ('location','task')),
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  unique (document_id, entity_type, entity_id)
);
create index on public.document_links (tenant_id, entity_type, entity_id);

-- Кому нужно ознакомиться с версией и кто уже ознакомился
create table public.document_acks (
  version_id  uuid not null references public.document_versions(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  notified_at timestamptz not null default now(),
  acked_at    timestamptz,
  primary key (version_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Проверки доступа (от имени пользователя, чтобы их можно было вызывать и из уведомлений)
-- ---------------------------------------------------------------------------
create or replace function private.user_can_publish_document(p_user uuid, p_project uuid, p_discipline uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_has_project_permission(p_user, p_project, 'document.publish')
      or (p_discipline is not null and exists (
            with recursive up(id, parent_id, lead_user_id) as (
              select d0.id, d0.parent_id, d0.lead_user_id from public.disciplines d0 where d0.id = p_discipline
              union all
              select d1.id, d1.parent_id, d1.lead_user_id from public.disciplines d1 join up on d1.id = up.parent_id)
            select 1 from up where lead_user_id = p_user));
$$;

create or replace function private.user_can_view_document(p_user uuid, p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
     where d.id = p_doc and d.deleted_at is null
       and private.user_can_see_project(p_user, d.project_id)
       and case
             when private.user_has_project_permission(p_user, d.project_id, 'comment.internal.view') then
               d.created_by = p_user
               or private.user_can_publish_document(p_user, d.project_id, d.discipline_id)
               or exists (select 1 from public.document_versions v where v.document_id = d.id and v.status in ('published', 'superseded'))
             else
               d.visibility = 'external'
               and exists (select 1 from public.document_versions v where v.document_id = d.id and v.status = 'published')
               and (not exists (select 1 from public.document_orgs o where o.document_id = d.id)
                    or exists (select 1 from public.document_orgs o
                                 join public.users u on u.organization_id = o.organization_id
                                where o.document_id = d.id and u.id = p_user))
           end);
$$;

-- Версии: внутренние видят выпущенные и замещённые (черновики — автор и выпускающие); внешние — только действующую
create or replace function private.user_can_view_version(p_user uuid, p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_versions v
      join public.documents d on d.id = v.document_id
     where v.id = p_version
       and private.user_can_view_document(p_user, d.id)
       and case
             when private.user_has_project_permission(p_user, d.project_id, 'comment.internal.view') then
               v.status in ('published', 'superseded') or v.created_by = p_user
               or private.user_can_publish_document(p_user, d.project_id, d.discipline_id)
             else v.status = 'published'
           end);
$$;

create or replace function private.user_can_edit_document(p_user uuid, p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
     where d.id = p_doc and d.deleted_at is null
       and (d.created_by = p_user or private.user_can_publish_document(p_user, d.project_id, d.discipline_id)));
$$;

-- Реестр сущностей: документ как объект с комментариями и лентой
create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'     then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
    when 'location' then (select project_id from public.locations where id = p_id and tenant_id = private.tenant_id())
    when 'document' then (select project_id from public.documents where id = p_id and tenant_id = private.tenant_id())
  end;
$$;

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id)
    when 'task'     then (select project_id from public.tasks where id = p_id)
    when 'location' then (select project_id from public.locations where id = p_id)
    when 'document' then (select project_id from public.documents where id = p_id)
  end;
$$;

create or replace function private.user_can_view_entity(p_user uuid, p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then private.user_can_see_project(p_user, p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and private.user_task_visible(p_user, t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    when 'location' then exists (
      select 1 from public.locations l
      where l.id = p_id and private.user_can_see_project(p_user, l.project_id))
    when 'document' then private.user_can_view_document(p_user, p_id)
    else false
  end;
$$;

create or replace function private.entity_display(p_type text, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'task' then (
      select jsonb_build_object('key', t.key, 'title', t.title, 'project_code', p.code)
        from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_id)
    when 'project' then (
      select jsonb_build_object('key', p.code, 'title', p.name, 'project_code', p.code)
        from public.projects p where p.id = p_id)
    when 'location' then (
      select jsonb_build_object('key', l.path::text, 'title', l.name, 'project_code', p.code)
        from public.locations l join public.projects p on p.id = l.project_id where l.id = p_id)
    when 'document' then (
      select jsonb_build_object('key', coalesce(d.code, 'Документ'), 'title', d.title, 'project_code', p.code)
        from public.documents d join public.projects p on p.id = d.project_id where d.id = p_id)
  end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.documents force row level security;
alter table public.document_versions enable row level security;
alter table public.document_versions force row level security;
alter table public.document_orgs enable row level security;
alter table public.document_orgs force row level security;
alter table public.document_links enable row level security;
alter table public.document_links force row level security;
alter table public.document_acks enable row level security;
alter table public.document_acks force row level security;

create policy documents_select on public.documents for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_view_document((select auth.uid()), id));
create policy documents_update on public.documents for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_edit_document((select auth.uid()), id))
  with check (tenant_id = (select private.tenant_id()));

create policy document_versions_select on public.document_versions for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_view_version((select auth.uid()), id));

create policy document_orgs_select on public.document_orgs for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.user_can_view_document((select auth.uid()), document_id)
         and private.can_see_internal(private.entity_project_id('document', document_id)));
create policy document_orgs_insert on public.document_orgs for insert to authenticated
  with check (private.user_can_edit_document((select auth.uid()), document_id));
create policy document_orgs_delete on public.document_orgs for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_edit_document((select auth.uid()), document_id));

create policy document_links_select on public.document_links for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_view_document((select auth.uid()), document_id));
create policy document_links_insert on public.document_links for insert to authenticated
  with check (private.user_can_edit_document((select auth.uid()), document_id));
create policy document_links_delete on public.document_links for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_edit_document((select auth.uid()), document_id));

-- Отметки: свои; выпускающие и автор видят все (прогресс ознакомления)
create policy document_acks_select on public.document_acks for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and (user_id = (select auth.uid())
              or exists (select 1 from public.document_versions v
                          where v.id = version_id and private.user_can_edit_document((select auth.uid()), v.document_id))));

revoke insert, update, delete on public.documents, public.document_versions, public.document_orgs, public.document_links, public.document_acks from authenticated;
grant update (title, code, doc_type, discipline_id, visibility, requires_ack, deleted_at) on public.documents to authenticated;
grant insert (document_id, organization_id) on public.document_orgs to authenticated;
grant delete on public.document_orgs to authenticated;
grant insert (document_id, entity_type, entity_id) on public.document_links to authenticated;
grant delete on public.document_links to authenticated;

create or replace function private.documents_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.code is not null then new.code := nullif(btrim(new.code), ''); end if;
  new.title := btrim(new.title);
  if new.discipline_id is distinct from old.discipline_id and new.discipline_id is not null and not exists (
    select 1 from public.disciplines d where d.id = new.discipline_id and d.project_id = old.project_id and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger documents_touch before update on public.documents
  for each row execute function private.documents_touch();

create or replace function private.document_children_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.documents;
  v_project uuid;
begin
  select * into v_doc from public.documents where id = new.document_id and tenant_id = private.tenant_id();
  if not found then raise exception 'document not found' using errcode = '23503'; end if;
  new.tenant_id := v_doc.tenant_id;
  if tg_table_name = 'document_links' then
    new.project_id := v_doc.project_id;
    new.created_by := auth.uid();
    v_project := private.entity_project_id_any(new.entity_type, new.entity_id);
    if v_project is distinct from v_doc.project_id then
      raise exception 'entity belongs to another project' using errcode = '23514';
    end if;
  else
    if not exists (select 1 from public.organizations o where o.id = new.organization_id and o.tenant_id = v_doc.tenant_id) then
      raise exception 'organization belongs to another tenant' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger document_links_before_insert before insert on public.document_links
  for each row execute function private.document_children_before_insert();
create trigger document_orgs_before_insert before insert on public.document_orgs
  for each row execute function private.document_children_before_insert();

-- Файлы документов видны тем, кто видит соответствующую версию (Storage опирается на эту политику)
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id))
  );

-- ---------------------------------------------------------------------------
-- Выпуск версии: прежняя действующая становится «заменённой», получатели уведомляются
-- ---------------------------------------------------------------------------
create or replace function private.publish_version(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v         public.document_versions;
  d         public.documents;
  v_prev    public.document_versions;
  v_manager uuid;
  v_text    text;
  v_user    uuid;
begin
  select * into v from public.document_versions where id = p_version for update;
  select * into d from public.documents where id = v.document_id for update;
  if v.status <> 'draft' then raise exception 'version_not_draft' using errcode = '22023'; end if;

  select * into v_prev from public.document_versions where id = d.current_version_id;
  update public.document_versions set status = 'superseded' where id = v_prev.id;
  update public.document_versions set status = 'published', published_by = auth.uid(), published_at = now() where id = v.id;
  update public.documents set current_version_id = v.id where id = d.id;

  perform private.record_event(d.tenant_id, d.project_id, 'document', d.id, 'version_published',
                               jsonb_build_object('revision', v.revision, 'version_no', v.version_no, 'previous', v_prev.revision), 'internal');

  select manager_user_id into v_manager from public.projects where id = d.project_id;
  v_text := format('Новая ревизия %s документа «%s»%s',
                   coalesce(nullif(v.revision, ''), '№' || v.version_no), d.title,
                   case when v_prev.id is not null then ' (было ' || coalesce(nullif(v_prev.revision, ''), '№' || v_prev.version_no) || ')' else '' end);
  if d.requires_ack then v_text := 'Требуется ознакомление: ' || v_text; end if;

  for v_user in
    select x.uid from (
      select pm.user_id as uid from public.project_members pm
       where pm.project_id = d.project_id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
         and d.discipline_id is not null and pm.discipline_id = d.discipline_id
      union
      select up.lead_user_id from (
        with recursive up(id, parent_id, lead_user_id) as (
          select d0.id, d0.parent_id, d0.lead_user_id from public.disciplines d0 where d0.id = d.discipline_id
          union all
          select d1.id, d1.parent_id, d1.lead_user_id from public.disciplines d1 join up on d1.id = up.parent_id)
        select * from up) up
      union
      select t.assignee_id from public.document_links l join public.tasks t on t.id = l.entity_id
       where l.document_id = d.id and l.entity_type = 'task'
      union
      select t.reporter_id from public.document_links l join public.tasks t on t.id = l.entity_id
       where l.document_id = d.id and l.entity_type = 'task'
      union
      select v_manager
      union
      select pm.user_id from public.project_members pm join public.users u on u.id = pm.user_id
       where d.visibility = 'external' and u.is_external and pm.project_id = d.project_id and pm.deleted_at is null
         and (pm.left_at is null or pm.left_at > current_date)
         and (not exists (select 1 from public.document_orgs o where o.document_id = d.id)
              or u.organization_id in (select o.organization_id from public.document_orgs o where o.document_id = d.id))
    ) x where x.uid is not null
  loop
    -- ознакомление просим у других: выпускающий и так знает, что выпустил
    if d.requires_ack and v_user is distinct from auth.uid() then
      insert into public.document_acks (version_id, user_id, tenant_id, project_id)
      values (v.id, v_user, d.tenant_id, d.project_id) on conflict do nothing;
    end if;
    perform private.notify(v_user, 'document', d.id,
                           case when d.requires_ack then 'assigned' else 'watching' end,
                           case when d.requires_ack then 'high' else 'normal' end,
                           'document', v_text);
  end loop;
end;
$$;

create or replace function public.create_document(
  p_project     uuid,
  p_title       text,
  p_code        text,
  p_doc_type    text,
  p_discipline  uuid,
  p_visibility  text,
  p_requires_ack boolean,
  p_file        uuid,
  p_revision    text,
  p_note        text,
  p_locations   uuid[] default '{}',
  p_orgs        uuid[] default '{}',
  p_publish     boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := private.tenant_id();
  v_doc    uuid;
  v_ver    uuid;
  x        uuid;
begin
  if v_uid is null or v_tenant is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'document.upload') then
    raise exception 'permission denied: document.upload' using errcode = '42501';
  end if;
  if p_publish and not private.user_can_publish_document(v_uid, p_project, p_discipline) then
    raise exception 'permission denied: document.publish' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = p_project and f.tenant_id = v_tenant) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  if p_discipline is not null and not exists (
    select 1 from public.disciplines d where d.id = p_discipline and d.project_id = p_project and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
  end if;

  begin
    insert into public.documents (tenant_id, project_id, code, title, doc_type, discipline_id, visibility, requires_ack, created_by)
    values (v_tenant, p_project, nullif(btrim(coalesce(p_code, '')), ''), btrim(p_title), coalesce(p_doc_type, 'other'),
            p_discipline, coalesce(p_visibility, 'internal'), coalesce(p_requires_ack, false), v_uid)
    returning id into v_doc;
  exception when unique_violation then
    raise exception 'code_taken' using errcode = '23505';
  end;

  insert into public.document_versions (tenant_id, project_id, document_id, version_no, revision, file_id, note, created_by)
  values (v_tenant, p_project, v_doc, 1, coalesce(btrim(p_revision), ''), p_file, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_ver;

  foreach x in array coalesce(p_locations, '{}') loop
    insert into public.document_links (tenant_id, project_id, document_id, entity_type, entity_id, created_by)
    select v_tenant, p_project, v_doc, 'location', l.id, v_uid
      from public.locations l where l.id = x and l.project_id = p_project and l.deleted_at is null
    on conflict do nothing;
  end loop;
  foreach x in array coalesce(p_orgs, '{}') loop
    insert into public.document_orgs (document_id, organization_id, tenant_id) values (v_doc, x, v_tenant) on conflict do nothing;
  end loop;

  perform private.record_event(v_tenant, p_project, 'document', v_doc, 'created',
                               jsonb_build_object('title', btrim(p_title)), 'internal');
  if p_publish then perform private.publish_version(v_ver); end if;
  return v_doc;
end;
$$;

create or replace function public.add_document_version(
  p_document uuid, p_file uuid, p_revision text, p_note text, p_publish boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  d      public.documents;
  v_no   integer;
  v_ver  uuid;
begin
  select * into d from public.documents where id = p_document and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_view_document(v_uid, d.id) then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_edit_document(v_uid, d.id) or not private.has_project_permission(d.project_id, 'document.upload') then
    raise exception 'permission denied: document.upload' using errcode = '42501';
  end if;
  if p_publish and not private.user_can_publish_document(v_uid, d.project_id, d.discipline_id) then
    raise exception 'permission denied: document.publish' using errcode = '42501';
  end if;
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = d.project_id) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no from public.document_versions where document_id = d.id;
  insert into public.document_versions (tenant_id, project_id, document_id, version_no, revision, file_id, note, created_by)
  values (d.tenant_id, d.project_id, d.id, v_no, coalesce(btrim(p_revision), ''), p_file, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_ver;
  perform private.record_event(d.tenant_id, d.project_id, 'document', d.id, 'version_added',
                               jsonb_build_object('revision', coalesce(btrim(p_revision), ''), 'version_no', v_no), 'internal');
  if p_publish then perform private.publish_version(v_ver); end if;
  return v_ver;
end;
$$;

create or replace function public.publish_document_version(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select dd.* into d from public.documents dd join public.document_versions v on v.document_id = dd.id
   where v.id = p_version and dd.tenant_id = private.tenant_id();
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_publish_document(auth.uid(), d.project_id, d.discipline_id) then
    raise exception 'permission denied: document.publish' using errcode = '42501';
  end if;
  perform private.publish_version(p_version);
end;
$$;

-- «Ознакомлен»: отметка видна выпускающим; доступна любому, кто видит версию
create or replace function public.ack_document(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.document_versions;
begin
  select * into v from public.document_versions where id = p_version and tenant_id = private.tenant_id();
  if not found or not private.user_can_view_version(auth.uid(), p_version) then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  insert into public.document_acks (version_id, user_id, tenant_id, project_id, acked_at)
  values (v.id, auth.uid(), v.tenant_id, v.project_id, now())
  on conflict (version_id, user_id) do update set acked_at = coalesce(public.document_acks.acked_at, now());
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_document(uuid,text,text,text,uuid,text,boolean,uuid,text,text,uuid[],uuid[],boolean)',
    'add_document_version(uuid,uuid,text,text,boolean)',
    'publish_document_version(uuid)', 'ack_document(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Реестр: документ с действующей версией, местами и состоянием ознакомления
-- ---------------------------------------------------------------------------
create view public.documents_overview with (security_invoker = true) as
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
                where a.version_id = d.current_version_id and a.user_id = auth.uid() and a.acked_at is null) as ack_pending
  from public.documents d
  left join public.document_versions cv on cv.id = d.current_version_id
  left join lateral (select v.* from public.document_versions v where v.document_id = d.id order by v.version_no desc limit 1) lv on true
  left join public.files f on f.id = coalesce(cv.file_id, lv.file_id)
 where d.deleted_at is null;
grant select on public.documents_overview to authenticated;

alter publication supabase_realtime add table public.documents, public.document_versions;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
