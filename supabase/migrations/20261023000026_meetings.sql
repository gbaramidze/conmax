-- Совещания (лёгкая версия): повестка, участники и присутствие, решения, поручения (задачи типа action_item),
-- протокол с публикацией. См. docs: 04-modules/07-meetings.md (раздел «Лёгкая версия»).
-- Внешние видят только внешние совещания, на которые приглашены; решения — после публикации протокола.

insert into public.entity_types (code, module, features) values ('meeting', 'meetings', array['comments','activity']);

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------
create table public.meetings (
  id             uuid primary key default public.uuidv7(),
  tenant_id      uuid not null references public.tenants(id),
  project_id     uuid not null references public.projects(id) on delete cascade,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users(id),
  updated_at     timestamptz not null default now(),
  number         integer not null,
  key            text not null,
  type           text not null default 'operational'
                 check (type in ('operational','weekly','coordination','safety','client','acceptance','other')),
  title          text not null check (length(btrim(title)) between 1 and 200),
  scheduled_at   timestamptz not null,
  duration_min   integer not null default 60 check (duration_min between 5 and 720),
  place          text check (place is null or length(place) <= 200),
  visibility     text not null default 'internal' check (visibility in ('internal','external')),
  status         text not null default 'scheduled'
                 check (status in ('scheduled','in_progress','minutes_draft','published','cancelled')),
  facilitator_id uuid references public.users(id),
  summary        text check (summary is null or length(summary) <= 20000),
  started_at     timestamptz,
  finished_at    timestamptz,
  published_at   timestamptz,
  published_by   uuid references public.users(id),
  unique (project_id, number)
);
create index on public.meetings (tenant_id, project_id, scheduled_at desc);

create table public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  required   boolean not null default true,
  attendance text not null default 'invited' check (attendance in ('invited','present','absent','excused')),
  primary key (meeting_id, user_id)
);
create index on public.meeting_participants (user_id);

create table public.meeting_agenda_items (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  sort         integer not null default 0,
  title        text not null check (length(btrim(title)) between 1 and 300),
  presenter_id uuid references public.users(id),
  duration_min integer check (duration_min is null or duration_min between 1 and 480),
  notes        text check (notes is null or length(notes) <= 10000),
  task_id      uuid references public.tasks(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.meeting_agenda_items (meeting_id, sort);

create table public.meeting_decisions (
  id             uuid primary key default public.uuidv7(),
  tenant_id      uuid not null references public.tenants(id),
  project_id     uuid not null references public.projects(id) on delete cascade,
  meeting_id     uuid not null references public.meetings(id) on delete cascade,
  agenda_item_id uuid references public.meeting_agenda_items(id) on delete set null,
  number         integer not null,
  text           text not null check (length(btrim(text)) between 1 and 2000),
  created_by     uuid default auth.uid() references public.users(id),
  created_at     timestamptz not null default now(),
  unique (meeting_id, number)
);
create index on public.meeting_decisions (tenant_id, project_id, created_at desc);

-- Поручение — обычная задача типа action_item; источник совещания хранится в самой задаче
alter table public.tasks add column meeting_id uuid references public.meetings(id) on delete set null;
create index on public.tasks (meeting_id) where meeting_id is not null;

-- ---------------------------------------------------------------------------
-- Проверки доступа (от имени пользователя)
-- ---------------------------------------------------------------------------
create or replace function private.user_can_view_meeting(p_user uuid, p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting
       and private.user_can_see_project(p_user, m.project_id)
       and case
             when private.user_has_project_permission(p_user, m.project_id, 'comment.internal.view') then
               private.user_has_project_permission(p_user, m.project_id, 'meeting.view')
               or m.created_by = p_user or m.facilitator_id = p_user
               or exists (select 1 from public.meeting_participants mp where mp.meeting_id = m.id and mp.user_id = p_user)
             else
               m.visibility = 'external'
               and exists (select 1 from public.meeting_participants mp where mp.meeting_id = m.id and mp.user_id = p_user)
           end);
$$;

-- Менять повестку, состав и параметры: организатор, ведущий и роли с meeting.manage (только внутренние)
create or replace function private.user_can_manage_meeting(p_user uuid, p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting
       and private.user_has_project_permission(p_user, m.project_id, 'comment.internal.view')
       and private.user_can_view_meeting(p_user, m.id)
       and (m.created_by = p_user or m.facilitator_id = p_user
            or private.user_has_project_permission(p_user, m.project_id, 'meeting.manage')));
$$;

-- Вести совещание (присутствие, заметки, решения, поручения, протокол): ведущий или роль с meeting.conduct
create or replace function private.user_can_conduct_meeting(p_user uuid, p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting
       and private.user_has_project_permission(p_user, m.project_id, 'comment.internal.view')
       and private.user_can_view_meeting(p_user, m.id)
       and (m.facilitator_id = p_user or private.user_has_project_permission(p_user, m.project_id, 'meeting.conduct')));
$$;

-- Внешним решения и заметки показываем только в опубликованном протоколе
create or replace function private.user_can_view_minutes(p_user uuid, p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting and private.user_can_view_meeting(p_user, m.id)
       and (m.status = 'published'
            or private.user_has_project_permission(p_user, m.project_id, 'comment.internal.view')));
$$;

-- ---------------------------------------------------------------------------
-- Реестр сущностей: совещание как объект с комментариями, лентой и уведомлениями
-- ---------------------------------------------------------------------------
create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'     then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
    when 'location' then (select project_id from public.locations where id = p_id and tenant_id = private.tenant_id())
    when 'document' then (select project_id from public.documents where id = p_id and tenant_id = private.tenant_id())
    when 'meeting'  then (select project_id from public.meetings where id = p_id and tenant_id = private.tenant_id())
  end;
$$;

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id)
    when 'task'     then (select project_id from public.tasks where id = p_id)
    when 'location' then (select project_id from public.locations where id = p_id)
    when 'document' then (select project_id from public.documents where id = p_id)
    when 'meeting'  then (select project_id from public.meetings where id = p_id)
  end;
$$;

create or replace function private.user_can_view_entity(p_user uuid, p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then private.user_can_see_project(p_user, p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and private.user_task_visible(p_user, t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    when 'location' then exists (
      select 1 from public.locations l
      where l.id = p_id and private.user_can_see_project(p_user, l.project_id))
    when 'document' then private.user_can_view_document(p_user, p_id)
    when 'meeting' then private.user_can_view_meeting(p_user, p_id)
    else false
  end;
$$;

create or replace function private.entity_display(p_type text, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'task' then (
      select jsonb_build_object('key', t.key, 'title', t.title, 'project_code', p.code)
        from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_id)
    when 'project' then (
      select jsonb_build_object('key', p.code, 'title', p.name, 'project_code', p.code)
        from public.projects p where p.id = p_id)
    when 'location' then (
      select jsonb_build_object('key', l.path::text, 'title', l.name, 'project_code', p.code)
        from public.locations l join public.projects p on p.id = l.project_id where l.id = p_id)
    when 'document' then (
      select jsonb_build_object('key', coalesce(d.code, 'Документ'), 'title', d.title, 'project_code', p.code)
        from public.documents d join public.projects p on p.id = d.project_id where d.id = p_id)
    when 'meeting' then (
      select jsonb_build_object('key', m.key, 'title', m.title, 'project_code', p.code)
        from public.meetings m join public.projects p on p.id = m.project_id where m.id = p_id)
  end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.meetings enable row level security;
alter table public.meetings force row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_participants force row level security;
alter table public.meeting_agenda_items enable row level security;
alter table public.meeting_agenda_items force row level security;
alter table public.meeting_decisions enable row level security;
alter table public.meeting_decisions force row level security;

create policy meetings_select on public.meetings for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_view_meeting((select auth.uid()), id));
create policy meetings_update on public.meetings for update to authenticated
  using (tenant_id = (select private.tenant_id())
         and (private.user_can_manage_meeting((select auth.uid()), id) or private.user_can_conduct_meeting((select auth.uid()), id)))
  with check (tenant_id = (select private.tenant_id()));

create policy meeting_participants_select on public.meeting_participants for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.user_can_view_meeting((select auth.uid()), meeting_id)
         and private.can_see_user(user_id));
create policy meeting_participants_insert on public.meeting_participants for insert to authenticated
  with check (private.user_can_manage_meeting((select auth.uid()), meeting_id));
create policy meeting_participants_update on public.meeting_participants for update to authenticated
  using (tenant_id = (select private.tenant_id())
         and (private.user_can_manage_meeting((select auth.uid()), meeting_id) or private.user_can_conduct_meeting((select auth.uid()), meeting_id)))
  with check (tenant_id = (select private.tenant_id()));
create policy meeting_participants_delete on public.meeting_participants for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_manage_meeting((select auth.uid()), meeting_id));

create policy meeting_agenda_select on public.meeting_agenda_items for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_view_meeting((select auth.uid()), meeting_id));
create policy meeting_agenda_insert on public.meeting_agenda_items for insert to authenticated
  with check (private.user_can_manage_meeting((select auth.uid()), meeting_id) or private.user_can_conduct_meeting((select auth.uid()), meeting_id));
create policy meeting_agenda_update on public.meeting_agenda_items for update to authenticated
  using (tenant_id = (select private.tenant_id())
         and (private.user_can_manage_meeting((select auth.uid()), meeting_id) or private.user_can_conduct_meeting((select auth.uid()), meeting_id)))
  with check (tenant_id = (select private.tenant_id()));
create policy meeting_agenda_delete on public.meeting_agenda_items for delete to authenticated
  using (tenant_id = (select private.tenant_id())
         and (private.user_can_manage_meeting((select auth.uid()), meeting_id) or private.user_can_conduct_meeting((select auth.uid()), meeting_id)));

create policy meeting_decisions_select on public.meeting_decisions for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_view_minutes((select auth.uid()), meeting_id));
create policy meeting_decisions_insert on public.meeting_decisions for insert to authenticated
  with check (private.user_can_conduct_meeting((select auth.uid()), meeting_id));
create policy meeting_decisions_update on public.meeting_decisions for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_conduct_meeting((select auth.uid()), meeting_id))
  with check (tenant_id = (select private.tenant_id()));
create policy meeting_decisions_delete on public.meeting_decisions for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_conduct_meeting((select auth.uid()), meeting_id));

revoke insert, update, delete on public.meetings, public.meeting_participants, public.meeting_agenda_items, public.meeting_decisions from authenticated;
grant update (title, type, scheduled_at, duration_min, place, visibility, facilitator_id, summary) on public.meetings to authenticated;
grant insert (meeting_id, user_id, required) on public.meeting_participants to authenticated;
grant update (required, attendance) on public.meeting_participants to authenticated;
grant delete on public.meeting_participants to authenticated;
grant insert (meeting_id, title, presenter_id, duration_min, sort, task_id) on public.meeting_agenda_items to authenticated;
grant update (title, presenter_id, duration_min, sort, notes, task_id) on public.meeting_agenda_items to authenticated;
grant delete on public.meeting_agenda_items to authenticated;
grant insert (meeting_id, agenda_item_id, text) on public.meeting_decisions to authenticated;
grant update (text) on public.meeting_decisions to authenticated;
grant delete on public.meeting_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- Триггеры: служебные поля, блокировка после закрытия, права на разные поля
-- ---------------------------------------------------------------------------
create or replace function private.meetings_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('published', 'cancelled') then
    raise exception 'meeting_closed' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.title := btrim(new.title);
  if new.summary is distinct from old.summary and not private.user_can_conduct_meeting(auth.uid(), old.id) then
    raise exception 'permission denied: meeting.conduct' using errcode = '42501';
  end if;
  if (new.title, new.type, new.scheduled_at, new.duration_min, new.place, new.visibility, new.facilitator_id)
     is distinct from (old.title, old.type, old.scheduled_at, old.duration_min, old.place, old.visibility, old.facilitator_id)
     and not private.user_can_manage_meeting(auth.uid(), old.id) then
    raise exception 'permission denied: meeting.manage' using errcode = '42501';
  end if;
  if new.facilitator_id is distinct from old.facilitator_id and new.facilitator_id is not null
     and not private.user_is_project_member(new.facilitator_id, old.project_id) then
    raise exception 'facilitator is not a project member' using errcode = '23514';
  end if;
  -- внешнее совещание нельзя «закрыть» от тех, кто уже приглашён: видимость меняем только пока оно не началось
  if new.visibility is distinct from old.visibility and old.status <> 'scheduled' then
    raise exception 'visibility_locked' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger meetings_before_update before update on public.meetings
  for each row execute function private.meetings_before_update();

-- Дочерние строки: служебные поля из совещания, запрет правок в закрытом совещании
create or replace function private.meeting_children_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_id uuid := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
begin
  select * into m from public.meetings where id = v_id and tenant_id = private.tenant_id();
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
    -- присутствие отмечает тот, кто ведёт совещание
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
    -- решения фиксируют, пока совещание идёт или протокол в черновике
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
create trigger meeting_participants_guard before insert or update or delete on public.meeting_participants
  for each row execute function private.meeting_children_guard();
create trigger meeting_agenda_guard before insert or update or delete on public.meeting_agenda_items
  for each row execute function private.meeting_children_guard();
create trigger meeting_decisions_guard before insert or update or delete on public.meeting_decisions
  for each row execute function private.meeting_children_guard();

-- Приглашённого уведомляем (после вставки: внешний видит совещание только как участник)
create or replace function private.meeting_participants_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = new.meeting_id;
  if m.status = 'scheduled' then
    perform private.notify(new.user_id, 'meeting', m.id, 'assigned', 'normal', 'meeting',
      format('Вас пригласили на совещание «%s» — %s', m.title,
             to_char(m.scheduled_at at time zone (select coalesce(p.timezone, 'UTC') from public.projects p where p.id = m.project_id), 'DD.MM.YYYY HH24:MI')));
  end if;
  return new;
end;
$$;
create trigger meeting_participants_after_insert after insert on public.meeting_participants
  for each row execute function private.meeting_participants_after_insert();

-- ---------------------------------------------------------------------------
-- Создание совещания
-- ---------------------------------------------------------------------------
create or replace function public.create_meeting(
  p_project      uuid,
  p_title        text,
  p_type         text,
  p_scheduled_at timestamptz,
  p_duration_min integer default 60,
  p_place        text default null,
  p_visibility   text default 'internal',
  p_facilitator  uuid default null,
  p_participants uuid[] default '{}',
  p_agenda       text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_number  integer;
  v_id      uuid;
  v_fac     uuid := coalesce(p_facilitator, v_uid);
  x         uuid;
  t         text;
begin
  if v_uid is null or v_tenant is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if not found or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'meeting.create')
     or not private.can_see_internal(p_project) then
    raise exception 'permission denied: meeting.create' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if p_scheduled_at is null then raise exception 'date_required' using errcode = '22023'; end if;
  if not private.user_is_project_member(v_fac, p_project) then
    raise exception 'facilitator is not a project member' using errcode = '23514';
  end if;

  insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'M', 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;

  insert into public.meetings (tenant_id, project_id, number, key, type, title, scheduled_at, duration_min, place, visibility, facilitator_id, created_by)
  values (v_tenant, p_project, v_number, v_project.code || '-M-' || v_number, coalesce(p_type, 'operational'), btrim(p_title),
          p_scheduled_at, coalesce(p_duration_min, 60), nullif(btrim(coalesce(p_place, '')), ''), coalesce(p_visibility, 'internal'), v_fac, v_uid)
  returning id into v_id;

  -- организатор и ведущий всегда в составе
  foreach x in array (select array_agg(distinct u) from unnest(coalesce(p_participants, '{}') || v_uid || v_fac) u) loop
    if private.user_is_project_member(x, p_project) then
      insert into public.meeting_participants (meeting_id, user_id, tenant_id, project_id)
      values (v_id, x, v_tenant, p_project) on conflict do nothing;
    end if;
  end loop;

  foreach t in array coalesce(p_agenda, '{}') loop
    if nullif(btrim(t), '') is not null then
      insert into public.meeting_agenda_items (meeting_id, tenant_id, project_id, title) values (v_id, v_tenant, p_project, btrim(t));
    end if;
  end loop;

  perform private.record_event(v_tenant, p_project, 'meeting', v_id, 'created', jsonb_build_object('title', btrim(p_title)), 'internal');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Жизненный цикл: scheduled → in_progress → minutes_draft → published (+ cancelled)
-- ---------------------------------------------------------------------------
create or replace function public.set_meeting_status(p_meeting uuid, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m      public.meetings;
  v_uid  uuid := auth.uid();
  v_user uuid;
  v_text text;
begin
  select * into m from public.meetings where id = p_meeting and tenant_id = private.tenant_id() for update;
  if not found or not private.user_can_view_meeting(v_uid, m.id) then raise exception 'meeting_not_found' using errcode = 'P0002'; end if;

  if p_to = 'in_progress' and m.status in ('scheduled', 'minutes_draft') then
    if not private.user_can_conduct_meeting(v_uid, m.id) then raise exception 'permission denied: meeting.conduct' using errcode = '42501'; end if;
    update public.meetings set status = 'in_progress', started_at = coalesce(started_at, now()), finished_at = null where id = m.id;
  elsif p_to = 'minutes_draft' and m.status = 'in_progress' then
    if not private.user_can_conduct_meeting(v_uid, m.id) then raise exception 'permission denied: meeting.conduct' using errcode = '42501'; end if;
    update public.meetings set status = 'minutes_draft', finished_at = now() where id = m.id;
  elsif p_to = 'published' and m.status = 'minutes_draft' then
    if not (private.user_has_project_permission(v_uid, m.project_id, 'meeting.minutes.publish')
            or (private.user_can_conduct_meeting(v_uid, m.id) and m.facilitator_id = v_uid)) then
      raise exception 'permission denied: meeting.minutes.publish' using errcode = '42501';
    end if;
    update public.meetings set status = 'published', published_at = now(), published_by = v_uid where id = m.id;
    v_text := format('Опубликован протокол совещания «%s»', m.title);
    for v_user in select user_id from public.meeting_participants where meeting_id = m.id loop
      perform private.notify(v_user, 'meeting', m.id, 'watching', 'normal', 'meeting', v_text);
    end loop;
  elsif p_to = 'cancelled' and m.status in ('scheduled', 'in_progress') then
    if not private.user_can_manage_meeting(v_uid, m.id) then raise exception 'permission denied: meeting.manage' using errcode = '42501'; end if;
    update public.meetings set status = 'cancelled' where id = m.id;
    v_text := format('Совещание «%s» отменено', m.title);
    for v_user in select user_id from public.meeting_participants where meeting_id = m.id loop
      perform private.notify(v_user, 'meeting', m.id, 'watching', 'high', 'meeting', v_text);
    end loop;
  else
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  perform private.record_event(m.tenant_id, m.project_id, 'meeting', m.id, 'status_changed',
                               jsonb_build_object('from', m.status, 'to', p_to), 'internal');
end;
$$;

-- ---------------------------------------------------------------------------
-- Поручение по итогам совещания: обычная задача (action_item) с исполнителем и сроком
-- ---------------------------------------------------------------------------
create or replace function public.add_meeting_action(
  p_meeting  uuid,
  p_title    text,
  p_assignee uuid default null,
  p_due_date date default null,
  p_priority text default 'normal'
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings;
  v_task public.tasks;
begin
  select * into m from public.meetings where id = p_meeting and tenant_id = private.tenant_id();
  if not found or not private.user_can_view_meeting(auth.uid(), m.id) then raise exception 'meeting_not_found' using errcode = 'P0002'; end if;
  if not private.user_can_conduct_meeting(auth.uid(), m.id) then raise exception 'permission denied: meeting.conduct' using errcode = '42501'; end if;
  if m.status not in ('in_progress', 'minutes_draft') then raise exception 'meeting_not_in_progress' using errcode = '22023'; end if;

  v_task := public.create_task(m.project_id, p_title, 'action_item', p_assignee, p_due_date, coalesce(p_priority, 'normal'));
  update public.tasks set meeting_id = m.id where id = v_task.id returning * into v_task;
  perform private.record_event(m.tenant_id, m.project_id, 'meeting', m.id, 'action_added',
                               jsonb_build_object('key', v_task.key, 'title', v_task.title), 'internal');
  return v_task;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_meeting(uuid,text,text,timestamptz,integer,text,text,uuid,uuid[],text[])',
    'set_meeting_status(uuid,text)',
    'add_meeting_action(uuid,text,uuid,date,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Реестр: совещания со счётчиками
-- ---------------------------------------------------------------------------
create view public.meetings_overview with (security_invoker = true) as
select m.id, m.project_id, m.number, m.key, m.type, m.title, m.scheduled_at, m.duration_min, m.place, m.visibility,
       m.status, m.facilitator_id, m.published_at,
       (select count(*)::int from public.meeting_participants p where p.meeting_id = m.id) as participants_count,
       (select count(*)::int from public.meeting_participants p where p.meeting_id = m.id and p.attendance = 'present') as present_count,
       (select count(*)::int from public.meeting_decisions d where d.meeting_id = m.id) as decisions_count,
       (select count(*)::int from public.tasks t where t.meeting_id = m.id and t.deleted_at is null) as actions_count,
       (select count(*)::int from public.tasks t where t.meeting_id = m.id and t.deleted_at is null
           and t.status_category not in ('done', 'cancelled')) as open_actions_count
  from public.meetings m;
grant select on public.meetings_overview to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
