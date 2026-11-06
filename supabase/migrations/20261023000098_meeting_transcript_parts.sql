-- Запись совещания кусками: расшифровка по ходу и итоги без повторной расшифровки всего файла.
--
-- Пока идёт запись, браузер каждые ~30 секунд (и при смене говорящего) отправляет короткий кусок звука в Edge Function `transcribe-chunk`;
-- она расшифровывает его и пишет сюда строку `meeting_transcript_parts` (текст, смещение от начала записи, говорящий, если его отметили).
-- Экран показывает текст сразу. Целиком запись по-прежнему сохраняется одним файлом, чтобы её можно было послушать.
-- Куски объединены сеансом записи (`session_id`); запись помнит свой сеанс, и когда по ней просят итоги, расшифровка собирается из кусков
-- (`meeting_summaries.from_parts`), без повторной расшифровки файла: нет предела 24 МБ и ожидания.
-- Видят куски те же, кто вправе слушать запись (ведущий и управляющие совещанием). Пишет их только функция под сервисной ролью.
-- Не вошло: автоматическое определение говорящих по голосу (потребует другого сервиса расшифровки), правка текста кусков человеком.
-- См. docs: 04-modules/07-meetings.md.

create table public.meeting_transcript_parts (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  session_id   uuid not null,
  seq          integer not null check (seq >= 0),
  offset_sec   integer not null default 0 check (offset_sec >= 0),
  duration_sec integer not null default 0 check (duration_sec >= 0),
  speaker      text check (speaker is null or char_length(speaker) <= 200),
  text         text not null default '' check (char_length(text) <= 20000),
  created_by   uuid default auth.uid() references public.users(id),
  created_at   timestamptz not null default now(),
  unique (meeting_id, session_id, seq)
);
create index on public.meeting_transcript_parts (meeting_id, session_id, seq);

alter table public.meeting_transcript_parts enable row level security;
alter table public.meeting_transcript_parts force row level security;
create policy meeting_transcript_parts_select on public.meeting_transcript_parts for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_access_recordings((select auth.uid()), meeting_id));
revoke insert, update, delete on public.meeting_transcript_parts from authenticated;

-- Может ли вызывающий записывать и расшифровывать это совещание (проверка для Edge Function)
create or replace function public.meeting_transcript_allowed(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meetings m where m.id = p_meeting and m.tenant_id = private.tenant_id() and m.status <> 'cancelled')
         and private.user_can_access_recordings(auth.uid(), p_meeting)
$$;
revoke execute on function public.meeting_transcript_allowed(uuid) from public, anon;
grant execute on function public.meeting_transcript_allowed(uuid) to authenticated;

alter table public.meeting_recordings add column if not exists session_id uuid;
alter table public.meeting_summaries add column if not exists from_parts boolean not null default false;

-- Запись запоминает сеанс, по которому шла расшифровка кусками
drop function if exists public.add_meeting_recording(uuid, uuid, integer);
create or replace function public.add_meeting_recording(p_meeting uuid, p_file uuid, p_duration integer default 0, p_session uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_id uuid;
begin
  select * into m from public.meetings where id = p_meeting and tenant_id = private.tenant_id();
  if not found or not private.user_can_view_meeting(auth.uid(), m.id) then raise exception 'meeting_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_access_recordings(auth.uid(), m.id) then raise exception 'permission denied: meeting.conduct' using errcode = '42501'; end if;
  if m.status = 'cancelled' then raise exception 'meeting_closed' using errcode = '22023'; end if;
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = m.project_id and f.tenant_id = m.tenant_id and f.created_by = auth.uid()) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  insert into public.meeting_recordings (tenant_id, project_id, meeting_id, file_id, duration_sec, created_by, session_id)
  values (m.tenant_id, m.project_id, m.id, p_file, greatest(coalesce(p_duration, 0), 0), auth.uid(), p_session)
  returning id into v_id;
  perform private.record_event(m.tenant_id, m.project_id, 'meeting', m.id, 'recording_added',
                               jsonb_build_object('duration_sec', greatest(coalesce(p_duration, 0), 0)), 'internal');
  return v_id;
end;
$$;
revoke execute on function public.add_meeting_recording(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.add_meeting_recording(uuid, uuid, integer, uuid) to authenticated;

-- Расшифровка из кусков: по строке на кусок, «Говорящий: текст» там, где говорящий отмечен
create or replace function private.transcript_from_parts(p_meeting uuid, p_session uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(case when speaker is not null and btrim(speaker) <> '' then speaker || ': ' || btrim(text) else btrim(text) end, E'\n' order by seq), '')
    from public.meeting_transcript_parts
   where meeting_id = p_meeting and session_id = p_session and btrim(text) <> ''
$$;

-- Запрос итогов: если у записи есть расшифровка по кускам, берём её и файл заново не расшифровываем
create or replace function public.meeting_summary_request(p_recording uuid, p_reuse_transcript boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.meeting_recordings;
  m public.meetings;
  s public.meeting_summaries;
  v_parts text := '';
begin
  select * into r from public.meeting_recordings where id = p_recording and tenant_id = private.tenant_id();
  if not found or not private.user_can_access_recordings(auth.uid(), r.meeting_id) then
    raise exception 'recording_not_found' using errcode = 'P0002';
  end if;
  select * into m from public.meetings where id = r.meeting_id;
  if m.status = 'cancelled' then raise exception 'meeting_closed' using errcode = '22023'; end if;
  if r.session_id is not null then v_parts := private.transcript_from_parts(r.meeting_id, r.session_id); end if;

  select * into s from public.meeting_summaries where recording_id = r.id;
  if found then
    if s.status in ('queued', 'transcribing', 'summarizing') and s.updated_at > now() - interval '15 minutes' then
      return s.id;
    end if;
    update public.meeting_summaries
       set status = 'queued', error = null, result = case when (p_reuse_transcript and transcript <> '') or char_length(v_parts) >= 40 then result else '{}'::jsonb end,
           transcript = case when char_length(v_parts) >= 40 then v_parts when p_reuse_transcript then transcript else '' end,
           from_parts = char_length(v_parts) >= 40,
           accepted = '{}', requested_by = auth.uid(), updated_at = now(), finished_at = null
     where id = s.id;
    return s.id;
  end if;
  insert into public.meeting_summaries (tenant_id, project_id, meeting_id, recording_id, transcript, from_parts)
  values (r.tenant_id, r.project_id, r.meeting_id, r.id, case when char_length(v_parts) >= 40 then v_parts else '' end, char_length(v_parts) >= 40)
  returning id into s.id;
  return s.id;
end;
$$;
notify pgrst, 'reload schema';
