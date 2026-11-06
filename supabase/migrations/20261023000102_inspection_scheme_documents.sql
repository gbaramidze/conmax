-- Инспекция: схема из чертежей, привязанных к месту.
--
-- План этажа у проекта лежит не в изображениях места, а в «Документах» (чертёж «L05 Floor Plan», привязанный к этажам через `document_links`).
-- Теперь схемой отчёта может быть и такой чертёж: берётся текущая версия документа вида «план» или «чертёж», привязанного к месту или
-- к вышестоящему узлу (для помещения — план его этажа). Если файл версии не картинка и не PDF, берётся её предпросмотр.
-- В отчёте запоминается версия документа (`scheme_version_id`) и страница (`scheme_page`, пока всегда 1), чтобы выданный отчёт не менялся
-- при выходе новой версии плана. PDF рисуется в картинку в браузере; точки замечаний лежат в долях ширины и высоты страницы.
-- Варианты схемы, по порядку: само место, тип номера, вышестоящие узлы (ближайший первым); внутри уровня: отмеченные изображения,
-- затем планы, затем чертежи. Схема подставляется сама при создании отчёта, при смене места и у отчёта без схемы при сохранении.
-- См. docs: 04-modules/19-quality-control.md.

alter table public.inspection_reports
  add column scheme_version_id uuid references public.document_versions(id),
  add column scheme_page integer not null default 1 check (scheme_page >= 1),
  add constraint inspection_reports_one_scheme check (scheme_file_id is null or scheme_version_id is null);

drop function if exists public.inspection_set_scheme(uuid, uuid);
drop function if exists private.inspection_default_scheme(uuid);
drop function if exists public.inspection_scheme_options(uuid);

create function public.inspection_scheme_options(p_location uuid)
returns table (kind text, file_id uuid, version_id uuid, title text, name text, storage_key text, mime text, source text, ord integer)
language sql stable security definer set search_path = '' as $$
  with loc as (
    select l.id, l.path, l.project_id from public.locations l
     where l.id = p_location and l.tenant_id = private.tenant_id() and l.deleted_at is null
       and private.can_see_project(l.project_id)
  ),
  anc as (
    select loc.id, loc.project_id, 1 as rank from loc
    union all
    select a.id, loc.project_id, 3 + (1000 - length(a.path::text))
      from loc join public.locations a on a.project_id = loc.project_id and a.deleted_at is null and loc.path::text like a.path::text || '.%'
  ),
  cand as (
    -- изображения места и вышестоящих узлов, отмеченные как схема
    select 'file'::text as kind, i.file_id, null::uuid as version_id, coalesce(i.caption, f.name) as title, f.name, f.storage_key, f.mime,
           case when anc.rank = 1 then 'location' else 'parent' end as source, anc.rank, 0 as pri, i.is_cover, i.sort
      from anc
      join public.entity_images i on i.entity_type = 'location' and i.entity_id = anc.id and i.project_id = anc.project_id and i.is_plan
      join public.files f on f.id = i.file_id and f.mime like 'image/%'
    union all
    -- изображения типа номера, отмеченные как схема
    select 'file', i.file_id, null::uuid, coalesce(i.caption, f.name), f.name, f.storage_key, f.mime, 'room_type', 2, 0, i.is_cover, i.sort
      from loc
      join public.room_specs rs on rs.location_id = loc.id
      join public.entity_images i on i.entity_type = 'room_type' and i.entity_id = rs.type_id and i.project_id = loc.project_id and i.is_plan
      join public.files f on f.id = i.file_id and f.mime like 'image/%'
    union all
    -- чертежи и планы, привязанные к месту или вышестоящему узлу
    select 'document', null::uuid, v.id, d.title, f.name, f.storage_key, f.mime,
           case when anc.rank = 1 then 'location' else 'parent' end, anc.rank, case when d.doc_type = 'plan' then 1 else 2 end, false, 0
      from anc
      join public.document_links dl on dl.entity_type = 'location' and dl.entity_id = anc.id and dl.project_id = anc.project_id
      join public.documents d on d.id = dl.document_id and d.deleted_at is null and d.doc_type in ('plan', 'drawing')
      join public.document_versions v on v.id = d.current_version_id
      join public.files fm on fm.id = v.file_id
      join public.files f on f.id = case when fm.mime = 'application/pdf' or fm.mime like 'image/%' then fm.id else v.preview_file_id end
                         and (f.mime = 'application/pdf' or f.mime like 'image/%')
  )
  select c.kind, c.file_id, c.version_id, c.title, c.name, c.storage_key, c.mime, c.source,
         (row_number() over (order by c.rank, c.pri, c.is_cover desc, c.sort, c.title))::integer as ord
    from cand c
   order by ord
$$;
revoke execute on function public.inspection_scheme_options(uuid) from public, anon;
grant execute on function public.inspection_scheme_options(uuid) to authenticated;

-- Создать отчёт (схема подставляется по месту) или изменить шапку (при смене места схема меняется, точки сбрасываются)
create or replace function public.inspection_save(
  p_project uuid, p_id uuid default null, p_location uuid default null, p_title text default null, p_date date default null,
  p_contractor uuid default null, p_scheme_text text default '', p_note text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_loc     public.locations;
  v_old     public.inspection_reports;
  v_title   text := btrim(coalesce(p_title, ''));
  v_id      uuid;
  v_number  integer;
  v_pos     integer := 0;
  v_code    text;
  v_file    uuid;
  v_ver     uuid;
begin
  perform private.week_guard(p_project, array['inspection.conduct']);
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if p_location is not null then
    select * into v_loc from public.locations where id = p_location and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'location_not_found' using errcode = 'P0002'; end if;
    select o.file_id, o.version_id into v_file, v_ver from public.inspection_scheme_options(p_location) o order by o.ord limit 1;
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
    insert into public.inspection_reports (tenant_id, project_id, number, key, title, location_id, inspection_date, contractor_org_id, scheme_text, note, scheme_file_id, scheme_version_id)
    values (v_tenant, p_project, v_number, v_project.code || '-IR-' || v_number, v_title, p_location, coalesce(p_date, current_date), p_contractor,
            coalesce(p_scheme_text, ''), coalesce(p_note, ''), v_file, v_ver)
    returning id into v_id;
    foreach v_code in array array['walls', 'floor', 'ceiling', 'doors', 'windows', 'electrical', 'sanitary', 'ffe'] loop
      v_pos := v_pos + 1;
      insert into public.inspection_sections (tenant_id, report_id, position, code) values (v_tenant, v_id, v_pos, v_code);
    end loop;
  else
    v_old := private.inspection_guard(p_id);
    -- схема меняется при смене места, а у отчёта без схемы подставляется сейчас
    if p_location is not distinct from v_old.location_id and (v_old.scheme_file_id is not null or v_old.scheme_version_id is not null) then
      v_file := v_old.scheme_file_id;
      v_ver := v_old.scheme_version_id;
    end if;
    update public.inspection_reports
       set title = v_title, location_id = p_location, inspection_date = coalesce(p_date, inspection_date), contractor_org_id = p_contractor,
           scheme_text = coalesce(p_scheme_text, ''), note = coalesce(p_note, ''), updated_at = now(),
           scheme_file_id = v_file, scheme_version_id = v_ver, scheme_page = 1
     where id = p_id and project_id = p_project;
    if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;
    if v_file is distinct from v_old.scheme_file_id or v_ver is distinct from v_old.scheme_version_id then
      update public.inspection_items set scheme_x = null, scheme_y = null where report_id = p_id;
    end if;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

-- Выбор другой схемы: только из тех, что привязаны к месту (изображение или версия чертежа); пусто — без схемы
create function public.inspection_set_scheme(p_report uuid, p_file uuid default null, p_version uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report);
begin
  if p_file is not null and p_version is not null then raise exception 'scheme_not_from_place' using errcode = '22023'; end if;
  if (p_file is not null or p_version is not null) and not exists (
       select 1 from public.inspection_scheme_options(r.location_id) o where (p_file is not null and o.file_id = p_file) or (p_version is not null and o.version_id = p_version)) then
    raise exception 'scheme_not_from_place' using errcode = '22023';
  end if;
  if p_file is distinct from r.scheme_file_id or p_version is distinct from r.scheme_version_id then
    update public.inspection_items set scheme_x = null, scheme_y = null where report_id = r.id;
  end if;
  update public.inspection_reports set scheme_file_id = p_file, scheme_version_id = p_version, scheme_page = 1, updated_at = now() where id = r.id;
end;
$$;
revoke execute on function public.inspection_set_scheme(uuid, uuid, uuid) from public, anon;
grant execute on function public.inspection_set_scheme(uuid, uuid, uuid) to authenticated;

-- Точка на схеме возможна, если у отчёта есть схема любого вида
create or replace function public.inspection_item_point(p_item uuid, p_x numeric default null, p_y numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspection_items;
  r public.inspection_reports;
begin
  select * into i from public.inspection_items where id = p_item and tenant_id = private.tenant_id();
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  r := private.inspection_guard(i.report_id);
  if (p_x is null) <> (p_y is null) or p_x not between 0 and 1 or p_y not between 0 and 1 then raise exception 'point_invalid' using errcode = '22023'; end if;
  if p_x is not null and r.scheme_file_id is null and r.scheme_version_id is null then raise exception 'no_scheme' using errcode = '22023'; end if;
  update public.inspection_items set scheme_x = round(p_x, 4), scheme_y = round(p_y, 4), updated_at = now() where id = i.id;
end;
$$;

notify pgrst, 'reload schema';
