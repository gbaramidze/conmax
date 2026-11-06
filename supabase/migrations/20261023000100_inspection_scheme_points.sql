-- Инспекция: схема берётся от места, на схеме отмечается точка замечания, подписывает только тот, кто провёл инспекцию.
--
-- Схема больше не загружается в отчёт: она заранее привязана к месту (изображения помещения, изображения типа номера или, если у помещения
-- их нет, ближайшего вышестоящего узла, например плана этажа). При создании отчёта схема подставляется сама; при смене места подставляется
-- схема нового места. Выбрать другую можно только из изображений, уже лежащих у места (`inspection_scheme_options`).
-- Точка замечания: доли ширины и высоты схемы (0–1) у замечания (`scheme_x`, `scheme_y`); при смене схемы точки сбрасываются, потому что
-- координаты относятся к конкретному изображению.
-- Подпись: `inspection_sign` и `inspection_sign_clear` доступны только автору отчёта (тому, кто провёл инспекцию). Подпись заказчика ставится
-- от его имени из профиля (имя с клиента не принимается), подпись подрядчика — с введённым именем представителя подрядчика.
-- См. docs: 04-modules/19-quality-control.md.

alter table public.inspection_items
  add column scheme_x numeric(5, 4) check (scheme_x between 0 and 1),
  add column scheme_y numeric(5, 4) check (scheme_y between 0 and 1),
  add constraint inspection_items_point_pair check ((scheme_x is null) = (scheme_y is null));

-- Варианты схемы для места с источником: 1 — само место, 2 — тип номера, 3 — вышестоящий узел (ближайший первым)
create or replace function public.inspection_scheme_options(p_location uuid)
returns table (file_id uuid, caption text, name text, storage_key text, source text, rank integer, is_cover boolean, sort integer)
language sql stable security definer set search_path = '' as $$
  with loc as (
    select l.id, l.path, l.project_id from public.locations l
     where l.id = p_location and l.tenant_id = private.tenant_id() and l.deleted_at is null
       and private.can_see_project(l.project_id)
  ),
  cand as (
    select i.file_id, i.caption, 'location'::text as source, 1 as rank, i.is_cover, i.sort
      from public.entity_images i, loc where i.entity_type = 'location' and i.entity_id = loc.id and i.project_id = loc.project_id
    union all
    select i.file_id, i.caption, 'room_type', 2, i.is_cover, i.sort
      from public.entity_images i, loc, public.room_specs rs
     where rs.location_id = loc.id and i.entity_type = 'room_type' and i.entity_id = rs.type_id and i.project_id = loc.project_id
    union all
    select i.file_id, i.caption, 'parent', 3 + (1000 - length(a.path::text)), i.is_cover, i.sort
      from public.entity_images i, loc
      join public.locations a on a.project_id = loc.project_id and a.deleted_at is null and loc.path::text like a.path::text || '.%'
     where i.entity_type = 'location' and i.entity_id = a.id and i.project_id = loc.project_id
  )
  select c.file_id, c.caption, f.name, f.storage_key, c.source, c.rank, c.is_cover, c.sort
    from cand c join public.files f on f.id = c.file_id
   where f.mime like 'image/%'
   order by c.rank, c.is_cover desc, c.sort
$$;
revoke execute on function public.inspection_scheme_options(uuid) from public, anon;
grant execute on function public.inspection_scheme_options(uuid) to authenticated;

-- Схема по умолчанию для места: изображения самого места (обложка первой), затем изображения типа номера, затем ближайший узел выше
create or replace function private.inspection_default_scheme(p_location uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select o.file_id
    from public.inspection_scheme_options(p_location) o
   order by o.rank, o.is_cover desc, o.sort
   limit 1
$$;

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
  v_scheme  uuid;
begin
  perform private.week_guard(p_project, array['inspection.conduct']);
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if p_location is not null then
    select * into v_loc from public.locations where id = p_location and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'location_not_found' using errcode = 'P0002'; end if;
    v_scheme := private.inspection_default_scheme(p_location);
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
    insert into public.inspection_reports (tenant_id, project_id, number, key, title, location_id, inspection_date, contractor_org_id, scheme_text, note, scheme_file_id)
    values (v_tenant, p_project, v_number, v_project.code || '-IR-' || v_number, v_title, p_location, coalesce(p_date, current_date), p_contractor,
            coalesce(p_scheme_text, ''), coalesce(p_note, ''), v_scheme)
    returning id into v_id;
    foreach v_code in array array['walls', 'floor', 'ceiling', 'doors', 'windows', 'electrical', 'sanitary', 'ffe'] loop
      v_pos := v_pos + 1;
      insert into public.inspection_sections (tenant_id, report_id, position, code) values (v_tenant, v_id, v_pos, v_code);
    end loop;
  else
    v_old := private.inspection_guard(p_id);
    update public.inspection_reports
       set title = v_title, location_id = p_location, inspection_date = coalesce(p_date, inspection_date), contractor_org_id = p_contractor,
           scheme_text = coalesce(p_scheme_text, ''), note = coalesce(p_note, ''), updated_at = now(),
           scheme_file_id = case when p_location is distinct from v_old.location_id then v_scheme else scheme_file_id end
     where id = p_id and project_id = p_project;
    if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;
    if p_location is distinct from v_old.location_id then
      update public.inspection_items set scheme_x = null, scheme_y = null where report_id = p_id;
    end if;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

-- Выбор другой схемы: только из изображений, которые уже есть у места (загрузка своих файлов в отчёт закрыта)
create or replace function public.inspection_set_scheme(p_report uuid, p_file uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report);
begin
  if p_file is not null and not exists (select 1 from public.inspection_scheme_options(r.location_id) o where o.file_id = p_file) then
    raise exception 'scheme_not_from_place' using errcode = '22023';
  end if;
  if p_file is distinct from r.scheme_file_id then
    update public.inspection_items set scheme_x = null, scheme_y = null where report_id = r.id;
  end if;
  update public.inspection_reports set scheme_file_id = p_file, updated_at = now() where id = r.id;
end;
$$;

-- Точка замечания на схеме (доли 0–1); обе пустые — убрать точку
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
  if p_x is not null and r.scheme_file_id is null then raise exception 'no_scheme' using errcode = '22023'; end if;
  update public.inspection_items set scheme_x = round(p_x, 4), scheme_y = round(p_y, 4), updated_at = now() where id = i.id;
end;
$$;
revoke execute on function public.inspection_item_point(uuid, numeric, numeric) from public, anon;
grant execute on function public.inspection_item_point(uuid, numeric, numeric) to authenticated;

-- Подпись: только автор отчёта. Заказчик подписывает от своего имени из профиля.
create or replace function public.inspection_sign(p_report uuid, p_side text, p_name text, p_file uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.inspection_reports := private.inspection_guard(p_report, false);
  v_name text := btrim(coalesce(p_name, ''));
begin
  if r.created_by is distinct from auth.uid() then raise exception 'sign_author_only' using errcode = '42501'; end if;
  if p_side not in ('client', 'contractor') then raise exception 'side_invalid' using errcode = '22023'; end if;
  if p_side = 'client' then
    select full_name into v_name from public.users where id = auth.uid();
  end if;
  if char_length(coalesce(v_name, '')) not between 1 and 200 then raise exception 'name_required' using errcode = '22023'; end if;
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
  if r.created_by is distinct from auth.uid() then raise exception 'sign_author_only' using errcode = '42501'; end if;
  if p_side not in ('client', 'contractor') then raise exception 'side_invalid' using errcode = '22023'; end if;
  if p_side = 'client' then
    update public.inspection_reports set client_name = null, client_signed_at = null, client_sign_file_id = null, updated_at = now() where id = r.id;
  else
    update public.inspection_reports set contractor_name = null, contractor_signed_at = null, contractor_sign_file_id = null, updated_at = now() where id = r.id;
  end if;
end;
$$;
notify pgrst, 'reload schema';
