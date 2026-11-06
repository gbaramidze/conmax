-- Инспекция выполненных работ: отчёт по месту (этаж, зона, помещение или любой узел дерева локаций).
--
-- Отчёт повторяет бумажную форму «Work Inspection Report»: шапка (проект, подрядчик, дата, место), схема места (изображение и описание),
-- разделы чек-листа (стены, пол, потолок, двери, окна, электрика и приборы, сантехника, мебель и оборудование; можно добавлять свои),
-- в разделе — замечания с комментарием и статусом A (принято), C (принято с замечаниями), R (не принято), фото к замечаниям и общие фото,
-- подписи заказчика и подрядчика (имя, дата, необязательно нарисованная подпись).
-- Ключ вида `ZK7-IR-4` по счётчику проекта (kind 'IR'). Маршрут: черновик → выдан подрядчику; «открыть заново» возвращает в черновик и снимает подписи.
-- Итог отчёта: есть R — R; иначе есть C — C; иначе, если принято хоть что-то, — A. Счётчики по статусам пересчитывает база.
-- Права: смотрят `inspection.view` и `inspection.conduct`, ведут (создают, меняют, выдают, подписывают, удаляют) только `inspection.conduct`.
-- Внешние участники отчётов не видят (внутренние, `can_see_internal`). Выдача и открытие заново пишутся в ленту проекта.
-- Не вошло: повторная инспекция по списку замечаний, отметки замечаний на схеме, замечания как задачи, выдача отчёта подрядчику через портал.
-- См. docs: 04-modules/19-quality-control.md, 05-roadmap/05-backlog.md.

create table public.inspection_reports (
  id                    uuid primary key default public.uuidv7(),
  tenant_id             uuid not null references public.tenants(id),
  project_id            uuid not null references public.projects(id) on delete cascade,
  number                integer not null,
  key                   text not null,
  title                 text not null check (char_length(btrim(title)) between 1 and 200),
  location_id           uuid references public.locations(id),
  inspection_date       date not null default current_date,
  contractor_org_id     uuid references public.organizations(id),
  scheme_text           text not null default '' check (char_length(scheme_text) <= 4000),
  scheme_file_id        uuid references public.files(id),
  note                  text not null default '' check (char_length(note) <= 4000),
  status                text not null default 'draft' check (status in ('draft', 'issued')),
  result                text check (result is null or result in ('A', 'C', 'R')),
  cnt_a                 integer not null default 0,
  cnt_c                 integer not null default 0,
  cnt_r                 integer not null default 0,
  cnt_open              integer not null default 0,
  client_name           text check (client_name is null or char_length(client_name) <= 200),
  client_signed_at      timestamptz,
  client_sign_file_id   uuid references public.files(id),
  contractor_name       text check (contractor_name is null or char_length(contractor_name) <= 200),
  contractor_signed_at  timestamptz,
  contractor_sign_file_id uuid references public.files(id),
  issued_at             timestamptz,
  issued_by             uuid references public.users(id),
  created_by            uuid default auth.uid() references public.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (project_id, number)
);
create index on public.inspection_reports (project_id, inspection_date desc) where deleted_at is null;
create index on public.inspection_reports (location_id) where deleted_at is null;

create table public.inspection_sections (
  id        uuid primary key default public.uuidv7(),
  tenant_id uuid not null references public.tenants(id),
  report_id uuid not null references public.inspection_reports(id) on delete cascade,
  position  integer not null,
  code      text check (code is null or code in ('walls', 'floor', 'ceiling', 'doors', 'windows', 'electrical', 'sanitary', 'ffe')),
  title     text check (title is null or char_length(btrim(title)) between 1 and 120),
  ok        boolean not null default false,
  unique (report_id, position),
  check (code is not null or title is not null)
);

create table public.inspection_items (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  report_id  uuid not null references public.inspection_reports(id) on delete cascade,
  section_id uuid not null references public.inspection_sections(id) on delete cascade,
  position   integer not null,
  comment    text not null default '' check (char_length(comment) <= 2000),
  status     text check (status is null or status in ('A', 'C', 'R')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, position)
);
create index on public.inspection_items (report_id);

create table public.inspection_photos (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  report_id  uuid not null references public.inspection_reports(id) on delete cascade,
  item_id    uuid references public.inspection_items(id) on delete cascade,
  file_id    uuid not null references public.files(id),
  caption    text check (caption is null or char_length(caption) <= 300),
  created_by uuid default auth.uid() references public.users(id),
  created_at timestamptz not null default now()
);
create index on public.inspection_photos (report_id, created_at);
create index on public.inspection_photos (file_id);

alter table public.inspection_reports enable row level security;
alter table public.inspection_reports force row level security;
alter table public.inspection_sections enable row level security;
alter table public.inspection_sections force row level security;
alter table public.inspection_items enable row level security;
alter table public.inspection_items force row level security;
alter table public.inspection_photos enable row level security;
alter table public.inspection_photos force row level security;
revoke insert, update, delete on public.inspection_reports, public.inspection_sections, public.inspection_items, public.inspection_photos from authenticated;

create policy inspection_reports_select on public.inspection_reports for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and (private.has_project_permission(project_id, 'inspection.view') or private.has_project_permission(project_id, 'inspection.conduct')));
create policy inspection_sections_select on public.inspection_sections for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.inspection_reports r where r.id = report_id));
create policy inspection_items_select on public.inspection_items for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.inspection_reports r where r.id = report_id));
create policy inspection_photos_select on public.inspection_photos for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.inspection_reports r where r.id = report_id));

-- Файлы отчёта (фото, схема, подписи) видят те же, кто видит сам отчёт
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id or v.preview_file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), id)
         or exists (select 1 from public.projects p where p.cover_file_id = files.id and p.deleted_at is null and private.can_see_project(p.id))
         or exists (select 1 from public.entity_images i where i.file_id = files.id)
         or exists (select 1 from public.entity_image_versions v where v.file_id = files.id)
         or exists (select 1 from public.inspection_photos ph where ph.file_id = files.id)
         or exists (select 1 from public.inspection_reports r
                     where files.id in (r.scheme_file_id, r.client_sign_file_id, r.contractor_sign_file_id)))
  );

-- Права: существующим компаниям и триггером для новых
create or replace function private.inspection_perms(p_code text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_code
    when 'project_manager' then array['inspection.view', 'inspection.conduct']
    when 'chief_engineer'  then array['inspection.view', 'inspection.conduct']
    when 'pto'             then array['inspection.view', 'inspection.conduct']
    when 'foreman'         then array['inspection.view', 'inspection.conduct']
    when 'master'          then array['inspection.view']
    when 'economist'       then array['inspection.view']
    when 'safety_officer'  then array['inspection.view']
    when 'observer'        then array['inspection.view']
    else array[]::text[]
  end
$$;

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, p
  from public.roles r, lateral unnest(private.inspection_perms(r.code)) as p
 where r.scope = 'project' and r.is_system and r.deleted_at is null
on conflict do nothing;

create or replace function private.roles_inspection_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'project' and new.is_system then
    insert into public.role_permissions (tenant_id, role_id, permission)
    select new.tenant_id, new.id, p from unnest(private.inspection_perms(new.code)) as p
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger roles_inspection_defaults after insert on public.roles for each row execute function private.roles_inspection_defaults();

-- Отчёт для правки: проверяет право и что отчёт ещё не выдан (p_edit = false — для подписи и выдачи, где выданный отчёт допустим)
create or replace function private.inspection_guard(p_report uuid, p_edit boolean default true) returns public.inspection_reports
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports;
begin
  select * into r from public.inspection_reports where id = p_report and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['inspection.conduct']);
  if p_edit and r.status = 'issued' then raise exception 'report_issued' using errcode = '22023'; end if;
  return r;
end;
$$;

-- Пересчёт счётчиков и итога отчёта
create or replace function private.inspection_recount(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_a integer; v_c integer; v_r integer; v_open integer; v_ok boolean;
begin
  select count(*) filter (where status = 'A'), count(*) filter (where status = 'C'), count(*) filter (where status = 'R'), count(*) filter (where status is null)
    into v_a, v_c, v_r, v_open
    from public.inspection_items where report_id = p_report;
  select exists (select 1 from public.inspection_sections where report_id = p_report and ok) into v_ok;
  update public.inspection_reports
     set cnt_a = v_a, cnt_c = v_c, cnt_r = v_r, cnt_open = v_open,
         result = case when v_r > 0 then 'R' when v_c > 0 then 'C' when v_a > 0 or v_ok then 'A' else null end,
         updated_at = now()
   where id = p_report;
end;
$$;

-- Создать отчёт (разделы стандартного чек-листа заводятся сразу) или изменить шапку
create or replace function public.inspection_save(
  p_project uuid, p_id uuid default null, p_location uuid default null, p_title text default null, p_date date default null,
  p_contractor uuid default null, p_scheme_text text default '', p_note text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_loc     public.locations;
  v_title   text := btrim(coalesce(p_title, ''));
  v_id      uuid;
  v_number  integer;
  v_pos     integer := 0;
  v_code    text;
begin
  perform private.week_guard(p_project, array['inspection.conduct']);
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if p_location is not null then
    select * into v_loc from public.locations where id = p_location and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'location_not_found' using errcode = 'P0002'; end if;
  end if;
  if p_contractor is not null and not exists (select 1 from public.organizations o where o.id = p_contractor and o.tenant_id = v_tenant and o.deleted_at is null) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if v_title = '' then v_title := coalesce(v_loc.name, ''); end if;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
  if char_length(coalesce(p_scheme_text, '')) > 4000 or char_length(coalesce(p_note, '')) > 4000 then raise exception 'text_too_long' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'IR', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_number;
    insert into public.inspection_reports (tenant_id, project_id, number, key, title, location_id, inspection_date, contractor_org_id, scheme_text, note)
    values (v_tenant, p_project, v_number, v_project.code || '-IR-' || v_number, v_title, p_location, coalesce(p_date, current_date), p_contractor,
            coalesce(p_scheme_text, ''), coalesce(p_note, ''))
    returning id into v_id;
    foreach v_code in array array['walls', 'floor', 'ceiling', 'doors', 'windows', 'electrical', 'sanitary', 'ffe'] loop
      v_pos := v_pos + 1;
      insert into public.inspection_sections (tenant_id, report_id, position, code) values (v_tenant, v_id, v_pos, v_code);
    end loop;
  else
    perform private.inspection_guard(p_id);
    update public.inspection_reports
       set title = v_title, location_id = p_location, inspection_date = coalesce(p_date, inspection_date), contractor_org_id = p_contractor,
           scheme_text = coalesce(p_scheme_text, ''), note = coalesce(p_note, ''), updated_at = now()
     where id = p_id and project_id = p_project;
    if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

-- Схема места: изображение (пусто — убрать). Файл должен быть загружен вызывающим в этот же проект.
create or replace function public.inspection_set_scheme(p_report uuid, p_file uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report);
begin
  if p_file is not null and not exists (
       select 1 from public.files f
        where f.id = p_file and f.project_id = r.project_id and f.tenant_id = r.tenant_id
          and f.mime like 'image/%'
          and (f.created_by = auth.uid() or exists (select 1 from public.entity_images i where i.file_id = f.id and i.project_id = r.project_id))) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  update public.inspection_reports set scheme_file_id = p_file, updated_at = now() where id = r.id;
end;
$$;

-- Добавить свой раздел в конец чек-листа
create or replace function public.inspection_section_add(p_report uuid, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report);
  v_title text := btrim(coalesce(p_title, ''));
  v_id uuid;
begin
  if char_length(v_title) not between 1 and 120 then raise exception 'title_required' using errcode = '22023'; end if;
  insert into public.inspection_sections (tenant_id, report_id, position, title)
  values (r.tenant_id, r.id, coalesce((select max(position) from public.inspection_sections where report_id = r.id), 0) + 1, v_title)
  returning id into v_id;
  return v_id;
end;
$$;

-- «Без замечаний» у раздела и/или новое название своего раздела (стандартные разделы переименовать нельзя)
create or replace function public.inspection_section_set(p_section uuid, p_ok boolean default null, p_title text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.inspection_sections;
  r public.inspection_reports;
  v_title text := btrim(coalesce(p_title, ''));
begin
  select * into s from public.inspection_sections where id = p_section and tenant_id = private.tenant_id();
  if not found then raise exception 'section_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(s.report_id);
  if p_title is not null then
    if s.code is not null then raise exception 'section_standard' using errcode = '22023'; end if;
    if char_length(v_title) not between 1 and 120 then raise exception 'title_required' using errcode = '22023'; end if;
  end if;
  if p_ok is true and exists (select 1 from public.inspection_items where section_id = s.id and status in ('C', 'R')) then
    raise exception 'section_has_remarks' using errcode = '22023';
  end if;
  update public.inspection_sections
     set ok = coalesce(p_ok, ok), title = case when p_title is not null then v_title else title end
   where id = s.id;
  perform private.inspection_recount(r.id);
end;
$$;

create or replace function public.inspection_section_delete(p_section uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.inspection_sections;
  r public.inspection_reports;
begin
  select * into s from public.inspection_sections where id = p_section and tenant_id = private.tenant_id();
  if not found then raise exception 'section_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(s.report_id);
  delete from public.inspection_sections where id = s.id;
  perform private.inspection_recount(r.id);
end;
$$;

-- Добавить (p_id пусто) или изменить замечание раздела
create or replace function public.inspection_item_save(p_section uuid, p_id uuid default null, p_comment text default '', p_status text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.inspection_sections;
  r public.inspection_reports;
  v_id uuid;
begin
  select * into s from public.inspection_sections where id = p_section and tenant_id = private.tenant_id();
  if not found then raise exception 'section_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(s.report_id);
  if p_status is not null and p_status not in ('A', 'C', 'R') then raise exception 'status_invalid' using errcode = '22023'; end if;
  if char_length(coalesce(p_comment, '')) > 2000 then raise exception 'text_too_long' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.inspection_items (tenant_id, report_id, section_id, position, comment, status)
    values (r.tenant_id, r.id, s.id, coalesce((select max(position) from public.inspection_items where section_id = s.id), 0) + 1, coalesce(p_comment, ''), p_status)
    returning id into v_id;
    -- раздел с замечаниями уже не «без замечаний»
    update public.inspection_sections set ok = false where id = s.id and ok;
  else
    update public.inspection_items set comment = coalesce(p_comment, ''), status = p_status, updated_at = now()
     where id = p_id and section_id = s.id;
    if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    v_id := p_id;
  end if;
  perform private.inspection_recount(r.id);
  return v_id;
end;
$$;

create or replace function public.inspection_item_delete(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspection_items;
  r public.inspection_reports;
begin
  select * into i from public.inspection_items where id = p_item and tenant_id = private.tenant_id();
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(i.report_id);
  delete from public.inspection_items where id = i.id;
  perform private.inspection_recount(r.id);
end;
$$;

-- Фото к отчёту (p_item пусто — общее фото) и подпись фото
create or replace function public.inspection_photo_add(p_report uuid, p_file uuid, p_item uuid default null, p_caption text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report);
  v_id uuid;
begin
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = r.project_id and f.tenant_id = r.tenant_id and f.created_by = auth.uid()) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  if p_item is not null and not exists (select 1 from public.inspection_items i where i.id = p_item and i.report_id = r.id) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  insert into public.inspection_photos (tenant_id, report_id, item_id, file_id, caption)
  values (r.tenant_id, r.id, p_item, p_file, nullif(btrim(coalesce(p_caption, '')), ''))
  returning id into v_id;
  update public.inspection_reports set updated_at = now() where id = r.id;
  return v_id;
end;
$$;

create or replace function public.inspection_photo_delete(p_photo uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ph public.inspection_photos;
  r public.inspection_reports;
begin
  select * into ph from public.inspection_photos where id = p_photo and tenant_id = private.tenant_id();
  if not found then raise exception 'photo_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(ph.report_id);
  delete from public.inspection_photos where id = ph.id;
  update public.inspection_reports set updated_at = now() where id = r.id;
end;
$$;

-- Выдать отчёт подрядчику: у каждого замечания должен быть статус, в отчёте должно быть хоть что-то проверенное
create or replace function public.inspection_issue(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report);
begin
  if exists (select 1 from public.inspection_items where report_id = r.id and status is null) then
    raise exception 'items_without_status' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inspection_items where report_id = r.id) and not exists (select 1 from public.inspection_sections where report_id = r.id and ok) then
    raise exception 'report_empty' using errcode = '22023';
  end if;
  perform private.inspection_recount(r.id);
  update public.inspection_reports set status = 'issued', issued_at = now(), issued_by = auth.uid(), updated_at = now() where id = r.id;
  select * into r from public.inspection_reports where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'inspection_issued',
                               jsonb_build_object('key', r.key, 'title', r.title, 'result', r.result, 'remarks', r.cnt_c + r.cnt_r));
end;
$$;

-- Открыть выданный отчёт заново: возвращается в черновик, подписи снимаются
create or replace function public.inspection_reopen(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
begin
  if r.status <> 'issued' then return; end if;
  update public.inspection_reports
     set status = 'draft', issued_at = null, issued_by = null, updated_at = now(),
         client_name = null, client_signed_at = null, client_sign_file_id = null,
         contractor_name = null, contractor_signed_at = null, contractor_sign_file_id = null
   where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'inspection_reopened', jsonb_build_object('key', r.key, 'title', r.title));
end;
$$;

-- Подпись стороны (имя обязательно, нарисованная подпись — по желанию); p_side: 'client' | 'contractor'
create or replace function public.inspection_sign(p_report uuid, p_side text, p_name text, p_file uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
  v_name text := btrim(coalesce(p_name, ''));
begin
  if p_side not in ('client', 'contractor') then raise exception 'side_invalid' using errcode = '22023'; end if;
  if char_length(v_name) not between 1 and 200 then raise exception 'name_required' using errcode = '22023'; end if;
  if p_file is not null and not exists (select 1 from public.files f where f.id = p_file and f.project_id = r.project_id and f.tenant_id = r.tenant_id and f.created_by = auth.uid()) then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  if p_side = 'client' then
    update public.inspection_reports set client_name = v_name, client_signed_at = now(), client_sign_file_id = p_file, updated_at = now() where id = r.id;
  else
    update public.inspection_reports set contractor_name = v_name, contractor_signed_at = now(), contractor_sign_file_id = p_file, updated_at = now() where id = r.id;
  end if;
end;
$$;

create or replace function public.inspection_sign_clear(p_report uuid, p_side text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
begin
  if p_side not in ('client', 'contractor') then raise exception 'side_invalid' using errcode = '22023'; end if;
  if p_side = 'client' then
    update public.inspection_reports set client_name = null, client_signed_at = null, client_sign_file_id = null, updated_at = now() where id = r.id;
  else
    update public.inspection_reports set contractor_name = null, contractor_signed_at = null, contractor_sign_file_id = null, updated_at = now() where id = r.id;
  end if;
end;
$$;

create or replace function public.inspection_delete(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
begin
  update public.inspection_reports set deleted_at = now() where id = r.id;
end;
$$;

revoke execute on function
  public.inspection_save(uuid, uuid, uuid, text, date, uuid, text, text), public.inspection_set_scheme(uuid, uuid),
  public.inspection_section_add(uuid, text), public.inspection_section_set(uuid, boolean, text), public.inspection_section_delete(uuid),
  public.inspection_item_save(uuid, uuid, text, text), public.inspection_item_delete(uuid),
  public.inspection_photo_add(uuid, uuid, uuid, text), public.inspection_photo_delete(uuid),
  public.inspection_issue(uuid), public.inspection_reopen(uuid), public.inspection_sign(uuid, text, text, uuid),
  public.inspection_sign_clear(uuid, text), public.inspection_delete(uuid)
  from public, anon;
grant execute on function
  public.inspection_save(uuid, uuid, uuid, text, date, uuid, text, text), public.inspection_set_scheme(uuid, uuid),
  public.inspection_section_add(uuid, text), public.inspection_section_set(uuid, boolean, text), public.inspection_section_delete(uuid),
  public.inspection_item_save(uuid, uuid, text, text), public.inspection_item_delete(uuid),
  public.inspection_photo_add(uuid, uuid, uuid, text), public.inspection_photo_delete(uuid),
  public.inspection_issue(uuid), public.inspection_reopen(uuid), public.inspection_sign(uuid, text, text, uuid),
  public.inspection_sign_clear(uuid, text), public.inspection_delete(uuid)
  to authenticated;
notify pgrst, 'reload schema';
