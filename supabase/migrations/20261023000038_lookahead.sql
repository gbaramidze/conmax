-- Look-ahead (S6): ограничения работ графика и отметка «готовность проверена».
-- Ограничение — обычная задача типа `constraint` (ключ C-n, ответственный, срок, статусы, обсуждение), которую
-- связка `activity_constraints` привязывает к работе графика и к виду проверки (проект, RFI, материалы, люди…).
-- Готовность работы: есть неснятые ограничения — «constrained»; нет и проверена — «ready»; иначе «unknown».
-- Ограничение «предшественник просрочен» система показывает сама (по графику), в базе оно не хранится.
-- См. docs: 04-modules/08-schedule-planning.md (§3).

create table public.activity_constraints (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  activity_id uuid not null references public.schedule_activities(id) on delete cascade,
  task_id     uuid not null unique references public.tasks(id) on delete cascade,
  kind        text not null check (kind in ('design','rfi','materials','labor','equipment','predecessor','approvals',
                                            'access','client_decision','finance','safety')),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id)
);
create index on public.activity_constraints (project_id, activity_id);

-- Отметка «проверил готовность» (какая работа просмотрена на look-ahead)
create table public.activity_readiness_checks (
  activity_id uuid primary key references public.schedule_activities(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  checked_by  uuid default auth.uid() references public.users(id)
);
create index on public.activity_readiness_checks (project_id);

do $$
declare t text;
begin
  foreach t in array array['activity_constraints', 'activity_readiness_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'schedule.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Создать ограничение: задача типа constraint + связка с работой. Срок по умолчанию — за неделю до старта работы.
create or replace function public.create_constraint(
  p_activity uuid, p_kind text, p_title text, p_assignee uuid default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  act    public.schedule_activities;
  v_due  date;
  v_task public.tasks;
begin
  select * into act from public.schedule_activities where id = p_activity and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'activity_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(act.project_id, array['schedule.view']);
  if not private.has_project_permission(act.project_id, 'task.create') then
    raise exception 'permission denied: task.create' using errcode = '42501';
  end if;
  if act.kind = 'summary' then raise exception 'activity_not_found' using errcode = 'P0002'; end if;
  if p_kind is null or p_kind not in ('design','rfi','materials','labor','equipment','predecessor','approvals','access',
                                      'client_decision','finance','safety') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;

  v_due := coalesce(p_due, greatest(current_date, coalesce(act.start_date, current_date + 7) - 7));
  v_task := public.create_task(act.project_id, p_title, 'constraint', p_assignee, v_due,
                               case when act.is_critical then 'high' else 'normal' end, null);
  insert into public.activity_constraints (tenant_id, project_id, activity_id, task_id, kind, created_by)
  values (act.tenant_id, act.project_id, act.id, v_task.id, p_kind, auth.uid());
  -- новое неснятое ограничение отменяет прежнюю отметку «проверено»
  delete from public.activity_readiness_checks where activity_id = act.id;
  return v_task.id;
end;
$$;

-- Отметить, что готовность работы проверена (или снять отметку)
create or replace function public.set_activity_checked(p_activity uuid, p_checked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  act public.schedule_activities;
begin
  select * into act from public.schedule_activities where id = p_activity and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'activity_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(act.project_id, array['schedule.edit', 'commitment.create']);
  if p_checked then
    insert into public.activity_readiness_checks (activity_id, tenant_id, project_id, checked_at, checked_by)
    values (act.id, act.tenant_id, act.project_id, now(), auth.uid())
    on conflict (activity_id) do update set checked_at = now(), checked_by = auth.uid();
  else
    delete from public.activity_readiness_checks where activity_id = act.id;
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['create_constraint(uuid,text,text,uuid,date)', 'set_activity_checked(uuid,boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
