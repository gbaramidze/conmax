-- Прогресс и журнал дня (S8): ввод факта по работам графика и журнал работ на каждую дату.
-- См. docs: 04-modules/09-budget-progress-evm.md (часть A).
-- Методы ввода: manual (% и комментарий), quantity (накопленный объём к плану), zero_hundred (начата / закончена),
-- fifty_fifty (начата 50% / закончена 100%). Запись того, у кого нет progress.approve (мастер), ждёт подтверждения
-- и в расчёт не идёт. Применённый процент = последняя утверждённая запись; факт-даты ставятся автоматически.

alter table public.schedule_activities
  add column progress_method text not null default 'manual' check (progress_method in ('manual','quantity','zero_hundred','fifty_fifty')),
  add column plan_quantity   numeric(14,3) check (plan_quantity is null or plan_quantity > 0),
  add column quantity_unit   text check (quantity_unit is null or length(quantity_unit) <= 20);

create table public.progress_entries (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  activity_id   uuid not null references public.schedule_activities(id) on delete cascade,
  entry_date    date not null,
  method        text not null,
  percent       numeric(5,2) not null check (percent between 0 and 100),
  quantity      numeric(14,3),                 -- накопленный объём (метод quantity)
  note          text check (note is null or length(note) <= 1000),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.users(id),
  decided_at    timestamptz,
  decided_by    uuid references public.users(id),
  decision_note text check (decision_note is null or length(decision_note) <= 1000)
);
create index on public.progress_entries (activity_id, entry_date desc, created_at desc);
create index on public.progress_entries (project_id, status) where status = 'pending';

create table public.daily_logs (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  log_date      date not null,
  weather       text check (weather is null or length(weather) <= 200),
  temperature_c integer check (temperature_c is null or temperature_c between -60 and 60),
  work_stopped  boolean not null default false,
  stop_reason   text check (stop_reason is null or length(stop_reason) <= 500),
  manpower      jsonb not null default '[]' check (jsonb_typeof(manpower) = 'array' and jsonb_array_length(manpower) <= 100),
  equipment     jsonb not null default '[]' check (jsonb_typeof(equipment) = 'array' and jsonb_array_length(equipment) <= 100),
  works         text check (works is null or length(works) <= 4000),
  events        text check (events is null or length(events) <= 4000),
  visitors      text check (visitors is null or length(visitors) <= 2000),
  notes         text check (notes is null or length(notes) <= 4000),
  status        text not null default 'draft' check (status in ('draft','submitted','approved')),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.users(id),
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.users(id),
  unique (project_id, log_date)
);

do $$
declare t text;
begin
  foreach t in array array['progress_entries', 'daily_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'schedule.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Прогресс
-- ---------------------------------------------------------------------------
create or replace function public.set_progress_method(p_activity uuid, p_method text, p_qty numeric default null, p_unit text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  act public.schedule_activities;
begin
  select * into act from public.schedule_activities where id = p_activity and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'activity_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(act.project_id, array['schedule.edit']);
  if p_method not in ('manual', 'quantity', 'zero_hundred', 'fifty_fifty') then raise exception 'bad_method' using errcode = '22023'; end if;
  if p_method = 'quantity' and (p_qty is null or p_qty <= 0) then raise exception 'plan_quantity_required' using errcode = '22023'; end if;
  update public.schedule_activities set progress_method = p_method,
         plan_quantity = case when p_method = 'quantity' then p_qty end,
         quantity_unit = case when p_method = 'quantity' then nullif(btrim(coalesce(p_unit, '')), '') end
   where id = act.id;
end;
$$;

-- Применить к работе последнюю утверждённую запись: процент, фактические даты
create or replace function private.apply_progress(p_activity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e   public.progress_entries;
  act public.schedule_activities;
begin
  select * into act from public.schedule_activities where id = p_activity;
  select * into e from public.progress_entries where activity_id = p_activity and status = 'approved' order by entry_date desc, created_at desc limit 1;
  if not found then return; end if;
  update public.schedule_activities set
    percent_complete = e.percent,
    actual_start = case
      when (e.percent > 0 or e.method in ('zero_hundred', 'fifty_fifty')) then least(coalesce(act.actual_start, e.entry_date), e.entry_date)
      else act.actual_start end,
    actual_finish = case when e.percent >= 100 then e.entry_date else null end
   where id = p_activity;
end;
$$;

create or replace function public.report_progress(p_activity uuid, p_date date, p_value numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  act    public.schedule_activities;
  v_pct  numeric;
  v_qty  numeric;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ok   boolean;
  v_id   uuid;
begin
  select * into act from public.schedule_activities where id = p_activity and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or act.kind = 'summary' then raise exception 'activity_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(act.project_id, array['progress.report', 'progress.approve']);
  if p_date is null or p_date > current_date + 1 then raise exception 'bad_date' using errcode = '22023'; end if;
  if p_value is null then raise exception 'bad_value' using errcode = '22023'; end if;

  case act.progress_method
    when 'manual' then
      if p_value < 0 or p_value > 100 then raise exception 'bad_value' using errcode = '22023'; end if;
      if v_note is null then raise exception 'comment_required' using errcode = '22023'; end if;
      v_pct := round(p_value, 2);
    when 'quantity' then
      if act.plan_quantity is null then raise exception 'plan_quantity_required' using errcode = '22023'; end if;
      if p_value < 0 then raise exception 'bad_value' using errcode = '22023'; end if;
      v_qty := p_value;
      v_pct := least(100, round(p_value / act.plan_quantity * 100, 2));
    when 'zero_hundred' then
      if p_value not in (0, 100) then raise exception 'bad_value' using errcode = '22023'; end if;
      v_pct := p_value;
    when 'fifty_fifty' then
      if p_value not in (0, 50, 100) then raise exception 'bad_value' using errcode = '22023'; end if;
      v_pct := p_value;
  end case;

  -- уменьшение процента — только с комментарием
  if v_pct < act.percent_complete and v_note is null then raise exception 'comment_required' using errcode = '22023'; end if;

  v_ok := private.has_project_permission(act.project_id, 'progress.approve');
  insert into public.progress_entries (tenant_id, project_id, activity_id, entry_date, method, percent, quantity, note, status, decided_at, decided_by, created_by, created_at)
  values (act.tenant_id, act.project_id, act.id, p_date, act.progress_method, v_pct, v_qty, v_note,
          case when v_ok then 'approved' else 'pending' end, case when v_ok then now() end, case when v_ok then auth.uid() end, auth.uid(), clock_timestamp())
  returning id into v_id;

  if v_ok then
    perform private.apply_progress(act.id);
    if private.has_project_permission(act.project_id, 'schedule.edit') then
      begin
        perform public.recalculate_schedule(act.project_id);
      exception when others then
        null;   -- ошибка пересчёта (например, цикл в сети) не должна терять введённый факт
      end;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.decide_progress(p_entry uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.progress_entries;
begin
  select * into e from public.progress_entries where id = p_entry and tenant_id = private.tenant_id();
  if not found then raise exception 'entry_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(e.project_id, array['progress.approve']);
  if e.status <> 'pending' then raise exception 'already_decided' using errcode = '23514'; end if;
  update public.progress_entries set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = e.id;
  if p_approve then
    perform private.apply_progress(e.activity_id);
    if private.has_project_permission(e.project_id, 'schedule.edit') then
      begin
        perform public.recalculate_schedule(e.project_id);
      exception when others then
        null;
      end;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Журнал дня
-- ---------------------------------------------------------------------------
create or replace function public.save_daily_log(p_project uuid, p_date date, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  cur public.daily_logs;
  v_id uuid;
begin
  perform private.week_guard(p_project, array['daily_log.create', 'daily_log.approve']);
  if p_date is null or p_date > current_date + 1 then raise exception 'bad_date' using errcode = '22023'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'bad_rows' using errcode = '22023'; end if;
  select * into cur from public.daily_logs where project_id = p_project and log_date = p_date;
  if found and cur.status <> 'draft' then raise exception 'log_locked' using errcode = '23514'; end if;

  insert into public.daily_logs (tenant_id, project_id, log_date, weather, temperature_c, work_stopped, stop_reason, manpower, equipment, works, events, visitors, notes, created_by)
  values (private.tenant_id(), p_project, p_date,
          nullif(left(btrim(coalesce(p_data ->> 'weather', '')), 200), ''), nullif(p_data ->> 'temperature_c', '')::integer,
          coalesce((p_data ->> 'work_stopped')::boolean, false), nullif(left(btrim(coalesce(p_data ->> 'stop_reason', '')), 500), ''),
          coalesce(p_data -> 'manpower', '[]'), coalesce(p_data -> 'equipment', '[]'),
          nullif(btrim(coalesce(p_data ->> 'works', '')), ''), nullif(btrim(coalesce(p_data ->> 'events', '')), ''),
          nullif(btrim(coalesce(p_data ->> 'visitors', '')), ''), nullif(btrim(coalesce(p_data ->> 'notes', '')), ''), auth.uid())
  on conflict (project_id, log_date) do update set
    weather = excluded.weather, temperature_c = excluded.temperature_c, work_stopped = excluded.work_stopped, stop_reason = excluded.stop_reason,
    manpower = excluded.manpower, equipment = excluded.equipment, works = excluded.works, events = excluded.events,
    visitors = excluded.visitors, notes = excluded.notes, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_daily_log(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.daily_logs;
begin
  select * into l from public.daily_logs where id = p_id and tenant_id = private.tenant_id();
  if not found then raise exception 'log_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(l.project_id, array['daily_log.create', 'daily_log.approve']);
  if l.status <> 'draft' then raise exception 'log_locked' using errcode = '23514'; end if;
  update public.daily_logs set status = 'submitted', submitted_at = now(), updated_at = now() where id = l.id;
end;
$$;

create or replace function public.approve_daily_log(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.daily_logs;
begin
  select * into l from public.daily_logs where id = p_id and tenant_id = private.tenant_id();
  if not found then raise exception 'log_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(l.project_id, array['daily_log.approve']);
  if l.status <> 'submitted' then raise exception 'log_locked' using errcode = '23514'; end if;
  update public.daily_logs set status = 'approved', approved_at = now(), approved_by = auth.uid(), updated_at = now() where id = l.id;
end;
$$;

-- Вернуть в работу (утверждающий): например, если в журнале нашли ошибку
create or replace function public.reopen_daily_log(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.daily_logs;
begin
  select * into l from public.daily_logs where id = p_id and tenant_id = private.tenant_id();
  if not found then raise exception 'log_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(l.project_id, array['daily_log.approve']);
  update public.daily_logs set status = 'draft', submitted_at = null, approved_at = null, approved_by = null, updated_at = now() where id = l.id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_progress_method(uuid,text,numeric,text)', 'report_progress(uuid,date,numeric,text)', 'decide_progress(uuid,boolean,text)',
    'save_daily_log(uuid,date,jsonb)', 'submit_daily_log(uuid)', 'approve_daily_log(uuid)', 'reopen_daily_log(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
