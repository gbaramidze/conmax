-- График работ (лёгкая версия S4): работы с иерархией (WBS), вехи, зависимости FS/SS/FF/SF со сдвигом, ограничения дат,
-- расчёт критического пути в рабочих днях, базовые планы, генерация цепочки работ по этажам.
-- См. docs: 04-modules/08-schedule-planning.md (§0).
-- Рабочие дни проекта: projects.settings -> "workdays" (1 — понедельник … 7 — воскресенье, по умолчанию 1..5)
-- и "holidays" (даты YYYY-MM-DD).

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------
create table public.schedule_activities (
  id                uuid primary key default public.uuidv7(),
  tenant_id         uuid not null references public.tenants(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references public.users(id),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  parent_id         uuid references public.schedule_activities(id),
  sort              integer not null default 0,
  kind              text not null default 'task' check (kind in ('task','milestone','summary')),
  name              text not null check (length(btrim(name)) between 1 and 300),
  duration_days     integer not null default 1 check (duration_days between 0 and 5000),   -- в рабочих днях
  constraint_type   text not null default 'asap' check (constraint_type in ('asap','snet','mso','fnlt')),
  constraint_date   date,
  discipline_id     uuid references public.disciplines(id),
  location_id       uuid references public.locations(id),
  contractor_org_id uuid references public.organizations(id),
  responsible_id    uuid references public.users(id),
  percent_complete  numeric(5,2) not null default 0 check (percent_complete between 0 and 100),
  actual_start      date,
  actual_finish     date,
  external_ref      text,
  -- результат расчёта
  start_date        date,
  finish_date       date,
  late_start        date,
  late_finish       date,
  total_float       integer,
  free_float        integer,
  is_critical       boolean not null default false,
  calc_at           timestamptz,
  check (constraint_type = 'asap' or constraint_date is not null)
);
create index on public.schedule_activities (tenant_id, project_id) where deleted_at is null;
create index on public.schedule_activities (parent_id);
create unique index schedule_activities_ext_uniq on public.schedule_activities (project_id, external_ref) where external_ref is not null and deleted_at is null;

create table public.schedule_links (
  id             uuid primary key default public.uuidv7(),
  tenant_id      uuid not null references public.tenants(id),
  project_id     uuid not null references public.projects(id) on delete cascade,
  predecessor_id uuid not null references public.schedule_activities(id) on delete cascade,
  successor_id   uuid not null references public.schedule_activities(id) on delete cascade,
  type           text not null default 'FS' check (type in ('FS','SS','FF','SF')),
  lag_days       integer not null default 0 check (lag_days between -1000 and 1000),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users(id),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);
create index on public.schedule_links (successor_id);
create index on public.schedule_links (project_id);

create table public.schedule_baselines (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  number     integer not null,
  name       text not null check (length(btrim(name)) between 1 and 120),
  reason     text check (reason is null or length(reason) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users(id),
  unique (project_id, number)
);
create table public.schedule_baseline_activities (
  baseline_id  uuid not null references public.schedule_baselines(id) on delete cascade,
  activity_id  uuid not null references public.schedule_activities(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  start_date   date,
  finish_date  date,
  primary key (baseline_id, activity_id)
);

-- ---------------------------------------------------------------------------
-- RLS: график видят внутренние участники с schedule.view, меняют — с schedule.edit
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['schedule_activities', 'schedule_links', 'schedule_baselines', 'schedule_baseline_activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'schedule.view'))$p$, t || '_select', t);
  end loop;
end $$;

create policy schedule_activities_insert on public.schedule_activities for insert to authenticated
  with check (private.can_see_project(project_id) and private.has_project_permission(project_id, 'schedule.edit'));
create policy schedule_activities_update on public.schedule_activities for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.has_project_permission(project_id, 'schedule.edit'))
  with check (tenant_id = (select private.tenant_id()));
create policy schedule_links_insert on public.schedule_links for insert to authenticated
  with check (private.can_see_project(project_id) and private.has_project_permission(project_id, 'schedule.edit'));
create policy schedule_links_update on public.schedule_links for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.has_project_permission(project_id, 'schedule.edit'))
  with check (tenant_id = (select private.tenant_id()));
create policy schedule_links_delete on public.schedule_links for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and private.has_project_permission(project_id, 'schedule.edit'));

revoke insert, update, delete on public.schedule_activities, public.schedule_links, public.schedule_baselines, public.schedule_baseline_activities from authenticated;
grant insert (project_id, parent_id, sort, kind, name, duration_days, constraint_type, constraint_date, discipline_id, location_id,
              contractor_org_id, responsible_id, external_ref) on public.schedule_activities to authenticated;
grant update (parent_id, sort, kind, name, duration_days, constraint_type, constraint_date, discipline_id, location_id,
              contractor_org_id, responsible_id, percent_complete, actual_start, actual_finish, deleted_at) on public.schedule_activities to authenticated;
grant insert (predecessor_id, successor_id, type, lag_days) on public.schedule_links to authenticated;
grant update (type, lag_days) on public.schedule_links to authenticated;
grant delete on public.schedule_links to authenticated;

-- ---------------------------------------------------------------------------
-- Триггеры
-- ---------------------------------------------------------------------------
create or replace function private.schedule_activities_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_proj uuid;
begin
  if tg_op = 'INSERT' then
    new.tenant_id := private.tenant_id();
    new.created_by := auth.uid();
    v_proj := new.project_id;
  else
    new.updated_at := now();
    v_proj := old.project_id;
  end if;

  new.name := btrim(new.name);
  if new.kind = 'milestone' then new.duration_days := 0;
  elsif new.kind = 'task' and new.duration_days < 1 then new.duration_days := 1; end if;
  if new.actual_finish is not null and new.actual_start is not null and new.actual_finish < new.actual_start then
    raise exception 'actual_finish_before_start' using errcode = '23514';
  end if;
  if new.actual_finish is not null then new.percent_complete := 100; end if;

  if new.parent_id is not null then
    if not exists (select 1 from public.schedule_activities p where p.id = new.parent_id and p.project_id = v_proj and p.deleted_at is null) then
      raise exception 'parent belongs to another project' using errcode = '23514';
    end if;
    -- родитель не может оказаться потомком самого себя
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id and exists (
      with recursive up(id, parent_id) as (
        select a.id, a.parent_id from public.schedule_activities a where a.id = new.parent_id
        union all
        select a.id, a.parent_id from public.schedule_activities a join up on a.id = up.parent_id)
      select 1 from up where id = new.id) then
      raise exception 'cycle_in_hierarchy' using errcode = '23514';
    end if;
  end if;
  if new.discipline_id is not null and not exists (
    select 1 from public.disciplines d where d.id = new.discipline_id and d.project_id = v_proj and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
  end if;
  if new.location_id is not null and not exists (
    select 1 from public.locations l where l.id = new.location_id and l.project_id = v_proj and l.deleted_at is null) then
    raise exception 'location does not belong to this project' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger schedule_activities_guard before insert or update on public.schedule_activities
  for each row execute function private.schedule_activities_guard();

-- Родитель с потомками становится суммарной работой
create or replace function private.schedule_activities_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null then
    update public.schedule_activities set kind = 'summary' where id = new.parent_id and kind <> 'summary';
  end if;
  return new;
end;
$$;
create trigger schedule_activities_after after insert or update of parent_id on public.schedule_activities
  for each row execute function private.schedule_activities_after();

create or replace function private.schedule_links_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.schedule_activities;
  s public.schedule_activities;
begin
  if tg_op = 'INSERT' then
    select * into p from public.schedule_activities where id = new.predecessor_id and deleted_at is null;
    select * into s from public.schedule_activities where id = new.successor_id and deleted_at is null;
    if p.id is null or s.id is null or p.project_id <> s.project_id then
      raise exception 'activities must belong to one project' using errcode = '23514';
    end if;
    if p.kind = 'summary' or s.kind = 'summary' then
      raise exception 'summary_link_not_allowed' using errcode = '23514';
    end if;
    new.tenant_id := p.tenant_id;
    new.project_id := p.project_id;
    new.created_by := auth.uid();
    -- связь не должна замыкать цикл: из преемника нельзя дойти до предшественника
    if exists (
      with recursive reach(id) as (
        select new.successor_id
        union
        select l.successor_id from public.schedule_links l join reach r on l.predecessor_id = r.id)
      select 1 from reach where id = new.predecessor_id) then
      raise exception 'cycle_detected' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger schedule_links_guard before insert on public.schedule_links
  for each row execute function private.schedule_links_guard();

-- ---------------------------------------------------------------------------
-- Расчёт графика (CPM) в рабочих днях
-- ---------------------------------------------------------------------------
create or replace function public.recalculate_schedule(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_proj     public.projects;
  v_workdays integer[];
  v_holidays date[];
  v_cal_from date;
  v_start    date;
  v_start_ix integer;
  v_finish_ix integer;
  v_left     integer;
  v_prev     integer;
  v_depth    integer;
  v_cycle    text;
  v_critical integer;
  v_total    integer;
  v_end_date date;
begin
  select * into v_proj from public.projects where id = p_project and tenant_id = private.tenant_id();
  if not found or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'schedule.edit') then
    raise exception 'permission denied: schedule.edit' using errcode = '42501';
  end if;

  v_workdays := coalesce(nullif(array(select jsonb_array_elements_text(v_proj.settings -> 'workdays')::integer), '{}'), array[1, 2, 3, 4, 5]);
  v_holidays := coalesce(array(select jsonb_array_elements_text(v_proj.settings -> 'holidays')::date), '{}');
  v_start := coalesce(v_proj.planned_start, current_date);
  v_cal_from := least(v_start, (select min(least(constraint_date, actual_start)) from public.schedule_activities where project_id = p_project and deleted_at is null), v_start) - 366;

  -- календарь рабочих дней: номер рабочего дня <-> дата
  drop table if exists pg_temp._wd;
  create temp table _wd (ix integer primary key, d date not null unique) on commit drop;
  insert into _wd
    select (row_number() over (order by g))::integer, g::date
      from generate_series(v_cal_from, v_cal_from + 4400, interval '1 day') g
     where extract(isodow from g)::integer = any (v_workdays) and g::date <> all (v_holidays);

  select ix into v_start_ix from _wd where d >= v_start order by d limit 1;

  drop table if exists pg_temp._a;
  create temp table _a on commit drop as
    select a.id, a.kind, a.parent_id,
           case a.kind when 'milestone' then 0 else greatest(a.duration_days, 1) end as dur,
           a.constraint_type, a.constraint_date, a.actual_start, a.actual_finish,
           (select ix from _wd where d >= a.constraint_date order by d limit 1) as c_next,   -- первый рабочий день на/после даты
           (select max(ix) from _wd where d <= a.constraint_date) as c_prev,                  -- последний рабочий день на/до даты
           (select ix from _wd where d >= a.actual_start order by d limit 1) as as_ix,
           (select max(ix) from _wd where d <= a.actual_finish) as af_ix,
           0 as es, 0 as ef, 0 as ls, 0 as lf, 0 as tf, 0 as ff,
           false as fdone, false as bdone
      from public.schedule_activities a
     where a.project_id = p_project and a.deleted_at is null and a.kind <> 'summary';

  drop table if exists pg_temp._l;
  create temp table _l on commit drop as
    select l.predecessor_id as pred, l.successor_id as succ, l.type, l.lag_days as lag
      from public.schedule_links l
      join _a p on p.id = l.predecessor_id
      join _a s on s.id = l.successor_id
     where l.project_id = p_project;
  create index on _l (succ);
  create index on _l (pred);

  -- прямой проход: ранние даты
  select count(*) into v_left from _a;
  loop
    update _a a set
      es = case
             when a.constraint_type = 'mso' and a.c_next is not null then a.c_next
             when a.as_ix is not null then a.as_ix
             else greatest(
               v_start_ix,
               coalesce(case when a.constraint_type = 'snet' then a.c_next end, 0),
               coalesce((select max(case l.type
                                      when 'FS' then p.ef + 1 + l.lag
                                      when 'SS' then p.es + l.lag
                                      when 'FF' then p.ef + l.lag - a.dur + 1
                                      else p.es + l.lag - a.dur + 1 end)
                           from _l l join _a p on p.id = l.pred where l.succ = a.id), 0))
           end,
      fdone = true
     where not a.fdone
       and not exists (select 1 from _l l join _a p on p.id = l.pred where l.succ = a.id and not p.fdone);
    update _a set ef = case when af_ix is not null then af_ix else es + dur - 1 end where fdone and ef = 0;
    select count(*) into v_prev from _a where not fdone;
    exit when v_prev = 0;
    exit when v_prev >= v_left;     -- ничего не продвинулось: цикл
    v_left := v_prev;
  end loop;
  if v_prev > 0 then
    select string_agg(distinct name, ' → ') into v_cycle
      from (select a2.name from _a a join public.schedule_activities a2 on a2.id = a.id where not a.fdone limit 6) q;
    raise exception 'cycle_detected: %', coalesce(v_cycle, '') using errcode = '23514';
  end if;

  -- веха занимает «точку перед началом дня» (ef = es - 1), поэтому конец проекта — просто максимум ef
  select coalesce(max(ef), 0) into v_finish_ix from _a;

  -- обратный проход: поздние даты
  v_left := (select count(*) from _a);
  loop
    update _a a set
      lf = least(
             v_finish_ix,
             coalesce(case when a.constraint_type = 'fnlt' then a.c_prev end, v_finish_ix),
             coalesce((select min(case l.type
                                    when 'FS' then s.ls - 1 - l.lag
                                    when 'SS' then s.ls - l.lag + a.dur - 1
                                    when 'FF' then s.lf - l.lag
                                    else s.lf - l.lag + a.dur - 1 end)
                         from _l l join _a s on s.id = l.succ where l.pred = a.id), v_finish_ix)),
      bdone = true
     where not a.bdone
       and not exists (select 1 from _l l join _a s on s.id = l.succ where l.pred = a.id and not s.bdone);
    update _a set ls = lf - dur + 1 where bdone and ls = 0 and lf <> 0;
    select count(*) into v_prev from _a where not bdone;
    exit when v_prev = 0;
    exit when v_prev >= v_left;
    v_left := v_prev;
  end loop;

  -- резервы
  update _a a set
    tf = a.ls - a.es,
    ff = coalesce((select min(case l.type
                                when 'FS' then s.es - (a.ef + 1 + l.lag)
                                when 'SS' then s.es - (a.es + l.lag)
                                when 'FF' then s.ef - (a.ef + l.lag)
                                else s.ef - (a.es + l.lag) end)
                     from _l l join _a s on s.id = l.succ where l.pred = a.id),
                  v_finish_ix - a.ef)
   where true;   -- обязательный WHERE: запросы через API идут с защитой от UPDATE без условия

  -- результат: рабочие работы
  update public.schedule_activities t set
    start_date  = (select d from _wd where ix = a.es),
    finish_date = (select d from _wd where ix = case when a.dur = 0 then a.es else a.ef end),
    late_start  = (select d from _wd where ix = a.ls),
    late_finish = (select d from _wd where ix = case when a.dur = 0 then a.ls else a.lf end),
    total_float = a.tf,
    free_float  = greatest(a.ff, 0),
    is_critical = (a.tf <= 0 and a.actual_finish is null),
    calc_at     = now()
   from _a a where t.id = a.id;

  -- суммарные работы: от самых вложенных к верхним
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
    with recursive tree(id, depth) as (
      select id, 0 from public.schedule_activities where project_id = p_project and deleted_at is null and parent_id is null
      union all
      select c.id, tree.depth + 1 from public.schedule_activities c join tree on c.parent_id = tree.id where c.deleted_at is null)
    select id, depth from tree;
  select coalesce(max(depth), 0) into v_depth from _s;
  for i in reverse v_depth..0 loop
    update public.schedule_activities s set
      start_date  = c.st, finish_date = c.fi, late_start = c.ls, late_finish = c.lf,
      total_float = c.tf, free_float = null, is_critical = c.crit,
      percent_complete = c.pct, calc_at = now()
     from (
       select p.id as pid, min(ch.start_date) as st, max(ch.finish_date) as fi, min(ch.late_start) as ls, max(ch.late_finish) as lf,
              min(ch.total_float) as tf, bool_or(ch.is_critical) as crit,
              round(sum(ch.percent_complete * greatest(ch.duration_days, 1)) / sum(greatest(ch.duration_days, 1)), 2) as pct
         from public.schedule_activities p
         join _s on _s.id = p.id and _s.depth = i
         join public.schedule_activities ch on ch.parent_id = p.id and ch.deleted_at is null
        where p.kind = 'summary'
        group by p.id) c
     where s.id = c.pid;
  end loop;

  select count(*) filter (where is_critical), count(*), max(finish_date) into v_critical, v_total, v_end_date
    from public.schedule_activities where project_id = p_project and deleted_at is null and kind <> 'summary';
  return jsonb_build_object('activities', v_total, 'critical', v_critical, 'finish', v_end_date);
end;
$$;

-- ---------------------------------------------------------------------------
-- Базовый план
-- ---------------------------------------------------------------------------
create or replace function public.create_schedule_baseline(p_project uuid, p_name text, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_n integer;
  v_id uuid;
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'baseline.create') then
    raise exception 'permission denied: baseline.create' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.schedule_activities where project_id = p_project and deleted_at is null and start_date is not null) then
    raise exception 'schedule_not_calculated' using errcode = '22023';
  end if;
  select coalesce(max(number), -1) + 1 into v_n from public.schedule_baselines where project_id = p_project;
  insert into public.schedule_baselines (tenant_id, project_id, number, name, reason)
  values (v_tenant, p_project, v_n, btrim(p_name), nullif(btrim(coalesce(p_reason, '')), '')) returning id into v_id;
  insert into public.schedule_baseline_activities (baseline_id, activity_id, tenant_id, project_id, start_date, finish_date)
    select v_id, a.id, v_tenant, p_project, a.start_date, a.finish_date
      from public.schedule_activities a where a.project_id = p_project and a.deleted_at is null and a.start_date is not null;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Генерация цепочки работ по местам: «Монолит перекрытия» × этажи с лагом (поточное производство)
-- ---------------------------------------------------------------------------
create or replace function public.generate_schedule_by_locations(
  p_project   uuid,
  p_name      text,
  p_locations uuid[],
  p_duration  integer default 5,
  p_lag       integer default 0,
  p_chain     boolean default true,
  p_parent    uuid default null,
  p_discipline uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_group  uuid;
  v_prev   uuid;
  v_new    uuid;
  v_loc    record;
  v_count  integer := 0;
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'schedule.edit') then
    raise exception 'permission denied: schedule.edit' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if coalesce(array_length(p_locations, 1), 0) = 0 then raise exception 'location_required' using errcode = '22023'; end if;
  if array_length(p_locations, 1) > 200 then raise exception 'too_many_locations' using errcode = '22023'; end if;

  insert into public.schedule_activities (tenant_id, project_id, parent_id, kind, name, sort, discipline_id)
  values (v_tenant, p_project, p_parent, 'summary', btrim(p_name), (select coalesce(max(sort), 0) + 10 from public.schedule_activities where project_id = p_project and parent_id is not distinct from p_parent and deleted_at is null), p_discipline)
  returning id into v_group;

  for v_loc in
    select l.id, l.code, l.name from public.locations l
     where l.id = any (p_locations) and l.project_id = p_project and l.deleted_at is null
     order by l.path
  loop
    insert into public.schedule_activities (tenant_id, project_id, parent_id, kind, name, duration_days, location_id, discipline_id, sort)
    values (v_tenant, p_project, v_group, 'task', btrim(p_name) || ' — ' || v_loc.code || ' ' || v_loc.name,
            greatest(coalesce(p_duration, 1), 1), v_loc.id, p_discipline, (v_count + 1) * 10)
    returning id into v_new;
    if p_chain and v_prev is not null then
      insert into public.schedule_links (tenant_id, project_id, predecessor_id, successor_id, type, lag_days)
      values (v_tenant, p_project, v_prev, v_new, 'FS', coalesce(p_lag, 0));
    end if;
    v_prev := v_new;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'recalculate_schedule(uuid)',
    'create_schedule_baseline(uuid,text,text)',
    'generate_schedule_by_locations(uuid,text,uuid[],integer,integer,boolean,uuid,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
