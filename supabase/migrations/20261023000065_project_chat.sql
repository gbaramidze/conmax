-- Чат проекта: общий чат внутренней команды, чат каждой подрядной организации с нашей командой и личные переписки.
-- Кто что видит: общий чат — только внутренние участники (`comment.internal.view`); чат организации — её сотрудники и внутренняя команда;
-- личная переписка — двое, при условии что каждый видит другого (внешний видит только свою организацию и внутреннюю команду, см. external_privacy).
-- Присутствие («кто онлайн»): приложение раз в 30 секунд отмечается в проекте; онлайн — отметка не старше 90 секунд.
-- Сообщения пишутся только функциями; чтение закрыто RLS и по тем же правилам доходит до Realtime.
-- См. docs: 05-roadmap/05-backlog.md, раздел «17. Чат между сотрудниками».

create table public.chat_channels (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  kind            text not null check (kind in ('project', 'org', 'direct')),
  organization_id uuid references public.organizations(id),
  user_a          uuid references public.users(id),
  user_b          uuid references public.users(id),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  check (
    (kind = 'project' and organization_id is null and user_a is null and user_b is null)
    or (kind = 'org' and organization_id is not null and user_a is null and user_b is null)
    or (kind = 'direct' and organization_id is null and user_a is not null and user_b is not null and user_a < user_b)
  )
);
create unique index chat_channels_project on public.chat_channels (project_id) where kind = 'project';
create unique index chat_channels_org on public.chat_channels (project_id, organization_id) where kind = 'org';
create unique index chat_channels_direct on public.chat_channels (project_id, user_a, user_b) where kind = 'direct';

create table public.chat_messages (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.users(id),
  body       text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (deleted_at is not null or char_length(btrim(body)) between 1 and 4000)
);
create index on public.chat_messages (channel_id, created_at desc, id desc);

create table public.chat_reads (
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.project_presence (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  seen_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Доступ к чату: единое правило для политик и функций
create or replace function private.chat_can_access(p_project uuid, p_kind text, p_org uuid, p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_see_project(p_project) and case p_kind
    when 'project' then private.can_see_internal(p_project)
    when 'org'     then private.can_see_internal(p_project) or p_org = private.my_org_id()
    when 'direct'  then auth.uid() in (p_a, p_b)
    else false
  end;
$$;
grant execute on function private.chat_can_access(uuid, text, uuid, uuid, uuid) to authenticated;

alter table public.chat_channels enable row level security;
alter table public.chat_channels force row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_messages force row level security;
alter table public.chat_reads enable row level security;
alter table public.chat_reads force row level security;
alter table public.project_presence enable row level security;
alter table public.project_presence force row level security;

revoke insert, update, delete on public.chat_channels, public.chat_messages, public.chat_reads, public.project_presence from authenticated;

create policy chat_channels_select on public.chat_channels for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.chat_can_access(project_id, kind, organization_id, user_a, user_b));
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and exists (select 1 from public.chat_channels c where c.id = channel_id));
create policy chat_reads_select on public.chat_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy project_presence_select on public.project_presence for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.can_see_project(project_id)
         and private.can_see_user(user_id));

alter publication supabase_realtime add table public.chat_messages;

-- Действующий участник проекта
create or replace function private.is_active_member(p_project uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members pm
                  where pm.project_id = p_project and pm.user_id = p_user and pm.deleted_at is null
                    and (pm.left_at is null or pm.left_at > current_date));
$$;
grant execute on function private.is_active_member(uuid, uuid) to authenticated;

-- Открыть (или создать) канал. Для личной переписки передаётся собеседник, для чата организации — организация.
create or replace function public.chat_open(p_project uuid, p_kind text, p_org uuid default null, p_user uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_a      uuid;
  v_b      uuid;
  v_id     uuid;
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant) or not private.can_see_project(p_project) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;

  if p_kind = 'project' then
    if not private.can_see_internal(p_project) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
    insert into public.chat_channels (tenant_id, project_id, kind) values (v_tenant, p_project, 'project')
      on conflict (project_id) where kind = 'project' do nothing;
    select id into v_id from public.chat_channels where project_id = p_project and kind = 'project';

  elsif p_kind = 'org' then
    if p_org is null or not (private.can_see_internal(p_project) or p_org = private.my_org_id()) then
      raise exception 'permission denied: chat' using errcode = '42501';
    end if;
    if not exists (select 1 from public.organizations where id = p_org and tenant_id = v_tenant and deleted_at is null) then
      raise exception 'organization_not_found' using errcode = 'P0002';
    end if;
    insert into public.chat_channels (tenant_id, project_id, kind, organization_id) values (v_tenant, p_project, 'org', p_org)
      on conflict (project_id, organization_id) where kind = 'org' do nothing;
    select id into v_id from public.chat_channels where project_id = p_project and kind = 'org' and organization_id = p_org;

  elsif p_kind = 'direct' then
    if p_user is null or p_user = v_me then raise exception 'invalid_user' using errcode = '22023'; end if;
    if not private.is_active_member(p_project, p_user) then raise exception 'user_not_in_project' using errcode = '22023'; end if;
    if not private.can_see_user(p_user) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
    v_a := least(v_me, p_user);
    v_b := greatest(v_me, p_user);
    insert into public.chat_channels (tenant_id, project_id, kind, user_a, user_b) values (v_tenant, p_project, 'direct', v_a, v_b)
      on conflict (project_id, user_a, user_b) where kind = 'direct' do nothing;
    select id into v_id from public.chat_channels where project_id = p_project and kind = 'direct' and user_a = v_a and user_b = v_b;

  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- Отправить сообщение
create or replace function public.chat_send(p_channel uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  c        public.chat_channels;
  v_id     uuid;
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select * into c from public.chat_channels where id = p_channel and tenant_id = v_tenant;
  if not found or not private.chat_can_access(c.project_id, c.kind, c.organization_id, c.user_a, c.user_b) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  insert into public.chat_messages (tenant_id, channel_id, author_id, body) values (v_tenant, c.id, v_me, v_body) returning id into v_id;
  update public.chat_channels set last_message_at = now() where id = c.id;
  insert into public.chat_reads (channel_id, user_id, last_read_at) values (c.id, v_me, now())
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
  return v_id;
end;
$$;

-- Удалить своё сообщение (в канале остаётся пометка «сообщение удалено»)
create or replace function public.chat_delete(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_message and tenant_id = private.tenant_id();
  if not found or m.author_id is distinct from auth.uid() then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  update public.chat_messages set deleted_at = now(), body = '' where id = m.id and deleted_at is null;
end;
$$;

-- Отметить канал прочитанным
create or replace function public.chat_mark_read(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_channels;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into c from public.chat_channels where id = p_channel and tenant_id = private.tenant_id();
  if not found or not private.chat_can_access(c.project_id, c.kind, c.organization_id, c.user_a, c.user_b) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  insert into public.chat_reads (channel_id, user_id, last_read_at) values (c.id, auth.uid(), now())
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Список каналов проекта для меня: общий (внутренним), организации, мои личные; с последним сообщением и числом непрочитанных.
-- Общий чат и чаты организаций, у которых есть сотрудники в проекте, создаются при первом открытии списка.
create or replace function public.chat_overview(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_result jsonb;
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant) or not private.can_see_project(p_project) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;

  if private.can_see_internal(p_project) then
    insert into public.chat_channels (tenant_id, project_id, kind) values (v_tenant, p_project, 'project')
      on conflict (project_id) where kind = 'project' do nothing;
  end if;
  insert into public.chat_channels (tenant_id, project_id, kind, organization_id)
  select distinct v_tenant, p_project, 'org', o.id
    from public.project_members pm
    join public.users u on u.id = pm.user_id
    join public.organizations o on o.id = u.organization_id and o.deleted_at is null and o.kind <> 'own'
   where pm.project_id = p_project and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
     and (private.can_see_internal(p_project) or o.id = private.my_org_id())
  on conflict (project_id, organization_id) where kind = 'org' do nothing;

  select coalesce(jsonb_agg(row_json order by sort_key), '[]'::jsonb) into v_result
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'organization_id', c.organization_id,
        'other_user_id', case when c.kind = 'direct' then case when c.user_a = v_me then c.user_b else c.user_a end end,
        'last_message_at', c.last_message_at,
        'last_body', lm.body,
        'last_author_id', lm.author_id,
        'unread', (select count(*) from public.chat_messages m
                    where m.channel_id = c.id and m.deleted_at is null and m.author_id <> v_me
                      and m.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.channel_id = c.id and r.user_id = v_me), '-infinity'))
      ) as row_json,
      case c.kind when 'project' then 0 when 'org' then 1 else 2 end as sort_key
    from public.chat_channels c
    left join lateral (select m.body, m.author_id from public.chat_messages m
                        where m.channel_id = c.id and m.deleted_at is null order by m.created_at desc, m.id desc limit 1) lm on true
    where c.project_id = p_project and c.tenant_id = v_tenant
      and private.chat_can_access(c.project_id, c.kind, c.organization_id, c.user_a, c.user_b)
  ) x;
  return v_result;
end;
$$;

-- Число непрочитанных сообщений в проекте (значок в меню)
create or replace function public.chat_unread_count(p_project uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(count(*), 0)::integer
    from public.chat_channels c
    join public.chat_messages m on m.channel_id = c.id
   where c.project_id = p_project and c.tenant_id = private.tenant_id()
     and private.chat_can_access(c.project_id, c.kind, c.organization_id, c.user_a, c.user_b)
     and m.deleted_at is null and m.author_id <> auth.uid()
     and m.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.channel_id = c.id and r.user_id = auth.uid()), '-infinity');
$$;

-- Присутствие: «я в проекте»
create or replace function public.presence_ping(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant) or not private.can_see_project(p_project) then
    raise exception 'permission denied: project' using errcode = '42501';
  end if;
  insert into public.project_presence (project_id, user_id, tenant_id, seen_at) values (p_project, auth.uid(), v_tenant, now())
    on conflict (project_id, user_id) do update set seen_at = excluded.seen_at;
end;
$$;

-- Кто в проекте и когда был в сети (видны только те, кого я вправе видеть); онлайн — отметка не старше 90 секунд
create or replace function public.project_online(p_project uuid) returns table (user_id uuid, seen_at timestamptz, online boolean)
language sql stable set search_path = '' as $$
  select pp.user_id, pp.seen_at, pp.seen_at > now() - interval '90 seconds'
    from public.project_presence pp
   where pp.project_id = p_project and pp.seen_at > now() - interval '7 days';
$$;

revoke execute on function public.chat_open(uuid, text, uuid, uuid), public.chat_send(uuid, text), public.chat_delete(uuid), public.chat_mark_read(uuid),
  public.chat_overview(uuid), public.chat_unread_count(uuid), public.presence_ping(uuid), public.project_online(uuid) from public, anon;
grant execute on function public.chat_open(uuid, text, uuid, uuid), public.chat_send(uuid, text), public.chat_delete(uuid), public.chat_mark_read(uuid),
  public.chat_overview(uuid), public.chat_unread_count(uuid), public.presence_ping(uuid), public.project_online(uuid) to authenticated;
notify pgrst, 'reload schema';
