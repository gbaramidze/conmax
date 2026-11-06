-- Итоги по записи совещания: расшифровка речи и черновик протокола (краткое содержание, решения, поручения, открытые вопросы).
--
-- Запись уже хранится в закрытом бакете (миграции 29–30). Здесь — результат её обработки: по одной строке на запись.
-- Расшифровку и итоги делает Edge Function `summarize-meeting` (облачная расшифровка речи и Claude по ключам из секретов функций);
-- она работает под сервисной ролью и пишет в эту таблицу, пользователи читают через RLS и запрашивают обработку через RPC.
-- Расшифровка и итоги видны тем же, кто вправе слушать запись (ведущий и управляющие совещанием), — не всем приглашённым.
-- Предложенные решения и поручения — это ЧЕРНОВИК: в протокол они попадают только по кнопке секретаря (`meeting_summary_accept`
-- запоминает, что уже принято, чтобы не создать дубль). Публикация протокола по-прежнему только у человека.
-- См. docs: 04-modules/07-meetings.md, раздел «Итоги по записи».

create table public.meeting_summaries (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  recording_id uuid not null unique references public.meeting_recordings(id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'transcribing', 'summarizing', 'ready', 'failed')),
  -- расшифровка речи целиком
  transcript   text not null default '',
  -- итоги: {summary, topics:[{title, points[]}], decisions:[{text}], actions:[{title, assignee_name, due_date, priority}], questions[]}
  result       jsonb not null default '{}'::jsonb,
  -- что из предложенного уже принято в протокол: ключи вида d0, a2
  accepted     text[] not null default '{}',
  -- код ошибки: not_configured_stt, not_configured_llm, too_large, stt_failed, llm_failed, empty_audio, no_speech, internal
  error        text,
  stt_model    text,
  llm_model    text,
  requested_by uuid default auth.uid() references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index on public.meeting_summaries (meeting_id);

alter table public.meeting_summaries enable row level security;
alter table public.meeting_summaries force row level security;
create policy meeting_summaries_select on public.meeting_summaries for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_access_recordings((select auth.uid()), meeting_id));
revoke insert, update, delete on public.meeting_summaries from authenticated;

-- Запросить обработку записи (или повторить). p_reuse_transcript: расшифровка уже есть — переписать только итоги.
-- Идущая обработка не дублируется: пока строка в работе меньше 15 минут, возвращается она же.
create or replace function public.meeting_summary_request(p_recording uuid, p_reuse_transcript boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.meeting_recordings;
  m public.meetings;
  s public.meeting_summaries;
begin
  select * into r from public.meeting_recordings where id = p_recording and tenant_id = private.tenant_id();
  if not found or not private.user_can_access_recordings(auth.uid(), r.meeting_id) then
    raise exception 'recording_not_found' using errcode = 'P0002';
  end if;
  select * into m from public.meetings where id = r.meeting_id;
  if m.status = 'cancelled' then raise exception 'meeting_closed' using errcode = '22023'; end if;

  select * into s from public.meeting_summaries where recording_id = r.id;
  if found then
    if s.status in ('queued', 'transcribing', 'summarizing') and s.updated_at > now() - interval '15 minutes' then
      return s.id;
    end if;
    update public.meeting_summaries
       set status = 'queued', error = null, result = case when p_reuse_transcript and transcript <> '' then result else '{}'::jsonb end,
           transcript = case when p_reuse_transcript then transcript else '' end,
           accepted = '{}', requested_by = auth.uid(), updated_at = now(), finished_at = null
     where id = s.id;
    return s.id;
  end if;
  insert into public.meeting_summaries (tenant_id, project_id, meeting_id, recording_id)
  values (r.tenant_id, r.project_id, r.meeting_id, r.id)
  returning id into s.id;
  return s.id;
end;
$$;

-- Отметить предложение принятым в протокол (ключ d0 — решение, a1 — поручение); повтор безвреден
create or replace function public.meeting_summary_accept(p_summary uuid, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.meeting_summaries;
begin
  select * into s from public.meeting_summaries where id = p_summary and tenant_id = private.tenant_id();
  if not found or not private.user_can_conduct_meeting(auth.uid(), s.meeting_id) then
    raise exception 'summary_not_found' using errcode = 'P0002';
  end if;
  if p_key !~ '^[da][0-9]{1,3}$' then raise exception 'invalid_key' using errcode = '22023'; end if;
  update public.meeting_summaries set accepted = (select array_agg(distinct k) from unnest(accepted || p_key) k) where id = s.id;
end;
$$;

-- Убрать расшифровку и итоги (например, если запись обработали по ошибке); саму запись это не трогает
create or replace function public.meeting_summary_delete(p_summary uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.meeting_summaries;
begin
  select * into s from public.meeting_summaries where id = p_summary and tenant_id = private.tenant_id();
  if not found or not private.user_can_access_recordings(auth.uid(), s.meeting_id) then
    raise exception 'summary_not_found' using errcode = 'P0002';
  end if;
  delete from public.meeting_summaries where id = s.id;
end;
$$;

revoke execute on function public.meeting_summary_request(uuid, boolean), public.meeting_summary_accept(uuid, text), public.meeting_summary_delete(uuid) from public, anon;
grant execute on function public.meeting_summary_request(uuid, boolean), public.meeting_summary_accept(uuid, text), public.meeting_summary_delete(uuid) to authenticated;
notify pgrst, 'reload schema';
