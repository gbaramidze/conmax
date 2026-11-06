-- Чат проекта: файлы, фото, голосовые сообщения и реакции-эмодзи.
-- Файлы лежат в закрытом бакете `chat` по пути <tenant>/<проект>/<канал>/<имя>: читать и загружать может тот, кто видит канал
-- (то же правило, что и для сообщений), удалять — только загрузивший. К сообщению файлы прикрепляются при отправке (`chat_send`),
-- размер и тип берутся из хранилища, а не от клиента. При удалении сообщения вложения и реакции убираются, ключи файлов возвращаются клиенту.
-- См. docs: 05-roadmap/05-backlog.md, раздел «17. Чат между сотрудниками».

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 26214400)
on conflict (id) do nothing;

create policy chat_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'chat'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and case when (storage.foldername(name))[3] ~ '^[0-9a-f-]{36}$' then private.chat_visible(((storage.foldername(name))[3])::uuid) else false end
  );
create policy chat_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and case when (storage.foldername(name))[3] ~ '^[0-9a-f-]{36}$' then private.chat_visible(((storage.foldername(name))[3])::uuid) else false end
  );
create policy chat_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and owner_id = (select auth.uid())::text);

alter table public.chat_messages drop constraint chat_messages_check;
alter table public.chat_messages add constraint chat_messages_body_check check (char_length(body) <= 4000);

create table public.chat_attachments (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  message_id   uuid not null references public.chat_messages(id) on delete cascade,
  storage_key  text not null check (char_length(storage_key) <= 400),
  name         text not null check (char_length(name) between 1 and 255),
  mime         text not null,
  size_bytes   bigint not null check (size_bytes >= 0),
  kind         text not null check (kind in ('file', 'image', 'voice')),
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 3600),
  created_at   timestamptz not null default now()
);
create index on public.chat_attachments (message_id);

create table public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.chat_attachments enable row level security;
alter table public.chat_attachments force row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_reactions force row level security;
revoke insert, update, delete on public.chat_attachments, public.chat_reactions from authenticated;
create policy chat_attachments_select on public.chat_attachments for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.chat_messages m where m.id = message_id));
create policy chat_reactions_select on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id));

alter publication supabase_realtime add table public.chat_attachments, public.chat_reactions;

-- Отправить сообщение: текст и/или вложения (до 10), загруженные заранее в свою папку канала
drop function public.chat_send(uuid, text);
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

  v_prefix := v_tenant || '/' || c.project_id || '/' || c.id || '/';
  -- сначала проверяем все вложения, потом пишем
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

-- Удалить своё сообщение вместе с вложениями и реакциями; возвращает ключи файлов, чтобы клиент убрал их из хранилища
drop function public.chat_delete(uuid);
create or replace function public.chat_delete(p_message uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  m      public.chat_messages;
  v_keys text[];
begin
  select * into m from public.chat_messages where id = p_message and tenant_id = private.tenant_id();
  if not found or m.author_id is distinct from auth.uid() then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  select coalesce(array_agg(storage_key), '{}') into v_keys from public.chat_attachments where message_id = m.id;
  delete from public.chat_attachments where message_id = m.id;
  delete from public.chat_reactions where message_id = m.id;
  update public.chat_messages set deleted_at = now(), body = '' where id = m.id and deleted_at is null;
  return v_keys;
end;
$$;

-- Реакция: нажать — поставить, нажать ещё раз — снять. Возвращает true, если реакция поставлена.
create or replace function public.chat_react(p_message uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  m       public.chat_messages;
  v_emoji text := btrim(coalesce(p_emoji, ''));
begin
  select * into m from public.chat_messages where id = p_message and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.chat_visible(m.channel_id) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if char_length(v_emoji) not between 1 and 16 then raise exception 'invalid_emoji' using errcode = '22023'; end if;
  delete from public.chat_reactions where message_id = m.id and user_id = auth.uid() and emoji = v_emoji;
  if found then return false; end if;
  insert into public.chat_reactions (message_id, user_id, emoji) values (m.id, auth.uid(), v_emoji);
  return true;
end;
$$;

revoke execute on function public.chat_send(uuid, text, jsonb), public.chat_delete(uuid), public.chat_react(uuid, text) from public, anon;
grant execute on function public.chat_send(uuid, text, jsonb), public.chat_delete(uuid), public.chat_react(uuid, text) to authenticated;
notify pgrst, 'reload schema';
