-- S3 · Уведомления: наблюдатели, настройки, конвейер «событие → получатели → фильтр прав → настройки → группировка».
-- См. docs: 04-modules/06-notifications.md

-- ---------------------------------------------------------------------------
-- Проверки доступа «от имени произвольного пользователя».
-- Получателя уведомления нужно проверять его правами, а не правами того, кто совершил действие.
-- Прежние функции (от имени текущего пользователя) становятся тонкими обёртками — логика в одном месте.
-- ---------------------------------------------------------------------------
create or replace function private.user_has_tenant_permission(p_user uuid, p_tenant uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_tenant_roles utr
    join public.role_permissions rp on rp.role_id = utr.role_id
    where utr.user_id = p_user and utr.tenant_id = p_tenant and rp.permission = p_permission
  );
$$;

create or replace function private.user_is_project_member(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project and pm.user_id = p_user
      and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
  );
$$;

create or replace function private.user_has_project_permission(p_user uuid, p_project uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.projects p
           where p.id = p_project and private.user_has_tenant_permission(p_user, p.tenant_id, p_permission))
      or exists (
           select 1
           from public.project_members pm
           join public.role_permissions rp on rp.role_id = pm.role_id
           where pm.project_id = p_project and pm.user_id = p_user
             and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
             and rp.permission = p_permission);
$$;

create or replace function private.user_can_see_project(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_is_project_member(p_user, p_project)
      or exists (
           select 1 from public.projects p
           where p.id = p_project and private.user_has_tenant_permission(p_user, p.tenant_id, 'project.view.all'));
$$;

create or replace function private.user_task_visible(
  p_user uuid, p_project uuid, p_assignee uuid, p_reporter uuid, p_org uuid, p_visibility text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_can_see_project(p_user, p_project)
     and private.user_has_project_permission(p_user, p_project, 'task.view')
     and (
       private.user_has_project_permission(p_user, p_project, 'task.view.internal')
       or p_assignee = p_user
       or p_reporter = p_user
       or (p_org is not null and p_org = (select u.organization_id from public.users u where u.id = p_user))
       or p_visibility = 'external'
     );
$$;

create or replace function private.user_can_view_entity(p_user uuid, p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then private.user_can_see_project(p_user, p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and private.user_task_visible(p_user, t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    else false
  end;
$$;

-- Обёртки для текущего пользователя (поведение прежнее)
create or replace function private.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_is_project_member(auth.uid(), p_project);
$$;
create or replace function private.has_project_permission(p_project uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_has_project_permission(auth.uid(), p_project, p_permission);
$$;
create or replace function private.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_can_see_project(auth.uid(), p_project);
$$;
create or replace function private.task_visible(
  p_project uuid, p_assignee uuid, p_reporter uuid, p_org uuid, p_visibility text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_task_visible(auth.uid(), p_project, p_assignee, p_reporter, p_org, p_visibility);
$$;
create or replace function private.can_view_entity(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_can_view_entity(auth.uid(), p_type, p_id);
$$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Наблюдатели
-- ---------------------------------------------------------------------------
create table public.watchers (
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  entity_type text not null references public.entity_types(code),
  entity_id   uuid not null,
  user_id     uuid not null references public.users(id) on delete cascade,
  reason      text not null check (reason in ('creator','assignee','mention','participant','manual')),
  muted       boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (entity_type, entity_id, user_id)
);
create index on public.watchers (user_id);
create index on public.watchers (tenant_id, project_id);

alter table public.watchers enable row level security;
alter table public.watchers force row level security;

create policy watchers_select on public.watchers for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_view_entity(entity_type, entity_id));
create policy watchers_insert on public.watchers for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_entity(entity_type, entity_id));
create policy watchers_update on public.watchers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy watchers_delete on public.watchers for delete to authenticated
  using (user_id = (select auth.uid()));

-- project_id и tenant_id выводятся из сущности, клиент задаёт только «за чем следить»
create or replace function private.watchers_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id  := private.tenant_id();
  new.project_id := private.entity_project_id(new.entity_type, new.entity_id);
  new.reason     := 'manual';
  if new.project_id is null then
    raise exception 'entity not found' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger watchers_before_insert before insert on public.watchers
  for each row execute function private.watchers_before_insert();

revoke insert, update on public.watchers from authenticated;
grant insert (entity_type, entity_id, user_id) on public.watchers to authenticated;
grant update (muted) on public.watchers to authenticated;

-- ---------------------------------------------------------------------------
-- Настройки уведомлений (категория × канал → режим)
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  user_id    uuid not null references public.users(id) on delete cascade default auth.uid(),
  category   text not null check (category in ('assigned','mentioned','watching','escalation','digest','system')),
  channel    text not null check (channel in ('in_app','email','telegram','push')),
  mode       text not null check (mode in ('instant','digest','off')),
  unique (user_id, category, channel)
);

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));

create or replace function private.notification_preferences_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id := private.tenant_id();
  new.user_id   := auth.uid();
  return new;
end;
$$;
create trigger notification_preferences_before_write before insert or update on public.notification_preferences
  for each row execute function private.notification_preferences_before_write();

revoke insert, update on public.notification_preferences from authenticated;
grant insert (category, channel, mode) on public.notification_preferences to authenticated;
grant update (mode) on public.notification_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- Уведомления
-- ---------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  user_id       uuid not null references public.users(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,
  event_type    text not null,                       -- 'task.assigned', 'comment.mentioned' …
  entity_type   text references public.entity_types(code),
  entity_id     uuid,
  actor_id      uuid references public.users(id),
  priority      text not null default 'normal' check (priority in ('low','normal','high','critical')),
  category      text not null check (category in ('assigned','mentioned','watching','escalation','digest','system')),
  title         text not null,
  body          text,
  group_key     text,                                -- 'task:{id}': схлопывание в окне 3 минуты
  payload       jsonb not null default '{}',
  read_at       timestamptz,
  snoozed_until timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (user_id, group_key) where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at, snoozed_until, archived_at) on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------------------------
-- Вспомогательное
-- ---------------------------------------------------------------------------
create or replace function private.ru_plural(n integer, one text, few text, many text) returns text
language sql immutable as $$
  select case
    when n % 100 between 11 and 14 then many
    when n % 10 = 1 then one
    when n % 10 between 2 and 4 then few
    else many end;
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
  end;
$$;

-- Текст уведомления по счётчикам событий: «вас упомянули, 2 комментария, статус изменён»
create or replace function private.notification_body(p_counts jsonb, p_last_text text) returns text
language plpgsql immutable as $$
declare
  v_total integer := 0;
  v_parts text[] := '{}';
  v_n     integer;
  k       text;
begin
  for k in select jsonb_object_keys(p_counts) loop v_total := v_total + (p_counts ->> k)::integer; end loop;
  if v_total <= 1 then return p_last_text; end if;

  v_n := coalesce((p_counts ->> 'assigned')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'вас назначили исполнителем'); end if;
  v_n := coalesce((p_counts ->> 'mentioned')::integer, 0);
  if v_n = 1 then v_parts := array_append(v_parts, 'вас упомянули');
  elsif v_n > 1 then v_parts := array_append(v_parts, 'упоминаний: ' || v_n); end if;
  v_n := coalesce((p_counts ->> 'status_changed')::integer, 0);
  if v_n = 1 then v_parts := array_append(v_parts, 'статус изменён');
  elsif v_n > 1 then v_parts := array_append(v_parts, 'статус менялся ' || v_n || ' ' || private.ru_plural(v_n, 'раз', 'раза', 'раз')); end if;
  v_n := coalesce((p_counts ->> 'due_changed')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'срок изменён'); end if;
  v_n := coalesce((p_counts ->> 'commented')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, v_n || ' ' || private.ru_plural(v_n, 'комментарий', 'комментария', 'комментариев')); end if;

  return array_to_string(v_parts, ', ');
end;
$$;

create or replace function private.max_priority(a text, b text) returns text
language sql immutable as $$
  select case when array_position(array['low','normal','high','critical'], a)
                 >= array_position(array['low','normal','high','critical'], b) then a else b end;
$$;

-- ---------------------------------------------------------------------------
-- Ядро конвейера: создать или схлопнуть уведомление
-- ---------------------------------------------------------------------------
create or replace function private.notify(
  p_user          uuid,
  p_entity_type   text,
  p_entity_id     uuid,
  p_category      text,
  p_priority      text,
  p_event         text,        -- ключ счётчика: assigned | mentioned | status_changed | due_changed | commented
  p_text          text,        -- текст события для одиночного уведомления
  p_internal_only boolean default false   -- событие внутреннее: внешним получателям не показываем
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor    uuid := auth.uid();
  v_project  uuid;
  v_tenant   uuid;
  v_display  jsonb;
  v_pref     text;
  v_group    text := p_entity_type || ':' || p_entity_id;
  v_existing public.notifications;
  v_counts   jsonb;
  v_actor_name text;
begin
  if p_user is null or p_user = v_actor then return; end if;              -- себе не уведомляем

  v_project := private.entity_project_id_any(p_entity_type, p_entity_id);
  if v_project is null then return; end if;
  select tenant_id into v_tenant from public.projects where id = v_project;

  if not exists (select 1 from public.users u where u.id = p_user and u.tenant_id = v_tenant and u.status <> 'blocked') then
    return;
  end if;
  -- фильтр прав: видит ли получатель объект (и внутренние данные, если событие внутреннее)
  if not private.user_can_view_entity(p_user, p_entity_type, p_entity_id) then return; end if;
  if p_internal_only and not private.user_has_project_permission(p_user, v_project, 'comment.internal.view') then return; end if;

  -- настройки получателя: «выкл» уважаем, кроме критичных
  select mode into v_pref from public.notification_preferences
   where user_id = p_user and category = p_category and channel = 'in_app';
  if v_pref = 'off' and p_priority <> 'critical' then return; end if;

  v_display := private.entity_display(p_entity_type, p_entity_id);
  select full_name into v_actor_name from public.users where id = v_actor;

  -- группировка: непрочитанное по тому же объекту за последние 3 минуты дополняем, а не дублируем
  select * into v_existing from public.notifications n
   where n.user_id = p_user and n.group_key = v_group and n.read_at is null and n.archived_at is null
     and n.updated_at > now() - interval '3 minutes'
   order by n.updated_at desc limit 1
   for update;

  if found then
    v_counts := jsonb_set(coalesce(v_existing.payload -> 'counts', '{}'),
                          array[p_event], to_jsonb(coalesce((v_existing.payload -> 'counts' ->> p_event)::integer, 0) + 1));
    update public.notifications set
      priority = private.max_priority(v_existing.priority, p_priority),
      category = case when array_position(array['watching','assigned','mentioned'], p_category)
                         > array_position(array['watching','assigned','mentioned'], v_existing.category)
                      then p_category else v_existing.category end,
      body     = private.notification_body(v_counts, p_text),
      payload  = v_existing.payload || jsonb_build_object('counts', v_counts, 'last_text', p_text),
      updated_at = now()
    where id = v_existing.id;
  else
    insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, actor_id,
                                      priority, category, title, body, group_key, payload)
    values (v_tenant, p_user, v_project, p_entity_type || '.' || p_event, p_entity_type, p_entity_id, v_actor,
            p_priority, p_category,
            (v_display ->> 'key') || ' «' || (v_display ->> 'title') || '»',
            p_text, v_group,
            jsonb_build_object('entity_key', v_display ->> 'key', 'entity_title', v_display ->> 'title',
                               'project_code', v_display ->> 'project_code', 'actor_name', v_actor_name,
                               'counts', jsonb_build_object(p_event, 1), 'last_text', p_text));
  end if;
end;
$$;

-- project_id любой сущности без привязки к JWT-тенанту (в триггерах JWT может отсутствовать)
create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then (select id from public.projects where id = p_id)
    when 'task'    then (select project_id from public.tasks where id = p_id)
  end;
$$;

create or replace function private.add_watcher(p_type text, p_id uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid := private.entity_project_id_any(p_type, p_id);
  v_tenant  uuid;
begin
  if p_user is null or v_project is null then return; end if;
  select tenant_id into v_tenant from public.projects where id = v_project;
  insert into public.watchers (tenant_id, project_id, entity_type, entity_id, user_id, reason)
  values (v_tenant, v_project, p_type, p_id, p_user, p_reason)
  on conflict do nothing;   -- повторно не добавляем и не «размучиваем»
end;
$$;

-- ---------------------------------------------------------------------------
-- Правила получателей: задачи
-- ---------------------------------------------------------------------------
create or replace function private.tasks_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor   text := (select full_name from public.users where id = auth.uid());
  v_who     text;
  w         record;
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
    return new;
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
      -- на проверку — автору (он проверяет)
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
create trigger tasks_notify after insert or update on public.tasks
  for each row execute function private.tasks_notify();

-- ---------------------------------------------------------------------------
-- Правила получателей: комментарии (упоминания и наблюдатели)
-- ---------------------------------------------------------------------------
create or replace function private.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_author  text := (select full_name from public.users where id = new.author_id);
  v_snippet text := left(regexp_replace(new.body_text, '\s+', ' ', 'g'), 140);
  m         record;
  w         record;
  v_internal boolean := new.visibility = 'internal';
begin
  perform private.add_watcher(new.entity_type, new.entity_id, new.author_id, 'participant');

  for m in select (e ->> 'id')::uuid as user_id from jsonb_array_elements(new.mentions) e loop
    perform private.add_watcher(new.entity_type, new.entity_id, m.user_id, 'mention');
    perform private.notify(m.user_id, new.entity_type, new.entity_id, 'mentioned', 'high', 'mentioned',
                           'Упоминание от ' || v_author || ': «' || v_snippet || '»', v_internal);
  end loop;

  for w in select user_id from public.watchers
            where entity_type = new.entity_type and entity_id = new.entity_id and not muted
              and user_id <> new.author_id
              and not (new.mentions @> jsonb_build_array(jsonb_build_object('type', 'user', 'id', user_id))) loop
    perform private.notify(w.user_id, new.entity_type, new.entity_id, 'watching', 'low', 'commented',
                           v_author || ': «' || v_snippet || '»', v_internal);
  end loop;
  return new;
end;
$$;
create trigger comments_notify after insert on public.comments
  for each row execute function private.comments_notify();

-- ---------------------------------------------------------------------------
-- Счётчики для шапки и вкладок
-- ---------------------------------------------------------------------------
create or replace function public.my_notification_counts() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with v as (
    select * from public.notifications n
     where n.user_id = auth.uid() and n.archived_at is null and n.read_at is null
  ),
  visible as (select * from v where snoozed_until is null or snoozed_until <= now())
  select jsonb_build_object(
    'badge',     (select count(*) from visible where priority in ('high','critical') or category in ('assigned','mentioned')),
    'all',       (select count(*) from visible),
    'assigned',  (select count(*) from visible where category = 'assigned'),
    'mentioned', (select count(*) from visible where category = 'mentioned'),
    'watching',  (select count(*) from visible where category = 'watching'),
    'snoozed',   (select count(*) from v where snoozed_until > now())
  );
$$;

revoke execute on function public.my_notification_counts from public, anon;
grant  execute on function public.my_notification_counts to authenticated;
