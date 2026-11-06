-- S2 · Классификация задач: дисциплина при создании, сортируемые ранги, проверки принадлежности тенанту.

-- Ранги для сортировки на сервере (priority/status — не по алфавиту, а по смыслу)
alter table public.tasks
  add column priority_rank smallint generated always as (
    case priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end) stored,
  add column status_rank smallint generated always as (
    case status_category
      when 'blocked' then 0 when 'in_progress' then 1 when 'review' then 2
      when 'todo' then 3 when 'backlog' then 4 when 'done' then 5 else 6 end) stored;

create index on public.tasks (tenant_id, project_id, discipline_id);
create index on public.tasks (tenant_id, project_id, due_date);

-- Генерируемые ранги не должны попадать в ленту как «изменения полей»
create or replace function private.tasks_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_changes jsonb;
  v_from text;
  v_to   text;
begin
  if tg_op = 'INSERT' then
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'created',
                                 jsonb_build_object('key', new.key, 'title', new.title), 'external');
    return new;
  end if;

  if new.status_id is distinct from old.status_id then
    select name into v_from from public.workflow_statuses where id = old.status_id;
    select name into v_to   from public.workflow_statuses where id = new.status_id;
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'status_changed',
      jsonb_strip_nulls(jsonb_build_object(
        'status', jsonb_build_array(v_from, v_to),
        'reason_code', new.blocked_reason_code)), 'external');
  end if;

  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}') into v_changes
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value
     and n.key not in ('updated_at','updated_by','version','status_id','status_category','completed_at',
                       'closed_at','actual_start','blocked_reason_code','blocked_comment',
                       'priority_rank','status_rank');
  if v_changes <> '{}' then
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'field_changed', v_changes,
      case when v_changes ? 'assignee_id' then 'external' else 'internal' end);
  end if;
  return new;
end;
$$;

-- Ссылки на организацию и дисциплину обязаны принадлежать тому же тенанту (FK это не гарантирует)
create or replace function private.tasks_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is distinct from old.assignee_id then
    if not private.has_project_permission(old.project_id, 'task.assign') then
      raise exception 'permission denied: task.assign' using errcode = '42501';
    end if;
    if new.assignee_id is not null and not exists (
      select 1 from public.project_members pm
      where pm.project_id = old.project_id and pm.user_id = new.assignee_id and pm.deleted_at is null
        and (pm.left_at is null or pm.left_at > current_date)
    ) then
      raise exception 'assignee is not a project member' using errcode = '23514';
    end if;
  end if;
  if new.organization_id is distinct from old.organization_id and new.organization_id is not null
     and not exists (select 1 from public.organizations o where o.id = new.organization_id and o.tenant_id = old.tenant_id) then
    raise exception 'organization belongs to another tenant' using errcode = '23514';
  end if;
  if new.discipline_id is distinct from old.discipline_id and new.discipline_id is not null
     and not exists (select 1 from public.disciplines d where d.id = new.discipline_id and d.tenant_id = old.tenant_id) then
    raise exception 'discipline belongs to another tenant' using errcode = '23514';
  end if;
  if new.visibility is distinct from old.visibility
     and not private.has_project_permission(old.project_id, 'task.edit.any') then
    raise exception 'permission denied: share task' using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at
     and not private.has_project_permission(old.project_id, 'task.delete') then
    raise exception 'permission denied: task.delete' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- create_task: добавляем дисциплину (прежняя сигнатура удаляется)
drop function if exists public.create_task(uuid, text, text, uuid, date, text, uuid);

create or replace function public.create_task(
  p_project      uuid,
  p_title        text,
  p_type         text default 'task',
  p_assignee     uuid default null,
  p_due_date     date default null,
  p_priority     text default 'normal',
  p_organization uuid default null,
  p_discipline   uuid default null
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_tenant   uuid := private.tenant_id();
  v_project  public.projects;
  v_prefix   text;
  v_workflow uuid;
  v_status   public.workflow_statuses;
  v_number   integer;
  v_org      uuid := p_organization;
  v_task     public.tasks;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if not found or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'task.create') then
    raise exception 'permission denied: task.create' using errcode = '42501';
  end if;

  v_prefix := case p_type
    when 'task' then 'T' when 'punch' then 'P' when 'rfi' then 'RFI'
    when 'action_item' then 'A' when 'issue' then 'I' when 'constraint' then 'C'
  end;
  if v_prefix is null then
    raise exception 'unknown task type' using errcode = '22023';
  end if;

  if p_discipline is not null and not exists (
    select 1 from public.disciplines d where d.id = p_discipline and d.tenant_id = v_tenant) then
    raise exception 'discipline belongs to another tenant' using errcode = '23514';
  end if;
  if v_org is not null and not exists (
    select 1 from public.organizations o where o.id = v_org and o.tenant_id = v_tenant) then
    raise exception 'organization belongs to another tenant' using errcode = '23514';
  end if;

  if p_assignee is not null then
    if not private.has_project_permission(p_project, 'task.assign') then
      raise exception 'permission denied: task.assign' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project and pm.user_id = p_assignee and pm.deleted_at is null
        and (pm.left_at is null or pm.left_at > current_date)
    ) then
      raise exception 'assignee is not a project member' using errcode = '23514';
    end if;
    v_org := coalesce(v_org, (select organization_id from public.users where id = p_assignee));
  end if;

  if private.is_external() then
    v_org := private.my_org_id();
  end if;

  select id into v_workflow from public.workflows
   where tenant_id = v_tenant and entity_type = 'task' and (subtype = p_type or (subtype is null and is_default))
   order by (subtype is null) limit 1;
  select * into v_status from public.workflow_statuses
   where workflow_id = v_workflow order by sort limit 1;
  if v_status.id is null then
    raise exception 'workflow is not configured' using errcode = '22023';
  end if;

  insert into public.project_counters as pc (project_id, kind, last_number)
  values (p_project, v_prefix, 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;

  insert into public.tasks (
    tenant_id, project_id, number, key, type, title, workflow_id, status_id, status_category,
    priority, reporter_id, assignee_id, organization_id, due_date, discipline_id, created_by
  ) values (
    v_tenant, p_project, v_number, v_project.code || '-' || v_prefix || '-' || v_number, p_type, btrim(p_title),
    v_workflow, v_status.id, v_status.category, p_priority, v_uid, p_assignee, v_org, p_due_date, p_discipline, v_uid
  ) returning * into v_task;

  return v_task;
end;
$$;

revoke execute on function public.create_task from public, anon;
grant  execute on function public.create_task to authenticated;

-- Цвета дисциплин по умолчанию (для бейджей и группировки)
update public.disciplines set color = case code
  when 'AR' then 'sky' when 'KR' then 'amber' when 'OV' then 'teal'
  when 'VK' then 'blue' when 'EOM' then 'orange' when 'SS' then 'violet' end
where color is null;
