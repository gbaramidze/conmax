-- S1 · Ядро сущностей: реестр типов, комментарии, лента событий, файлы и вложения.
-- См. docs: 04-modules/01-core-kernel.md

-- ---------------------------------------------------------------------------
-- Реестр типов сущностей: модуль добавляет строку + ветку в entity_project_id()
-- ---------------------------------------------------------------------------
create table public.entity_types (
  code     text primary key,
  module   text not null,
  features text[] not null default '{}'
);
insert into public.entity_types (code, module, features) values
  ('project', 'projects', array['comments','attachments','activity']);

alter table public.entity_types enable row level security;
create policy entity_types_select on public.entity_types for select to authenticated using (true);

-- Проект, к которому относится сущность (null — сущности нет). Новые типы добавляют ветку case.
create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
  end;
$$;
grant execute on function private.entity_project_id to authenticated;

-- Достаточно ли прав, чтобы видеть «внутренние» (не для внешних) данные проекта
create or replace function private.can_see_internal(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_project_permission(p_project, 'comment.internal.view');
$$;
grant execute on function private.can_see_internal to authenticated;

-- ---------------------------------------------------------------------------
-- Лента событий (append-only; пишется только триггерами)
-- ---------------------------------------------------------------------------
create table public.entity_events (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid references public.projects(id) on delete cascade,
  entity_type text not null references public.entity_types(code),
  entity_id   uuid not null,
  event_type  text not null,                         -- created, field_changed, member_added, commented …
  actor_id    uuid references public.users(id),      -- null = система
  changes     jsonb not null default '{}',           -- {field: [old, new]}
  visibility  text not null default 'internal' check (visibility in ('internal','external')),
  occurred_at timestamptz not null default now()
);
create index on public.entity_events (tenant_id, entity_type, entity_id, occurred_at desc);
create index on public.entity_events (tenant_id, project_id, occurred_at desc);

alter table public.entity_events enable row level security;
alter table public.entity_events force row level security;
create policy entity_events_select on public.entity_events for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and project_id is not null
    and private.can_see_project(project_id)
    and (visibility = 'external' or private.can_see_internal(project_id))
  );
-- INSERT/UPDATE/DELETE политик нет: клиенты писать в журнал не могут

create or replace function private.record_event(
  p_tenant uuid, p_project uuid, p_type text, p_id uuid, p_event text,
  p_changes jsonb default '{}', p_visibility text default 'internal'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.entity_events (tenant_id, project_id, entity_type, entity_id, event_type, actor_id, changes, visibility)
  values (p_tenant, p_project, p_type, p_id, p_event, auth.uid(), p_changes, p_visibility);
$$;

-- ---------------------------------------------------------------------------
-- Комментарии
-- ---------------------------------------------------------------------------
create table public.comments (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  version     integer not null default 1,
  deleted_at  timestamptz,
  project_id  uuid not null references public.projects(id) on delete cascade,  -- выводится триггером из сущности
  entity_type text not null references public.entity_types(code),
  entity_id   uuid not null,
  parent_id   uuid references public.comments(id),
  author_id   uuid not null references public.users(id),
  body        jsonb not null check (body ->> 'type' = 'doc' and pg_column_size(body) < 200000),  -- документ Tiptap
  body_text   text not null default '',                                                       -- выводится триггером
  mentions    jsonb not null default '[]',                                                    -- выводится триггером
  visibility  text not null default 'internal' check (visibility in ('internal','external')),
  is_decision boolean not null default false,
  edited_at   timestamptz
);
create index on public.comments (tenant_id, entity_type, entity_id, created_at);
create index on public.comments (tenant_id, project_id, created_at desc);
create index on public.comments using gin (body_text extensions.gin_trgm_ops);

create or replace function private.comments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.tenant_id  := private.tenant_id();
    new.author_id  := auth.uid();
    new.project_id := private.entity_project_id(new.entity_type, new.entity_id);
    if new.project_id is null then
      raise exception 'entity not found' using errcode = '23503';
    end if;
  else
    -- Текст правит только автор; модератор (comment.delete.any) может лишь скрыть комментарий
    if new.body is distinct from old.body then
      if old.author_id <> auth.uid() then
        raise exception 'only the author can edit a comment' using errcode = '42501';
      end if;
      new.edited_at := now();
    end if;
  end if;

  -- Производные поля считаем на сервере: клиенту не доверяем
  new.body_text := coalesce((
    select string_agg(t #>> '{}', ' ') from (
      select t from jsonb_path_query(new.body, 'strict $.**.text') t
      union all
      select to_jsonb('@' || (m #>> '{attrs,label}')) from jsonb_path_query(new.body, 'strict $.** ? (@.type == "mention")') m
    ) s
  ), '');

  new.mentions := coalesce((
    select jsonb_agg(jsonb_build_object('type', 'user', 'id', u.id))
    from (
      select distinct (m #>> '{attrs,id}') as uid
      from jsonb_path_query(new.body, 'strict $.** ? (@.type == "mention")') m
      where (m #>> '{attrs,id}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) x
    join public.users u on u.id = x.uid::uuid and u.tenant_id = new.tenant_id
  ), '[]');

  return new;
end;
$$;

create trigger comments_before_write before insert or update on public.comments
  for each row execute function private.comments_before_write();
create trigger touch before update on public.comments for each row execute function private.touch();

create or replace function private.comments_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.record_event(new.tenant_id, new.project_id, new.entity_type, new.entity_id, 'commented',
                               jsonb_build_object('comment_id', new.id), new.visibility);
  return new;
end;
$$;
create trigger comments_after_insert after insert on public.comments
  for each row execute function private.comments_after_insert();

alter table public.comments enable row level security;
alter table public.comments force row level security;

create policy comments_select on public.comments for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.can_see_project(project_id)
    and (visibility = 'external' or private.can_see_internal(project_id))
  );
create policy comments_insert on public.comments for insert to authenticated
  with check (
    private.can_see_project(project_id)
    and case visibility
          when 'internal' then private.has_project_permission(project_id, 'comment.internal.create')
          else private.has_project_permission(project_id, 'comment.create')
        end
  );
create policy comments_update on public.comments for update to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (author_id = (select auth.uid()) or private.has_project_permission(project_id, 'comment.delete.any'))
  )
  with check (tenant_id = (select private.tenant_id()));

-- Клиент задаёт только то, что от него зависит; остальное выводится/проставляется сервером
revoke insert, update on public.comments from authenticated;
grant insert (entity_type, entity_id, parent_id, body, visibility) on public.comments to authenticated;
grant update (body, deleted_at) on public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- Файлы и вложения
-- ---------------------------------------------------------------------------
create table public.files (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  storage_key  text not null unique,
  name         text not null check (length(name) between 1 and 255),
  mime         text not null,
  size_bytes   bigint not null check (size_bytes >= 0),
  status       text not null default 'ready' check (status in ('uploading','scanning','ready','infected','failed')),
  meta         jsonb not null default '{}'
);
create index on public.files (tenant_id, project_id);

create table public.attachments (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  entity_type text not null references public.entity_types(code),
  entity_id   uuid not null,
  file_id     uuid not null references public.files(id) on delete cascade,
  comment_id  uuid references public.comments(id) on delete cascade,
  caption     text
);
create index on public.attachments (tenant_id, entity_type, entity_id);
create index on public.attachments (comment_id);

create or replace function private.files_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id  := private.tenant_id();
  new.created_by := auth.uid();
  -- ключ обязан лежать в «папке» своего тенанта и проекта (на него опираются политики Storage)
  if new.storage_key not like new.tenant_id::text || '/' || new.project_id::text || '/%' then
    raise exception 'invalid storage key' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger files_before_insert before insert on public.files
  for each row execute function private.files_before_insert();

create or replace function private.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  new.tenant_id  := private.tenant_id();
  new.created_by := auth.uid();
  v_project := private.entity_project_id(new.entity_type, new.entity_id);
  if v_project is null then raise exception 'entity not found' using errcode = '23503'; end if;
  new.project_id := v_project;
  if not exists (select 1 from public.files f where f.id = new.file_id and f.project_id = v_project) then
    raise exception 'file belongs to another project' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger attachments_before_insert before insert on public.attachments
  for each row execute function private.attachments_before_insert();

alter table public.files enable row level security;
alter table public.files force row level security;
alter table public.attachments enable row level security;
alter table public.attachments force row level security;

-- Файл виден автору (пока не прикреплён) или тем, кто видит вложение
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid()) or exists (select 1 from public.attachments a where a.file_id = files.id))
  );
create policy files_insert on public.files for insert to authenticated
  with check (private.can_see_project(project_id) and private.has_project_permission(project_id, 'comment.create'));

-- Вложение к комментарию наследует видимость комментария (RLS комментариев работает и в подзапросе)
create policy attachments_select on public.attachments for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.can_see_project(project_id)
    and (
      (comment_id is null and (select private.can_see_internal(project_id)))
      or exists (select 1 from public.comments c where c.id = attachments.comment_id)
    )
  );
create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    private.can_see_project(project_id)
    and private.has_project_permission(project_id, 'comment.create')
    and (comment_id is null or exists (select 1 from public.comments c where c.id = comment_id and c.author_id = (select auth.uid())))
  );

revoke insert on public.files, public.attachments from authenticated;
grant insert (project_id, storage_key, name, mime, size_bytes) on public.files to authenticated;
grant insert (entity_type, entity_id, file_id, comment_id, caption) on public.attachments to authenticated;

-- Supabase Storage: приватный бакет, путь <tenant_id>/<project_id>/<uuid>-<имя>
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

create policy files_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and private.has_project_permission(((storage.foldername(name))[2])::uuid, 'comment.create')
  );
-- скачать можно только файл, который виден в таблице files (с учётом RLS)
create policy files_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and exists (select 1 from public.files f where f.storage_key = name)
  );

-- ---------------------------------------------------------------------------
-- Журнал изменений проектов и участников
-- ---------------------------------------------------------------------------
create or replace function private.projects_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.record_event(new.tenant_id, new.id, 'project', new.id, 'created',
                                 jsonb_build_object('code', new.code, 'name', new.name), 'external');
  else
    -- {поле: [было, стало]} без служебных полей
    select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}')
      into v_changes
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'updated_by', 'version');
    if v_changes <> '{}' then
      perform private.record_event(new.tenant_id, new.id, 'project', new.id, 'field_changed', v_changes, 'external');
    end if;
  end if;
  return new;
end;
$$;
create trigger projects_audit after insert or update on public.projects
  for each row execute function private.projects_audit();

create or replace function private.project_members_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  select code into v_role from public.roles where id = new.role_id;
  if tg_op = 'INSERT' then
    perform private.record_event(new.tenant_id, new.project_id, 'project', new.project_id, 'member_added',
                                 jsonb_build_object('user_id', new.user_id, 'role', v_role));
  elsif old.left_at is null and new.left_at is not null then
    perform private.record_event(new.tenant_id, new.project_id, 'project', new.project_id, 'member_removed',
                                 jsonb_build_object('user_id', new.user_id, 'role', v_role));
  end if;
  return new;
end;
$$;
create trigger project_members_audit after insert or update on public.project_members
  for each row execute function private.project_members_audit();

-- ---------------------------------------------------------------------------
-- Realtime (RLS применяется и к подпискам)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.comments, public.entity_events;
