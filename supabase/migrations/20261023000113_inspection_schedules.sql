-- Инспекции: расписание повторных инспекций («отчёт пошёл заново раз в период»).
--
-- На место (этаж, зона, помещение) заводится расписание: «каждые N дней, ближайшая — такого-то числа». Когда срок наступает, задание
-- `buildos-inspection-schedules` (раз в сутки) создаёт новый отчёт-черновик: то же место, подрядчик и схема прошлого отчёта этого места,
-- чистый чек-лист из стандартных разделов, автор — инспектор расписания, ему приходит уведомление «Пора провести инспекцию».
-- Срок сдвигается на следующий период с сохранением ритма (сколько бы дней ни пропустили, создаётся один отчёт). Пока предыдущий отчёт
-- расписания не выдан (остаётся черновиком), новый не создаётся: срок просто считается просроченным.
-- «Провести сейчас» создаёт отчёт на сегодня вне очереди (или возвращает открытый черновик) и отсчитывает период заново от сегодняшнего дня.
-- Одно расписание на место; выключенное остаётся в списке и не срабатывает. Права: смотрят `inspection.view`/`inspection.conduct`, ведут `inspection.conduct`.
-- Отчёты, созданные расписанием, помнят его в `inspection_reports.schedule_id`.
-- См. docs: 04-modules/19-quality-control.md.

create table public.inspection_schedules (
  id                uuid primary key default public.uuidv7(),
  tenant_id         uuid not null references public.tenants(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  location_id       uuid not null references public.locations(id),
  contractor_org_id uuid references public.organizations(id),
  title             text not null default '' check (char_length(title) <= 200),
  period_days       integer not null check (period_days between 1 and 365),
  next_due          date not null,
  active            boolean not null default true,
  inspector_id      uuid references public.users(id),
  created_by        uuid default auth.uid() references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index inspection_schedules_place_uniq on public.inspection_schedules (project_id, location_id) where deleted_at is null;
create index on public.inspection_schedules (next_due) where active and deleted_at is null;

alter table public.inspection_reports add column schedule_id uuid references public.inspection_schedules(id) on delete set null;
create index on public.inspection_reports (schedule_id) where schedule_id is not null;

alter table public.inspection_schedules enable row level security;
alter table public.inspection_schedules force row level security;
revoke insert, update, delete on public.inspection_schedules from authenticated;
create policy inspection_schedules_select on public.inspection_schedules for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and (private.has_project_permission(project_id, 'inspection.view') or private.has_project_permission(project_id, 'inspection.conduct')));

-- Расписание для правки: проверяет право
create or replace function private.inspection_schedule_guard(p_id uuid) returns public.inspection_schedules
language plpgsql security definer set search_path = '' as $$
declare
  s public.inspection_schedules;
begin
  select * into s from public.inspection_schedules where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'schedule_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(s.project_id, array['inspection.conduct']);
  return s;
end;
$$;

-- Новый отчёт-черновик по расписанию. p_restart: срок отсчитывается заново от p_today («провести сейчас»); иначе ритм сохраняется.
create or replace function private.inspection_schedule_make(s public.inspection_schedules, p_today date, p_author uuid, p_restart boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_loc     public.locations;
  v_prev    public.inspection_reports;
  v_title   text;
  v_number  integer;
  v_id      uuid;
  v_pos     integer := 0;
  v_code    text;
  v_next    date;
  v_author  uuid := coalesce(p_author, s.inspector_id, s.created_by);
begin
  select * into v_project from public.projects where id = s.project_id;
  select * into v_loc from public.locations where id = s.location_id;
  v_title := coalesce(nullif(btrim(s.title), ''), v_loc.name);
  -- подрядчик и схема берутся из прошлого отчёта этого места
  select * into v_prev from public.inspection_reports r
   where r.project_id = s.project_id and r.location_id = s.location_id and r.deleted_at is null
   order by r.inspection_date desc, r.number desc limit 1;

  insert into public.project_counters as pc (project_id, kind, last_number) values (s.project_id, 'IR', 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;
  insert into public.inspection_reports (tenant_id, project_id, number, key, title, location_id, inspection_date, contractor_org_id, scheme_text,
                                         scheme_file_id, scheme_version_id, scheme_page, created_by, schedule_id)
  values (s.tenant_id, s.project_id, v_number, v_project.code || '-IR-' || v_number, v_title, s.location_id, p_today,
          coalesce(s.contractor_org_id, v_prev.contractor_org_id), coalesce(v_prev.scheme_text, ''),
          v_prev.scheme_file_id, v_prev.scheme_version_id, coalesce(v_prev.scheme_page, 1), v_author, s.id)
  returning id into v_id;
  foreach v_code in array array['walls', 'floor', 'ceiling', 'doors', 'windows', 'electrical', 'sanitary', 'ffe'] loop
    v_pos := v_pos + 1;
    insert into public.inspection_sections (tenant_id, report_id, position, code) values (s.tenant_id, v_id, v_pos, v_code);
  end loop;

  if p_restart then
    v_next := p_today + s.period_days;
  else
    v_next := s.next_due + ((greatest(p_today - s.next_due, 0) / s.period_days) + 1) * s.period_days;
  end if;
  update public.inspection_schedules set next_due = v_next, updated_at = now() where id = s.id;

  -- «Пора провести инспекцию»: ссылка ведёт на созданный отчёт
  perform private.notify(v_author, 'project', s.project_id, 'assigned', 'normal', 'assigned',
                         'Пора провести инспекцию: ' || v_title || ' (' || v_project.code || '-IR-' || v_number || ')', true);
  update public.notifications
     set payload = payload || jsonb_build_object('link', '/projects/' || v_project.code || '/inspection/' || v_id)
   where id = (select n.id from public.notifications n where n.user_id = v_author and n.entity_type = 'project' and n.entity_id = s.project_id order by n.updated_at desc limit 1);
  return v_id;
end;
$$;

-- Задание: создаёт отчёты по всем расписаниям, у которых наступил срок (по часовому поясу проекта). Возвращает, сколько создано.
create or replace function private.inspection_schedules_run() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s       public.inspection_schedules;
  v_today date;
  v_count integer := 0;
begin
  for s in
    select x.* from public.inspection_schedules x
     where x.active and x.deleted_at is null
       and not exists (select 1 from public.inspection_reports r where r.schedule_id = x.id and r.status = 'draft' and r.deleted_at is null)
  loop
    v_today := (now() at time zone coalesce((select p.timezone from public.projects p where p.id = s.project_id), 'UTC'))::date;
    continue when s.next_due > v_today;
    begin
      perform private.inspection_schedule_make(s, v_today, null, false);
      v_count := v_count + 1;
    exception when others then
      raise warning 'inspection_schedules_run: расписание % пропущено: %', s.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

do $$ begin
  perform cron.schedule('buildos-inspection-schedules', '20 4 * * *', 'select private.inspection_schedules_run()');
exception when others then
  raise notice 'pg_cron недоступен, расписание повторных инспекций не создано: %', sqlerrm;
end $$;

-- Создать (p_id пусто) или изменить расписание места. p_next_due пусто — сегодня.
create or replace function public.inspection_schedule_save(
  p_project uuid, p_id uuid default null, p_location uuid default null, p_contractor uuid default null, p_title text default '',
  p_period_days integer default 14, p_next_due date default null, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_title  text := btrim(coalesce(p_title, ''));
  v_id     uuid;
begin
  perform private.week_guard(p_project, array['inspection.conduct']);
  if p_location is null or not exists (select 1 from public.locations l where l.id = p_location and l.project_id = p_project and l.tenant_id = v_tenant and l.deleted_at is null) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if p_contractor is not null and not exists (select 1 from public.organizations o where o.id = p_contractor and o.tenant_id = v_tenant and o.deleted_at is null) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if p_period_days is null or p_period_days not between 1 and 365 then raise exception 'period_invalid' using errcode = '22023'; end if;
  if char_length(v_title) > 200 then raise exception 'text_too_long' using errcode = '22023'; end if;
  if exists (select 1 from public.inspection_schedules x where x.project_id = p_project and x.location_id = p_location and x.deleted_at is null and x.id is distinct from p_id) then
    raise exception 'schedule_exists' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.inspection_schedules (tenant_id, project_id, location_id, contractor_org_id, title, period_days, next_due, active, inspector_id)
    values (v_tenant, p_project, p_location, p_contractor, v_title, p_period_days, coalesce(p_next_due, current_date), coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    perform private.inspection_schedule_guard(p_id);
    update public.inspection_schedules
       set location_id = p_location, contractor_org_id = p_contractor, title = v_title, period_days = p_period_days,
           next_due = coalesce(p_next_due, next_due), active = coalesce(p_active, active), updated_at = now()
     where id = p_id and project_id = p_project;
    if not found then raise exception 'schedule_not_found' using errcode = 'P0002'; end if;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.inspection_schedule_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.inspection_schedules := private.inspection_schedule_guard(p_id);
begin
  update public.inspection_schedules set deleted_at = now(), active = false where id = s.id;
end;
$$;

-- «Провести сейчас»: отчёт на сегодня вне очереди; если от расписания уже есть открытый черновик — возвращает его
create or replace function public.inspection_schedule_run(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s       public.inspection_schedules := private.inspection_schedule_guard(p_id);
  v_today date := (now() at time zone coalesce((select p.timezone from public.projects p where p.id = s.project_id), 'UTC'))::date;
  v_open  uuid;
begin
  select r.id into v_open from public.inspection_reports r where r.schedule_id = s.id and r.status = 'draft' and r.deleted_at is null order by r.created_at desc limit 1;
  if v_open is not null then return v_open; end if;
  return private.inspection_schedule_make(s, v_today, auth.uid(), true);
end;
$$;

revoke execute on function public.inspection_schedule_save(uuid, uuid, uuid, uuid, text, integer, date, boolean), public.inspection_schedule_delete(uuid), public.inspection_schedule_run(uuid) from public, anon;
grant execute on function public.inspection_schedule_save(uuid, uuid, uuid, uuid, text, integer, date, boolean), public.inspection_schedule_delete(uuid), public.inspection_schedule_run(uuid) to authenticated;
notify pgrst, 'reload schema';
