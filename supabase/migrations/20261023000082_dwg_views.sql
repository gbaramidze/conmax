-- Просмотр DWG и DXF в браузере через Autodesk Platform Services (APS): точный вид чертежа со слоями, листами, измерениями.
-- Edge-функция `dwg-view` отправляет файл в APS, запускает перевод в формат просмотра (Model Derivative, SVF2) и сохраняет здесь
-- состояние: когда перевод готов, браузер открывает чертёж штатным просмотрщиком Autodesk по идентификатору `urn`.
-- Файл переводится один раз и дальше открывается сразу; новая версия документа — это новый файл, поэтому переводится заново.
-- Видит строку тот, кто видит сам файл (политика смотрит таблицу `files` с её RLS); пишет только функция с сервисным ключом.
-- Ключи APS (`APS_CLIENT_ID`, `APS_CLIENT_SECRET`) лежат в секретах функции, в базу и в браузер не попадают.
-- См. docs: 04-modules/12-documents-drawings.md, раздел «Просмотр DWG через Autodesk».

create table public.dwg_views (
  file_id      uuid primary key references public.files(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  status       text not null default 'uploading' check (status in ('uploading', 'translating', 'ready', 'failed')),
  urn          text,
  progress     text,
  error        text,
  requested_by uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.dwg_views (project_id);

alter table public.dwg_views enable row level security;
alter table public.dwg_views force row level security;
revoke all on public.dwg_views from authenticated, anon;
grant select on public.dwg_views to authenticated;
create policy dwg_views_select on public.dwg_views for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.files f where f.id = dwg_views.file_id));

-- Реестр: у документов, чей файл — DWG/DXF, показывать готовность просмотра не нужно: состояние спрашивает сам просмотрщик.
notify pgrst, 'reload schema';
