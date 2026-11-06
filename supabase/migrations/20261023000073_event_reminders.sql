-- Напоминания о событиях календаря: за 10 минут приходит уведомление «Через N мин: название».
-- Охват: события со временем — совещания (участникам и ведущему) и личные события со временем (владельцу, по его часовому поясу).
-- События «на весь день» (сроки задач, вехи, документы) напоминаний за 10 минут не имеют: у них нет времени начала.
-- Задание раз в минуту (`pg_cron`, `buildos-reminders`). Каждое напоминание отправляется один раз на человека и момент начала: перенесённое событие напомнит заново.
-- Письмом такие уведомления не дублируются: через три минуты письмо уже бесполезно.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Напоминания о событиях».

create table public.event_reminders_sent (
  kind      text not null check (kind in ('meeting', 'personal')),
  entity_id uuid not null,
  user_id   uuid not null references public.users(id) on delete cascade,
  starts_at timestamptz not null,
  sent_at   timestamptz not null default now(),
  primary key (kind, entity_id, user_id, starts_at)
);
alter table public.event_reminders_sent enable row level security;
alter table public.event_reminders_sent force row level security;
revoke all on public.event_reminders_sent from authenticated, anon;

-- Не дублируем напоминания письмом
create or replace function private.notifications_enqueue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_mode  text;
begin
  if new.event_type like '%.reminder' then return new; end if;
  select u.email into v_email from public.users u where u.id = new.user_id and u.status <> 'blocked';
  if v_email is null then return new; end if;

  v_mode := private.channel_mode(new.user_id, new.category, 'email');
  if new.priority = 'critical' and v_mode = 'off' then v_mode := 'instant'; end if;   -- критичное отключить нельзя

  if v_mode = 'instant' then
    insert into public.email_outbox (tenant_id, user_id, to_email, kind, notification_id, send_after)
    values (new.tenant_id, new.user_id, v_email, 'instant', new.id,
            private.next_send_time(new.user_id, new.priority, now() + interval '3 minutes'))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function private.send_event_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  v_n    integer := 0;
  v_mins integer;
  v_code text;
begin
  -- совещания: участники и ведущий, до начала не больше 10 минут
  for r in
    select m.id, m.tenant_id, m.project_id, m.key, m.title, m.scheduled_at, m.place, pu.user_id, p.code as project_code
      from public.meetings m
      join public.projects p on p.id = m.project_id
      join (select meeting_id, user_id from public.meeting_participants
            union select id, facilitator_id from public.meetings where facilitator_id is not null) pu(meeting_id, user_id) on pu.meeting_id = m.id
     where m.status = 'scheduled' and m.scheduled_at > now() and m.scheduled_at <= now() + interval '10 minutes'
       and not exists (select 1 from public.event_reminders_sent s
                        where s.kind = 'meeting' and s.entity_id = m.id and s.user_id = pu.user_id and s.starts_at = m.scheduled_at)
  loop
    insert into public.event_reminders_sent (kind, entity_id, user_id, starts_at) values ('meeting', r.id, r.user_id, r.scheduled_at) on conflict do nothing;
    if not exists (select 1 from public.users u where u.id = r.user_id and u.status <> 'blocked')
       or not private.user_can_view_entity(r.user_id, 'meeting', r.id)
       or private.channel_mode(r.user_id, 'system', 'in_app') = 'off' then
      continue;
    end if;
    v_mins := greatest(ceil(extract(epoch from (r.scheduled_at - now())) / 60)::integer, 1);
    insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, priority, category, title, body, group_key, payload)
    values (r.tenant_id, r.user_id, r.project_id, 'meeting.reminder', 'meeting', r.id, 'high', 'system',
            format('Через %s мин: %s', v_mins, r.title),
            concat_ws(' · ', r.key, to_char(r.scheduled_at at time zone coalesce((select u.timezone from public.users u where u.id = r.user_id), 'UTC'), 'HH24:MI'), nullif(r.place, '')),
            'reminder:meeting:' || r.id || ':' || extract(epoch from r.scheduled_at)::bigint,
            jsonb_build_object('entity_key', r.key, 'entity_title', r.title, 'project_code', r.project_code, 'starts_at', r.scheduled_at));
    v_n := v_n + 1;
  end loop;

  -- личные события со временем: время «как на часах» владельца
  for r in
    select i.id, i.tenant_id, i.user_id, i.title, i.place, i.event_date,
           ((i.event_date + i.start_time) at time zone u.timezone) as starts_at, i.start_time
      from public.personal_items i
      join public.users u on u.id = i.user_id and u.status <> 'blocked'
     where i.kind = 'event' and i.start_time is not null
       and i.event_date between current_date - 1 and current_date + 1
       and ((i.event_date + i.start_time) at time zone u.timezone) > now()
       and ((i.event_date + i.start_time) at time zone u.timezone) <= now() + interval '10 minutes'
       and not exists (select 1 from public.event_reminders_sent s
                        where s.kind = 'personal' and s.entity_id = i.id and s.user_id = i.user_id
                          and s.starts_at = ((i.event_date + i.start_time) at time zone u.timezone))
  loop
    insert into public.event_reminders_sent (kind, entity_id, user_id, starts_at) values ('personal', r.id, r.user_id, r.starts_at) on conflict do nothing;
    if private.channel_mode(r.user_id, 'system', 'in_app') = 'off' then continue; end if;
    v_mins := greatest(ceil(extract(epoch from (r.starts_at - now())) / 60)::integer, 1);
    insert into public.notifications (tenant_id, user_id, event_type, priority, category, title, body, group_key, payload)
    values (r.tenant_id, r.user_id, 'personal.reminder', 'high', 'system',
            format('Через %s мин: %s', v_mins, r.title),
            concat_ws(' · ', to_char(r.start_time, 'HH24:MI'), nullif(r.place, '')),
            'reminder:personal:' || r.id || ':' || extract(epoch from r.starts_at)::bigint,
            jsonb_build_object('entity_title', r.title, 'link', '/personal?tab=calendar&item=' || r.id || '&d=' || r.event_date, 'starts_at', r.starts_at));
    v_n := v_n + 1;
  end loop;

  delete from public.event_reminders_sent where starts_at < now() - interval '3 days';
  return v_n;
end;
$$;

do $$
begin
  perform cron.schedule('buildos-reminders', '* * * * *', 'select private.send_event_reminders()');
exception when others then
  raise notice 'pg_cron недоступен, расписание напоминаний не создано: %', sqlerrm;
end $$;

grant execute on function private.send_event_reminders() to authenticated, supabase_auth_admin;
