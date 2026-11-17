-- Заметки с площадки (შენიშვნა) как отдельный раздел, не задачи.
-- Заметка по-прежнему комментарий к месту (entity_type = 'location'): текст, видимость и фото живут в comments/attachments,
-- поэтому лента этажа и помещения, права и push не меняются. Эта таблица добавляет то, чего у комментария нет:
-- кому адресована (сотрудник ЛИБО подрядчик), закрыта ли и какая задача создана из заметки. По ней строятся
-- страница «Заметки», фильтры и статистика.

create table public.field_notes (
  comment_id        uuid primary key references public.comments(id) on delete cascade,
  tenant_id         uuid not null references public.tenants(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  location_id       uuid not null references public.locations(id),
  author_id         uuid not null references public.users(id),
  addressee_user_id uuid references public.users(id),
  addressee_org_id  uuid references public.organizations(id),
  task_id           uuid references public.tasks(id) on delete set null,
  status            text not null default 'open' check (status in ('open', 'done')),
  resolved_at       timestamptz,
  resolved_by       uuid references public.users(id),
  created_at        timestamptz not null default now(),
  -- адресат один: сотрудник или организация
  constraint field_notes_one_addressee check (addressee_user_id is null or addressee_org_id is null),
  constraint field_notes_resolved check ((status = 'done') = (resolved_at is not null))
);
create index on public.field_notes (project_id, created_at desc);
create index on public.field_notes (project_id, status);
create index on public.field_notes (location_id);
create index on public.field_notes (addressee_user_id) where addressee_user_id is not null;
create index on public.field_notes (addressee_org_id) where addressee_org_id is not null;

alter table public.field_notes enable row level security;
alter table public.field_notes force row level security;

-- Видна тем, кто видит сам комментарий (внутренняя заметка — только тем, кто видит внутреннее; удалённая — никому)
create policy field_notes_select on public.field_notes for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and exists (select 1 from public.comments c where c.id = field_notes.comment_id and c.deleted_at is null)
  );

revoke all on public.field_notes from public, anon, authenticated;
grant select on public.field_notes to authenticated;
-- записывают заметки только функции ниже

-- Адресат должен существовать, быть в проекте (сотрудник) и видеть заметку
create or replace function private.field_note_check_addressee(p_project uuid, p_visibility text, p_user uuid, p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user is not null and p_org is not null then
    raise exception 'one addressee only' using errcode = '22023';
  end if;
  if p_user is not null then
    if not exists (select 1 from public.project_members pm
                    where pm.project_id = p_project and pm.user_id = p_user and pm.deleted_at is null and pm.left_at is null) then
      raise exception 'addressee is not on the project' using errcode = '23514';
    end if;
    if p_visibility = 'internal' and not private.user_has_project_permission(p_user, p_project, 'comment.internal.view') then
      raise exception 'addressee cannot see an internal note' using errcode = '23514';
    end if;
  end if;
  if p_org is not null and not exists (
       select 1 from public.organizations o
        where o.id = p_org and o.tenant_id = private.tenant_id() and o.deleted_at is null) then
    raise exception 'organization not found' using errcode = '23514';
  end if;
end;
$$;
revoke execute on function private.field_note_check_addressee(uuid, text, uuid, uuid) from public, anon;

-- Вызывает сайт сразу после того, как создан комментарий к месту: «это заметка, адресована такому-то».
-- Повторный вызов обновляет адресата и связь с задачей.
create or replace function public.register_field_note(p_comment uuid, p_user uuid default null, p_org uuid default null, p_task uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  c    record;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select cm.tenant_id, cm.project_id, cm.entity_id, cm.visibility into c
    from public.comments cm
   where cm.id = p_comment and cm.author_id = v_me and cm.entity_type = 'location' and cm.deleted_at is null
     and cm.tenant_id = private.tenant_id();
  if not found then
    raise exception 'note not found' using errcode = '42501';
  end if;
  perform private.field_note_check_addressee(c.project_id, c.visibility, p_user, p_org);
  if p_task is not null and not exists (
       select 1 from public.tasks t where t.id = p_task and t.project_id = c.project_id and t.reporter_id = v_me) then
    raise exception 'task not found' using errcode = '42501';
  end if;

  insert into public.field_notes (comment_id, tenant_id, project_id, location_id, author_id, addressee_user_id, addressee_org_id, task_id)
  values (p_comment, c.tenant_id, c.project_id, c.entity_id, v_me, p_user, p_org, p_task)
  on conflict (comment_id) do update
    set addressee_user_id = excluded.addressee_user_id,
        addressee_org_id  = excluded.addressee_org_id,
        task_id           = coalesce(excluded.task_id, public.field_notes.task_id);
end;
$$;

-- Закрыть заметку («сделано») или вернуть в работу. Может автор, адресат (сотрудник или любой человек из организации-адресата)
-- и тот, кто может удалять чужие комментарии (руководитель).
create or replace function public.set_field_note_status(p_comment uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  n    record;
  v_my_org uuid;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select f.project_id, f.author_id, f.addressee_user_id, f.addressee_org_id, cm.visibility into n
    from public.field_notes f join public.comments cm on cm.id = f.comment_id
   where f.comment_id = p_comment and f.tenant_id = private.tenant_id() and cm.deleted_at is null;
  if not found or not private.can_see_project(n.project_id)
     or (n.visibility = 'internal' and not private.can_see_internal(n.project_id)) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  select organization_id into v_my_org from public.users where id = v_me;
  if not (v_me = n.author_id
          or v_me = n.addressee_user_id
          or (n.addressee_org_id is not null and n.addressee_org_id = v_my_org)
          or private.has_project_permission(n.project_id, 'comment.delete.any')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.field_notes
     set status      = case when p_done then 'done' else 'open' end,
         resolved_at = case when p_done then now() else null end,
         resolved_by = case when p_done then v_me else null end
   where comment_id = p_comment;
end;
$$;

-- Передать заметку другому адресату (или снять адресата). Только автор и руководитель.
create or replace function public.set_field_note_addressee(p_comment uuid, p_user uuid default null, p_org uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  n    record;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select f.project_id, f.author_id, cm.visibility into n
    from public.field_notes f join public.comments cm on cm.id = f.comment_id
   where f.comment_id = p_comment and f.tenant_id = private.tenant_id() and cm.deleted_at is null;
  if not found or not private.can_see_project(n.project_id) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  if not (v_me = n.author_id or private.has_project_permission(n.project_id, 'comment.delete.any')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform private.field_note_check_addressee(n.project_id, n.visibility, p_user, p_org);
  update public.field_notes set addressee_user_id = p_user, addressee_org_id = p_org where comment_id = p_comment;
end;
$$;

revoke execute on function public.register_field_note(uuid, uuid, uuid, uuid), public.set_field_note_status(uuid, boolean),
  public.set_field_note_addressee(uuid, uuid, uuid) from public, anon;
grant  execute on function public.register_field_note(uuid, uuid, uuid, uuid), public.set_field_note_status(uuid, boolean),
  public.set_field_note_addressee(uuid, uuid, uuid) to authenticated;

-- Заметки, отправленные до появления раздела (по ним уже разослан push), попадают в список как открытые, без адресата
insert into public.field_notes (comment_id, tenant_id, project_id, location_id, author_id, created_at)
select c.id, c.tenant_id, c.project_id, c.entity_id, c.author_id, c.created_at
  from public.comments c
  join private.field_note_pushes p on p.comment_id = c.id
 where c.entity_type = 'location' and c.deleted_at is null
on conflict do nothing;

notify pgrst, 'reload schema';
