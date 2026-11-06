-- Рендеры: действия с папкой целиком — переименовать или перенести (в другую папку, другой тип номера или место), удалить, свести ревизии.
--
-- Папка — это путь `entity_images.folder` («Спальня/Ночь»); действие над папкой касается и её подпапок.
-- Перенос в другой тип номера или место переносит изображения со всей историей версий; обложкой они там не становятся,
-- пока у получателя есть своя (а если нет — обложкой станет первое перенесённое); в источнике обложка переходит к первому оставшемуся.
-- Сведение ревизий. Дизайнеры часто кладут обновлённые рендеры в соседние папки «JUNIOR SUITE 01.1», «01.2»: файлы с одинаковым
-- названием в них — это один рендер разных ревизий. `entity_image_folders_merge` принимает папки от старой к новой, превращает такие
-- файлы в версии одного изображения (новейшая — текущая) и собирает всё в одну папку.
-- Права те же, что у самих изображений: место — `location.manage`, тип номера — ещё и `schedule.edit`.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Рендеры: папки и версии».

-- Нормальный вид пути папки; null — путь недопустим (двойной слэш, слишком длинный)
create or replace function private.image_folder_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select case when char_length(btrim(coalesce(p, ''), ' /')) > 200 or btrim(coalesce(p, ''), ' /') ~ '//' then null else btrim(coalesce(p, ''), ' /') end
$$;

-- Лежит ли изображение в папке или её подпапке
create or replace function private.in_image_folder(p_image_folder text, p_folder text) returns boolean
language sql immutable set search_path = '' as $$
  select p_image_folder = p_folder or left(p_image_folder, char_length(p_folder) + 1) = p_folder || '/'
$$;

create or replace function private.image_entity_check(p_project uuid, p_type text, p_entity uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
begin
  if p_type not in ('location', 'room_type') then raise exception 'invalid_type' using errcode = '22023'; end if;
  perform private.image_guard(p_project, p_type);
  if p_type = 'location' and not exists (select 1 from public.locations where id = p_entity and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  if p_type = 'room_type' and not exists (select 1 from public.room_types where id = p_entity and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Если у сущности пропала обложка (перенесли или удалили), обложкой становится первое оставшееся изображение
create or replace function private.image_fix_cover(p_type text, p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entity_images where entity_type = p_type and entity_id = p_entity and is_cover) then
    update public.entity_images set is_cover = true
     where id = (select id from public.entity_images where entity_type = p_type and entity_id = p_entity order by sort, created_at limit 1);
  end if;
end;
$$;

-- Переименовать папку или перенести её (и подпапки) в другую папку, тип номера или место. Возвращает число перенесённых изображений.
create or replace function public.entity_image_folder_move(
  p_project uuid, p_type text, p_entity uuid, p_folder text,
  p_to_type text default null, p_to_entity uuid default null, p_to_folder text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from text := private.image_folder_norm(p_folder);
  v_to   text := private.image_folder_norm(coalesce(p_to_folder, p_folder));
  v_tt   text := coalesce(p_to_type, p_type);
  v_te   uuid := coalesce(p_to_entity, p_entity);
  v_n    integer;
  v_base integer;
begin
  if v_from is null or v_from = '' or v_to is null then raise exception 'invalid_folder' using errcode = '22023'; end if;
  perform private.image_entity_check(p_project, p_type, p_entity);
  perform private.image_entity_check(p_project, v_tt, v_te);
  -- блокировки в одном порядке, чтобы два переноса навстречу не зашли в тупик
  perform pg_advisory_xact_lock(hashtextextended(least(p_type || ':' || p_entity::text, v_tt || ':' || v_te::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_type || ':' || p_entity::text, v_tt || ':' || v_te::text), 0));

  if v_tt = p_type and v_te = p_entity then
    -- внутри одного места: меняется только путь
    if exists (select 1 from public.entity_images where entity_type = p_type and entity_id = p_entity and private.in_image_folder(folder, v_from)
                 and char_length(v_to || substr(folder, char_length(v_from) + 1)) > 200) then
      raise exception 'invalid_folder' using errcode = '22023';
    end if;
    update public.entity_images set folder = v_to || substr(folder, char_length(v_from) + 1)
     where entity_type = p_type and entity_id = p_entity and private.in_image_folder(folder, v_from);
    get diagnostics v_n = row_count;
    return v_n;
  end if;

  select coalesce(max(sort) + 1, 0) into v_base from public.entity_images where entity_type = v_tt and entity_id = v_te;
  with moved as (
    select id, row_number() over (order by sort, created_at) - 1 as rn
      from public.entity_images
     where entity_type = p_type and entity_id = p_entity and private.in_image_folder(folder, v_from)
  )
  update public.entity_images i
     set entity_type = v_tt, entity_id = v_te, folder = v_to || substr(i.folder, char_length(v_from) + 1), is_cover = false, sort = v_base + moved.rn
    from moved where i.id = moved.id;
  get diagnostics v_n = row_count;
  perform private.image_fix_cover(p_type, p_entity);
  perform private.image_fix_cover(v_tt, v_te);
  return v_n;
end;
$$;
revoke execute on function public.entity_image_folder_move(uuid, text, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.entity_image_folder_move(uuid, text, uuid, text, text, uuid, text) to authenticated;

-- Удалить папку со всеми подпапками, изображениями и версиями; возвращает ключи файлов для очистки хранилища
create or replace function public.entity_image_folder_delete(p_project uuid, p_type text, p_entity uuid, p_folder text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_from  text := private.image_folder_norm(p_folder);
  v_ids   uuid[];
  v_files uuid[];
  v_keys  text[];
begin
  if v_from is null or v_from = '' then raise exception 'invalid_folder' using errcode = '22023'; end if;
  perform private.image_entity_check(p_project, p_type, p_entity);
  perform pg_advisory_xact_lock(hashtextextended(p_type || ':' || p_entity::text, 0));
  select coalesce(array_agg(id), '{}') into v_ids from public.entity_images
   where entity_type = p_type and entity_id = p_entity and private.in_image_folder(folder, v_from);
  select coalesce(array_agg(distinct f), '{}') into v_files
    from (select file_id as f from public.entity_images where id = any (v_ids)
          union select file_id from public.entity_image_versions where image_id = any (v_ids)) s;
  select coalesce(array_agg(storage_key), '{}') into v_keys from public.files where id = any (v_files);
  delete from public.entity_images where id = any (v_ids);
  delete from public.files where id = any (v_files) and not exists (select 1 from public.attachments a where a.file_id = files.id)
                                                    and not exists (select 1 from public.entity_images x where x.file_id = files.id)
                                                    and not exists (select 1 from public.entity_image_versions y where y.file_id = files.id);
  perform private.image_fix_cover(p_type, p_entity);
  return v_keys;
end;
$$;
revoke execute on function public.entity_image_folder_delete(uuid, text, uuid, text) from public, anon;
grant execute on function public.entity_image_folder_delete(uuid, text, uuid, text) to authenticated;

-- Свести ревизии: папки от старой к новой; одноимённые файлы становятся версиями одного изображения (новейшая — текущая),
-- всё собирается в папку `p_target`. Возвращает число добавленных версий.
create or replace function public.entity_image_folders_merge(p_project uuid, p_type text, p_entity uuid, p_folders text[], p_target text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_target text := private.image_folder_norm(p_target);
  v_map    jsonb := '{}';
  v_added  integer := 0;
  v_folder text;
  r        record;
  v_surv   uuid;
  v_key    text;
  v        record;
  v_next   integer;
begin
  if v_target is null or coalesce(array_length(p_folders, 1), 0) < 1 or array_length(p_folders, 1) > 50 then raise exception 'invalid_folder' using errcode = '22023'; end if;
  perform private.image_entity_check(p_project, p_type, p_entity);
  perform pg_advisory_xact_lock(hashtextextended(p_type || ':' || p_entity::text, 0));
  foreach v_folder in array p_folders loop
    v_folder := private.image_folder_norm(v_folder);
    if v_folder is null or v_folder = '' then raise exception 'invalid_folder' using errcode = '22023'; end if;
    for r in
      select i.id, i.is_cover, i.file_id, lower(regexp_replace(regexp_replace(f.name, '\.[A-Za-z0-9]{2,5}$', ''), '[\s._-]*(v|ver|version)[\s._-]*\d+$', '', 'i')) as base
        from public.entity_images i join public.files f on f.id = i.file_id
       where i.entity_type = p_type and i.entity_id = p_entity and i.folder = v_folder
       order by i.sort, i.created_at
    loop
      v_key := r.base;
      v_surv := nullif(v_map ->> v_key, '')::uuid;
      if v_surv is null or v_key = '' then
        v_map := v_map || jsonb_build_object(v_key, r.id::text);
        continue;
      end if;
      -- более новая ревизия того же рендера: её версии переходят к первому изображению, текущей становится самая новая
      select coalesce(max(version_no), 0) into v_next from public.entity_image_versions where image_id = v_surv;
      for v in select id from public.entity_image_versions where image_id = r.id order by version_no loop
        v_next := v_next + 1;
        update public.entity_image_versions set image_id = v_surv, version_no = v_next, note = coalesce(note, 'из папки ' || v_folder) where id = v.id;
        v_added := v_added + 1;
      end loop;
      update public.entity_images set is_cover = false where id = r.id;
      update public.entity_images set file_id = r.file_id, is_cover = is_cover or r.is_cover where id = v_surv;
      delete from public.entity_images where id = r.id;
    end loop;
  end loop;
  update public.entity_images set folder = v_target
   where entity_type = p_type and entity_id = p_entity and folder = any (select private.image_folder_norm(x) from unnest(p_folders) x);
  perform private.image_fix_cover(p_type, p_entity);
  return v_added;
end;
$$;
revoke execute on function public.entity_image_folders_merge(uuid, text, uuid, text[], text) from public, anon;
grant execute on function public.entity_image_folders_merge(uuid, text, uuid, text[], text) to authenticated;

revoke execute on function private.image_folder_norm(text), private.in_image_folder(text, text), private.image_entity_check(uuid, text, uuid), private.image_fix_cover(text, uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
