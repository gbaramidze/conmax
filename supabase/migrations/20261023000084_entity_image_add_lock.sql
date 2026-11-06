-- Рендеры: параллельная загрузка нескольких картинок в один тип номера или место.
-- Первая картинка становится обложкой (она одна на сущность), а порядок берётся как «максимум + 1». Если две картинки пришли одновременно
-- (загрузка папкой идёт в три потока), обе видели «картинок ещё нет», и вторая упиралась в уникальность обложки.
-- Теперь добавление берёт блокировку на эту сущность до конца транзакции: вторая ждёт первую и видит уже её запись.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Рендеры: папки и версии».

create or replace function public.entity_image_add(p_project uuid, p_type text, p_entity uuid, p_file uuid, p_caption text default null, p_folder text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
  v_first  boolean;
  v_folder text := btrim(coalesce(p_folder, ''), ' /');
begin
  if p_type not in ('location', 'room_type') then raise exception 'invalid_type' using errcode = '22023'; end if;
  perform private.image_guard(p_project, p_type);
  if char_length(v_folder) > 200 or v_folder ~ '//' then raise exception 'invalid_folder' using errcode = '22023'; end if;
  if p_type = 'location' and not exists (select 1 from public.locations where id = p_entity and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  if p_type = 'room_type' and not exists (select 1 from public.room_types where id = p_entity and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = p_project and f.tenant_id = v_tenant and f.created_by = auth.uid() and f.mime like 'image/%') then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  -- одновременные добавления в одну сущность идут по очереди
  perform pg_advisory_xact_lock(hashtextextended(p_type || ':' || p_entity::text, 0));
  select not exists (select 1 from public.entity_images where entity_type = p_type and entity_id = p_entity) into v_first;
  insert into public.entity_images (tenant_id, project_id, entity_type, entity_id, file_id, caption, is_cover, sort, folder)
  values (v_tenant, p_project, p_type, p_entity, p_file, nullif(btrim(coalesce(p_caption, '')), ''), v_first,
          coalesce((select max(sort) + 1 from public.entity_images where entity_type = p_type and entity_id = p_entity), 0), v_folder)
  returning id into v_id;
  insert into public.entity_image_versions (tenant_id, project_id, image_id, version_no, file_id) values (v_tenant, p_project, v_id, 1, p_file);
  return v_id;
end;
$$;
