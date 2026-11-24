-- Дни рождения сотрудников.
--
-- Дата хранится отдельно от users: users видят все в компании, а год рождения — личное. Строку целиком (с годом) видят
-- только сам человек и тот, у кого есть staff.manage (кадровик заполняет даты за сотрудников). Остальные сотрудники
-- получают дни рождения через public.birthdays(): день и месяц всегда, возраст — только если человек разрешил
-- показывать год. Внешние участники (подрядчики, заказчик) чужих дней рождения не видят и не получают уведомлений.
--
-- Уведомления (новая категория `birthday`: колокольчик и push, без писем; выключается в настройках уведомлений):
--   * накануне — руководителю: «Завтра день рождения у …»;
--   * в сам день — коллегам: руководитель, подчинённые, отдел и те, с кем человек в одном действующем проекте;
--   * в сам день — самому человеку: «С днём рождения!».
-- Время — 9 утра по часовому поясу именинника (cron раз в час), повторно за ту же дату не шлём.

-- ---------------------------------------------------------------------------
-- 1. Категория уведомлений «Дни рождения»
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('assigned','mentioned','watching','escalation','digest','system','mail','birthday'));
alter table public.notification_preferences drop constraint notification_preferences_category_check;
alter table public.notification_preferences add constraint notification_preferences_category_check
  check (category in ('assigned','mentioned','watching','escalation','digest','system','mail','birthday'));

-- Письмо о дне рождения не нужно: как и почта Outlook — только колокольчик и push
create or replace function private.notifications_enqueue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_mode  text;
begin
  if new.event_type like '%.reminder' then return new; end if;
  if new.category in ('mail', 'birthday') then return new; end if;
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

-- ---------------------------------------------------------------------------
-- 2. Таблица
-- ---------------------------------------------------------------------------
create table public.user_birthdays (
  user_id      uuid primary key references public.users (id) on delete cascade,
  tenant_id    uuid not null default private.tenant_id() references public.tenants (id),
  birth_date   date not null check (birth_date >= date '1900-01-01'),
  show_year    boolean not null default false,  -- показывать коллегам год (возраст)
  announced_for date,                           -- за какой день рождения уже поздравили
  reminded_for  date,                           -- за какой день рождения уже напомнили руководителю накануне
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
create index user_birthdays_tenant on public.user_birthdays (tenant_id);

alter table public.user_birthdays enable row level security;
grant select on public.user_birthdays to authenticated;
-- Пишет только public.set_birthday(); читают строку целиком сам человек и staff.manage
create policy user_birthdays_select on public.user_birthdays for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and (user_id = (select auth.uid()) or ((select private.staff_insider()) and (select private.has_tenant_permission('staff.manage')))));

-- ---------------------------------------------------------------------------
-- 3. Помощники: день рождения в заданном году (29 февраля в невисокосный — 28-е) и ближайший начиная с даты
-- ---------------------------------------------------------------------------
create or replace function private.birthday_in_year(p_birth date, p_year integer) returns date
language sql immutable set search_path = '' as $$
  select case
    when extract(month from p_birth) = 2 and extract(day from p_birth) = 29
         and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0))
      then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from p_birth)::int, extract(day from p_birth)::int)
  end
$$;

create or replace function private.birthday_next(p_birth date, p_from date) returns date
language sql immutable set search_path = '' as $$
  select case
    when private.birthday_in_year(p_birth, extract(year from p_from)::int) >= p_from
      then private.birthday_in_year(p_birth, extract(year from p_from)::int)
    else private.birthday_in_year(p_birth, extract(year from p_from)::int + 1)
  end
$$;

-- Сегодняшняя дата по часовому поясу пользователя
create or replace function private.user_local_now(p_user uuid) returns timestamp
language sql stable security definer set search_path = '' as $$
  select now() at time zone coalesce((select nullif(timezone, '') from public.users where id = p_user), 'UTC')
$$;

-- ---------------------------------------------------------------------------
-- 4. Записать или убрать дату. Свою — сам; за сотрудника компании — staff.manage.
-- ---------------------------------------------------------------------------
create or replace function public.set_birthday(p_user uuid, p_date date, p_show_year boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  if p_user is null then raise exception 'bad_birthday' using errcode = '22023'; end if;
  if p_user <> auth.uid()
     and not (private.staff_insider() and private.has_tenant_permission('staff.manage') and private.staff_same_tenant_user(p_user)) then
    raise exception 'permission denied: birthday' using errcode = '42501';
  end if;
  select tenant_id into v_tenant from public.users where id = p_user and deleted_at is null;
  if v_tenant is null or v_tenant <> private.tenant_id() then raise exception 'permission denied: birthday' using errcode = '42501'; end if;

  if p_date is null then
    delete from public.user_birthdays where user_id = p_user;
    return;
  end if;
  if p_date < date '1900-01-01' or p_date > current_date then raise exception 'bad_birthday' using errcode = '22023'; end if;

  insert into public.user_birthdays (user_id, tenant_id, birth_date, show_year)
  values (p_user, v_tenant, p_date, coalesce(p_show_year, false))
  on conflict (user_id) do update
    set birth_date = excluded.birth_date,
        show_year = excluded.show_year,
        -- сменили день — поздравления за новый день ещё не было
        announced_for = case when user_birthdays.birth_date is distinct from excluded.birth_date then null else user_birthdays.announced_for end,
        reminded_for  = case when user_birthdays.birth_date is distinct from excluded.birth_date then null else user_birthdays.reminded_for end,
        updated_at = now(),
        updated_by = auth.uid();
end;
$$;
revoke execute on function public.set_birthday(uuid, date, boolean) from public, anon;
grant execute on function public.set_birthday(uuid, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Дни рождения сотрудников компании для календаря, «Сегодня» и раздела «Персонал».
--    Ближайшая дата считается от сегодняшнего дня по часовому поясу того, кто смотрит. Возраст — только с разрешения.
-- ---------------------------------------------------------------------------
create or replace function public.birthdays()
returns table (user_id uuid, full_name text, job_title text, avatar_path text, birth_month integer, birth_day integer,
               next_date date, turns integer)
language sql stable security definer set search_path = '' as $$
  with today as (select private.user_local_now(auth.uid())::date as d)
  select u.id, u.full_name, u.job_title, u.avatar_path,
         extract(month from b.birth_date)::int, extract(day from b.birth_date)::int,
         private.birthday_next(b.birth_date, t.d),
         case when b.show_year or b.user_id = auth.uid()
              then extract(year from private.birthday_next(b.birth_date, t.d))::int - extract(year from b.birth_date)::int end
    from public.user_birthdays b
    join public.users u on u.id = b.user_id
    cross join today t
   where private.staff_insider()
     and b.tenant_id = private.tenant_id()
     and u.tenant_id = b.tenant_id and not u.is_external and u.deleted_at is null and u.status <> 'blocked'
   order by 7, u.full_name
$$;
revoke execute on function public.birthdays() from public, anon;
grant execute on function public.birthdays() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Уведомления
-- ---------------------------------------------------------------------------
create or replace function private.birthday_notify_one(p_user uuid, p_event text, p_title text, p_body text, p_link text, p_group text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.users where id = p_user and status <> 'blocked' and not is_external and deleted_at is null;
  if v_tenant is null then return false; end if;
  if private.channel_mode(p_user, 'birthday', 'in_app') = 'off' then return false; end if;
  insert into public.notifications (tenant_id, user_id, event_type, priority, category, title, body, group_key, payload)
  values (v_tenant, p_user, p_event, 'low', 'birthday', p_title, left(p_body, 300), p_group,
          jsonb_build_object('link', p_link, 'last_text', left(p_body, 300)));
  return true;
end;
$$;

-- Коллеги именинника: руководитель, подчинённые, отдел, участники тех же действующих проектов (без него самого)
create or replace function private.birthday_colleagues(p_user uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct c.id
    from (
      select manager_id as id from public.staff_profiles where user_id = p_user
      union select user_id from public.staff_profiles where manager_id = p_user
      union select o.user_id from public.staff_profiles me join public.staff_profiles o on o.department_id = me.department_id
             where me.user_id = p_user and me.department_id is not null
      union select o.user_id
              from public.project_members me
              join public.project_members o on o.project_id = me.project_id and o.deleted_at is null
              join public.projects p on p.id = me.project_id and p.deleted_at is null
                                    and p.status not in ('completed', 'cancelled', 'archived')
             where me.user_id = p_user and me.deleted_at is null
    ) c
    join public.users u on u.id = c.id
    join public.users me on me.id = p_user
   where c.id is not null and c.id <> p_user
     and u.tenant_id = me.tenant_id and not u.is_external and u.deleted_at is null and u.status <> 'blocked'
$$;

-- Раз в час: кому сейчас 9 утра или позже в день рождения (или накануне) — поздравляем / напоминаем. Возвращает число уведомлений.
create or replace function private.birthday_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c uuid;
  v_n integer := 0;
begin
  for r in
    select b.user_id, b.birth_date, b.announced_for, b.reminded_for, u.full_name, sp.manager_id,
           l.ts::date as local_day, extract(hour from l.ts)::int as local_hour
      from public.user_birthdays b
      join public.users u on u.id = b.user_id and not u.is_external and u.deleted_at is null and u.status <> 'blocked'
      left join public.staff_profiles sp on sp.user_id = b.user_id
      cross join lateral (select private.user_local_now(b.user_id) as ts) l
  loop
    continue when r.local_hour < 9;

    -- в сам день: коллегам и самому имениннику
    if private.birthday_in_year(r.birth_date, extract(year from r.local_day)::int) = r.local_day
       and r.announced_for is distinct from r.local_day then
      for c in select private.birthday_colleagues(r.user_id) loop
        if private.birthday_notify_one(c, 'birthday.today', 'День рождения',
             format('Сегодня день рождения у %s', r.full_name), '/staff/' || r.user_id,
             'birthday:' || r.user_id || ':' || r.local_day) then
          v_n := v_n + 1;
        end if;
      end loop;
      if private.birthday_notify_one(r.user_id, 'birthday.greeting', 'С днём рождения!',
           'Команда поздравляет вас с днём рождения', '/today', 'birthday:' || r.user_id || ':' || r.local_day) then
        v_n := v_n + 1;
      end if;
      update public.user_birthdays set announced_for = r.local_day where user_id = r.user_id;
    end if;

    -- накануне: руководителю
    if r.manager_id is not null
       and private.birthday_in_year(r.birth_date, extract(year from r.local_day + 1)::int) = r.local_day + 1
       and r.reminded_for is distinct from r.local_day + 1 then
      if private.birthday_notify_one(r.manager_id, 'birthday.tomorrow', 'Завтра день рождения',
           format('Завтра день рождения у %s', r.full_name), '/staff/' || r.user_id,
           'birthday_tomorrow:' || r.user_id || ':' || (r.local_day + 1)) then
        v_n := v_n + 1;
      end if;
      update public.user_birthdays set reminded_for = r.local_day + 1 where user_id = r.user_id;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function private.birthday_reminders() from public, anon, authenticated;

select cron.schedule('buildos-birthdays', '5 * * * *', $$select private.birthday_reminders()$$);
