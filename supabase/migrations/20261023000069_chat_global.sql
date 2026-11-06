-- Чат вне проекта: общий раздел «Чат» со всеми переписками человека.
-- Личные переписки и группы больше не привязаны к проекту: с коллегой одна переписка на все проекты, группа может объединять людей из разных проектов.
-- Каналы, которые по смыслу проектные (вся команда проекта, направление, организация подрядчика), остаются привязанными к проекту, но показываются в том же списке.
-- Кого можно позвать в личную переписку или группу: внутренние сотрудники — любого сотрудника; внешний — людей своей организации и внутреннюю команду,
-- с которой у него есть общий проект (правила из external_privacy сохраняются).
-- Присутствие («в сети») тоже общее: отметка раз в 30 секунд из любого места приложения.
-- Существующие дубли личных переписок одной пары (по одной на проект) сливаются в одну.
-- См. docs: 05-roadmap/05-backlog.md, раздел «17. Чат между сотрудниками».

-- ---------------------------------------------------------------------------
-- 1. Данные: одна личная переписка на пару людей
-- ---------------------------------------------------------------------------
create temp table _dm_rank as
select id, user_a, user_b, first_value(id) over (partition by user_a, user_b order by id) as keep
  from public.chat_channels where kind = 'direct';

update public.chat_messages m set channel_id = r.keep from _dm_rank r where m.channel_id = r.id and r.id <> r.keep;
insert into public.chat_reads (channel_id, user_id, last_read_at)
select r.keep, rd.user_id, max(rd.last_read_at)
  from _dm_rank r join public.chat_reads rd on rd.channel_id = r.id where r.id <> r.keep group by 1, 2
on conflict (channel_id, user_id) do update set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
delete from public.chat_channels where id in (select id from _dm_rank where id <> keep);
update public.chat_channels c set last_message_at = (select max(m.created_at) from public.chat_messages m where m.channel_id = c.id)
 where c.id in (select keep from _dm_rank);
drop table _dm_rank;

-- ---------------------------------------------------------------------------
-- 2. Схема: у личной переписки и группы проекта нет
-- ---------------------------------------------------------------------------
drop index public.chat_channels_direct;
alter table public.chat_channels alter column project_id drop not null;
update public.chat_channels set project_id = null where kind in ('direct', 'group');
alter table public.chat_channels add constraint chat_channels_project_check check (
  (kind in ('project', 'org', 'discipline') and project_id is not null) or (kind in ('direct', 'group') and project_id is null)
);
create unique index chat_channels_direct on public.chat_channels (user_a, user_b) where kind = 'direct';

-- ---------------------------------------------------------------------------
-- 3. Кого можно позвать в переписку
-- ---------------------------------------------------------------------------
create or replace function private.chat_peer_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and p_user <> auth.uid() and exists (
    select 1 from public.users u
     where u.id = p_user and u.tenant_id = private.tenant_id() and u.status <> 'blocked'
       and ((not u.is_external and not private.is_external())
            or (private.can_see_user(p_user) and private.shares_project_with(p_user))));
$$;
grant execute on function private.chat_peer_ok(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Доступ к каналу
-- ---------------------------------------------------------------------------
create or replace function private.chat_visible(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_channels c
     where c.id = p_channel and c.tenant_id = private.tenant_id() and c.archived_at is null
       and case c.kind
         when 'direct' then auth.uid() in (c.user_a, c.user_b)
                            and private.chat_peer_ok(case when c.user_a = auth.uid() then c.user_b else c.user_a end)
         when 'group'  then exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
         else private.can_see_project(c.project_id) and case c.kind
           when 'project' then private.can_see_internal(c.project_id)
           when 'org'     then private.can_see_internal(c.project_id) or c.organization_id = private.my_org_id()
           when 'discipline' then private.can_see_internal(c.project_id) and (
                exists (select 1 from public.project_members pm
                         where pm.project_id = c.project_id and pm.user_id = auth.uid() and pm.discipline_id = c.discipline_id
                           and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date))
                or exists (select 1 from public.disciplines d where d.id = c.discipline_id and d.lead_user_id = auth.uid() and d.deleted_at is null))
           else false
         end
       end);
$$;

-- Файл чата доступен по папке канала или по строке вложения (после слияния переписок файлы остаются в старой папке)
drop policy chat_storage_select on storage.objects;
create policy chat_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'chat'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (case when (storage.foldername(name))[3] ~ '^[0-9a-f-]{36}$' then private.chat_visible(((storage.foldername(name))[3])::uuid) else false end
         or exists (select 1 from public.chat_attachments a where a.storage_key = objects.name))
  );

-- ---------------------------------------------------------------------------
-- 5. Открыть канал: проектный — с проектом, личный — только с собеседником
-- ---------------------------------------------------------------------------
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

  if p_kind = 'direct' then
    if p_user is null or p_user = v_me then raise exception 'invalid_user' using errcode = '22023'; end if;
    if not private.chat_peer_ok(p_user) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
    v_a := least(v_me, p_user);
    v_b := greatest(v_me, p_user);
    insert into public.chat_channels (tenant_id, kind, user_a, user_b) values (v_tenant, 'direct', v_a, v_b)
      on conflict (user_a, user_b) where kind = 'direct' do nothing;
    select id into v_id from public.chat_channels where kind = 'direct' and user_a = v_a and user_b = v_b;
    return v_id;
  end if;

  if p_project is null or not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant) or not private.can_see_project(p_project) then
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
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Отправка: у личных и групповых каналов в пути файла вместо проекта «global»
-- ---------------------------------------------------------------------------
create or replace function public.chat_send(p_channel uuid, p_body text, p_attachments jsonb default '[]') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_att    jsonb := coalesce(p_attachments, '[]');
  v_n      integer;
  c        public.chat_channels;
  v_id     uuid;
  a        jsonb;
  o        record;
  v_prefix text;
  v_kind   text;
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select * into c from public.chat_channels where id = p_channel and tenant_id = v_tenant;
  if not found or not private.chat_visible(p_channel) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if jsonb_typeof(v_att) <> 'array' then raise exception 'invalid_message' using errcode = '22023'; end if;
  v_n := jsonb_array_length(v_att);
  if v_n > 10 or char_length(v_body) > 4000 or (v_body = '' and v_n = 0) then
    raise exception 'invalid_message' using errcode = '22023';
  end if;

  v_prefix := v_tenant || '/' || coalesce(c.project_id::text, 'global') || '/' || c.id || '/';
  for a in select * from jsonb_array_elements(v_att) loop
    v_kind := a ->> 'kind';
    if v_kind not in ('file', 'image', 'voice') or left(coalesce(a ->> 'storage_key', ''), char_length(v_prefix)) <> v_prefix
       or not exists (select 1 from storage.objects so where so.bucket_id = 'chat' and so.name = a ->> 'storage_key' and so.owner_id = v_me::text) then
      raise exception 'invalid_attachment' using errcode = '22023';
    end if;
  end loop;

  insert into public.chat_messages (tenant_id, channel_id, author_id, body) values (v_tenant, c.id, v_me, v_body) returning id into v_id;
  for a in select * from jsonb_array_elements(v_att) loop
    select coalesce((so.metadata ->> 'size')::bigint, 0) as size, coalesce(so.metadata ->> 'mimetype', 'application/octet-stream') as mime
      into o from storage.objects so where so.bucket_id = 'chat' and so.name = a ->> 'storage_key';
    insert into public.chat_attachments (tenant_id, message_id, storage_key, name, mime, size_bytes, kind, duration_sec)
    values (v_tenant, v_id, a ->> 'storage_key', left(coalesce(nullif(btrim(a ->> 'name'), ''), 'file'), 255), o.mime, o.size, a ->> 'kind',
            case when a ->> 'kind' = 'voice' then least(greatest(coalesce((a ->> 'duration_sec')::integer, 0), 0), 3600) end);
  end loop;
  update public.chat_channels set last_message_at = now() where id = c.id;
  insert into public.chat_reads (channel_id, user_id, last_read_at) values (c.id, v_me, now())
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Группы: состав из людей, которых можно позвать
-- ---------------------------------------------------------------------------
drop function public.chat_group_create(uuid, text, uuid[]);
drop function private.chat_group_users(uuid, uuid[]);

create or replace function private.chat_group_users(p_users uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_users, '{}')) x where x <> auth.uid()), '{}');
  v_u uuid;
begin
  if coalesce(array_length(v_users, 1), 0) = 0 then
    raise exception 'group_needs_members' using errcode = '22023';
  end if;
  foreach v_u in array v_users loop
    if not private.chat_peer_ok(v_u) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
  end loop;
  return v_users;
end;
$$;
grant execute on function private.chat_group_users(uuid[]) to authenticated;

create or replace function public.chat_group_create(p_name text, p_users uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_name   text := btrim(coalesce(p_name, ''));
  v_users  uuid[];
  v_id     uuid;
begin
  if v_me is null or v_tenant is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  v_users := private.chat_group_users(p_users);
  insert into public.chat_channels (tenant_id, kind, name, created_by) values (v_tenant, 'group', v_name, v_me) returning id into v_id;
  insert into public.chat_channel_members (channel_id, user_id, added_by) select v_id, x, v_me from unnest(v_users || v_me) x;
  return v_id;
end;
$$;

create or replace function public.chat_group_update(p_channel uuid, p_name text, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  c       public.chat_channels;
  v_users uuid[];
begin
  select * into c from public.chat_channels where id = p_channel and tenant_id = private.tenant_id() and kind = 'group' and archived_at is null;
  if not found or c.created_by is distinct from v_me then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  v_users := private.chat_group_users(p_users);
  update public.chat_channels set name = v_name where id = c.id;
  delete from public.chat_channel_members where channel_id = c.id and user_id <> v_me and user_id <> all(v_users);
  insert into public.chat_channel_members (channel_id, user_id, added_by) select c.id, x, v_me from unnest(v_users) x
    on conflict (channel_id, user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Список каналов и непрочитанное — по всем проектам сразу
-- ---------------------------------------------------------------------------
drop function public.chat_overview(uuid);
drop function public.chat_unread_count(uuid);

create or replace function public.chat_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_me     uuid := auth.uid();
  v_result jsonb;
begin
  if v_me is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- проектные каналы создаются сами: общий, мои направления, организации
  insert into public.chat_channels (tenant_id, project_id, kind)
  select v_tenant, p.id, 'project' from public.projects p
   where p.tenant_id = v_tenant and private.can_see_project(p.id) and private.can_see_internal(p.id)
  on conflict (project_id) where kind = 'project' do nothing;

  insert into public.chat_channels (tenant_id, project_id, kind, discipline_id)
  select v_tenant, d.project_id, 'discipline', d.id
    from public.disciplines d join public.projects p on p.id = d.project_id
   where p.tenant_id = v_tenant and d.tenant_id = v_tenant and d.deleted_at is null
     and private.can_see_project(p.id) and private.can_see_internal(p.id)
     and (d.lead_user_id = v_me
          or exists (select 1 from public.project_members pm
                      where pm.project_id = d.project_id and pm.user_id = v_me and pm.discipline_id = d.id
                        and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)))
  on conflict (project_id, discipline_id) where kind = 'discipline' do nothing;

  insert into public.chat_channels (tenant_id, project_id, kind, organization_id)
  select distinct v_tenant, pm.project_id, 'org', o.id
    from public.project_members pm
    join public.projects p on p.id = pm.project_id and p.tenant_id = v_tenant
    join public.users u on u.id = pm.user_id
    join public.organizations o on o.id = u.organization_id and o.deleted_at is null and o.kind <> 'own'
   where pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
     and private.can_see_project(pm.project_id)
     and (private.can_see_internal(pm.project_id) or o.id = private.my_org_id())
  on conflict (project_id, organization_id) where kind = 'org' do nothing;

  select coalesce(jsonb_agg(row_json order by sort_key, sort_code, sort_name), '[]'::jsonb) into v_result
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'name', c.name,
        'project_id', c.project_id,
        'project_code', p.code,
        'project_name', p.name,
        'organization_id', c.organization_id,
        'organization_name', o.name,
        'discipline_id', c.discipline_id,
        'discipline_code', d.code,
        'discipline_name', d.name,
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
      case c.kind when 'direct' then 0 when 'group' then 1 when 'project' then 2 when 'discipline' then 3 else 4 end as sort_key,
      coalesce(p.code, '') as sort_code,
      case when c.kind in ('direct', 'group') then coalesce(to_char(now() - c.last_message_at, 'YYYYMMDDHH24MISSUS'), '99999999999999999999')
           else coalesce(o.name, d.code, '') end as sort_name
    from public.chat_channels c
    left join public.projects p on p.id = c.project_id
    left join public.organizations o on o.id = c.organization_id
    left join public.disciplines d on d.id = c.discipline_id
    left join lateral (select m.body, m.author_id from public.chat_messages m
                        where m.channel_id = c.id and m.deleted_at is null order by m.created_at desc, m.id desc limit 1) lm on true
    where c.tenant_id = v_tenant and private.chat_visible(c.id)
  ) x;
  return v_result;
end;
$$;

create or replace function public.chat_unread_count() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(count(*), 0)::integer
    from public.chat_channels c
    join public.chat_messages m on m.channel_id = c.id
   where c.tenant_id = private.tenant_id() and private.chat_visible(c.id)
     and m.deleted_at is null and m.author_id <> auth.uid()
     and m.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.channel_id = c.id and r.user_id = auth.uid()), '-infinity');
$$;

-- ---------------------------------------------------------------------------
-- 9. Присутствие: общее для приложения, а не для проекта
-- ---------------------------------------------------------------------------
drop function public.presence_ping(uuid);
drop function public.project_online(uuid);
drop table public.project_presence;

create table public.user_presence (
  user_id   uuid primary key references public.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  seen_at   timestamptz not null default now()
);
alter table public.user_presence enable row level security;
alter table public.user_presence force row level security;
revoke insert, update, delete on public.user_presence from authenticated;
create policy user_presence_select on public.user_presence for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_user(user_id));

create or replace function public.presence_ping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.tenant_id() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  insert into public.user_presence (user_id, tenant_id, seen_at) values (auth.uid(), private.tenant_id(), now())
    on conflict (user_id) do update set seen_at = excluded.seen_at;
end;
$$;

-- Кто когда был в сети (видны только те, кого я вправе видеть); онлайн — отметка не старше 90 секунд
create or replace function public.chat_online() returns table (user_id uuid, seen_at timestamptz, online boolean)
language sql stable set search_path = '' as $$
  select up.user_id, up.seen_at, up.seen_at > now() - interval '90 seconds'
    from public.user_presence up
   where up.seen_at > now() - interval '7 days';
$$;

revoke execute on function public.chat_open(uuid, text, uuid, uuid), public.chat_send(uuid, text, jsonb), public.chat_overview(), public.chat_unread_count(),
  public.chat_group_create(text, uuid[]), public.chat_group_update(uuid, text, uuid[]), public.presence_ping(), public.chat_online() from public, anon;
grant execute on function public.chat_open(uuid, text, uuid, uuid), public.chat_send(uuid, text, jsonb), public.chat_overview(), public.chat_unread_count(),
  public.chat_group_create(text, uuid[]), public.chat_group_update(uuid, text, uuid[]), public.presence_ping(), public.chat_online() to authenticated;
notify pgrst, 'reload schema';
