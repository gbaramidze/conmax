-- Модули проекта: «Договоры», «График и выполнение», «Бюджет и затраты», «Документы», «Персонал и подрядчики»,
-- «Закупки», «Отчёты и осмотры». Включает и выключает их тот, у кого право настраивать проект (project.settings.manage).
-- Выключенный модуль прячет свои разделы у всех участников; данные модуля не удаляются и вернутся при включении.
-- Личное (почта, календарь, чат, личное пространство) и основа проекта (задачи, заметки, доски, структура) модулями не являются.

create or replace function private.project_module_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['contracts', 'schedule', 'budget', 'documents', 'staffing', 'procurement', 'reporting']
$$;

-- Уже работающие проекты получают только «Отчёты и осмотры»: в них осмотры и обход, которые открыты сейчас.
-- Остальное (раньше спрятанное «вторым этапом») включают в настройках проекта.
alter table public.projects
  add column modules text[] not null default array['reporting'];

alter table public.projects
  add constraint projects_modules_known check (modules <@ private.project_module_keys());

comment on column public.projects.modules is 'Включённые модули проекта (ключи из private.project_module_keys())';

-- Включён ли модуль в проекте — для серверных проверок и уведомлений модулей
create or replace function private.project_has_module(p_project uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p_module = any(modules) from public.projects where id = p_project), false)
$$;

-- Менять модули может только тот, кто настраивает проект (одного права «править проект» мало)
create or replace function private.projects_modules_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.modules is distinct from old.modules and auth.uid() is not null
     and not private.has_project_permission(new.id, 'project.settings.manage') then
    raise exception 'permission denied: project.settings.manage' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger projects_modules_guard before update of modules on public.projects
  for each row execute function private.projects_modules_guard();

-- Включить/выключить модули разом. Возвращает итоговый список в порядке каталога.
create or replace function public.set_project_modules(p_project uuid, p_modules text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := private.project_module_keys();
  v_new text[];
begin
  perform private.settings_guard(p_project, array['project.settings.manage']);
  if p_modules is null or not (p_modules <@ v_keys) then
    raise exception 'unknown_module' using errcode = '22023';
  end if;
  select coalesce(array_agg(k order by i), '{}') into v_new
    from unnest(v_keys) with ordinality as t(k, i) where k = any(p_modules);
  -- журнал проекта пишет общий триггер аудита (поле modules: было → стало)
  update public.projects set modules = v_new where id = p_project and modules is distinct from v_new;
  return v_new;
end;
$$;

revoke execute on function public.set_project_modules(uuid, text[]) from public, anon;
grant execute on function public.set_project_modules(uuid, text[]) to authenticated;
