-- S2 · Задачи: справочник причин, workflow со статусами-категориями, задачи, ключи (ZK7-T-125), переходы с guard-ами.
-- См. docs: 04-modules/04-tasks.md, ADR-005/006/007.

-- ---------------------------------------------------------------------------
-- Справочник причин (ADR-007)
-- ---------------------------------------------------------------------------
create table public.reason_codes (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  created_at timestamptz not null default now(),
  code       text not null,
  name       text not null,
  category   text not null check (category in ('internal','subcontractor','client','external')),
  applies_to text[] not null default '{blocked,non_completion,constraint,delay}',
  is_active  boolean not null default true,
  unique (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- Workflow (ADR-006): статусы настраиваются, категории фиксированы
-- ---------------------------------------------------------------------------
create table public.workflows (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  created_at  timestamptz not null default now(),
  entity_type text not null,                 -- 'task'
  subtype     text,                          -- тип задачи; null = для всех
  name        text not null,
  is_default  boolean not null default false
);

create table public.workflow_statuses (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  code        text not null,
  name        text not null,
  category    text not null check (category in ('backlog','todo','in_progress','blocked','review','done','cancelled')),
  color       text,
  sort        integer not null,
  unique (workflow_id, code)
);

create table public.workflow_transitions (
  id                  uuid primary key default public.uuidv7(),
  tenant_id           uuid not null references public.tenants(id),
  workflow_id         uuid not null references public.workflows(id) on delete cascade,
  from_status_id      uuid references public.workflow_statuses(id) on delete cascade,  -- null = из любого
  to_status_id        uuid not null references public.workflow_statuses(id) on delete cascade,
  name                text,
  required_permission text,
  requires_reason     boolean not null default false,
  requires_comment    boolean not null default false
);
create index on public.workflow_transitions (workflow_id, from_status_id);

-- Счётчики номеров (ключ проекта + тип)
create table public.project_counters (
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null,
  last_number integer not null default 0,
  primary key (project_id, kind)
);
alter table public.project_counters enable row level security;   -- политик нет: только через create_task()

-- ---------------------------------------------------------------------------
-- Задачи
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                  uuid primary key default public.uuidv7(),
  tenant_id           uuid not null references public.tenants(id),
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  version             integer not null default 1,
  deleted_at          timestamptz,
  project_id          uuid not null references public.projects(id) on delete cascade,
  number              integer not null,
  key                 text not null,
  type                text not null check (type in ('task','punch','rfi','action_item','issue','constraint')),
  title               text not null check (length(btrim(title)) between 1 and 300),
  description         jsonb,
  workflow_id         uuid not null references public.workflows(id),
  status_id           uuid not null references public.workflow_statuses(id),
  status_category     text not null,
  priority            text not null default 'normal' check (priority in ('low','normal','high','critical')),
  reporter_id         uuid not null references public.users(id),
  assignee_id         uuid references public.users(id),
  organization_id     uuid references public.organizations(id),      -- ответственная организация
  visibility          text not null default 'internal' check (visibility in ('internal','external')),
  planned_start       date,
  due_date            date,
  need_by_date        date,
  actual_start        timestamptz,
  completed_at        timestamptz,
  closed_at           timestamptz,
  estimate_hours      numeric(9,2),
  spent_hours         numeric(9,2),
  discipline_id       uuid references public.disciplines(id),
  parent_id           uuid references public.tasks(id),
  source_type         text,
  source_id           uuid,
  blocked_reason_code text,
  blocked_comment     text,
  tags                text[] not null default '{}',
  custom              jsonb not null default '{}',
  unique (project_id, type, number),
  unique (tenant_id, key),
  foreign key (tenant_id, blocked_reason_code) references public.reason_codes (tenant_id, code)
);
create index on public.tasks (tenant_id, project_id, status_category, due_date);
create index on public.tasks (tenant_id, assignee_id, status_category);
create index on public.tasks (tenant_id, organization_id);
create index on public.tasks using gin (tags);
create index on public.tasks using gin (title extensions.gin_trgm_ops);

insert into public.entity_types (code, module, features) values
  ('task', 'tasks', array['comments','attachments','activity']);

create trigger touch before update on public.tasks for each row execute function private.touch();

-- ---------------------------------------------------------------------------
-- Видимость и права
-- ---------------------------------------------------------------------------
create or replace function private.my_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select organization_id from public.users where id = auth.uid();
$$;

-- Внутренние видят все задачи проекта; внешние — свои (исполнитель/автор/их организация) и расшаренные
create or replace function private.task_visible(
  p_project uuid, p_assignee uuid, p_reporter uuid, p_org uuid, p_visibility text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_see_project(p_project)
     and private.has_project_permission(p_project, 'task.view')
     and (
       private.has_project_permission(p_project, 'task.view.internal')
       or p_assignee = auth.uid()
       or p_reporter = auth.uid()
       or (p_org is not null and p_org = private.my_org_id())
       or p_visibility = 'external'
     );
$$;

create or replace function private.task_editable(
  p_project uuid, p_assignee uuid, p_reporter uuid, p_org uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_project_permission(p_project, 'task.edit.any')
      or (
        private.has_project_permission(p_project, 'task.edit.own')
        and (p_assignee = auth.uid() or p_reporter = auth.uid() or (p_org is not null and p_org = private.my_org_id()))
      );
$$;

-- Общая проверка доступа к сущности (ядро: комментарии, вложения, события)
create or replace function private.can_view_entity(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then private.can_see_project(p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id and t.tenant_id = private.tenant_id()
        and private.task_visible(t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    else false
  end;
$$;

create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'    then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
  end;
$$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['reason_codes','workflows','workflow_statuses','workflow_transitions','tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy reason_codes_select on public.reason_codes for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy reason_codes_write on public.reason_codes for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.reference_data')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.reference_data')));

create policy workflows_select on public.workflows for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy workflows_write on public.workflows for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.workflows')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.workflows')));
create policy workflow_statuses_select on public.workflow_statuses for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy workflow_statuses_write on public.workflow_statuses for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.workflows')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.workflows')));
create policy workflow_transitions_select on public.workflow_transitions for select to authenticated
  using (tenant_id = (select private.tenant_id()));
create policy workflow_transitions_write on public.workflow_transitions for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.workflows')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.workflows')));

create policy tasks_select on public.tasks for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.task_visible(project_id, assignee_id, reporter_id, organization_id, visibility)
  );
create policy tasks_update on public.tasks for update to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.task_visible(project_id, assignee_id, reporter_id, organization_id, visibility)
    and private.task_editable(project_id, assignee_id, reporter_id, organization_id)
  )
  with check (tenant_id = (select private.tenant_id()));
-- INSERT/DELETE политик нет: создание — create_task(), удаление — мягкое (deleted_at)

-- Статус и служебные поля меняются только через transition_task()
revoke insert, update on public.tasks from authenticated;
grant update (title, description, priority, assignee_id, organization_id, visibility, planned_start, due_date,
              need_by_date, estimate_hours, spent_hours, discipline_id, parent_id, tags, custom, deleted_at)
  on public.tasks to authenticated;

-- Чувствительные правки внутри UPDATE: назначение, видимость, удаление
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
create trigger tasks_before_update before update on public.tasks
  for each row execute function private.tasks_before_update();

-- Задачи в realtime
alter publication supabase_realtime add table public.tasks;

-- ---------------------------------------------------------------------------
-- Ядро: доступ к комментариям, вложениям и событиям теперь учитывает доступ к самой сущности
-- ---------------------------------------------------------------------------
drop policy comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.can_view_entity(entity_type, entity_id)
    and (visibility = 'external' or private.can_see_internal(project_id))
  );

drop policy comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (
    private.can_view_entity(entity_type, entity_id)
    and case visibility
          when 'internal' then private.has_project_permission(project_id, 'comment.internal.create')
          else private.has_project_permission(project_id, 'comment.create')
        end
  );

drop policy attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and private.can_view_entity(entity_type, entity_id)
    and (
      (comment_id is null and (select private.can_see_internal(project_id)))
      or exists (select 1 from public.comments c where c.id = attachments.comment_id)
    )
  );

drop policy attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    private.can_view_entity(entity_type, entity_id)
    and private.has_project_permission(project_id, 'comment.create')
    and (comment_id is null or exists (select 1 from public.comments c where c.id = comment_id and c.author_id = (select auth.uid())))
  );

drop policy entity_events_select on public.entity_events;
create policy entity_events_select on public.entity_events for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and project_id is not null
    and private.can_view_entity(entity_type, entity_id)
    and (visibility = 'external' or private.can_see_internal(project_id))
  );

-- ---------------------------------------------------------------------------
-- Журнал событий задач
-- ---------------------------------------------------------------------------
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
                       'closed_at','actual_start','blocked_reason_code','blocked_comment');
  if v_changes <> '{}' then
    perform private.record_event(new.tenant_id, new.project_id, 'task', new.id, 'field_changed', v_changes,
      case when v_changes ? 'assignee_id' then 'external' else 'internal' end);
  end if;
  return new;
end;
$$;
create trigger tasks_audit after insert or update on public.tasks
  for each row execute function private.tasks_audit();

-- ---------------------------------------------------------------------------
-- Создание задачи: ключ ZK7-T-125, начальный статус, проверка исполнителя
-- ---------------------------------------------------------------------------
create or replace function public.create_task(
  p_project      uuid,
  p_title        text,
  p_type         text default 'task',
  p_assignee     uuid default null,
  p_due_date     date default null,
  p_priority     text default 'normal',
  p_organization uuid default null
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

  -- Внешний исполнитель создаёт задачи только для своей организации
  if private.is_external() then
    v_org := private.my_org_id();
  end if;

  -- workflow: сначала свой для типа, иначе общий по умолчанию
  select id into v_workflow from public.workflows
   where tenant_id = v_tenant and entity_type = 'task' and (subtype = p_type or (subtype is null and is_default))
   order by (subtype is null) limit 1;
  select * into v_status from public.workflow_statuses
   where workflow_id = v_workflow order by sort limit 1;
  if v_status.id is null then
    raise exception 'workflow is not configured' using errcode = '22023';
  end if;

  -- Атомарный счётчик: параллельные запросы получают разные номера
  insert into public.project_counters as pc (project_id, kind, last_number)
  values (p_project, v_prefix, 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;

  insert into public.tasks (
    tenant_id, project_id, number, key, type, title, workflow_id, status_id, status_category,
    priority, reporter_id, assignee_id, organization_id, due_date, created_by
  ) values (
    v_tenant, p_project, v_number, v_project.code || '-' || v_prefix || '-' || v_number, p_type, btrim(p_title),
    v_workflow, v_status.id, v_status.category, p_priority, v_uid, p_assignee, v_org, p_due_date, v_uid
  ) returning * into v_task;

  return v_task;
end;
$$;

revoke execute on function public.create_task from public, anon;
grant  execute on function public.create_task to authenticated;

-- ---------------------------------------------------------------------------
-- Переход статуса с guard-ами: права, причина, комментарий
-- Ошибки: message = машинный код (transition_not_allowed, reason_required, comment_required)
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

  -- Комментарий к переходу попадает в обсуждение задачи
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
-- Справочные данные тенанта: причины и стандартный workflow (идемпотентно)
-- ---------------------------------------------------------------------------
create or replace function private.seed_tenant_workflow(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wf uuid;
  s    jsonb := '{}';
  r    record;
  v_id uuid;
begin
  insert into public.reason_codes (tenant_id, code, name, category) values
    (p_tenant, 'design',          'Проектная документация',     'internal'),
    (p_tenant, 'rfi',             'Ожидание ответа на RFI',     'client'),
    (p_tenant, 'materials',       'Материалы',                  'subcontractor'),
    (p_tenant, 'labor',           'Рабочая сила',               'subcontractor'),
    (p_tenant, 'equipment',       'Техника и оборудование',     'subcontractor'),
    (p_tenant, 'predecessor',     'Предшествующая работа',      'internal'),
    (p_tenant, 'weather',         'Погода',                     'external'),
    (p_tenant, 'client_decision', 'Решение заказчика',          'client'),
    (p_tenant, 'approvals',       'Согласования и разрешения',  'external'),
    (p_tenant, 'access',          'Фронт работ и доступ',       'internal'),
    (p_tenant, 'safety',          'Охрана труда',               'internal'),
    (p_tenant, 'finance',         'Финансирование',             'client'),
    (p_tenant, 'quality_rework',  'Переделка по качеству',      'subcontractor'),
    (p_tenant, 'other',           'Другое (нужен комментарий)', 'internal')
  on conflict (tenant_id, code) do nothing;

  if exists (select 1 from public.workflows where tenant_id = p_tenant and entity_type = 'task' and is_default) then
    return;
  end if;

  insert into public.workflows (tenant_id, entity_type, name, is_default)
  values (p_tenant, 'task', 'Стандартный', true) returning id into v_wf;

  for r in select * from (values
    ('new',         'Новая',         'todo',        1),
    ('planned',     'Запланирована', 'todo',        2),
    ('in_progress', 'В работе',      'in_progress', 3),
    ('blocked',     'Заблокирована', 'blocked',     4),
    ('review',      'На проверке',   'review',      5),
    ('done',        'Выполнена',     'done',        6),
    ('cancelled',   'Отменена',      'cancelled',   7)
  ) as x(code, name, category, sort) loop
    insert into public.workflow_statuses (tenant_id, workflow_id, code, name, category, sort)
    values (p_tenant, v_wf, r.code, r.name, r.category, r.sort) returning id into v_id;
    s := s || jsonb_build_object(r.code, v_id);
  end loop;

  -- (из, в, название, нужно право, нужна причина, нужен комментарий)
  for r in select * from (values
    ('new',         'planned',     'Запланировать',  null,                 false, false),
    ('new',         'in_progress', 'Начать',         null,                 false, false),
    ('planned',     'in_progress', 'Начать',         null,                 false, false),
    ('in_progress', 'blocked',     'Заблокировать',  null,                 true,  false),
    ('blocked',     'in_progress', 'Разблокировать', null,                 false, false),
    ('in_progress', 'review',      'На проверку',    null,                 false, false),
    ('review',      'in_progress', 'Вернуть в работу', null,               false, true),
    ('review',      'done',        'Принять',        'task.transition.any', false, false),
    ('in_progress', 'done',        'Выполнено',      null,                 false, false),
    ('done',        'in_progress', 'Переоткрыть',    null,                 false, false),
    ('new',         'cancelled',   'Отменить',       null,                 true,  false),
    ('planned',     'cancelled',   'Отменить',       null,                 true,  false),
    ('in_progress', 'cancelled',   'Отменить',       null,                 true,  false),
    ('blocked',     'cancelled',   'Отменить',       null,                 true,  false)
  ) as x(from_code, to_code, name, perm, reason, comment) loop
    insert into public.workflow_transitions
      (tenant_id, workflow_id, from_status_id, to_status_id, name, required_permission, requires_reason, requires_comment)
    values (p_tenant, v_wf, (s ->> r.from_code)::uuid, (s ->> r.to_code)::uuid, r.name, r.perm, r.reason, r.comment);
  end loop;
end;
$$;

create or replace function private.tenants_seed_workflow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_tenant_workflow(new.id);
  return new;
end;
$$;
create trigger tenants_seed_workflow after insert on public.tenants
  for each row execute function private.tenants_seed_workflow();

-- Уже существующие тенанты
do $$
declare t uuid;
begin
  for t in select id from public.tenants loop
    perform private.seed_tenant_workflow(t);
  end loop;
end $$;
