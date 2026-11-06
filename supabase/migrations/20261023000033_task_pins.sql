-- Замечания на плане: булавка задачи на странице плана (PDF или картинка — документ проекта).
-- Координаты — доли страницы (0..1), поэтому не зависят от масштаба. Булавка помнит ревизию плана, на которой поставлена.
-- Создаётся и двигается только через функции: они проверяют права на задачу и доступ к документу.

create table public.task_pins (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id  uuid references public.document_versions(id) on delete set null,
  page        integer not null default 1 check (page >= 1),
  x           numeric(7,6) not null check (x between 0 and 1),
  y           numeric(7,6) not null check (y between 0 and 1),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  updated_at  timestamptz not null default now(),
  unique (task_id, document_id)
);
create index on public.task_pins (project_id, document_id);

alter table public.task_pins enable row level security;
alter table public.task_pins force row level security;
create policy task_pins_select on public.task_pins for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.can_view_entity('task', task_id)
         and private.user_can_view_document((select auth.uid()), document_id));
revoke insert, update, delete on public.task_pins from authenticated;

-- Поставить или передвинуть булавку существующей задачи
create or replace function public.pin_task(p_task uuid, p_document uuid, p_page integer, p_x numeric, p_y numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t    public.tasks;
  d    public.documents;
  v_id uuid;
begin
  select * into t from public.tasks where id = p_task and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.can_view_entity('task', t.id) then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  -- task_editable может вернуть NULL (нет исполнителя и организации): это «нельзя»
  if not coalesce(private.task_editable(t.project_id, t.assignee_id, t.reporter_id, t.organization_id), false) then
    raise exception 'permission denied: task.edit' using errcode = '42501';
  end if;
  select * into d from public.documents where id = p_document and tenant_id = t.tenant_id and project_id = t.project_id and deleted_at is null;
  if not found or not private.user_can_view_document(auth.uid(), d.id) then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if p_x is null or p_y is null or p_x not between 0 and 1 or p_y not between 0 and 1 or coalesce(p_page, 1) < 1 then
    raise exception 'position_invalid' using errcode = '22023';
  end if;

  insert into public.task_pins (tenant_id, project_id, task_id, document_id, version_id, page, x, y, created_by)
  values (t.tenant_id, t.project_id, t.id, d.id, d.current_version_id, coalesce(p_page, 1), p_x, p_y, auth.uid())
  on conflict (task_id, document_id)
  do update set page = excluded.page, x = excluded.x, y = excluded.y, version_id = excluded.version_id, updated_at = now()
  returning id into v_id;

  perform private.record_event(t.tenant_id, t.project_id, 'task', t.id, 'pinned',
                               jsonb_build_object('document', d.title, 'page', coalesce(p_page, 1)), 'internal');
  return v_id;
end;
$$;

create or replace function public.unpin_task(p_task uuid, p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.can_view_entity('task', t.id) then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  -- task_editable может вернуть NULL (нет исполнителя и организации): это «нельзя»
  if not coalesce(private.task_editable(t.project_id, t.assignee_id, t.reporter_id, t.organization_id), false) then
    raise exception 'permission denied: task.edit' using errcode = '42501';
  end if;
  delete from public.task_pins where task_id = p_task and document_id = p_document;
  perform private.record_event(t.tenant_id, t.project_id, 'task', t.id, 'unpinned', '{}', 'internal');
end;
$$;

-- Замечание прямо на плане: создаёт задачу и сразу ставит булавку. Место — этаж, к которому привязан план (если не указано).
create or replace function public.create_task_on_plan(
  p_project     uuid,
  p_document    uuid,
  p_page        integer,
  p_x           numeric,
  p_y           numeric,
  p_title       text,
  p_type        text default 'punch',
  p_assignee    uuid default null,
  p_due_date    date default null,
  p_priority    text default 'normal',
  p_location    uuid default null
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_loc  uuid := p_location;
  v_task public.tasks;
begin
  if not exists (select 1 from public.documents d where d.id = p_document and d.project_id = p_project and d.deleted_at is null)
     or not private.user_can_view_document(auth.uid(), p_document) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_loc is null then
    select dl.entity_id into v_loc from public.document_links dl
      join public.locations l on l.id = dl.entity_id and l.deleted_at is null
     where dl.document_id = p_document and dl.entity_type = 'location' order by dl.created_at limit 1;
  end if;

  v_task := public.create_task(p_project, p_title, coalesce(p_type, 'punch'), p_assignee, p_due_date, coalesce(p_priority, 'normal'),
                               null, null, v_loc, null);
  perform public.pin_task(v_task.id, p_document, p_page, p_x, p_y);
  return v_task;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'pin_task(uuid,uuid,integer,numeric,numeric)',
    'unpin_task(uuid,uuid)',
    'create_task_on_plan(uuid,uuid,integer,numeric,numeric,text,text,uuid,date,text,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
