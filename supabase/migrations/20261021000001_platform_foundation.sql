-- S0 · Платформа: расширения, служебные функции, тенанты, оргструктура, доступ, проекты.
-- Изоляция тенантов: RLS по claim `tenant_id` в JWT (Supabase Auth + custom access token hook).
-- См. docs: 03-architecture/04-data-model.md, 07-security-access.md, ADR-002.

create extension if not exists citext   with schema extensions;
create extension if not exists ltree    with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

create schema if not exists private;      -- не публикуется через API
grant usage on schema private to authenticated, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- UUIDv7 (в PG17 нет встроенной uuidv7(); заменить на нативную при переходе на PG18)
-- ---------------------------------------------------------------------------
create or replace function public.uuidv7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
              from 1 for 6),
      52, 1), 53, 1),
    'hex')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Контекст из JWT
-- ---------------------------------------------------------------------------
create or replace function private.tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

create or replace function private.is_external() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_external')::boolean, false);
$$;

-- Стандартный триггер: updated_at / updated_by / version
create or replace function private.touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.version    := old.version + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Тенанты
-- ---------------------------------------------------------------------------
create table public.tenants (
  id         uuid primary key default public.uuidv7(),
  name       text not null,
  slug       extensions.citext not null unique,
  settings   jsonb not null default '{}',   -- валюта, локаль, логотип, начало недели
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Организации
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  version     integer not null default 1,
  deleted_at  timestamptz,
  name        text not null,
  short_name  text,
  tax_id      text,
  kind        text not null check (kind in ('own','subcontractor','supplier','client','designer','supervision','other')),
  contacts    jsonb not null default '{}',
  is_active   boolean not null default true
);
create index on public.organizations (tenant_id, kind);

-- ---------------------------------------------------------------------------
-- Пользователи (профиль; id = auth.users.id)
-- ---------------------------------------------------------------------------
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  version         integer not null default 1,
  deleted_at      timestamptz,
  email           extensions.citext not null,
  phone           text,
  full_name       text not null,
  avatar_file_id  uuid,
  organization_id uuid references public.organizations(id),
  is_external     boolean not null default false,
  locale          text not null default 'ru',
  timezone        text not null default 'Europe/Moscow',
  status          text not null default 'invited' check (status in ('invited','active','blocked')),
  last_login_at   timestamptz,
  settings        jsonb not null default '{}',
  unique (tenant_id, email)
);
create index on public.users (tenant_id, organization_id);

create table public.disciplines (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version    integer not null default 1,
  deleted_at timestamptz,
  code       text not null,
  name       text not null,
  color      text,
  unique (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- Роли и права
-- ---------------------------------------------------------------------------
create table public.roles (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version    integer not null default 1,
  deleted_at timestamptz,
  scope      text not null check (scope in ('tenant','project')),
  code       text not null,
  name       text not null,
  is_system  boolean not null default false,
  unique (tenant_id, scope, code)
);

create table public.role_permissions (
  tenant_id  uuid not null references public.tenants(id),
  role_id    uuid not null references public.roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);
create index on public.role_permissions (tenant_id, permission);

create table public.user_tenant_roles (
  tenant_id uuid not null references public.tenants(id),
  user_id   uuid not null references public.users(id) on delete cascade,
  role_id   uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

-- ---------------------------------------------------------------------------
-- Проекты и участники
-- ---------------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default public.uuidv7(),
  tenant_id        uuid not null references public.tenants(id),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  version          integer not null default 1,
  deleted_at       timestamptz,
  code             text not null,                 -- короткий ключ: ZK7
  name             text not null,
  kind             text check (kind in ('residential','commercial','industrial','renovation','design_only')),
  status           text not null default 'draft' check (status in ('draft','active','on_hold','completed','cancelled','archived')),
  client_org_id    uuid references public.organizations(id),
  address          text,
  timezone         text not null default 'Europe/Moscow',
  currency         char(3) not null default 'RUB',
  planned_start    date,
  planned_finish   date,
  actual_start     date,
  actual_finish    date,
  manager_user_id  uuid references public.users(id),
  settings         jsonb not null default '{}',
  unique (tenant_id, code),
  check (code ~ '^[A-Z0-9]{2,8}$')
);
create index on public.projects (tenant_id, status);

create table public.project_members (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  version         integer not null default 1,
  deleted_at      timestamptz,
  project_id      uuid not null references public.projects(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  role_id         uuid not null references public.roles(id),
  organization_id uuid references public.organizations(id),
  discipline_id   uuid references public.disciplines(id),
  title           text,
  joined_at       date,
  left_at         date,
  unique (project_id, user_id, role_id)
);
create index on public.project_members (tenant_id, user_id);

-- Триггеры updated_*/version
do $$
declare t text;
begin
  foreach t in array array['organizations','users','disciplines','roles','projects','project_members'] loop
    execute format('create trigger touch before update on public.%I for each row execute function private.touch()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Проверки прав (security definer, чтобы не упираться в RLS самих таблиц)
-- ---------------------------------------------------------------------------
create or replace function private.has_tenant_permission(p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_tenant_roles utr
    join public.role_permissions rp on rp.role_id = utr.role_id
    where utr.user_id = auth.uid()
      and utr.tenant_id = private.tenant_id()
      and rp.permission = p_permission
  );
$$;

create or replace function private.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project
      and pm.user_id = auth.uid()
      and pm.tenant_id = private.tenant_id()
      and pm.deleted_at is null
      and (pm.left_at is null or pm.left_at > current_date)
  );
$$;

create or replace function private.has_project_permission(p_project uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_tenant_permission(p_permission)
      or exists (
        select 1
        from public.project_members pm
        join public.role_permissions rp on rp.role_id = pm.role_id
        where pm.project_id = p_project
          and pm.user_id = auth.uid()
          and pm.tenant_id = private.tenant_id()
          and pm.deleted_at is null
          and (pm.left_at is null or pm.left_at > current_date)
          and rp.permission = p_permission
      );
$$;

-- Видит ли пользователь проект: участник либо роль тенанта с `project.view.all`
create or replace function private.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_project_member(p_project) or private.has_tenant_permission('project.view.all');
$$;

-- Есть ли общий проект с пользователем (для внешних: видят только коллег по проектам)
create or replace function private.shares_project_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
      and mine.tenant_id = private.tenant_id()
      and mine.deleted_at is null and theirs.deleted_at is null
  );
$$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenants','organizations','users','disciplines','roles','role_permissions',
                           'user_tenant_roles','projects','project_members'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select private.tenant_id()));
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.tenant')))
  with check (id = (select private.tenant_id()));

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy organizations_write on public.organizations for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.reference_data')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.reference_data')));

-- users: внутренние видят всех в тенанте; внешние — себя и коллег по проектам
create policy users_select on public.users for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (not (select private.is_external()) or id = (select auth.uid()) or private.shares_project_with(id))
  );
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and tenant_id = (select private.tenant_id()));
create policy users_update_admin on public.users for update to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.users')))
  with check (tenant_id = (select private.tenant_id()));

-- Колоночные права: сам пользователь правит только профиль; статус/организацию/внешность — только сервер (service_role)
revoke update on public.users from authenticated;
grant update (full_name, phone, avatar_file_id, locale, timezone, settings) on public.users to authenticated;

-- справочники и роли
create policy disciplines_select on public.disciplines for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy disciplines_write on public.disciplines for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.reference_data')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.reference_data')));

create policy roles_select on public.roles for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy roles_write on public.roles for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.roles')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.roles')));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.roles')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.roles')));

create policy user_tenant_roles_select on public.user_tenant_roles for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (user_id = (select auth.uid()) or (select private.has_tenant_permission('admin.users'))));
create policy user_tenant_roles_write on public.user_tenant_roles for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.users')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.users')));

-- projects
create policy projects_select on public.projects for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('project.create')));
create policy projects_update on public.projects for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.has_project_permission(id, 'project.edit'))
  with check (tenant_id = (select private.tenant_id()));

-- project_members
create policy project_members_select on public.project_members for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));
create policy project_members_write on public.project_members for all to authenticated
  using (tenant_id = (select private.tenant_id()) and private.has_project_permission(project_id, 'project.members.manage'))
  with check (tenant_id = (select private.tenant_id()) and private.has_project_permission(project_id, 'project.members.manage'));

-- ---------------------------------------------------------------------------
-- Custom access token hook: кладёт tenant_id / is_external в JWT
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb := event -> 'claims';
  u record;
begin
  select tenant_id, is_external, status into u
  from public.users where id = (event ->> 'user_id')::uuid;

  -- Нет профиля (до bootstrap) или заблокирован → токен без тенанта, RLS не пускает ни к чему
  if found and u.status <> 'blocked' then
    claims := jsonb_set(claims, '{tenant_id}',   to_jsonb(u.tenant_id));
    claims := jsonb_set(claims, '{is_external}', to_jsonb(u.is_external));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
