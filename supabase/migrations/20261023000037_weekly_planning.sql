-- Недельное планирование (лёгкая версия S6): неделя = период, внутри — обязательства (что бригады берутся сделать),
-- по итогам недели — выполнено / не выполнено с причиной, из этого считается PPC (процент выполненных обязательств).
-- См. docs: 04-modules/08-schedule-planning.md (§4).
-- Права: планировать — commitment.create, отмечать результат — commitment.close, начинать и закрывать неделю — commitment.close или period.manage;
-- закрыть неделю с неотмеченными обязательствами может только period.manage. Видят внутренние участники с schedule.view.

insert into public.entity_types (code, module, features) values ('planning_period', 'planning', array['activity']);

create table public.planning_periods (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  starts_on    date not null check (extract(isodow from starts_on) = 1),   -- понедельник
  ends_on      date not null,
  status       text not null default 'planned' check (status in ('planned','active','closed')),
  note         text check (note is null or length(note) <= 2000),
  started_at   timestamptz,
  started_by   uuid references public.users(id),
  closed_at    timestamptz,
  closed_by    uuid references public.users(id),
  force_closed boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users(id),
  unique (project_id, starts_on),
  check (ends_on = starts_on + 6)
);

create table public.period_commitments (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  period_id       uuid not null references public.planning_periods(id) on delete cascade,
  activity_id     uuid references public.schedule_activities(id) on delete set null,
  title           text not null check (length(btrim(title)) between 1 and 300),
  note            text check (note is null or length(note) <= 2000),
  location_id     uuid references public.locations(id),
  organization_id uuid references public.organizations(id),
  responsible_id  uuid references public.users(id),
  was_ready       boolean not null default true,    -- на старте недели не было неснятых предшественников
  added_late      boolean not null default false,   -- добавлено после начала недели (в PPC не входит)
  result          text check (result in ('completed','not_completed')),
  reason          text check (reason in ('design','materials','labor','equipment','weather','predecessor','access',
                                         'client_decision','finance','safety','rework','planning','other','not_specified')),
  reason_note     text check (reason_note is null or length(reason_note) <= 1000),
  resolved_at     timestamptz,
  resolved_by     uuid references public.users(id),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references public.users(id),
  check (result is distinct from 'not_completed' or reason is not null),
  check (result is distinct from 'completed' or reason is null)
);
create index on public.period_commitments (period_id);
create index on public.period_commitments (project_id, organization_id);
create unique index period_commitments_activity_uniq on public.period_commitments (period_id, activity_id) where activity_id is not null;

do $$
declare t text;
begin
  foreach t in array array['planning_periods', 'period_commitments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'schedule.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Функции
-- ---------------------------------------------------------------------------
create or replace function private.week_guard(p_project uuid, p_perms text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_perm text;
begin
  if exists (select 1 from public.projects where id = p_project and tenant_id = private.tenant_id())
     and private.can_see_project(p_project) and private.can_see_internal(p_project) then
    foreach v_perm in array p_perms loop
      if private.has_project_permission(p_project, v_perm) then return; end if;
    end loop;
  end if;
  raise exception 'permission denied: %', p_perms[1] using errcode = '42501';
end;
$$;

-- Готовность работы на старте недели: все предшественники по «окончание → начало» завершены или заканчиваются раньше
create or replace function private.activity_ready(p_activity uuid, p_week_start date) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1
      from public.schedule_links l
      join public.schedule_activities p on p.id = l.predecessor_id
     where l.successor_id = p_activity and l.type = 'FS' and p.deleted_at is null
       and p.percent_complete < 100 and coalesce(p.finish_date, 'infinity'::date) >= p_week_start);
$$;

create or replace function public.create_planning_period(p_project uuid, p_week date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_start date := date_trunc('week', p_week)::date;
  v_id    uuid;
begin
  perform private.week_guard(p_project, array['commitment.create', 'period.manage']);
  begin
    insert into public.planning_periods (tenant_id, project_id, starts_on, ends_on, created_by)
    values (private.tenant_id(), p_project, v_start, v_start + 6, auth.uid()) returning id into v_id;
  exception when unique_violation then
    raise exception 'period_exists' using errcode = '23505';
  end;
  perform private.record_event(private.tenant_id(), p_project, 'planning_period', v_id, 'created',
    jsonb_build_object('starts_on', v_start), 'internal');
  return v_id;
end;
$$;

create or replace function public.add_commitment(
  p_period uuid, p_activity uuid, p_title text, p_note text default null,
  p_location uuid default null, p_org uuid default null, p_responsible uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  per   public.planning_periods;
  act   public.schedule_activities;
  v_id  uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  select * into per from public.planning_periods where id = p_period and tenant_id = private.tenant_id();
  if not found then raise exception 'period_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(per.project_id, array['commitment.create']);
  if per.status = 'closed' then raise exception 'period_closed' using errcode = '23514'; end if;

  if p_activity is not null then
    select * into act from public.schedule_activities
     where id = p_activity and project_id = per.project_id and deleted_at is null;
    if not found or act.kind = 'summary' then raise exception 'activity_not_found' using errcode = 'P0002'; end if;
    v_title := coalesce(v_title, act.name);
    p_location := coalesce(p_location, act.location_id);
    p_org := coalesce(p_org, act.contractor_org_id);
    p_responsible := coalesce(p_responsible, act.responsible_id);
  end if;
  if v_title is null then raise exception 'title_required' using errcode = '22023'; end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and project_id = per.project_id) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if p_org is not null and not exists (select 1 from public.organizations where id = p_org and tenant_id = per.tenant_id) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if p_responsible is not null and not exists (select 1 from public.users where id = p_responsible and tenant_id = per.tenant_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  begin
    insert into public.period_commitments (tenant_id, project_id, period_id, activity_id, title, note, location_id,
                                           organization_id, responsible_id, was_ready, added_late, created_by)
    values (per.tenant_id, per.project_id, per.id, p_activity, v_title, nullif(btrim(coalesce(p_note, '')), ''), p_location,
            p_org, p_responsible, p_activity is null or private.activity_ready(p_activity, per.starts_on),
            per.status = 'active', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_planned' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.update_commitment(
  p_commitment uuid, p_title text, p_note text, p_location uuid, p_org uuid, p_responsible uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c   public.period_commitments;
  per public.planning_periods;
begin
  select * into c from public.period_commitments where id = p_commitment and tenant_id = private.tenant_id();
  if not found then raise exception 'commitment_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(c.project_id, array['commitment.create']);
  select * into per from public.planning_periods where id = c.period_id;
  if per.status = 'closed' then raise exception 'period_closed' using errcode = '23514'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and project_id = c.project_id) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if p_org is not null and not exists (select 1 from public.organizations where id = p_org and tenant_id = c.tenant_id) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if p_responsible is not null and not exists (select 1 from public.users where id = p_responsible and tenant_id = c.tenant_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  update public.period_commitments
     set title = btrim(p_title), note = nullif(btrim(coalesce(p_note, '')), ''),
         location_id = p_location, organization_id = p_org, responsible_id = p_responsible
   where id = c.id;
end;
$$;

-- Убрать обязательство можно, пока неделя не началась; во время недели — только добавленное позже
create or replace function public.delete_commitment(p_commitment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c   public.period_commitments;
  per public.planning_periods;
begin
  select * into c from public.period_commitments where id = p_commitment and tenant_id = private.tenant_id();
  if not found then raise exception 'commitment_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(c.project_id, array['commitment.create']);
  select * into per from public.planning_periods where id = c.period_id;
  if per.status = 'closed' or (per.status = 'active' and not c.added_late) then
    raise exception 'period_started' using errcode = '23514';
  end if;
  delete from public.period_commitments where id = c.id;
end;
$$;

create or replace function public.start_planning_period(p_period uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  per public.planning_periods;
begin
  select * into per from public.planning_periods where id = p_period and tenant_id = private.tenant_id();
  if not found then raise exception 'period_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(per.project_id, array['commitment.close', 'period.manage']);
  if per.status <> 'planned' then raise exception 'period_started' using errcode = '23514'; end if;
  if not exists (select 1 from public.period_commitments where period_id = per.id) then
    raise exception 'no_commitments' using errcode = '23514';
  end if;
  update public.planning_periods set status = 'active', started_at = now(), started_by = auth.uid() where id = per.id;
  perform private.record_event(per.tenant_id, per.project_id, 'planning_period', per.id, 'started',
    jsonb_build_object('starts_on', per.starts_on, 'commitments', (select count(*) from public.period_commitments where period_id = per.id)), 'internal');
end;
$$;

-- Отметить итог по обязательству; p_result = null снимает отметку
create or replace function public.set_commitment_result(
  p_commitment uuid, p_result text, p_reason text default null, p_reason_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c   public.period_commitments;
  per public.planning_periods;
begin
  select * into c from public.period_commitments where id = p_commitment and tenant_id = private.tenant_id();
  if not found then raise exception 'commitment_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(c.project_id, array['commitment.close']);
  select * into per from public.planning_periods where id = c.period_id;
  if per.status <> 'active' then raise exception 'period_not_active' using errcode = '23514'; end if;
  if p_result is not null and p_result not in ('completed', 'not_completed') then
    raise exception 'bad_result' using errcode = '22023';
  end if;
  if p_result = 'not_completed' and (p_reason is null or p_reason = 'not_specified') then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update public.period_commitments
     set result = p_result,
         reason = case when p_result = 'not_completed' then p_reason end,
         reason_note = case when p_result = 'not_completed' then nullif(btrim(coalesce(p_reason_note, '')), '') end,
         resolved_at = case when p_result is null then null else now() end,
         resolved_by = case when p_result is null then null else auth.uid() end
   where id = c.id;
end;
$$;

-- Закрыть неделю. Неотмеченное — ошибка; period.manage может закрыть принудительно (причина «не указана»)
create or replace function public.close_planning_period(p_period uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  per       public.planning_periods;
  v_open    integer;
  v_total   integer;
  v_done    integer;
begin
  select * into per from public.planning_periods where id = p_period and tenant_id = private.tenant_id();
  if not found then raise exception 'period_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(per.project_id, array['commitment.close', 'period.manage']);
  if per.status <> 'active' then raise exception 'period_not_active' using errcode = '23514'; end if;

  select count(*) into v_open from public.period_commitments where period_id = per.id and result is null;
  if v_open > 0 then
    if not p_force then raise exception 'unresolved_commitments' using errcode = '23514'; end if;
    if not private.has_project_permission(per.project_id, 'period.manage') then
      raise exception 'permission denied: period.manage' using errcode = '42501';
    end if;
    update public.period_commitments
       set result = 'not_completed', reason = 'not_specified', resolved_at = now(), resolved_by = auth.uid()
     where period_id = per.id and result is null;
  end if;

  update public.planning_periods set status = 'closed', closed_at = now(), closed_by = auth.uid(), force_closed = v_open > 0 where id = per.id;
  select count(*) filter (where not added_late), count(*) filter (where not added_late and result = 'completed')
    into v_total, v_done from public.period_commitments where period_id = per.id;
  perform private.record_event(per.tenant_id, per.project_id, 'planning_period', per.id, 'closed',
    jsonb_build_object('starts_on', per.starts_on, 'total', v_total, 'completed', v_done, 'forced', v_open > 0), 'internal');
  return jsonb_build_object('total', v_total, 'completed', v_done, 'forced', v_open);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_planning_period(uuid,date)', 'add_commitment(uuid,uuid,text,text,uuid,uuid,uuid)',
    'update_commitment(uuid,text,text,uuid,uuid,uuid)', 'delete_commitment(uuid)', 'start_planning_period(uuid)',
    'set_commitment_result(uuid,text,text,text)', 'close_planning_period(uuid,boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
