-- Управление персоналом (уровень компании, не проекта): оргструктура (отделы), карточки сотрудников с руководителем,
-- матрица навыков, опыт работы, оценки эффективности с напоминаниями и личные заметки руководителей.
--
-- Видимость:
--   * отделы, карточки, навыки, опыт — все сотрудники компании (не внешние участники);
--   * оценка — сам сотрудник, его руководители по цепочке и право staff.manage; часть руководителя (текст, балл, цели)
--     сотрудник видит только после «Поделиться»;
--   * заметки руководителя — автор, руководители сотрудника по цепочке и право staff.notes.view.
--     САМ СОТРУДНИК СВОИ ЗАМЕТКИ НЕ ВИДИТ НИКОГДА — даже администратором и с правом staff.notes.view.

-- ---------------------------------------------------------------------------
-- Права
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, sort, label, tenant_only, external_ok) values
  ('staff.manage', 'Персонал', 301, 'Управлять персоналом: оргструктура, карточки, навыки, оценки', true, false),
  ('staff.notes.view', 'Персонал', 302, 'Видеть заметки руководителей обо всех сотрудниках (кроме заметок о себе)', true, false)
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, p.code
  from public.roles r cross join (values ('staff.manage'), ('staff.notes.view')) p(code)
 where r.scope = 'tenant' and r.is_system and r.deleted_at is null and r.code in ('tenant_admin', 'director')
on conflict do nothing;

create or replace function private.roles_staff_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'tenant' and new.is_system and new.code in ('tenant_admin', 'director') then
    insert into public.role_permissions (tenant_id, role_id, permission)
    values (new.tenant_id, new.id, 'staff.manage'), (new.tenant_id, new.id, 'staff.notes.view')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger roles_staff_defaults after insert on public.roles for each row execute function private.roles_staff_defaults();

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------
create table public.staff_departments (
  id           uuid primary key default uuidv7(),
  tenant_id    uuid not null default private.tenant_id() references public.tenants (id),
  parent_id    uuid references public.staff_departments (id) on delete set null,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  head_user_id uuid references public.users (id) on delete set null,
  position     double precision not null default 65536,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index on public.staff_departments (tenant_id, parent_id);

-- Карточка сотрудника: одна на пользователя. Должность — users.job_title (уже есть в справочнике людей).
create table public.staff_profiles (
  user_id               uuid primary key references public.users (id) on delete cascade,
  tenant_id             uuid not null default private.tenant_id() references public.tenants (id),
  department_id         uuid references public.staff_departments (id) on delete set null,
  manager_id            uuid references public.users (id) on delete set null,
  hire_date             date,
  employment_type       text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract', 'intern')),
  experience_before_months integer check (experience_before_months between 0 and 1200),
  review_interval_months integer not null default 12 check (review_interval_months in (3, 6, 12)),
  next_review_on        date,
  review_reminded_for   date,          -- для какого срока уже напомнили руководителю
  updated_at            timestamptz not null default now(),
  updated_by            uuid default auth.uid(),
  check (manager_id is null or manager_id <> user_id)
);
create index on public.staff_profiles (tenant_id, manager_id);
create index on public.staff_profiles (tenant_id, department_id);

create table public.staff_skills (
  id         uuid primary key default uuidv7(),
  tenant_id  uuid not null default private.tenant_id() references public.tenants (id),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  category   text not null default '' check (char_length(category) <= 60),
  created_at timestamptz not null default now()
);
create unique index staff_skills_name_key on public.staff_skills (tenant_id, lower(btrim(name)));

-- Уровень навыка: 1 — начальный … 5 — эксперт, может учить других
create table public.staff_skill_levels (
  tenant_id  uuid not null default private.tenant_id() references public.tenants (id),
  user_id    uuid not null references public.users (id) on delete cascade,
  skill_id   uuid not null references public.staff_skills (id) on delete cascade,
  level      smallint not null check (level between 1 and 5),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (user_id, skill_id)
);
create index on public.staff_skill_levels (tenant_id, skill_id);

-- Опыт работы: прошлые места и роли (стаж до компании считается из карточки, в компании — от даты найма)
create table public.staff_experience (
  id         uuid primary key default uuidv7(),
  tenant_id  uuid not null default private.tenant_id() references public.tenants (id),
  user_id    uuid not null references public.users (id) on delete cascade,
  company    text not null check (char_length(btrim(company)) between 1 and 160),
  role       text not null default '' check (char_length(role) <= 160),
  started_on date,
  ended_on   date,
  note       text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);
create index on public.staff_experience (user_id);

-- Оценка эффективности: self → manager → done. Часть руководителя — в staff_review_assessments.
create table public.staff_reviews (
  id                uuid primary key default uuidv7(),
  tenant_id         uuid not null default private.tenant_id() references public.tenants (id),
  user_id           uuid not null references public.users (id) on delete cascade,
  reviewer_id       uuid references public.users (id) on delete set null,
  period            text not null check (char_length(btrim(period)) between 1 and 60),
  due_on            date not null,
  status            text not null default 'self' check (status in ('self', 'manager', 'done')),
  self_text         text not null default '' check (char_length(self_text) <= 8000),
  self_submitted_at timestamptz,
  shared_at         timestamptz,
  reminded_stage    text,            -- на каком этапе уже напомнили о сроке
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.staff_reviews (tenant_id, user_id, created_at desc);

create table public.staff_review_assessments (
  review_id    uuid primary key references public.staff_reviews (id) on delete cascade,
  tenant_id    uuid not null references public.tenants (id),
  manager_text text not null default '' check (char_length(manager_text) <= 8000),
  rating       smallint check (rating between 1 and 5),
  goals        text not null default '' check (char_length(goals) <= 4000),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);

-- Заметки руководителя о сотруднике (достижения, бонус, повышение, замечания). Сотрудник их не видит.
create table public.staff_notes (
  id          uuid primary key default uuidv7(),
  tenant_id   uuid not null default private.tenant_id() references public.tenants (id),
  user_id     uuid not null references public.users (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.users (id),
  kind        text not null default 'note' check (kind in ('note', 'achievement', 'bonus', 'raise', 'concern')),
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  remind_on   date,
  reminded_at timestamptz,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (user_id <> author_id)
);
create index on public.staff_notes (tenant_id, user_id, created_at desc);
create index on public.staff_notes (remind_on) where remind_on is not null and reminded_at is null and done_at is null;

-- ---------------------------------------------------------------------------
-- Помощники
-- ---------------------------------------------------------------------------
-- Сотрудник компании (не внешний участник) — тот, кто видит раздел «Персонал»
create or replace function private.staff_insider() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = private.tenant_id()
                  and not u.is_external and u.deleted_at is null)
$$;

-- Является ли p_manager руководителем p_user по цепочке (прямой, руководитель руководителя и т. д.)
create or replace function private.staff_is_manager_of(p_manager uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive up (id, depth) as (
    select manager_id, 1 from public.staff_profiles where user_id = p_user and manager_id is not null
    union all
    select sp.manager_id, up.depth + 1 from up join public.staff_profiles sp on sp.user_id = up.id
     where sp.manager_id is not null and up.depth < 30
  )
  select p_manager is not null and p_user is not null and p_manager <> p_user and exists (select 1 from up where id = p_manager)
$$;

-- Может ли текущий пользователь вести оценки и навыки сотрудника: руководитель по цепочке или staff.manage
create or replace function private.staff_can_lead(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.staff_insider() and (private.has_tenant_permission('staff.manage') or private.staff_is_manager_of(auth.uid(), p_user))
$$;

-- Видит ли текущий пользователь заметки о сотруднике. О себе — никогда.
create or replace function private.staff_can_see_notes(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user <> auth.uid() and private.staff_insider()
     and (private.has_tenant_permission('staff.notes.view') or private.staff_is_manager_of(auth.uid(), p_user))
$$;

-- Пользователь из этой компании и не внешний
create or replace function private.staff_same_tenant_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.id = p_user and u.tenant_id = private.tenant_id() and not u.is_external)
$$;

-- Без петель: нельзя назначить руководителем своего подчинённого
create or replace function private.staff_profiles_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_id is not null and (new.manager_id = new.user_id or private.staff_is_manager_of(new.user_id, new.manager_id)) then
    raise exception 'manager_cycle' using errcode = '22023';
  end if;
  if new.manager_id is not null and not exists (select 1 from public.users u where u.id = new.manager_id and u.tenant_id = new.tenant_id and not u.is_external) then
    raise exception 'manager_not_staff' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.review_interval_months is distinct from old.review_interval_months then
    new.review_reminded_for := null;
  end if;
  if tg_op = 'UPDATE' and new.next_review_on is distinct from old.next_review_on then
    new.review_reminded_for := null;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger staff_profiles_check before insert or update on public.staff_profiles
  for each row execute function private.staff_profiles_check();

create or replace function private.staff_departments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null and tg_op = 'UPDATE' then
    if exists (
      with recursive up (id, depth) as (
        select new.parent_id, 1
        union all
        select d.parent_id, up.depth + 1 from up join public.staff_departments d on d.id = up.id where d.parent_id is not null and up.depth < 30
      ) select 1 from up where id = new.id
    ) then
      raise exception 'department_cycle' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger staff_departments_check before insert or update on public.staff_departments
  for each row execute function private.staff_departments_check();

create or replace function private.staff_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch before update on public.staff_notes for each row execute function private.staff_touch();
create trigger touch before update on public.staff_reviews for each row execute function private.staff_touch();
create trigger touch before update on public.staff_review_assessments for each row execute function private.staff_touch();

-- Автор заметки не меняется, сотрудник тоже
create or replace function private.staff_notes_keep() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id or new.author_id <> old.author_id then
    raise exception 'note_owner_fixed' using errcode = '22023';
  end if;
  if new.remind_on is distinct from old.remind_on then new.reminded_at := null; end if;
  return new;
end;
$$;
create trigger staff_notes_keep before update on public.staff_notes for each row execute function private.staff_notes_keep();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.staff_departments enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_skills enable row level security;
alter table public.staff_skill_levels enable row level security;
alter table public.staff_experience enable row level security;
alter table public.staff_reviews enable row level security;
alter table public.staff_review_assessments enable row level security;
alter table public.staff_notes enable row level security;

-- отделы и каталог навыков: читают все сотрудники, правит staff.manage
create policy staff_departments_select on public.staff_departments for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider()));
create policy staff_departments_write on public.staff_departments for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage'))
              and (head_user_id is null or private.staff_same_tenant_user(head_user_id)));

create policy staff_skills_select on public.staff_skills for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider()));
create policy staff_skills_write on public.staff_skills for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage')));

-- карточки: читают все сотрудники, правит staff.manage
create policy staff_profiles_select on public.staff_profiles for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider()));
create policy staff_profiles_write on public.staff_profiles for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage'))
              and private.staff_same_tenant_user(user_id));

-- навыки: читают все сотрудники; правят сам сотрудник, его руководители и staff.manage
create policy staff_skill_levels_select on public.staff_skill_levels for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider()));
create policy staff_skill_levels_write on public.staff_skill_levels for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (user_id = (select auth.uid()) and (select private.staff_insider()) or private.staff_can_lead(user_id)))
  with check (tenant_id = (select private.tenant_id()) and private.staff_same_tenant_user(user_id)
              and (user_id = (select auth.uid()) or private.staff_can_lead(user_id)));

-- опыт: читают все сотрудники; правят сам сотрудник и staff.manage
create policy staff_experience_select on public.staff_experience for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider()));
create policy staff_experience_write on public.staff_experience for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider())
         and (user_id = (select auth.uid()) or (select private.has_tenant_permission('staff.manage'))))
  with check (tenant_id = (select private.tenant_id()) and private.staff_same_tenant_user(user_id)
              and (user_id = (select auth.uid()) or (select private.has_tenant_permission('staff.manage'))));

-- оценки: сам сотрудник, руководители по цепочке, staff.manage. Пишут только функции ниже.
create policy staff_reviews_select on public.staff_reviews for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider())
         and (user_id = (select auth.uid()) or reviewer_id = (select auth.uid()) or private.staff_can_lead(user_id)));
revoke insert, update, delete on public.staff_reviews from authenticated;

-- часть руководителя: сотрудник — только после «Поделиться»
create policy staff_review_assessments_select on public.staff_review_assessments for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (
    select 1 from public.staff_reviews r
     where r.id = review_id
       and ((r.user_id = (select auth.uid()) and r.status = 'done')
            or (r.user_id <> (select auth.uid()) and (r.reviewer_id = (select auth.uid()) or private.staff_can_lead(r.user_id))))));
revoke insert, update, delete on public.staff_review_assessments from authenticated;

-- заметки руководителя: сам сотрудник не видит и не пишет
create policy staff_notes_select on public.staff_notes for select to authenticated
  using (tenant_id = (select private.tenant_id()) and user_id <> (select auth.uid())
         and (author_id = (select auth.uid()) or private.staff_can_see_notes(user_id)));
create policy staff_notes_insert on public.staff_notes for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and author_id = (select auth.uid()) and user_id <> (select auth.uid())
              and private.staff_same_tenant_user(user_id) and private.staff_can_see_notes(user_id));
create policy staff_notes_update on public.staff_notes for update to authenticated
  using (tenant_id = (select private.tenant_id()) and user_id <> (select auth.uid())
         and (author_id = (select auth.uid()) or (select private.has_tenant_permission('staff.notes.view')) and private.staff_can_see_notes(user_id)))
  with check (tenant_id = (select private.tenant_id()) and user_id <> (select auth.uid()));
create policy staff_notes_delete on public.staff_notes for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and user_id <> (select auth.uid()) and author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Уведомления (раздел компании, без проекта — пишем в notifications напрямую, как почта)
-- ---------------------------------------------------------------------------
create or replace function private.staff_notify(p_user uuid, p_event text, p_title text, p_body text, p_link text, p_group text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  select tenant_id into v_tenant from public.users where id = p_user and status <> 'blocked' and not is_external and deleted_at is null;
  if v_tenant is null then return; end if;
  if private.channel_mode(p_user, 'assigned', 'in_app') = 'off' then return; end if;
  insert into public.notifications (tenant_id, user_id, event_type, priority, category, title, body, group_key, actor_id, payload)
  values (v_tenant, p_user, p_event, 'normal', 'assigned', p_title, left(p_body, 300), p_group, auth.uid(),
          jsonb_build_object('link', p_link, 'last_text', left(p_body, 300)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Оценки: шаги
-- ---------------------------------------------------------------------------
create or replace function public.staff_review_start(p_user uuid, p_period text, p_due date, p_reviewer uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_reviewer uuid;
  v_name text;
begin
  if not private.staff_same_tenant_user(p_user) or not private.staff_can_lead(p_user) then
    raise exception 'permission denied: staff review' using errcode = '42501';
  end if;
  if p_due is null or nullif(btrim(coalesce(p_period, '')), '') is null then raise exception 'bad_review' using errcode = '22023'; end if;
  if exists (select 1 from public.staff_reviews where user_id = p_user and status <> 'done') then
    raise exception 'review_open' using errcode = '22023';
  end if;
  v_reviewer := coalesce(p_reviewer, (select manager_id from public.staff_profiles where user_id = p_user), auth.uid());
  if v_reviewer = p_user or not private.staff_same_tenant_user(v_reviewer) then raise exception 'bad_reviewer' using errcode = '22023'; end if;

  insert into public.staff_reviews (user_id, reviewer_id, period, due_on)
  values (p_user, v_reviewer, btrim(p_period), p_due) returning id into v_id;
  insert into public.staff_review_assessments (review_id, tenant_id) values (v_id, private.tenant_id());

  select full_name into v_name from public.users where id = v_reviewer;
  perform private.staff_notify(p_user, 'staff.review_started', 'Оценка эффективности',
    format('Начата оценка «%s». Заполните самооценку до %s', btrim(p_period), to_char(p_due, 'DD.MM.YYYY')),
    '/staff/' || p_user || '?tab=reviews', 'staff_review:' || v_id);
  return v_id;
end;
$$;

-- Самооценка: пишет только сам сотрудник, пока оценка на шаге self; p_submit — отдать руководителю
create or replace function public.staff_review_self(p_review uuid, p_text text, p_submit boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.staff_reviews;
begin
  select * into r from public.staff_reviews where id = p_review and tenant_id = private.tenant_id();
  if r.id is null or r.user_id <> auth.uid() then raise exception 'permission denied: self review' using errcode = '42501'; end if;
  if r.status <> 'self' then raise exception 'review_not_self' using errcode = '22023'; end if;
  update public.staff_reviews
     set self_text = coalesce(p_text, ''),
         status = case when p_submit then 'manager' else status end,
         self_submitted_at = case when p_submit then now() else self_submitted_at end
   where id = p_review;
  if p_submit then
    perform private.staff_notify(r.reviewer_id, 'staff.review_self_done', 'Самооценка готова',
      format('%s заполнил(а) самооценку «%s» — ваша очередь', (select full_name from public.users where id = r.user_id), r.period),
      '/staff/' || r.user_id || '?tab=reviews', 'staff_review:' || r.id);
  end if;
end;
$$;

-- Часть руководителя: руководитель по цепочке, назначенный оценщик или staff.manage; сам о себе — нельзя
create or replace function public.staff_review_assess(p_review uuid, p_text text, p_rating smallint, p_goals text, p_share boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.staff_reviews;
  v_interval integer;
begin
  select * into r from public.staff_reviews where id = p_review and tenant_id = private.tenant_id();
  if r.id is null or r.user_id = auth.uid() or not (r.reviewer_id = auth.uid() or private.staff_can_lead(r.user_id)) then
    raise exception 'permission denied: assess review' using errcode = '42501';
  end if;
  if r.status = 'done' then raise exception 'review_done' using errcode = '22023'; end if;
  if p_rating is not null and p_rating not between 1 and 5 then raise exception 'bad_rating' using errcode = '22023'; end if;
  update public.staff_review_assessments
     set manager_text = coalesce(p_text, ''), rating = p_rating, goals = coalesce(p_goals, ''), updated_by = auth.uid()
   where review_id = p_review;

  if p_share then
    if p_rating is null then raise exception 'rating_required' using errcode = '22023'; end if;
    update public.staff_reviews set status = 'done', shared_at = now() where id = p_review;
    -- следующая оценка — через интервал из карточки (по умолчанию год) от срока этой
    select review_interval_months into v_interval from public.staff_profiles where user_id = r.user_id;
    insert into public.staff_profiles (user_id, tenant_id, next_review_on)
    values (r.user_id, r.tenant_id, (r.due_on + make_interval(months => coalesce(v_interval, 12)))::date)
    on conflict (user_id) do update set next_review_on = excluded.next_review_on;
    perform private.staff_notify(r.user_id, 'staff.review_shared', 'Итоги оценки',
      format('Руководитель поделился итогами оценки «%s»', r.period),
      '/staff/' || r.user_id || '?tab=reviews', 'staff_review:' || r.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Напоминания (раз в день): срок оценки, этап оценки, заметки с датой (например, бонус в конце года)
-- ---------------------------------------------------------------------------
create or replace function private.staff_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
  v_today date := current_date;
  v_kind text;
begin
  -- 1. Пора начать оценку: за 14 дней до next_review_on руководителю (нет руководителя — никому), один раз на срок
  for r in
    select sp.user_id, sp.manager_id, sp.next_review_on, u.full_name
      from public.staff_profiles sp join public.users u on u.id = sp.user_id and u.deleted_at is null and u.status <> 'blocked'
     where sp.next_review_on is not null and sp.next_review_on <= v_today + 14 and sp.manager_id is not null
       and sp.review_reminded_for is distinct from sp.next_review_on
       and not exists (select 1 from public.staff_reviews rv where rv.user_id = sp.user_id and rv.status <> 'done')
  loop
    perform private.staff_notify(r.manager_id, 'staff.review_due', 'Пора провести оценку',
      format('%s: оценка эффективности — до %s', r.full_name, to_char(r.next_review_on, 'DD.MM.YYYY')),
      '/staff/' || r.user_id || '?tab=reviews', 'staff_review_due:' || r.user_id);
    update public.staff_profiles set review_reminded_for = next_review_on where user_id = r.user_id;
    v_n := v_n + 1;
  end loop;

  -- 2. Открытая оценка: за 3 дня до срока (и в день просрочки) тому, чей сейчас шаг, один раз на шаг
  for r in
    select rv.*, u.full_name from public.staff_reviews rv join public.users u on u.id = rv.user_id
     where rv.status in ('self', 'manager') and rv.due_on <= v_today + 3
       and rv.reminded_stage is distinct from rv.status || case when rv.due_on < v_today then ':late' else '' end
  loop
    v_kind := r.status || case when r.due_on < v_today then ':late' else '' end;
    if r.status = 'self' then
      perform private.staff_notify(r.user_id, 'staff.review_reminder_self', 'Самооценка ждёт',
        format('Оценка «%s»: заполните самооценку до %s', r.period, to_char(r.due_on, 'DD.MM.YYYY')),
        '/staff/' || r.user_id || '?tab=reviews', 'staff_review:' || r.id);
    else
      perform private.staff_notify(r.reviewer_id, 'staff.review_reminder_manager', 'Оценка ждёт вас',
        format('%s, оценка «%s»: срок %s', r.full_name, r.period, to_char(r.due_on, 'DD.MM.YYYY')),
        '/staff/' || r.user_id || '?tab=reviews', 'staff_review:' || r.id);
    end if;
    update public.staff_reviews set reminded_stage = v_kind where id = r.id;
    v_n := v_n + 1;
  end loop;

  -- 3. Заметка с датой напоминания — только автору (сотруднику — никогда)
  for r in
    select n.*, u.full_name from public.staff_notes n join public.users u on u.id = n.user_id
     where n.remind_on is not null and n.remind_on <= v_today and n.reminded_at is null and n.done_at is null
  loop
    perform private.staff_notify(r.author_id, 'staff.note_due',
      case r.kind when 'bonus' then 'Напоминание: бонус' when 'raise' then 'Напоминание: повышение' else 'Напоминание о сотруднике' end,
      r.full_name || ': ' || r.body, '/staff/' || r.user_id || '?tab=notes', 'staff_note:' || r.id);
    update public.staff_notes set reminded_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function private.staff_reminders() from public, anon, authenticated;

select cron.schedule('buildos-staff-reminders', '15 6 * * *', $$select private.staff_reminders()$$);
