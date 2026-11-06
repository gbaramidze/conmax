-- S3.5 · Направления проекта (дерево + руководитель), подзадачи, генератор помещений, заметки к местам.
-- См. docs: 04-modules/26-field-work.md, ADR-013.

-- ---------------------------------------------------------------------------
-- 1. Направления: шаблон компании → копия в каждом проекте
-- ---------------------------------------------------------------------------
alter table public.disciplines
  add column project_id   uuid references public.projects(id) on delete cascade,   -- null = шаблон компании
  add column parent_id    uuid references public.disciplines(id),
  add column lead_user_id uuid references public.users(id),
  add column template_id  uuid references public.disciplines(id),
  add column sort         integer not null default 0;

alter table public.disciplines drop constraint disciplines_tenant_id_code_key;
create unique index disciplines_template_code on public.disciplines (tenant_id, code)
  where project_id is null and deleted_at is null;
create unique index disciplines_project_code on public.disciplines
  (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), code)
  where project_id is not null and deleted_at is null;
create index on public.disciplines (tenant_id, project_id);
create index on public.disciplines (parent_id);

-- Руководители направления и всех его предков (по цепочке parent_id вверх)
create or replace function private.discipline_leads(p_discipline uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select id, parent_id, lead_user_id, 1 as depth from public.disciplines where id = p_discipline
    union all
    select d.id, d.parent_id, d.lead_user_id, up.depth + 1
      from public.disciplines d join up on d.id = up.parent_id where up.depth < 8
  )
  select distinct lead_user_id from up where lead_user_id is not null;
$$;

create or replace function private.disciplines_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.disciplines;
begin
  if tg_op = 'INSERT' then
    -- клиентская вставка: тенант из JWT; серверная (шаблоны, копирование) задаёт его явно
    new.tenant_id := coalesce(private.tenant_id(), new.tenant_id);
  end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.tenant_id = new.tenant_id) then
    raise exception 'project not found' using errcode = '23503';
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.disciplines where id = new.parent_id;
    if not found or v_parent.tenant_id <> new.tenant_id or v_parent.project_id is distinct from new.project_id
       or v_parent.deleted_at is not null then
      raise exception 'parent discipline must belong to the same project' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and (new.parent_id = new.id or exists (
      -- цикл: новый родитель — потомок самого узла
      with recursive down as (
        select id from public.disciplines where parent_id = new.id
        union all select d.id from public.disciplines d join down on d.parent_id = down.id)
      select 1 from down where id = new.parent_id)) then
      raise exception 'discipline cycle' using errcode = '23514';
    end if;
  end if;

  if new.lead_user_id is not null then
    if new.project_id is not null then
      if not private.user_is_project_member(new.lead_user_id, new.project_id) then
        raise exception 'lead must be a project member' using errcode = '23514';
      end if;
    elsif not exists (select 1 from public.users u where u.id = new.lead_user_id and u.tenant_id = new.tenant_id) then
      raise exception 'lead must belong to the company' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger disciplines_before_write before insert or update on public.disciplines
  for each row execute function private.disciplines_before_write();

drop policy disciplines_select on public.disciplines;
drop policy disciplines_write on public.disciplines;
create policy disciplines_select on public.disciplines for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (project_id is null or private.can_see_project(project_id)));
create policy disciplines_insert on public.disciplines for insert to authenticated
  with check (
    (project_id is null and (select private.has_tenant_permission('admin.reference_data')))
    or (project_id is not null and private.has_project_permission(project_id, 'project.settings.manage'))
  );
create policy disciplines_update on public.disciplines for update to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and ((project_id is null and (select private.has_tenant_permission('admin.reference_data')))
         or (project_id is not null and private.has_project_permission(project_id, 'project.settings.manage')))
  )
  with check (tenant_id = (select private.tenant_id()));

revoke insert, update, delete on public.disciplines from authenticated;
grant insert (project_id, parent_id, code, name, color, lead_user_id, sort) on public.disciplines to authenticated;
grant update (name, color, parent_id, lead_user_id, sort, deleted_at) on public.disciplines to authenticated;

-- Новый проект получает копию справочника направлений компании
create or replace function private.copy_disciplines_to_project(p_project uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.disciplines (tenant_id, project_id, code, name, color, template_id, sort)
  select p.tenant_id, p_project, d.code, d.name, d.color, d.id,
         (row_number() over (order by d.code))::integer
    from public.disciplines d
    join public.projects p on p.id = p_project
   where d.tenant_id = p.tenant_id and d.project_id is null and d.deleted_at is null
  on conflict do nothing;
$$;

create or replace function private.projects_copy_disciplines() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.copy_disciplines_to_project(new.id);
  return new;
end;
$$;
create trigger projects_copy_disciplines after insert on public.projects
  for each row execute function private.projects_copy_disciplines();

-- Существующие проекты: копируем направления и переносим задачи/участников на копии проекта
do $$
declare p record;
begin
  for p in select id from public.projects loop
    perform private.copy_disciplines_to_project(p.id);
  end loop;

  alter table public.tasks disable trigger user;     -- массовая миграция не должна порождать события и уведомления
  update public.tasks t set discipline_id = d.id
    from public.disciplines d
   where d.template_id = t.discipline_id and d.project_id = t.project_id;
  alter table public.tasks enable trigger user;

  update public.project_members pm set discipline_id = d.id
    from public.disciplines d
   where d.template_id = pm.discipline_id and d.project_id = pm.project_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Реестр: места (location) получают комментарии, фото и ленту
-- ---------------------------------------------------------------------------
insert into public.entity_types (code, module, features) values
  ('location', 'projects', array['comments','attachments','activity']);

alter table public.watchers drop constraint watchers_reason_check;
alter table public.watchers add constraint watchers_reason_check
  check (reason in ('creator','assignee','mention','participant','manual','discipline_lead'));

create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'     then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
    when 'location' then (select project_id from public.locations where id = p_id and tenant_id = private.tenant_id())
  end;
$$;

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id)
    when 'task'     then (select project_id from public.tasks where id = p_id)
    when 'location' then (select project_id from public.locations where id = p_id)
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
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Задачи: проверки направления (того же проекта) и родителя (без циклов)
-- ---------------------------------------------------------------------------
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
     and not exists (select 1 from public.disciplines d
                      where d.id = new.discipline_id and d.project_id = old.project_id and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
  end if;
  if new.parent_id is distinct from old.parent_id and new.parent_id is not null then
    if new.parent_id = old.id or not exists (
      select 1 from public.tasks p where p.id = new.parent_id and p.project_id = old.project_id and p.deleted_at is null) then
      raise exception 'invalid parent task' using errcode = '23503';
    end if;
    if exists (
      with recursive down as (
        select id from public.tasks where parent_id = old.id
        union all select t.id from public.tasks t join down on t.parent_id = down.id)
      select 1 from down where id = new.parent_id) then
      raise exception 'task cycle' using errcode = '23514';
    end if;
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

-- ---------------------------------------------------------------------------
-- 4. Уведомления: руководители направления следят за задачами своего направления
-- ---------------------------------------------------------------------------
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor   text := (select full_name from public.users where id = auth.uid());
  v_who     text;
  w         record;
  l         uuid;
  v_from    text;
  v_to      text;
  v_text    text;
begin
  v_who := coalesce(' (' || v_actor || ')', '');

  if tg_op = 'INSERT' then
    perform private.add_watcher('task', new.id, new.reporter_id, 'creator');
    if new.assignee_id is not null then
      perform private.add_watcher('task', new.id, new.assignee_id, 'assignee');
      perform private.notify(new.assignee_id, 'task', new.id, 'assigned', 'high', 'assigned', 'Вас назначили исполнителем' || v_who);
    end if;
    if new.discipline_id is not null then
      for l in select private.discipline_leads(new.discipline_id) loop
        perform private.add_watcher('task', new.id, l, 'discipline_lead');
      end loop;
    end if;
    return new;
  end if;

  if new.discipline_id is distinct from old.discipline_id and new.discipline_id is not null then
    for l in select private.discipline_leads(new.discipline_id) loop
      perform private.add_watcher('task', new.id, l, 'discipline_lead');
    end loop;
  end if;

  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform private.add_watcher('task', new.id, new.assignee_id, 'assignee');
    perform private.notify(new.assignee_id, 'task', new.id, 'assigned', 'high', 'assigned', 'Вас назначили исполнителем' || v_who);
  end if;

  if new.status_id is distinct from old.status_id then
    select name into v_from from public.workflow_statuses where id = old.status_id;
    select name into v_to   from public.workflow_statuses where id = new.status_id;
    v_text := 'Статус: ' || v_from || ' → ' || v_to || v_who;
    if new.status_category = 'review' then
      perform private.notify(new.reporter_id, 'task', new.id, 'assigned', 'high', 'status_changed', v_text);
    end if;
    for w in select user_id from public.watchers
              where entity_type = 'task' and entity_id = new.id and not muted loop
      if new.status_category = 'blocked' then
        perform private.notify(w.user_id, 'task', new.id, 'watching', 'high', 'status_changed',
                               v_text || coalesce(' — ' || (select name from public.reason_codes
                                                            where tenant_id = new.tenant_id and code = new.blocked_reason_code), ''));
      elsif new.status_category <> 'review' or w.user_id <> new.reporter_id then
        perform private.notify(w.user_id, 'task', new.id, 'watching', 'normal', 'status_changed', v_text);
      end if;
    end loop;
  end if;

  if new.due_date is distinct from old.due_date then
    v_text := 'Срок: ' || coalesce(old.due_date::text, '—') || ' → ' || coalesce(new.due_date::text, '—') || v_who;
    perform private.notify(new.assignee_id, 'task', new.id, 'watching', 'normal', 'due_changed', v_text);
    for w in select user_id from public.watchers
              where entity_type = 'task' and entity_id = new.id and not muted and user_id is distinct from new.assignee_id loop
      perform private.notify(w.user_id, 'task', new.id, 'watching', 'normal', 'due_changed', v_text);
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. create_task: направление проекта, родитель (подзадача) с наследованием полей
-- ---------------------------------------------------------------------------
drop function if exists public.create_task(uuid, text, text, uuid, date, text, uuid, uuid, uuid);

create or replace function public.create_task(
  p_project      uuid,
  p_title        text,
  p_type         text default 'task',
  p_assignee     uuid default null,
  p_due_date     date default null,
  p_priority     text default 'normal',
  p_organization uuid default null,
  p_discipline   uuid default null,
  p_location     uuid default null,
  p_parent       uuid default null
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid := private.tenant_id();
  v_project    public.projects;
  v_parent     public.tasks;
  v_prefix     text;
  v_workflow   uuid;
  v_status     public.workflow_statuses;
  v_number     integer;
  v_org        uuid := p_organization;
  v_discipline uuid := p_discipline;
  v_location   uuid := p_location;
  v_visibility text := 'internal';
  v_task       public.tasks;
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

  -- Подзадача: родитель из того же проекта и доступный пользователю; пустые поля наследуются
  if p_parent is not null then
    select * into v_parent from public.tasks
     where id = p_parent and tenant_id = v_tenant and project_id = p_project and deleted_at is null;
    if not found or not private.task_visible(v_parent.project_id, v_parent.assignee_id, v_parent.reporter_id,
                                             v_parent.organization_id, v_parent.visibility) then
      raise exception 'invalid parent task' using errcode = '23503';
    end if;
    v_discipline := coalesce(v_discipline, v_parent.discipline_id);
    v_location   := coalesce(v_location, v_parent.location_id);
    v_org        := coalesce(v_org, v_parent.organization_id);
    v_visibility := v_parent.visibility;
  end if;

  if v_discipline is not null and not exists (
    select 1 from public.disciplines d where d.id = v_discipline and d.project_id = p_project and d.deleted_at is null) then
    raise exception 'discipline does not belong to this project' using errcode = '23514';
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
    v_org := coalesce(p_organization, (select organization_id from public.users where id = p_assignee), v_org);
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
    priority, reporter_id, assignee_id, organization_id, due_date, discipline_id, location_id,
    parent_id, visibility, created_by
  ) values (
    v_tenant, p_project, v_number, v_project.code || '-' || v_prefix || '-' || v_number, p_type, btrim(p_title),
    v_workflow, v_status.id, v_status.category, p_priority, v_uid, p_assignee, v_org, p_due_date, v_discipline,
    v_location, p_parent, v_visibility, v_uid
  ) returning * into v_task;

  return v_task;
end;
$$;

revoke execute on function public.create_task from public, anon;
grant  execute on function public.create_task to authenticated;

-- ---------------------------------------------------------------------------
-- 6. transition_task: родителя нельзя закрыть при открытых подзадачах
-- ---------------------------------------------------------------------------
create or replace function public.transition_task(
  p_task        uuid,
  p_to_status   uuid,
  p_reason_code text default null,
  p_comment     text default null
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid := private.tenant_id();
  t         public.tasks;
  s_to      public.workflow_statuses;
  tr        public.workflow_transitions;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_uid is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into t from public.tasks where id = p_task and tenant_id = v_tenant and deleted_at is null for update;
  if not found or not private.task_visible(t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility) then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if not (
    private.has_project_permission(t.project_id, 'task.transition.any')
    or (private.has_project_permission(t.project_id, 'task.transition.own')
        and (t.assignee_id = v_uid or t.reporter_id = v_uid
             or (t.organization_id is not null and t.organization_id = private.my_org_id())))
  ) then
    raise exception 'permission denied: task.transition' using errcode = '42501';
  end if;

  select * into s_to from public.workflow_statuses where id = p_to_status and workflow_id = t.workflow_id;
  select * into tr from public.workflow_transitions
   where workflow_id = t.workflow_id and to_status_id = p_to_status
     and (from_status_id = t.status_id or from_status_id is null)
   order by (from_status_id is null) limit 1;
  if s_to.id is null or tr.id is null then
    raise exception 'transition_not_allowed' using errcode = '22023';
  end if;

  if tr.required_permission is not null and not private.has_project_permission(t.project_id, tr.required_permission) then
    raise exception 'permission denied: %', tr.required_permission using errcode = '42501';
  end if;

  if tr.requires_reason then
    if p_reason_code is null or not exists (
      select 1 from public.reason_codes rc where rc.tenant_id = v_tenant and rc.code = p_reason_code and rc.is_active
    ) then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    if p_reason_code = 'other' and v_comment is null then
      raise exception 'comment_required' using errcode = '22023';
    end if;
  end if;
  if tr.requires_comment and v_comment is null then
    raise exception 'comment_required' using errcode = '22023';
  end if;

  if s_to.category = 'done' and exists (
    select 1 from public.tasks c
     where c.parent_id = t.id and c.deleted_at is null and c.status_category not in ('done', 'cancelled')
  ) then
    raise exception 'subtasks_open' using errcode = '22023';
  end if;

  update public.tasks set
    status_id           = s_to.id,
    status_category     = s_to.category,
    blocked_reason_code = case when s_to.category in ('blocked','cancelled') then p_reason_code end,
    blocked_comment     = case when s_to.category in ('blocked','cancelled') then v_comment end,
    actual_start        = case when s_to.category = 'in_progress' then coalesce(actual_start, now()) else actual_start end,
    completed_at        = case when s_to.category = 'done' then now() else null end,
    closed_at           = case when s_to.category in ('done','cancelled') then now() else null end
  where id = t.id
  returning * into t;

  if v_comment is not null then
    insert into public.comments (entity_type, entity_id, body, visibility)
    values ('task', t.id,
            jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
              jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', v_comment))))),
            case when private.can_see_internal(t.project_id)
                  and private.has_project_permission(t.project_id, 'comment.internal.create')
                 then 'internal' else 'external' end);
  end if;

  return t;
end;
$$;

revoke execute on function public.transition_task from public, anon;
grant  execute on function public.transition_task to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Генератор помещений: N помещений на каждом этаже поддерева
--    схема 'floor'      — по этажам: 501, 502 …, на подвале RB101 …
--    схема 'sequential' — сквозная нумерация 1…N по всему поддереву
-- ---------------------------------------------------------------------------
create or replace function public.generate_rooms(
  p_project   uuid,
  p_parent    uuid,
  p_per_floor integer,
  p_scheme    text default 'floor'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_parent  public.locations;
  f         record;
  v_floors  integer;
  v_seq     integer := 0;
  v_created integer := 0;
  v_rows    integer;
  v_num     integer;
  v_code    text;
  i         integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, 'location.manage') then
    raise exception 'permission denied: location.manage' using errcode = '42501';
  end if;
  if p_scheme not in ('floor', 'sequential') or p_per_floor < 1 or p_per_floor > 200 then
    raise exception 'invalid generator parameters' using errcode = '22023';
  end if;

  select * into v_parent from public.locations
   where id = p_parent and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'parent location not found' using errcode = '23503';
  end if;

  select count(*) into v_floors from public.locations l
   where l.project_id = p_project and l.deleted_at is null and l.kind = 'floor'
     and (l.id = p_parent or l.path::text like v_parent.path::text || '.%');
  if v_floors = 0 then
    raise exception 'no floors under this location' using errcode = '22023';
  end if;
  if v_floors * p_per_floor > 5000 then
    raise exception 'too many rooms' using errcode = '22023';
  end if;

  for f in
    select l.id, l.sort from public.locations l
     where l.project_id = p_project and l.deleted_at is null and l.kind = 'floor'
       and (l.id = p_parent or l.path::text like v_parent.path::text || '.%')
     order by l.sort, l.path
  loop
    for i in 1 .. p_per_floor loop
      if p_scheme = 'sequential' then
        v_seq := v_seq + 1;
        v_code := 'R' || v_seq;
      else
        v_num := abs(f.sort) * (case when p_per_floor >= 100 then 1000 else 100 end) + i;
        v_code := 'R' || case when f.sort < 0 then 'B' else '' end || v_num;
      end if;
      insert into public.locations (project_id, parent_id, kind, code, name, sort)
      values (p_project, f.id, 'room', v_code, 'Помещение ' || substr(v_code, 2), i)
      on conflict (project_id, path) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.generate_rooms from public, anon;
grant  execute on function public.generate_rooms to authenticated;
