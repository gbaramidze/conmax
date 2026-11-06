-- S2 · Карточка задачи: чек-листы, удаление вложений.
-- Описание (tasks.description, jsonb Tiptap) и сроки/оценка уже были в схеме.

-- ---------------------------------------------------------------------------
-- Может ли пользователь менять сущность (для чек-листов и вложений)
-- ---------------------------------------------------------------------------
create or replace function private.can_edit_entity(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'task' then exists (
      select 1 from public.tasks t
       where t.id = p_id
         and private.task_visible(t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility)
         and private.task_editable(t.project_id, t.assignee_id, t.reporter_id, t.organization_id))
    else false
  end;
$$;

update public.entity_types set features = array_append(features, 'checklists')
 where code = 'task' and not ('checklists' = any (features));

-- ---------------------------------------------------------------------------
-- Чек-листы: список пунктов с отметками; у сущности может быть несколько
-- ---------------------------------------------------------------------------
create table public.checklists (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  entity_type text not null references public.entity_types(code),
  entity_id   uuid not null,
  title       text not null check (length(btrim(title)) between 1 and 200),
  sort        integer not null default 0
);
create index on public.checklists (tenant_id, entity_type, entity_id);

create table public.checklist_items (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  created_at   timestamptz not null default now(),
  text         text not null check (length(btrim(text)) between 1 and 500),
  done         boolean not null default false,
  done_by      uuid references public.users(id),
  done_at      timestamptz,
  sort         integer not null default 0
);
create index on public.checklist_items (checklist_id, sort);

create or replace function private.checklists_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id  := private.tenant_id();
  new.created_by := auth.uid();
  new.project_id := private.entity_project_id(new.entity_type, new.entity_id);
  if new.project_id is null then raise exception 'entity not found' using errcode = '23503'; end if;
  new.title := btrim(new.title);
  select coalesce(max(c.sort) + 1, 0) into new.sort
    from public.checklists c where c.entity_type = new.entity_type and c.entity_id = new.entity_id;
  return new;
end;
$$;
create trigger checklists_before_insert before insert on public.checklists
  for each row execute function private.checklists_before_insert();

create or replace function private.checklist_items_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_list public.checklists;
begin
  select * into v_list from public.checklists where id = new.checklist_id and tenant_id = private.tenant_id();
  if not found then raise exception 'checklist not found' using errcode = '23503'; end if;
  if (select count(*) from public.checklist_items i where i.checklist_id = new.checklist_id) >= 200 then
    raise exception 'checklist is full' using errcode = '23514';
  end if;
  new.tenant_id  := v_list.tenant_id;
  new.project_id := v_list.project_id;
  new.text := btrim(new.text);
  select coalesce(max(i.sort) + 1, 0) into new.sort from public.checklist_items i where i.checklist_id = new.checklist_id;
  if new.done then new.done_by := auth.uid(); new.done_at := now(); end if;
  return new;
end;
$$;
create trigger checklist_items_before_insert before insert on public.checklist_items
  for each row execute function private.checklist_items_before_insert();

create or replace function private.checklist_items_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
  end if;
  new.text := btrim(new.text);
  return new;
end;
$$;
create trigger checklist_items_before_update before update on public.checklist_items
  for each row execute function private.checklist_items_before_update();

alter table public.checklists enable row level security;
alter table public.checklists force row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_items force row level security;

-- Видят все, кто видит задачу; меняют те, кто может править задачу
create policy checklists_select on public.checklists for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_view_entity(entity_type, entity_id));
create policy checklists_insert on public.checklists for insert to authenticated
  with check (private.can_edit_entity(entity_type, entity_id));
create policy checklists_update on public.checklists for update to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_edit_entity(entity_type, entity_id))
  with check (tenant_id = (select private.tenant_id()));
create policy checklists_delete on public.checklists for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_edit_entity(entity_type, entity_id));

create policy checklist_items_select on public.checklist_items for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.checklists c where c.id = checklist_id));
create policy checklist_items_insert on public.checklist_items for insert to authenticated
  with check (exists (select 1 from public.checklists c where c.id = checklist_id and private.can_edit_entity(c.entity_type, c.entity_id)));
create policy checklist_items_update on public.checklist_items for update to authenticated
  using (tenant_id = (select private.tenant_id())
         and exists (select 1 from public.checklists c where c.id = checklist_id and private.can_edit_entity(c.entity_type, c.entity_id)))
  with check (tenant_id = (select private.tenant_id()));
create policy checklist_items_delete on public.checklist_items for delete to authenticated
  using (tenant_id = (select private.tenant_id())
         and exists (select 1 from public.checklists c where c.id = checklist_id and private.can_edit_entity(c.entity_type, c.entity_id)));

revoke insert, update, delete on public.checklists, public.checklist_items from authenticated;
grant insert (entity_type, entity_id, title) on public.checklists to authenticated;
grant update (title, sort) on public.checklists to authenticated;
grant delete on public.checklists to authenticated;
grant insert (checklist_id, text, done) on public.checklist_items to authenticated;
grant update (text, done, sort) on public.checklist_items to authenticated;
grant delete on public.checklist_items to authenticated;

alter publication supabase_realtime add table public.checklists, public.checklist_items;

-- ---------------------------------------------------------------------------
-- Вложения: удалить может автор вложения или тот, кто правит задачу.
-- Запись о файле убирается вместе с последним вложением (объект в хранилище чистит служебная задача).
-- ---------------------------------------------------------------------------
create policy attachments_delete on public.attachments for delete to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid()) or private.can_edit_entity(entity_type, entity_id))
  );
grant delete on public.attachments to authenticated;

create or replace function private.attachments_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.files f
   where f.id = old.file_id
     and not exists (select 1 from public.attachments a where a.file_id = f.id);
  return old;
end;
$$;
create trigger attachments_after_delete after delete on public.attachments
  for each row execute function private.attachments_after_delete();

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
