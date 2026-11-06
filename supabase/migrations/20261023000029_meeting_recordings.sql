-- Аудиозаписи совещаний: хранятся в закрытом бакете и видны только ведущему и тем, кто управляет совещанием
-- (не как обычное вложение, которое видят все приглашённые, включая внешних).
-- Под расшифровку и итоги ассистента запись пока только сохраняется. См. docs: 04-modules/07-meetings.md.

create table public.meeting_recordings (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  file_id      uuid not null references public.files(id),
  duration_sec integer not null default 0 check (duration_sec >= 0),
  created_by   uuid default auth.uid() references public.users(id),
  created_at   timestamptz not null default now()
);
create index on public.meeting_recordings (meeting_id, created_at);
create index on public.meeting_recordings (file_id);

-- Слушать запись: управляющие совещанием и ведущие
create or replace function private.user_can_access_recordings(p_user uuid, p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_can_manage_meeting(p_user, p_meeting) or private.user_can_conduct_meeting(p_user, p_meeting);
$$;

create or replace function private.user_can_hear_file(p_user uuid, p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meeting_recordings r
                  where r.file_id = p_file and private.user_can_access_recordings(p_user, r.meeting_id));
$$;

alter table public.meeting_recordings enable row level security;
alter table public.meeting_recordings force row level security;
create policy meeting_recordings_select on public.meeting_recordings for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_access_recordings((select auth.uid()), meeting_id));
revoke insert, update, delete on public.meeting_recordings from authenticated;

-- Файл записи виден тем, кто вправе её слушать (Storage опирается на эту политику)
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), files.id))
  );

-- Файл удаляется из хранилища только после того, как запись о нём удалена (осиротевший объект своего проекта)
create policy files_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and not exists (select 1 from public.files f where f.storage_key = objects.name)
    and (private.has_project_permission(((storage.foldername(name))[2])::uuid, 'meeting.conduct')
         or private.has_project_permission(((storage.foldername(name))[2])::uuid, 'meeting.manage'))
  );

create or replace function public.add_meeting_recording(p_meeting uuid, p_file uuid, p_duration integer default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_id uuid;
begin
  select * into m from public.meetings where id = p_meeting and tenant_id = private.tenant_id();
  if not found or not private.user_can_view_meeting(auth.uid(), m.id) then raise exception 'meeting_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_access_recordings(auth.uid(), m.id) then raise exception 'permission denied: meeting.conduct' using errcode = '42501'; end if;
  if m.status = 'cancelled' then raise exception 'meeting_closed' using errcode = '22023'; end if;
  -- файл — свой, из этого же проекта
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = m.project_id and f.tenant_id = m.tenant_id and f.created_by = auth.uid()) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  insert into public.meeting_recordings (tenant_id, project_id, meeting_id, file_id, duration_sec, created_by)
  values (m.tenant_id, m.project_id, m.id, p_file, greatest(coalesce(p_duration, 0), 0), auth.uid())
  returning id into v_id;
  perform private.record_event(m.tenant_id, m.project_id, 'meeting', m.id, 'recording_added',
                               jsonb_build_object('duration_sec', greatest(coalesce(p_duration, 0), 0)), 'internal');
  return v_id;
end;
$$;

-- Возвращает ключ объекта в хранилище, чтобы клиент удалил и сам файл
create or replace function public.delete_meeting_recording(p_recording uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.meeting_recordings;
  v_key text;
begin
  select * into r from public.meeting_recordings where id = p_recording and tenant_id = private.tenant_id();
  if not found or not private.user_can_access_recordings(auth.uid(), r.meeting_id) then raise exception 'recording_not_found' using errcode = 'P0002'; end if;
  delete from public.meeting_recordings where id = r.id;
  delete from public.files where id = r.file_id returning storage_key into v_key;
  perform private.record_event(r.tenant_id, r.project_id, 'meeting', r.meeting_id, 'recording_deleted', '{}', 'internal');
  return v_key;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['add_meeting_recording(uuid,uuid,integer)', 'delete_meeting_recording(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
