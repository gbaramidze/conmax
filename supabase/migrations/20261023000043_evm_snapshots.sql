-- EVM и снимки (S8): плановая (PV) и освоенная (EV) стоимость по работам с бюджетом, факт (AC), индексы, прогнозы,
-- Earned Schedule. Неизменяемые снимки на статусную дату (раз в неделю автоматически и вручную).
-- См. docs: 04-modules/09-budget-progress-evm.md (часть C), 02-methodology/03-progress-cost-control.md §4.
--
-- Объём расчёта — работы графика, которым закреплена доля бюджета (activity_budgets). Плановый процент на дату — линейно по
-- календарным дням между датами работы в последнем базовом плане (у работ без базового плана — по текущим датам).
-- EV = доля бюджета × фактический процент (подтверждённый). AC = факт затрат по статьям, к которым привязаны работы, на дату.

create table public.snapshots (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  status_date date not null,
  kind        text not null default 'manual' check (kind in ('weekly','manual')),
  note        text check (note is null or length(note) <= 1000),
  metrics     jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id)
);
create index on public.snapshots (project_id, status_date desc);
alter table public.snapshots enable row level security;
alter table public.snapshots force row level security;
create policy snapshots_select on public.snapshots for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and private.has_project_permission(project_id, 'budget.view'));
revoke insert, update, delete on public.snapshots from authenticated;

-- Плановая стоимость по датам: набор точек (день, PV) с шагом p_step дней
create or replace function private.evm_series_core(p_project uuid, p_from date, p_to date, p_step integer) returns table (day date, pv numeric)
language sql stable security definer set search_path = '' as $$
  with base as (select id from public.schedule_baselines where project_id = p_project order by number desc limit 1),
  acts as (
    select ab.amount,
           coalesce(bsa.start_date, a.start_date) as s,
           coalesce(bsa.finish_date, a.finish_date) as f
      from public.activity_budgets ab
      join public.schedule_activities a on a.id = ab.activity_id and a.deleted_at is null
      left join public.schedule_baseline_activities bsa on bsa.activity_id = a.id and bsa.baseline_id = (select id from base)
     where ab.project_id = p_project)
  select g::date as day,
         coalesce(sum(case when acts.s is null or acts.f is null or g::date < acts.s then 0
                           when g::date >= acts.f then acts.amount
                           else acts.amount * ((g::date - acts.s + 1)::numeric / (acts.f - acts.s + 1)) end), 0)::numeric(16,2) as pv
    from generate_series(p_from, p_to, make_interval(days => greatest(p_step, 1))) g
    left join acts on true
   group by g
   order by g;
$$;

create or replace function public.evm_series(p_project uuid, p_from date, p_to date, p_step integer default 7) returns table (day date, pv numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.week_guard(p_project, array['budget.view']);
  if p_to < p_from or p_to - p_from > 1500 then raise exception 'bad_dates' using errcode = '22023'; end if;
  return query select * from private.evm_series_core(p_project, p_from, p_to, p_step);
end;
$$;

-- Все показатели на дату одним документом
create or replace function private.evm_core(p_project uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_base   uuid;
  v_bac    numeric := 0;
  v_pv     numeric := 0;
  v_ev     numeric := 0;
  v_ac     numeric := 0;
  v_start  date;
  v_end    date;
  v_pd     integer;
  v_at     integer;
  v_es     numeric;
  v_prev_pv numeric := 0;
  v_prev_ix integer := 0;
  r        record;
  v_spi    numeric;
  v_cpi    numeric;
  v_spit   numeric;
  v_eac1 numeric; v_eac2 numeric; v_eac3 numeric; v_tcpi numeric;
  v_total_bac numeric;
  v_by_item jsonb;
  v_lag jsonb;
  v_ppc numeric;
  v_dur numeric;
begin
  select id into v_base from public.schedule_baselines where project_id = p_project order by number desc limit 1;

  create temp table if not exists _evm_acts (activity_id uuid, item_id uuid, name text, amount numeric, s date, f date, pct numeric) on commit drop;
  truncate _evm_acts;
  insert into _evm_acts
    select ab.activity_id, ab.item_id, a.name, ab.amount, coalesce(bsa.start_date, a.start_date), coalesce(bsa.finish_date, a.finish_date), a.percent_complete
      from public.activity_budgets ab
      join public.schedule_activities a on a.id = ab.activity_id and a.deleted_at is null
      left join public.schedule_baseline_activities bsa on bsa.activity_id = a.id and bsa.baseline_id = v_base
     where ab.project_id = p_project and ab.amount > 0;

  select coalesce(sum(amount), 0),
         coalesce(sum(case when s is null or f is null or p_date < s then 0 when p_date >= f then amount else amount * ((p_date - s + 1)::numeric / (f - s + 1)) end), 0),
         coalesce(sum(amount * pct / 100), 0),
         min(s), max(f)
    into v_bac, v_pv, v_ev, v_start, v_end from _evm_acts;

  select coalesce(sum(a.amount), 0) into v_ac from public.budget_actuals a
   where a.project_id = p_project and a.deleted_at is null and a.doc_date <= p_date and a.item_id in (select item_id from _evm_acts);

  -- Earned Schedule: момент, когда плановая стоимость достигала нынешнего освоенного объёма
  if v_start is not null and v_end is not null and v_bac > 0 then
    v_pd := v_end - v_start + 1;
    v_at := greatest(least(p_date, v_end) - v_start + 1, 0);
    if v_ev >= v_bac then
      v_es := v_pd;
    elsif v_ev <= 0 then
      v_es := 0;
    else
      for r in select day, pv from private.evm_series_core(p_project, v_start, v_end, 1) order by day loop
        if r.pv >= v_ev then
          v_es := (v_prev_ix) + case when r.pv > v_prev_pv then (v_ev - v_prev_pv) / (r.pv - v_prev_pv) else 0 end;
          exit;
        end if;
        v_prev_pv := r.pv;
        v_prev_ix := r.day - v_start + 1;
      end loop;
    end if;
  end if;

  v_spi := case when v_pv > 0 then v_ev / v_pv end;
  v_cpi := case when v_ac > 0 then v_ev / v_ac end;
  v_spit := case when v_es is not null and coalesce(v_at, 0) > 0 then v_es / v_at end;
  v_eac1 := case when v_cpi > 0 then v_bac / v_cpi end;
  v_eac2 := case when v_bac > 0 then v_ac + (v_bac - v_ev) end;
  v_eac3 := case when v_cpi > 0 and v_spi > 0 then v_ac + (v_bac - v_ev) / (v_cpi * v_spi) end;
  v_tcpi := case when v_bac - v_ac <> 0 then (v_bac - v_ev) / (v_bac - v_ac) end;
  v_dur := case when v_spit > 0 and v_pd is not null then v_pd / v_spit end;

  select coalesce(sum(amount), 0) into v_total_bac from public.budget_amounts
   where version_id = (select id from public.budget_versions where project_id = p_project and status in ('approved', 'draft') order by (status = 'approved') desc, number desc limit 1);

  select coalesce(jsonb_agg(x order by x.code), '[]') into v_by_item from (
    select i.code, i.name, e.item_id,
           round(sum(e.amount), 2) as bac,
           round(sum(case when e.s is null or e.f is null or p_date < e.s then 0 when p_date >= e.f then e.amount else e.amount * ((p_date - e.s + 1)::numeric / (e.f - e.s + 1)) end), 2) as pv,
           round(sum(e.amount * e.pct / 100), 2) as ev,
           (select coalesce(sum(a.amount), 0) from public.budget_actuals a where a.item_id = e.item_id and a.deleted_at is null and a.doc_date <= p_date) as ac
      from _evm_acts e join public.cbs_items i on i.id = e.item_id group by i.code, i.name, e.item_id) x;

  select coalesce(jsonb_agg(l), '[]') into v_lag from (
    select e.activity_id as id, e.name, round(e.amount, 2) as bac, e.pct as percent,
           round(case when e.s is null or e.f is null or p_date < e.s then 0 when p_date >= e.f then 100 else 100 * ((p_date - e.s + 1)::numeric / (e.f - e.s + 1)) end, 1) as planned_percent,
           round(case when e.s is null or e.f is null or p_date < e.s then 0 when p_date >= e.f then e.amount else e.amount * ((p_date - e.s + 1)::numeric / (e.f - e.s + 1)) end - e.amount * e.pct / 100, 2) as gap
      from _evm_acts e
     order by (case when e.s is null or e.f is null or p_date < e.s then 0 when p_date >= e.f then e.amount else e.amount * ((p_date - e.s + 1)::numeric / (e.f - e.s + 1)) end - e.amount * e.pct / 100) desc
     limit 5) l;

  -- PPC за последние четыре закрытые недели
  select case when count(*) filter (where not c.added_late) > 0
              then round(100.0 * count(*) filter (where not c.added_late and c.result = 'completed') / count(*) filter (where not c.added_late), 0) end
    into v_ppc
    from public.period_commitments c
   where c.period_id in (select id from public.planning_periods where project_id = p_project and status = 'closed' order by starts_on desc limit 4);

  return jsonb_build_object(
    'date', p_date, 'bac', round(v_bac, 2), 'pv', round(v_pv, 2), 'ev', round(v_ev, 2), 'ac', round(v_ac, 2),
    'sv', round(v_ev - v_pv, 2), 'cv', round(v_ev - v_ac, 2),
    'spi', round(v_spi, 4), 'cpi', round(v_cpi, 4), 'spit', round(v_spit, 4),
    'eac1', round(v_eac1, 2), 'eac2', round(v_eac2, 2), 'eac3', round(v_eac3, 2), 'tcpi', round(v_tcpi, 4),
    'vac', round(v_bac - coalesce(v_eac1, v_bac), 2),
    'start', v_start, 'finish', v_end, 'planned_days', v_pd, 'elapsed_days', v_at, 'es_days', round(v_es, 2),
    'forecast_days', round(v_dur, 1), 'forecast_finish', case when v_dur is not null then v_start + ceil(v_dur)::integer - 1 end,
    'coverage', case when v_total_bac > 0 then round(v_bac / v_total_bac, 4) end, 'total_budget', round(v_total_bac, 2),
    'works', (select count(*) from _evm_acts),
    'baseline', v_base is not null,
    'by_item', v_by_item, 'lagging', v_lag, 'ppc4', v_ppc,
    'open_tasks', (select count(*) from public.tasks where project_id = p_project and deleted_at is null and status_category not in ('done', 'cancelled')),
    'overdue_tasks', (select count(*) from public.tasks where project_id = p_project and deleted_at is null and status_category not in ('done', 'cancelled') and due_date < p_date),
    'open_constraints', (select count(*) from public.activity_constraints ac join public.tasks t on t.id = ac.task_id where ac.project_id = p_project and t.deleted_at is null and t.status_category not in ('done', 'cancelled')),
    'pending_progress', (select count(*) from public.progress_entries where project_id = p_project and status = 'pending'));
end;
$$;

create or replace function public.evm_calc(p_project uuid, p_date date default current_date) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.week_guard(p_project, array['budget.view']);
  return private.evm_core(p_project, p_date);
end;
$$;

create or replace function public.create_snapshot(p_project uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_metrics jsonb;
begin
  perform private.week_guard(p_project, array['snapshot.create']);
  v_metrics := private.evm_core(p_project, current_date);
  insert into public.snapshots (tenant_id, project_id, status_date, kind, note, metrics, created_by)
  values (private.tenant_id(), p_project, current_date, 'manual', nullif(btrim(coalesce(p_note, '')), ''), v_metrics, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

-- Еженедельный снимок по расписанию: по всем действующим проектам, где есть работы с бюджетом
create or replace function private.weekly_snapshots() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  n integer := 0;
begin
  for p in
    select pr.id, pr.tenant_id from public.projects pr
     where pr.deleted_at is null and pr.status = 'active' and exists (select 1 from public.activity_budgets ab where ab.project_id = pr.id)
       and not exists (select 1 from public.snapshots s where s.project_id = pr.id and s.status_date >= date_trunc('week', current_date)::date)
  loop
    insert into public.snapshots (tenant_id, project_id, status_date, kind, metrics) values (p.tenant_id, p.id, current_date, 'weekly', private.evm_core(p.id, current_date));
    n := n + 1;
  end loop;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['evm_series(uuid,date,date,integer)', 'evm_calc(uuid,date)', 'create_snapshot(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Пятница, 14:00 UTC; если расширения pg_cron нет (например, в тестовой среде) — просто пропускаем
do $$
begin
  perform cron.schedule('buildos-weekly-snapshots', '0 14 * * 5', 'select private.weekly_snapshots()');
exception when others then
  raise notice 'pg_cron недоступен, расписание снимков не создано: %', sqlerrm;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
