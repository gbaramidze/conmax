-- Регулярные совещания: серия по дням недели и времени (например, пн 11:00 и ср 13:00), встречи создаются заранее.
-- Любую встречу можно перенести только её саму или вместе со всеми следующими (меняется расписание серии).
-- См. docs: 04-modules/07-meetings.md (§0, серии).

create table public.meeting_series (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references public.users(id),
  title           text not null check (length(btrim(title)) between 1 and 200),
  type            text not null default 'weekly'
                  check (type in ('operational','weekly','coordination','safety','client','acceptance','other')),
  duration_min    integer not null default 60 check (duration_min between 5 and 720),
  place           text check (place is null or length(place) <= 200),
  visibility      text not null default 'internal' check (visibility in ('internal','external')),
  facilitator_id  uuid references public.users(id),
  participant_ids uuid[] not null default '{}',
  agenda          text[] not null default '{}',
  -- [{"dow": 1, "time": "11:00"}, {"dow": 3, "time": "13:00"}]; dow: 1 — понедельник … 7 — воскресенье
  slots           jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 14),
  starts_on       date not null,
  ends_on         date,
  active          boolean not null default true,
  check (ends_on is null or ends_on >= starts_on)
);
create index on public.meeting_series (tenant_id, project_id) where active;

alter table public.meeting_series enable row level security;
alter table public.meeting_series force row level security;
create policy meeting_series_select on public.meeting_series for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id));
revoke insert, update, delete on public.meeting_series from authenticated;

alter table public.meetings add column series_id uuid references public.meeting_series(id) on delete set null;
alter table public.meetings add column original_at timestamptz;   -- время по расписанию серии; перенос меняет только scheduled_at
create unique index meetings_series_slot_uniq on public.meetings (series_id, original_at) where series_id is not null;

-- Служебные операции над серией (создание встреч, перенос расписания) идут от имени системы:
-- права на них проверены в самих функциях, а приглашения не рассылаются на каждую встречу.
create or replace function private.meeting_system_op() returns boolean
language sql stable as $$ select coalesce(current_setting('buildos.meeting_system', true), '') = '1' $$;

create or replace function private.meetings_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('published', 'cancelled') then
    raise exception 'meeting_closed' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.title := btrim(new.title);
  if not private.meeting_system_op() then
    if new.summary is distinct from old.summary and not private.user_can_conduct_meeting(auth.uid(), old.id) then
      raise exception 'permission denied: meeting.conduct' using errcode = '42501';
    end if;
    if (new.title, new.type, new.scheduled_at, new.duration_min, new.place, new.visibility, new.facilitator_id)
       is distinct from (old.title, old.type, old.scheduled_at, old.duration_min, old.place, old.visibility, old.facilitator_id)
       and not private.user_can_manage_meeting(auth.uid(), old.id) then
      raise exception 'permission denied: meeting.manage' using errcode = '42501';
    end if;
  end if;
  if new.facilitator_id is distinct from old.facilitator_id and new.facilitator_id is not null
     and not private.user_is_project_member(new.facilitator_id, old.project_id) then
    raise exception 'facilitator is not a project member' using errcode = '23514';
  end if;
  if new.visibility is distinct from old.visibility and old.status <> 'scheduled' then
    raise exception 'visibility_locked' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Дочерние строки: совещание ищем по id (доступ уже проверен политиками), чтобы работали и системные операции
create or replace function private.meeting_children_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_id uuid := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
begin
  select * into m from public.meetings where id = v_id;
  if not found then raise exception 'meeting_not_found' using errcode = 'P0002'; end if;
  if m.status in ('published', 'cancelled') then raise exception 'meeting_closed' using errcode = '22023'; end if;

  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'INSERT' then
    new.tenant_id := m.tenant_id;
    new.project_id := m.project_id;
  end if;

  if tg_table_name = 'meeting_participants' then
    if tg_op = 'INSERT' and not private.user_is_project_member(new.user_id, m.project_id) then
      raise exception 'participant is not a project member' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.attendance is distinct from old.attendance and not private.user_can_conduct_meeting(auth.uid(), m.id) then
      raise exception 'permission denied: meeting.conduct' using errcode = '42501';
    end if;
  elsif tg_table_name = 'meeting_agenda_items' then
    if tg_op = 'INSERT' then
      new.title := btrim(new.title);
      if new.sort = 0 then
        select coalesce(max(sort), 0) + 10 into new.sort from public.meeting_agenda_items where meeting_id = m.id;
      end if;
    end if;
    if tg_op = 'UPDATE' and new.notes is distinct from old.notes and not private.user_can_conduct_meeting(auth.uid(), m.id) then
      raise exception 'permission denied: meeting.conduct' using errcode = '42501';
    end if;
    if new.presenter_id is not null and not private.user_is_project_member(new.presenter_id, m.project_id) then
      raise exception 'presenter is not a project member' using errcode = '23514';
    end if;
    if new.task_id is not null and not exists (
      select 1 from public.tasks t where t.id = new.task_id and t.project_id = m.project_id and t.deleted_at is null) then
      raise exception 'task belongs to another project' using errcode = '23514';
    end if;
  else
    if m.status not in ('in_progress', 'minutes_draft') then
      raise exception 'meeting_not_in_progress' using errcode = '22023';
    end if;
    new.text := btrim(new.text);
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      select coalesce(max(number), 0) + 1 into new.number from public.meeting_decisions where meeting_id = m.id;
    end if;
    if new.agenda_item_id is not null and not exists (
      select 1 from public.meeting_agenda_items a where a.id = new.agenda_item_id and a.meeting_id = m.id) then
      raise exception 'agenda item belongs to another meeting' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.meeting_participants_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
begin
  if private.meeting_system_op() then return new; end if;
  select * into m from public.meetings where id = new.meeting_id;
  if m.status = 'scheduled' then
    perform private.notify(new.user_id, 'meeting', m.id, 'assigned', 'normal', 'meeting',
      format('Вас пригласили на совещание «%s» — %s', m.title,
             to_char(m.scheduled_at at time zone (select coalesce(p.timezone, 'UTC') from public.projects p where p.id = m.project_id), 'DD.MM.YYYY HH24:MI')));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Вспомогательное
-- ---------------------------------------------------------------------------
create or replace function private.user_can_manage_series(p_user uuid, p_series uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meeting_series s
     where s.id = p_series
       and private.user_has_project_permission(p_user, s.project_id, 'comment.internal.view')
       and (s.created_by = p_user or s.facilitator_id = p_user
            or private.user_has_project_permission(p_user, s.project_id, 'meeting.manage')));
$$;

create or replace function private.series_slot_label(p_slots jsonb) returns text
language sql immutable as $$
  select string_agg((array['пн','вт','ср','чт','пт','сб','вс'])[(s ->> 'dow')::int] || ' ' || (s ->> 'time'), ', '
                    order by (s ->> 'dow')::int, s ->> 'time')
    from jsonb_array_elements(p_slots) s;
$$;

-- Создаёт недостающие встречи серии на ближайшие p_days дней (уже созданные, перенесённые и отменённые не трогает)
create or replace function private.generate_series_meetings(p_series uuid, p_days integer default 42) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s       public.meeting_series;
  v_proj  public.projects;
  v_tz    text;
  v_today date;
  d       date;
  v_slot  jsonb;
  v_ts    timestamptz;
  v_n     integer;
  v_id    uuid;
  v_user  uuid;
  v_title text;
  v_count integer := 0;
begin
  select * into s from public.meeting_series where id = p_series and active;
  if not found then return 0; end if;
  select * into v_proj from public.projects where id = s.project_id;
  v_tz := coalesce(v_proj.timezone, 'UTC');
  v_today := (now() at time zone v_tz)::date;

  perform set_config('buildos.meeting_system', '1', true);
  for d in
    select g::date from generate_series(greatest(s.starts_on, v_today), v_today + p_days, interval '1 day') g
     where s.ends_on is null or g::date <= s.ends_on
  loop
    for v_slot in select * from jsonb_array_elements(s.slots) loop
      continue when extract(isodow from d)::int <> (v_slot ->> 'dow')::int;
      v_ts := (d + (v_slot ->> 'time')::time) at time zone v_tz;
      continue when v_ts < now();
      continue when exists (select 1 from public.meetings m where m.series_id = s.id and m.original_at = v_ts);

      insert into public.project_counters as pc (project_id, kind, last_number) values (s.project_id, 'M', 1)
      on conflict (project_id, kind) do update set last_number = pc.last_number + 1
      returning last_number into v_n;

      insert into public.meetings (tenant_id, project_id, number, key, type, title, scheduled_at, original_at, duration_min,
                                   place, visibility, facilitator_id, created_by, series_id)
      values (s.tenant_id, s.project_id, v_n, v_proj.code || '-M-' || v_n, s.type, s.title, v_ts, v_ts, s.duration_min,
              s.place, s.visibility, s.facilitator_id, s.created_by, s.id)
      returning id into v_id;

      for v_user in select u from unnest(s.participant_ids) u loop
        if private.user_is_project_member(v_user, s.project_id) then
          insert into public.meeting_participants (meeting_id, user_id, tenant_id, project_id)
          values (v_id, v_user, s.tenant_id, s.project_id) on conflict do nothing;
        end if;
      end loop;
      foreach v_title in array s.agenda loop
        insert into public.meeting_agenda_items (meeting_id, tenant_id, project_id, title) values (v_id, s.tenant_id, s.project_id, v_title);
      end loop;
      v_count := v_count + 1;
    end loop;
  end loop;
  perform set_config('buildos.meeting_system', '', true);
  return v_count;
end;
$$;

-- Ежедневно поддерживаем горизонт в 6 недель
create or replace function private.generate_all_series() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.meeting_series where active and (ends_on is null or ends_on >= current_date) loop
    perform private.generate_series_meetings(r.id);
  end loop;
end;
$$;
select cron.schedule('buildos-meeting-series', '17 3 * * *', $$select private.generate_all_series()$$);

-- ---------------------------------------------------------------------------
-- Создание серии
-- ---------------------------------------------------------------------------
create or replace function public.create_meeting_series(
  p_project      uuid,
  p_title        text,
  p_type         text,
  p_slots        jsonb,
  p_starts_on    date,
  p_ends_on      date default null,
  p_duration_min integer default 60,
  p_place        text default null,
  p_visibility   text default 'internal',
  p_facilitator  uuid default null,
  p_participants uuid[] default '{}',
  p_agenda       text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := private.tenant_id();
  v_fac    uuid := coalesce(p_facilitator, v_uid);
  v_id     uuid;
  v_first  uuid;
  v_user   uuid;
  v_people uuid[];
  v_slot   jsonb;
begin
  if v_uid is null or v_tenant is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'meeting.create')
     or not private.can_see_internal(p_project) then
    raise exception 'permission denied: meeting.create' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if p_starts_on is null then raise exception 'date_required' using errcode = '22023'; end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) not between 1 and 14 then
    raise exception 'slots_required' using errcode = '22023';
  end if;
  for v_slot in select * from jsonb_array_elements(p_slots) loop
    if (v_slot ->> 'dow') !~ '^[1-7]$' or (v_slot ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'slots_invalid' using errcode = '22023';
    end if;
  end loop;
  if not private.user_is_project_member(v_fac, p_project) then
    raise exception 'facilitator is not a project member' using errcode = '23514';
  end if;

  select array_agg(distinct u) into v_people from unnest(coalesce(p_participants, '{}') || v_uid || v_fac) u
   where private.user_is_project_member(u, p_project);

  insert into public.meeting_series (tenant_id, project_id, created_by, title, type, duration_min, place, visibility,
                                     facilitator_id, participant_ids, agenda, slots, starts_on, ends_on)
  values (v_tenant, p_project, v_uid, btrim(p_title), coalesce(p_type, 'weekly'), coalesce(p_duration_min, 60),
          nullif(btrim(coalesce(p_place, '')), ''), coalesce(p_visibility, 'internal'), v_fac, v_people,
          coalesce((select array_agg(btrim(a)) from unnest(coalesce(p_agenda, '{}')) a where nullif(btrim(a), '') is not null), '{}'),
          p_slots, p_starts_on, p_ends_on)
  returning id into v_id;

  perform private.generate_series_meetings(v_id);
  select id into v_first from public.meetings where series_id = v_id order by scheduled_at limit 1;
  if v_first is null then raise exception 'no_occurrences' using errcode = '22023'; end if;

  -- одно приглашение на всю серию, а не по письму на каждую встречу
  for v_user in select u from unnest(v_people) u loop
    perform private.notify(v_user, 'meeting', v_first, 'assigned', 'normal', 'meeting',
      format('Вас пригласили на регулярное совещание «%s»: %s', btrim(p_title), private.series_slot_label(p_slots)));
  end loop;
  perform private.record_event(v_tenant, p_project, 'meeting', v_first, 'created',
                               jsonb_build_object('title', btrim(p_title), 'series', private.series_slot_label(p_slots)), 'internal');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Перенос: только эта встреча или эта и все следующие
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_meeting(p_meeting uuid, p_new_at timestamptz, p_scope text default 'this') returns void
language plpgsql security definer set search_path = '' as $$
declare
  m        public.meetings;
  s        public.meeting_series;
  v_tz     text;
  o        record;
  v_old_dow  integer;
  v_old_time text;
  v_new_dow  integer;
  v_new_time text;
  v_delta  integer;
  v_ts     timestamptz;
  v_user   uuid;
  v_text   text;
  v_when   text;
begin
  select * into m from public.meetings where id = p_meeting and tenant_id = private.tenant_id() for update;
  if not found or not private.user_can_view_meeting(auth.uid(), m.id) then raise exception 'meeting_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_manage_meeting(auth.uid(), m.id) then raise exception 'permission denied: meeting.manage' using errcode = '42501'; end if;
  if m.status <> 'scheduled' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if p_new_at is null then raise exception 'date_required' using errcode = '22023'; end if;
  if p_scope not in ('this', 'following') then raise exception 'invalid_scope' using errcode = '22023'; end if;

  select coalesce(p.timezone, 'UTC') into v_tz from public.projects p where p.id = m.project_id;
  perform set_config('buildos.meeting_system', '1', true);

  if p_scope = 'this' then
    update public.meetings set scheduled_at = p_new_at where id = m.id;
  else
    if m.series_id is null then raise exception 'not_in_series' using errcode = '22023'; end if;
    select * into s from public.meeting_series where id = m.series_id for update;
    if not private.user_can_manage_series(auth.uid(), s.id) then raise exception 'permission denied: meeting.manage' using errcode = '42501'; end if;

    v_old_dow  := extract(isodow from (coalesce(m.original_at, m.scheduled_at) at time zone v_tz))::int;
    v_old_time := to_char(coalesce(m.original_at, m.scheduled_at) at time zone v_tz, 'HH24:MI');
    v_new_dow  := extract(isodow from (p_new_at at time zone v_tz))::int;
    v_new_time := to_char(p_new_at at time zone v_tz, 'HH24:MI');
    v_delta    := v_new_dow - v_old_dow;

    -- расписание серии: прежний слот заменяется новым
    update public.meeting_series set slots = (
      select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
        select case when (sl ->> 'dow')::int = v_old_dow and sl ->> 'time' = v_old_time
                    then jsonb_build_object('dow', v_new_dow, 'time', v_new_time) else sl end as x
          from jsonb_array_elements(s.slots) sl) q)
     where id = s.id;

    -- эта встреча становится «обычной» в новом слоте
    update public.meetings set scheduled_at = p_new_at, original_at = p_new_at where id = m.id;

    -- следующие нетронутые встречи того же слота сдвигаются вслед за ней
    for o in
      select id, original_at from public.meetings
       where series_id = s.id and id <> m.id and status = 'scheduled'
         and scheduled_at = original_at and original_at > coalesce(m.original_at, m.scheduled_at)
         and extract(isodow from (original_at at time zone v_tz))::int = v_old_dow
         and to_char(original_at at time zone v_tz, 'HH24:MI') = v_old_time
       order by original_at
    loop
      v_ts := (((o.original_at at time zone v_tz)::date + v_delta) + v_new_time::time) at time zone v_tz;
      update public.meetings set scheduled_at = v_ts, original_at = v_ts where id = o.id;
    end loop;
  end if;
  perform set_config('buildos.meeting_system', '', true);

  v_when := to_char(p_new_at at time zone v_tz, 'DD.MM.YYYY HH24:MI');
  v_text := case when p_scope = 'following'
                 then format('Расписание совещания «%s» изменено: ближайшая встреча — %s', m.title, v_when)
                 else format('Совещание «%s» перенесено на %s', m.title, v_when) end;
  for v_user in select user_id from public.meeting_participants where meeting_id = m.id loop
    perform private.notify(v_user, 'meeting', m.id, 'watching', 'high', 'meeting', v_text);
  end loop;
  perform private.record_event(m.tenant_id, m.project_id, 'meeting', m.id, 'rescheduled',
                               jsonb_build_object('from', m.scheduled_at, 'to', p_new_at, 'scope', p_scope), 'internal');
end;
$$;

-- Закончить серию: будущие нетронутые встречи убираются, перенесённые вручную остаются как разовые
create or replace function public.end_meeting_series(p_series uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.meeting_series;
  v_removed integer;
  v_tz text;
begin
  select * into s from public.meeting_series where id = p_series and tenant_id = private.tenant_id() for update;
  if not found or not private.can_see_project(s.project_id) then raise exception 'series_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_manage_series(auth.uid(), s.id) then raise exception 'permission denied: meeting.manage' using errcode = '42501'; end if;

  select coalesce(p.timezone, 'UTC') into v_tz from public.projects p where p.id = s.project_id;
  update public.meeting_series set active = false, ends_on = greatest(starts_on, (now() at time zone v_tz)::date) where id = s.id;
  delete from public.meetings where series_id = s.id and status = 'scheduled' and scheduled_at > now() and scheduled_at = original_at;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_meeting_series(uuid,text,text,jsonb,date,date,integer,text,text,uuid,uuid[],text[])',
    'reschedule_meeting(uuid,timestamptz,text)',
    'end_meeting_series(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Реестр: добавлены серия и признак переноса
create or replace view public.meetings_overview with (security_invoker = true) as
select m.id, m.project_id, m.number, m.key, m.type, m.title, m.scheduled_at, m.duration_min, m.place, m.visibility,
       m.status, m.facilitator_id, m.published_at,
       (select count(*)::int from public.meeting_participants p where p.meeting_id = m.id) as participants_count,
       (select count(*)::int from public.meeting_participants p where p.meeting_id = m.id and p.attendance = 'present') as present_count,
       (select count(*)::int from public.meeting_decisions d where d.meeting_id = m.id) as decisions_count,
       (select count(*)::int from public.tasks t where t.meeting_id = m.id and t.deleted_at is null) as actions_count,
       (select count(*)::int from public.tasks t where t.meeting_id = m.id and t.deleted_at is null
           and t.status_category not in ('done', 'cancelled')) as open_actions_count,
       m.series_id, m.original_at
  from public.meetings m;
grant select on public.meetings_overview to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
