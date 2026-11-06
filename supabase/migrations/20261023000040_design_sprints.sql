-- Спринты проектирования (S6): двух-трёхнедельные циклы по задачам проектирования (задачи с направлением).
-- Бэклог — задачи проекта с направлением вне открытых спринтов; в спринт берутся по приоритету «нужно до».
-- Закрытие: выполненные фиксируются, невыполненные получают причину и переносятся в следующий спринт или в бэклог.
-- См. docs: 04-modules/08-schedule-planning.md (§4 «Спринт»). Права как у недельного плана:
-- планировать — commitment.create; начинать и закрывать — commitment.close или period.manage.

create table public.design_sprints (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 120),
  goal          text check (goal is null or length(goal) <= 1000),
  starts_on     date not null,
  ends_on       date not null,
  discipline_id uuid references public.disciplines(id),    -- null — все направления
  status        text not null default 'planned' check (status in ('planned','active','closed')),
  started_at    timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.users(id),
  check (ends_on >= starts_on and ends_on - starts_on <= 41)
);
create index on public.design_sprints (project_id, starts_on desc);

create table public.sprint_tasks (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  sprint_id   uuid not null references public.design_sprints(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  added_late  boolean not null default false,     -- добавлено после старта (в процент выполнения не входит)
  result      text check (result in ('completed','not_completed')),
  reason      text check (reason in ('design','materials','labor','equipment','weather','predecessor','access',
                                     'client_decision','finance','safety','rework','planning','other','not_specified')),
  reason_note text check (reason_note is null or length(reason_note) <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  unique (sprint_id, task_id),
  check (result is distinct from 'not_completed' or reason is not null)
);
create index on public.sprint_tasks (task_id);
create index on public.sprint_tasks (project_id);

do $$
declare t text;
begin
  foreach t in array array['design_sprints', 'sprint_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'schedule.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.create_sprint(
  p_project uuid, p_name text, p_starts date, p_ends date, p_discipline uuid default null, p_goal text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.week_guard(p_project, array['commitment.create', 'period.manage']);
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if p_starts is null or p_ends is null or p_ends < p_starts or p_ends - p_starts > 41 then
    raise exception 'bad_dates' using errcode = '22023';
  end if;
  if p_discipline is not null and not exists (select 1 from public.disciplines where id = p_discipline and project_id = p_project and deleted_at is null) then
    raise exception 'discipline_not_found' using errcode = 'P0002';
  end if;
  insert into public.design_sprints (tenant_id, project_id, name, goal, starts_on, ends_on, discipline_id, created_by)
  values (private.tenant_id(), p_project, btrim(p_name), nullif(btrim(coalesce(p_goal, '')), ''), p_starts, p_ends, p_discipline, auth.uid())
  returning id into v_id;
  perform private.record_event(private.tenant_id(), p_project, 'planning_period', v_id, 'created',
    jsonb_build_object('sprint', btrim(p_name), 'starts_on', p_starts), 'internal');
  return v_id;
end;
$$;

-- Добавить задачи в спринт; возвращает, сколько добавлено (занятые другим открытым спринтом и закрытые пропускаются)
create or replace function public.add_sprint_tasks(p_sprint uuid, p_tasks uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sp public.design_sprints;
  v_count integer;
begin
  select * into sp from public.design_sprints where id = p_sprint and tenant_id = private.tenant_id();
  if not found then raise exception 'sprint_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(sp.project_id, array['commitment.create']);
  if sp.status = 'closed' then raise exception 'sprint_closed' using errcode = '23514'; end if;
  if coalesce(array_length(p_tasks, 1), 0) > 200 then raise exception 'too_many_tasks' using errcode = '22023'; end if;
  insert into public.sprint_tasks (tenant_id, project_id, sprint_id, task_id, added_late, created_by)
  select sp.tenant_id, sp.project_id, sp.id, t.id, sp.status = 'active', auth.uid()
    from public.tasks t
   where t.id = any (p_tasks) and t.project_id = sp.project_id and t.deleted_at is null
     and t.status_category not in ('done', 'cancelled')
     and not exists (select 1 from public.sprint_tasks st join public.design_sprints s on s.id = st.sprint_id
                      where st.task_id = t.id and s.status <> 'closed')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.remove_sprint_task(p_sprint uuid, p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sp public.design_sprints;
  st public.sprint_tasks;
begin
  select * into sp from public.design_sprints where id = p_sprint and tenant_id = private.tenant_id();
  if not found then raise exception 'sprint_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(sp.project_id, array['commitment.create']);
  select * into st from public.sprint_tasks where sprint_id = sp.id and task_id = p_task;
  if not found then return; end if;
  if sp.status = 'closed' or (sp.status = 'active' and not st.added_late) then
    raise exception 'sprint_started' using errcode = '23514';
  end if;
  delete from public.sprint_tasks where id = st.id;
end;
$$;

create or replace function public.start_sprint(p_sprint uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sp public.design_sprints;
begin
  select * into sp from public.design_sprints where id = p_sprint and tenant_id = private.tenant_id();
  if not found then raise exception 'sprint_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(sp.project_id, array['commitment.close', 'period.manage']);
  if sp.status <> 'planned' then raise exception 'sprint_started' using errcode = '23514'; end if;
  if not exists (select 1 from public.sprint_tasks where sprint_id = sp.id) then raise exception 'no_tasks' using errcode = '23514'; end if;
  update public.design_sprints set status = 'active', started_at = now() where id = sp.id;
  perform private.record_event(sp.tenant_id, sp.project_id, 'planning_period', sp.id, 'started',
    jsonb_build_object('sprint', sp.name, 'tasks', (select count(*) from public.sprint_tasks where sprint_id = sp.id)), 'internal');
end;
$$;

-- Закрыть спринт. p_reasons — {"<id задачи>": "<причина>"} для невыполненных; без причины закрыть нельзя
-- (период.manage с p_force закрывает с причиной «не указана»). p_carry_to — спринт, в который переносятся невыполненные.
create or replace function public.close_sprint(p_sprint uuid, p_carry_to uuid default null, p_reasons jsonb default '{}', p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sp      public.design_sprints;
  nxt     public.design_sprints;
  r       record;
  v_reason text;
  v_total integer;
  v_done  integer;
  v_carry integer := 0;
begin
  select * into sp from public.design_sprints where id = p_sprint and tenant_id = private.tenant_id();
  if not found then raise exception 'sprint_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(sp.project_id, array['commitment.close', 'period.manage']);
  if sp.status <> 'active' then raise exception 'sprint_not_active' using errcode = '23514'; end if;
  if p_force and not private.has_project_permission(sp.project_id, 'period.manage') then
    raise exception 'permission denied: period.manage' using errcode = '42501';
  end if;
  if p_carry_to is not null then
    select * into nxt from public.design_sprints where id = p_carry_to and project_id = sp.project_id and status <> 'closed' and id <> sp.id;
    if not found then raise exception 'sprint_not_found' using errcode = 'P0002'; end if;
  end if;

  -- отменённые задачи в спринте не учитываются
  delete from public.sprint_tasks st using public.tasks t
   where st.sprint_id = sp.id and st.task_id = t.id and t.status_category = 'cancelled';

  -- у каждой невыполненной должна быть причина
  for r in
    select st.id, st.task_id, t.status_category from public.sprint_tasks st join public.tasks t on t.id = st.task_id
     where st.sprint_id = sp.id and t.status_category <> 'done'
  loop
    v_reason := p_reasons ->> r.task_id::text;
    if v_reason is null or v_reason = 'not_specified' then
      if not p_force then raise exception 'reasons_required' using errcode = '23514'; end if;
      v_reason := 'not_specified';
    end if;
    update public.sprint_tasks set result = 'not_completed', reason = v_reason where id = r.id;
    if nxt.id is not null then
      insert into public.sprint_tasks (tenant_id, project_id, sprint_id, task_id, added_late, created_by)
      values (sp.tenant_id, sp.project_id, nxt.id, r.task_id, nxt.status = 'active', auth.uid())
      on conflict do nothing;
      v_carry := v_carry + 1;
    end if;
  end loop;
  update public.sprint_tasks st set result = 'completed'
    from public.tasks t where st.sprint_id = sp.id and t.id = st.task_id and t.status_category = 'done';

  update public.design_sprints set status = 'closed', closed_at = now() where id = sp.id;
  select count(*) filter (where not added_late), count(*) filter (where not added_late and result = 'completed')
    into v_total, v_done from public.sprint_tasks where sprint_id = sp.id;
  perform private.record_event(sp.tenant_id, sp.project_id, 'planning_period', sp.id, 'closed',
    jsonb_build_object('sprint', sp.name, 'total', v_total, 'completed', v_done, 'carried', v_carry), 'internal');
  return jsonb_build_object('total', v_total, 'completed', v_done, 'carried', v_carry);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_sprint(uuid,text,date,date,uuid,text)', 'add_sprint_tasks(uuid,uuid[])', 'remove_sprint_task(uuid,uuid)',
    'start_sprint(uuid)', 'close_sprint(uuid,uuid,jsonb,boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
