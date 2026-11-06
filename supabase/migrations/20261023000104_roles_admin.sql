-- Роли и права: каталог прав, управление ролями из приложения (страница «Роли и права»).
--
-- Раньше права были просто строками в `role_permissions`: названий и групп у них не было, управлять ролями можно было только SQL-запросами.
-- Теперь:
--  • `permissions` — общий каталог прав (код, группа, название, порядок). Новое право сначала регистрируется здесь, потом выдаётся ролям
--    (внешний ключ `role_permissions.permission` не даёт опечататься). Каталог один на все компании: права — часть кода, а не данных.
--  • Признаки права: `tenant_only` — только для ролей компании (администрирование, «видеть все проекты»…), роли проекта его получить не могут;
--    `external_ok` — безопасно для внешних ролей (субподрядчик, ответственный от подрядчика, заказчик): остальные права им выдать нельзя,
--    иначе внутренние данные утекли бы наружу.
--  • Функции с проверкой права `admin.roles`: `roles_overview`, `role_holders`, `role_create`, `role_rename`, `role_set_permissions`, `role_delete`.
--  • Функции с проверкой права `admin.users`: `tenant_role_grant`, `tenant_role_revoke` — кому выдана роль компании.
--  • Защита от потери доступа: после любого изменения в компании должен остаться хотя бы один человек с правом `admin.roles`.
-- Права вычисляются из таблиц при каждом запросе, поэтому изменения действуют сразу, без перезахода (экран кеширует список прав до 5 минут).
-- См. docs: 04-modules/02-identity-org.md, раздел «Роли и права».

create table public.permissions (
  code        text primary key,
  module      text not null,
  sort        integer not null,
  label       text not null,
  tenant_only boolean not null default false,
  external_ok boolean not null default false
);

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
create policy permissions_select on public.permissions for select to authenticated using (true);
revoke all on public.permissions from anon, authenticated;
grant select on public.permissions to authenticated;

insert into public.permissions (code, module, sort, label, tenant_only, external_ok) values
  -- Администрирование
  ('admin.tenant',           'Администрирование', 101, 'Настройки компании', true, false),
  ('admin.users',            'Администрирование', 102, 'Пользователи и приглашения', true, false),
  ('admin.roles',            'Администрирование', 103, 'Роли и права', true, false),
  ('admin.workflows',        'Администрирование', 104, 'Статусы и переходы задач', true, false),
  ('admin.templates',        'Администрирование', 105, 'Шаблоны', true, false),
  ('admin.reference_data',   'Администрирование', 106, 'Справочники: организации и направления', true, false),
  ('admin.integrations',     'Администрирование', 107, 'Интеграции', true, false),
  -- Проекты
  ('project.create',         'Проекты', 201, 'Создавать проекты', true, false),
  ('project.view',           'Проекты', 202, 'Видеть проект', false, true),
  ('project.view.all',       'Проекты', 203, 'Видеть все проекты компании', true, false),
  ('project.edit',           'Проекты', 204, 'Править сведения о проекте', false, false),
  ('project.archive',        'Проекты', 205, 'Архивировать проекты', true, false),
  ('project.members.manage', 'Проекты', 206, 'Управлять участниками проекта', false, false),
  ('project.members.invite_org', 'Проекты', 207, 'Приглашать сотрудников своей организации', false, true),
  ('project.settings.manage','Проекты', 208, 'Настройки проекта', false, false),
  ('location.manage',        'Проекты', 209, 'Структура объекта: корпуса, этажи, помещения', false, false),
  ('phase.manage',           'Проекты', 210, 'Фазы проекта', false, false),
  ('gate.submit',            'Проекты', 211, 'Выносить ворота фазы на решение', false, false),
  ('milestone.manage',       'Проекты', 212, 'Вехи проекта', false, false),
  -- Задачи
  ('task.view',              'Задачи', 301, 'Видеть задачи', false, true),
  ('task.view.internal',     'Задачи', 302, 'Видеть внутренние задачи', false, false),
  ('task.create',            'Задачи', 303, 'Создавать задачи', false, true),
  ('task.edit.own',          'Задачи', 304, 'Править свои задачи', false, true),
  ('task.edit.any',          'Задачи', 305, 'Править любые задачи', false, false),
  ('task.assign',            'Задачи', 306, 'Назначать исполнителей', false, true),
  ('task.transition.own',    'Задачи', 307, 'Менять статус своих задач', false, true),
  ('task.transition.any',    'Задачи', 308, 'Менять статус любых задач', false, false),
  ('task.delete',            'Задачи', 309, 'Удалять задачи', false, false),
  -- Комментарии
  ('comment.create',         'Комментарии', 401, 'Писать комментарии', false, true),
  ('comment.internal.view',  'Комментарии', 402, 'Видеть внутренние комментарии', false, false),
  ('comment.internal.create','Комментарии', 403, 'Писать внутренние комментарии', false, false),
  ('comment.delete.any',     'Комментарии', 404, 'Удалять чужие комментарии', false, false),
  ('comment.mark_decision',  'Комментарии', 405, 'Отмечать комментарий как решение', false, false),
  -- Совещания
  ('meeting.view',           'Совещания', 501, 'Видеть совещания', false, true),
  ('meeting.create',         'Совещания', 502, 'Создавать совещания', false, false),
  ('meeting.manage',         'Совещания', 503, 'Управлять совещаниями и сериями', false, false),
  ('meeting.conduct',        'Совещания', 504, 'Проводить совещание', false, false),
  ('meeting.minutes.publish','Совещания', 505, 'Публиковать протокол', false, false),
  ('decision.record',        'Совещания', 506, 'Записывать решения', false, false),
  ('commitment.create',      'Совещания', 507, 'Создавать поручения', false, false),
  ('commitment.close',       'Совещания', 508, 'Закрывать поручения', false, false),
  -- График и планирование
  ('schedule.view',          'График и планирование', 601, 'Видеть график и недельные планы', false, false),
  ('schedule.edit',          'График и планирование', 602, 'Править график', false, false),
  ('schedule.import',        'График и планирование', 603, 'Импортировать график', false, false),
  ('baseline.create',        'График и планирование', 604, 'Фиксировать базовый план', false, false),
  ('period.manage',          'График и планирование', 605, 'Недельные планы и спринты', false, false),
  -- Прогресс и полевая работа
  ('progress.report',        'Прогресс и полевая работа', 701, 'Вносить факт выполнения', false, true),
  ('progress.approve',       'Прогресс и полевая работа', 702, 'Подтверждать факт', false, false),
  ('daily_log.create',       'Прогресс и полевая работа', 703, 'Вести журнал дня', false, false),
  ('daily_log.approve',      'Прогресс и полевая работа', 704, 'Утверждать журнал дня', false, false),
  ('walk.create',            'Прогресс и полевая работа', 705, 'Проводить обходы', false, true),
  ('walk.verify',            'Прогресс и полевая работа', 706, 'Независимая проверка обходов', false, false),
  ('walk.approve',           'Прогресс и полевая работа', 707, 'Подтверждать обходы и расхождения', false, false),
  ('workitem.manage',        'Прогресс и полевая работа', 708, 'Объёмы работ по местам', false, false),
  -- Бюджет и изменения
  ('budget.view',            'Бюджет и изменения', 801, 'Видеть бюджет', false, false),
  ('budget.edit',            'Бюджет и изменения', 802, 'Править бюджет', false, false),
  ('budget.approve',         'Бюджет и изменения', 803, 'Утверждать бюджет', false, false),
  ('cost.record',            'Бюджет и изменения', 804, 'Вносить факт затрат', false, false),
  ('change.create',          'Бюджет и изменения', 805, 'Создавать запросы на изменение', false, false),
  ('change.assess',          'Бюджет и изменения', 806, 'Оценивать запросы на изменение', false, false),
  ('change.approve',         'Бюджет и изменения', 807, 'Утверждать запросы на изменение', false, false),
  -- Аналитика, риски, отчёты
  ('signal.view',            'Аналитика, риски, отчёты', 901, 'Видеть сигналы и индекс здоровья', false, false),
  ('signal.manage',          'Аналитика, риски, отчёты', 902, 'Управлять сигналами', false, false),
  ('risk.view',              'Аналитика, риски, отчёты', 903, 'Видеть реестр рисков', false, false),
  ('risk.manage',            'Аналитика, риски, отчёты', 904, 'Управлять рисками', false, false),
  ('snapshot.create',        'Аналитика, риски, отчёты', 905, 'Создавать снимки', false, false),
  ('report.view',            'Аналитика, риски, отчёты', 906, 'Видеть отчёты проекта', false, false),
  ('report.portfolio.view',  'Аналитика, риски, отчёты', 907, 'Видеть отчёты портфеля', true, false),
  -- Документы и качество
  ('document.upload',        'Документы и качество', 1001, 'Загружать документы', false, false),
  ('document.publish',       'Документы и качество', 1002, 'Выпускать документы', false, false),
  ('inspection.view',        'Документы и качество', 1003, 'Видеть отчёты об инспекции', false, false),
  ('inspection.conduct',     'Документы и качество', 1004, 'Проводить инспекции', false, false),
  -- Закупки
  ('procurement.view',       'Закупки', 1101, 'Видеть заявки на материалы и запросы цен', false, false),
  ('procurement.request',    'Закупки', 1102, 'Создавать заявки на материалы и запросы цен', false, false),
  ('procurement.approve',    'Закупки', 1103, 'Согласовывать закупки', false, false);

-- Все выданные права должны быть в каталоге; дальше внешний ключ следит за этим сам
do $$
declare v_missing text;
begin
  select string_agg(distinct rp.permission, ', ') into v_missing
    from public.role_permissions rp left join public.permissions p on p.code = rp.permission
   where p.code is null;
  if v_missing is not null then
    raise exception 'permissions missing in catalog: %', v_missing;
  end if;
end $$;
alter table public.role_permissions
  add constraint role_permissions_permission_fkey foreign key (permission) references public.permissions(code) on update cascade;

-- ---------------------------------------------------------------------------
-- Внутренние помощники
-- ---------------------------------------------------------------------------

-- Внешняя роль: системная роль проекта субподрядчика или заказчика. Другие роли внутренние (так же решает invite-user).
create or replace function private.role_is_external(p_scope text, p_code text, p_is_system boolean) returns boolean
language sql immutable set search_path = '' as $$
  select p_is_system and p_scope = 'project' and p_code in ('subcontractor', 'subcontractor_lead', 'client');
$$;

-- В компании должен остаться хотя бы один человек с правом «Роли и права»: иначе роли станет нельзя править
create or replace function private.assert_roles_admin_remains() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1
      from public.user_tenant_roles utr
      join public.role_permissions rp on rp.role_id = utr.role_id and rp.permission = 'admin.roles'
      join public.users u on u.id = utr.user_id
     where utr.tenant_id = private.tenant_id() and u.deleted_at is null and u.status <> 'blocked'
  ) then
    raise exception 'last_admin' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.require_roles_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_tenant_permission('admin.roles') then
    raise exception 'permission denied: admin.roles' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Чтение
-- ---------------------------------------------------------------------------
create or replace function public.roles_overview()
returns table (id uuid, scope text, code text, name text, is_system boolean, is_external boolean, permission_count integer, holder_count integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_roles_admin();
  return query
    select r.id, r.scope, r.code, r.name, r.is_system,
           private.role_is_external(r.scope, r.code, r.is_system),
           (select count(*)::int from public.role_permissions rp where rp.role_id = r.id),
           case when r.scope = 'tenant'
                then (select count(distinct utr.user_id)::int from public.user_tenant_roles utr where utr.role_id = r.id)
                else (select count(distinct pm.user_id)::int from public.project_members pm
                       where pm.role_id = r.id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date))
           end
      from public.roles r
     where r.tenant_id = private.tenant_id() and r.deleted_at is null
     order by r.scope desc, r.is_system desc, r.name;
end;
$$;

-- Кому выдана роль: для роли компании — люди, для роли проекта — люди и проекты, где они в этой роли
create or replace function public.role_holders(p_role uuid)
returns table (user_id uuid, full_name text, email text, job_title text, project_code text)
language plpgsql stable security definer set search_path = '' as $$
declare v_scope text;
begin
  perform private.require_roles_admin();
  select r.scope into v_scope from public.roles r where r.id = p_role and r.tenant_id = private.tenant_id() and r.deleted_at is null;
  if v_scope is null then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if v_scope = 'tenant' then
    return query
      select u.id, u.full_name, u.email::text, u.job_title, null::text
        from public.user_tenant_roles utr join public.users u on u.id = utr.user_id
       where utr.role_id = p_role and utr.tenant_id = private.tenant_id()
       order by u.full_name limit 300;
  else
    return query
      select u.id, u.full_name, u.email::text, u.job_title, p.code::text
        from public.project_members pm
        join public.users u on u.id = pm.user_id
        join public.projects p on p.id = pm.project_id
       where pm.role_id = p_role and pm.tenant_id = private.tenant_id() and pm.deleted_at is null
         and (pm.left_at is null or pm.left_at > current_date)
       order by u.full_name, p.code limit 300;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Изменение ролей
-- ---------------------------------------------------------------------------
create or replace function public.role_create(p_scope text, p_name text, p_copy_from uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  perform private.require_roles_admin();
  if p_scope not in ('tenant', 'project') or char_length(v_name) not between 1 and 80 then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.roles r where r.tenant_id = private.tenant_id() and r.scope = p_scope and r.deleted_at is null and lower(r.name) = lower(v_name)) then
    raise exception 'role_name_taken' using errcode = '23505';
  end if;
  if p_copy_from is not null and not exists (select 1 from public.roles r where r.id = p_copy_from and r.tenant_id = private.tenant_id() and r.deleted_at is null) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;

  insert into public.roles (tenant_id, scope, code, name, is_system)
  values (private.tenant_id(), p_scope, 'custom_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), v_name, false)
  returning id into v_id;

  if p_copy_from is not null then
    insert into public.role_permissions (tenant_id, role_id, permission)
    select private.tenant_id(), v_id, rp.permission
      from public.role_permissions rp join public.permissions p on p.code = rp.permission
     where rp.role_id = p_copy_from and (p_scope = 'tenant' or not p.tenant_only);
  end if;
  return v_id;
end;
$$;

create or replace function public.role_rename(p_role uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_scope text;
begin
  perform private.require_roles_admin();
  select r.scope into v_scope from public.roles r where r.id = p_role and r.tenant_id = private.tenant_id() and r.deleted_at is null;
  if v_scope is null then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'role_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.roles r where r.tenant_id = private.tenant_id() and r.scope = v_scope and r.deleted_at is null and r.id <> p_role and lower(r.name) = lower(v_name)) then
    raise exception 'role_name_taken' using errcode = '23505';
  end if;
  update public.roles set name = v_name where id = p_role;
end;
$$;

-- Заменяет набор прав роли целиком. Возвращает сколько прав добавлено и убрано.
create or replace function public.role_set_permissions(p_role uuid, p_permissions text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       public.roles;
  v_new   text[] := coalesce((select array_agg(distinct x) from unnest(p_permissions) x), '{}');
  v_added int;
  v_removed int;
begin
  perform private.require_roles_admin();
  select * into r from public.roles where id = p_role and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'role_not_found' using errcode = 'P0002'; end if;

  if exists (select 1 from unnest(v_new) x where not exists (select 1 from public.permissions p where p.code = x)) then
    raise exception 'permission_unknown' using errcode = '22023';
  end if;
  if r.scope = 'project' and exists (select 1 from public.permissions p where p.code = any (v_new) and p.tenant_only) then
    raise exception 'permission_tenant_only' using errcode = '22023';
  end if;
  if private.role_is_external(r.scope, r.code, r.is_system)
     and exists (select 1 from public.permissions p where p.code = any (v_new) and not p.external_ok) then
    raise exception 'permission_not_for_external' using errcode = '22023';
  end if;

  with del as (
    delete from public.role_permissions rp where rp.role_id = p_role and not (rp.permission = any (v_new)) returning 1
  ) select count(*) into v_removed from del;
  with ins as (
    insert into public.role_permissions (tenant_id, role_id, permission)
    select r.tenant_id, p_role, x from unnest(v_new) x
    on conflict do nothing
    returning 1
  ) select count(*) into v_added from ins;

  update public.roles set updated_at = now() where id = p_role;
  perform private.assert_roles_admin_remains();
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

create or replace function public.role_delete(p_role uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.roles;
begin
  perform private.require_roles_admin();
  select * into r from public.roles where id = p_role and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if r.is_system then raise exception 'role_system' using errcode = '42501'; end if;
  if exists (select 1 from public.user_tenant_roles where role_id = p_role)
     or exists (select 1 from public.project_members where role_id = p_role) then
    raise exception 'role_in_use' using errcode = '23503';
  end if;
  delete from public.roles where id = p_role;
  perform private.assert_roles_admin_remains();
end;
$$;

-- ---------------------------------------------------------------------------
-- Роли компании: кому выданы
-- ---------------------------------------------------------------------------
create or replace function public.tenant_role_grant(p_user uuid, p_role uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_tenant_permission('admin.users') then
    raise exception 'permission denied: admin.users' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role and r.tenant_id = private.tenant_id() and r.scope = 'tenant' and r.deleted_at is null) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  -- роли компании только для внутренних сотрудников: внешний человек не должен получить права на всю компанию
  if not exists (select 1 from public.users u where u.id = p_user and u.tenant_id = private.tenant_id() and not u.is_external and u.deleted_at is null) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into public.user_tenant_roles (tenant_id, user_id, role_id) values (private.tenant_id(), p_user, p_role) on conflict do nothing;
end;
$$;

create or replace function public.tenant_role_revoke(p_user uuid, p_role uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_tenant_permission('admin.users') then
    raise exception 'permission denied: admin.users' using errcode = '42501';
  end if;
  delete from public.user_tenant_roles where user_id = p_user and role_id = p_role and tenant_id = private.tenant_id();
  perform private.assert_roles_admin_remains();
end;
$$;

revoke execute on function
  public.roles_overview(), public.role_holders(uuid), public.role_create(text, text, uuid), public.role_rename(uuid, text),
  public.role_set_permissions(uuid, text[]), public.role_delete(uuid), public.tenant_role_grant(uuid, uuid), public.tenant_role_revoke(uuid, uuid)
  from public, anon;
grant execute on function
  public.roles_overview(), public.role_holders(uuid), public.role_create(text, text, uuid), public.role_rename(uuid, text),
  public.role_set_permissions(uuid, text[]), public.role_delete(uuid), public.tenant_role_grant(uuid, uuid), public.tenant_role_revoke(uuid, uuid)
  to authenticated;
grant execute on all functions in schema private to authenticated, supabase_auth_admin;
notify pgrst, 'reload schema';
