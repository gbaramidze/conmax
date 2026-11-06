-- Чат проекта: группы и чаты по направлениям.
-- Группа: любой участник проекта создаёт её из людей, которых сам видит (внешний — из своей организации и внутренней команды);
-- состав меняет и группу удаляет только создатель, остальные могут выйти.
-- Чат направления создаётся сам для каждого направления, у которого есть сотрудники; его видят внутренние участники проекта
-- с этим направлением и руководитель направления. Подрядчики общаются в чате своей организации и в группах.
-- См. docs: 05-roadmap/05-backlog.md, раздел «17. Чат между сотрудниками».

alter table public.chat_channels
  add column name          text,
  add column discipline_id uuid references public.disciplines(id),
  add column created_by    uuid references public.users(id),
  add column archived_at   timestamptz;

alter table public.chat_channels drop constraint chat_channels_kind_check;
alter table public.chat_channels drop constraint chat_channels_check;
alter table public.chat_channels add constraint chat_channels_kind_check check (kind in ('project', 'org', 'direct', 'group', 'discipline'));
alter table public.chat_channels add constraint chat_channels_shape_check check (
  (kind = 'project'    and organization_id is null and user_a is null and user_b is null and name is null and discipline_id is null)
  or (kind = 'org'     and organization_id is not null and user_a is null and user_b is null and name is null and discipline_id is null)
  or (kind = 'direct'  and organization_id is null and user_a is not null and user_b is not null and user_a < user_b and name is null and discipline_id is null)
  or (kind = 'group'   and organization_id is null and user_a is null and user_b is null and discipline_id is null and char_length(btrim(name)) between 1 and 80 and created_by is not null)
  or (kind = 'discipline' and organization_id is null and user_a is null and user_b is null and name is null and discipline_id is not null)
);
create unique index chat_channels_discipline on public.chat_channels (project_id, discipline_id) where kind = 'discipline';

create table public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  added_by   uuid references public.users(id),
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index on public.chat_channel_members (user_id);

-- Единое правило доступа к каналу
create or replace function private.chat_visible(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_channels c
     where c.id = p_channel and c.tenant_id = private.tenant_id() and c.archived_at is null
       and private.can_see_project(c.project_id)
       and case c.kind
         when 'project' then private.can_see_internal(c.project_id)
         when 'org'     then private.can_see_internal(c.project_id) or c.organization_id = private.my_org_id()
         when 'direct'  then auth.uid() in (c.user_a, c.user_b)
         when 'group'   then exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
         when 'discipline' then private.can_see_internal(c.project_id) and (
              exists (select 1 from public.project_members pm
                       where pm.project_id = c.project_id and pm.user_id = auth.uid() and pm.discipline_id = c.discipline_id
                         and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date))
              or exists (select 1 from public.disciplines d where d.id = c.discipline_id and d.lead_user_id = auth.uid() and d.deleted_at is null))
         else false
       end);
$$;
grant execute on function private.chat_visible(uuid) to authenticated;

alter table public.chat_channel_members enable row level security;
alter table public.chat_channel_members force row level security;
revoke insert, update, delete on public.chat_channel_members from authenticated;
create policy chat_channel_members_select on public.chat_channel_members for select to authenticated
  using (private.chat_visible(channel_id));

drop policy chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels for select to authenticated
  using (private.chat_visible(id));
alter publication supabase_realtime add table public.chat_channel_members;

-- сообщения, отправка, чтение, непрочитанные — по единому правилу
create or replace function public.chat_send(p_channel uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     uuid;
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not private.chat_visible(p_channel) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  insert into public.chat_messages (tenant_id, channel_id, author_id, body) values (v_tenant, p_channel, v_me, v_body) returning id into v_id;
  update public.chat_channels set last_message_at = now() where id = p_channel;
  insert into public.chat_reads (channel_id, user_id, last_read_at) values (p_channel, v_me, now())
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
  return v_id;
end;
$$;

create or replace function public.chat_mark_read(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not private.chat_visible(p_channel) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  insert into public.chat_reads (channel_id, user_id, last_read_at) values (p_channel, auth.uid(), now())
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.chat_unread_count(p_project uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(count(*), 0)::integer
    from public.chat_channels c
    join public.chat_messages m on m.channel_id = c.id
   where c.project_id = p_project and private.chat_visible(c.id)
     and m.deleted_at is null and m.author_id <> auth.uid()
     and m.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.channel_id = c.id and r.user_id = auth.uid()), '-infinity');
$$;

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
    -- чаты направлений, в которых я состою или которыми руковожу
    insert into public.chat_channels (tenant_id, project_id, kind, discipline_id)
    select v_tenant, p_project, 'discipline', d.id
      from public.disciplines d
     where d.project_id = p_project and d.tenant_id = v_tenant and d.deleted_at is null
       and (d.lead_user_id = v_me
            or exists (select 1 from public.project_members pm
                        where pm.project_id = p_project and pm.user_id = v_me and pm.discipline_id = d.id
                          and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)))
    on conflict (project_id, discipline_id) where kind = 'discipline' do nothing;
  end if;
  insert into public.chat_channels (tenant_id, project_id, kind, organization_id)
  select distinct v_tenant, p_project, 'org', o.id
    from public.project_members pm
    join public.users u on u.id = pm.user_id
    join public.organizations o on o.id = u.organization_id and o.deleted_at is null and o.kind <> 'own'
   where pm.project_id = p_project and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
     and (private.can_see_internal(p_project) or o.id = private.my_org_id())
  on conflict (project_id, organization_id) where kind = 'org' do nothing;

  select coalesce(jsonb_agg(row_json order by sort_key, sort_name), '[]'::jsonb) into v_result
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'name', c.name,
        'organization_id', c.organization_id,
        'discipline_id', c.discipline_id,
        'created_by', c.created_by,
        'member_ids', case when c.kind = 'group'
                           then (select coalesce(jsonb_agg(m.user_id order by m.created_at), '[]'::jsonb) from public.chat_channel_members m where m.channel_id = c.id) end,
        'other_user_id', case when c.kind = 'direct' then case when c.user_a = v_me then c.user_b else c.user_a end end,
        'last_message_at', c.last_message_at,
        'last_body', lm.body,
        'last_author_id', lm.author_id,
        'unread', (select count(*) from public.chat_messages m
                    where m.channel_id = c.id and m.deleted_at is null and m.author_id <> v_me
                      and m.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.channel_id = c.id and r.user_id = v_me), '-infinity'))
      ) as row_json,
      case c.kind when 'project' then 0 when 'discipline' then 1 when 'org' then 2 when 'group' then 3 else 4 end as sort_key,
      coalesce(to_char(c.last_message_at, 'YYYYMMDDHH24MISSUS'), '') as sort_name
    from public.chat_channels c
    left join lateral (select m.body, m.author_id from public.chat_messages m
                        where m.channel_id = c.id and m.deleted_at is null order by m.created_at desc, m.id desc limit 1) lm on true
    where c.project_id = p_project and c.tenant_id = v_tenant and private.chat_visible(c.id)
  ) x;
  return v_result;
end;
$$;

-- Группа: проверка и сборка состава (создатель входит всегда)
create or replace function private.chat_group_users(p_project uuid, p_users uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_users, '{}')) x where x <> auth.uid()), '{}');
  v_u uuid;
begin
  if coalesce(array_length(v_users, 1), 0) = 0 then
    raise exception 'group_needs_members' using errcode = '22023';
  end if;
  foreach v_u in array v_users loop
    if not private.is_active_member(p_project, v_u) then raise exception 'user_not_in_project' using errcode = '22023'; end if;
    if not private.can_see_user(v_u) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
  end loop;
  return v_users;
end;
$$;

create or replace function public.chat_group_create(p_project uuid, p_name text, p_users uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_name   text := btrim(coalesce(p_name, ''));
  v_users  uuid[];
  v_id     uuid;
begin
  if v_me is null or v_tenant is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant) or not private.can_see_project(p_project) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  v_users := private.chat_group_users(p_project, p_users);
  insert into public.chat_channels (tenant_id, project_id, kind, name, created_by) values (v_tenant, p_project, 'group', v_name, v_me) returning id into v_id;
  insert into public.chat_channel_members (channel_id, user_id, added_by) select v_id, x, v_me from unnest(v_users || v_me) x;
  return v_id;
end;
$$;

-- Название и состав группы меняет только создатель; состав задаётся целиком
create or replace function public.chat_group_update(p_channel uuid, p_name text, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  c       public.chat_channels;
  v_users uuid[];
begin
  select * into c from public.chat_channels where id = p_channel and tenant_id = private.tenant_id() and kind = 'group' and archived_at is null;
  if not found or c.created_by is distinct from v_me or not private.can_see_project(c.project_id) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  v_users := private.chat_group_users(c.project_id, p_users);
  update public.chat_channels set name = v_name where id = c.id;
  delete from public.chat_channel_members where channel_id = c.id and user_id <> v_me and user_id <> all(v_users);
  insert into public.chat_channel_members (channel_id, user_id, added_by) select c.id, x, v_me from unnest(v_users) x
    on conflict (channel_id, user_id) do nothing;
end;
$$;

create or replace function public.chat_group_leave(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_channels;
begin
  select * into c from public.chat_channels where id = p_channel and tenant_id = private.tenant_id() and kind = 'group' and archived_at is null;
  if not found or not exists (select 1 from public.chat_channel_members where channel_id = c.id and user_id = auth.uid()) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if c.created_by = auth.uid() then raise exception 'creator_cannot_leave' using errcode = '22023'; end if;
  delete from public.chat_channel_members where channel_id = c.id and user_id = auth.uid();
end;
$$;

create or replace function public.chat_group_delete(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_channels set archived_at = now()
   where id = p_channel and tenant_id = private.tenant_id() and kind = 'group' and created_by = auth.uid() and archived_at is null;
  if not found then raise exception 'permission denied: chat' using errcode = '42501'; end if;
end;
$$;

drop function private.chat_can_access(uuid, text, uuid, uuid, uuid);

revoke execute on function public.chat_group_create(uuid, text, uuid[]), public.chat_group_update(uuid, text, uuid[]),
  public.chat_group_leave(uuid), public.chat_group_delete(uuid) from public, anon;
grant execute on function public.chat_group_create(uuid, text, uuid[]), public.chat_group_update(uuid, text, uuid[]),
  public.chat_group_leave(uuid), public.chat_group_delete(uuid) to authenticated;
grant execute on function private.chat_group_users(uuid, uuid[]) to authenticated;
notify pgrst, 'reload schema';
