-- Рендеры: папки с подпапками и версии.
--
-- Папки. У изображения появляется `folder` — путь папки внутри места или типа номера («Спальня» или «Спальня/Ночь»). Он заполняется
-- при загрузке папки целиком (подпапки сохраняются) и нужен только для порядка в галерее: на правах и видимости не сказывается.
--
-- Версии. Изображение — это «рендер», у которого может быть несколько версий (v1, v2…): дизайнер перевыпустил картинку, и новая
-- версия становится текущей, а прежние остаются в истории. Текущая версия — `entity_images.file_id`, поэтому обложки, плитки этажа
-- и всё, что уже читает `entity_images`, работают без изменений. Любую прежнюю версию можно вернуть текущей или удалить.
-- Файлы версий видит тот, кто видит рендер (политика `files_select` расширена).
-- Права те же, что у самих изображений: место — `location.manage`, тип номера — ещё и `schedule.edit`.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Рендеры: папки и версии».

alter table public.entity_images
  add column folder text not null default '' check (char_length(folder) <= 200 and folder !~ '^/' and folder !~ '/$' and folder !~ '//');

create table public.entity_image_versions (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  image_id   uuid not null references public.entity_images(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  file_id    uuid not null references public.files(id),
  note       text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid() references public.users(id),
  created_at timestamptz not null default now(),
  unique (image_id, version_no)
);
create index on public.entity_image_versions (file_id);
create index on public.entity_image_versions (project_id);

alter table public.entity_image_versions enable row level security;
alter table public.entity_image_versions force row level security;
revoke insert, update, delete on public.entity_image_versions from authenticated;
create policy entity_image_versions_select on public.entity_image_versions for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- У уже загруженных изображений первая версия — их текущий файл
insert into public.entity_image_versions (tenant_id, project_id, image_id, version_no, file_id, created_by, created_at)
select tenant_id, project_id, id, 1, file_id, created_by, created_at from public.entity_images;

-- Файл виден, если он — текущая или прежняя версия изображения
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
         or exists (select 1 from public.entity_image_versions v where v.file_id = files.id))
  );

-- Добавить изображение (теперь сразу с первой версией и папкой)
drop function public.entity_image_add(uuid, text, uuid, uuid, text);
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
  select not exists (select 1 from public.entity_images where entity_type = p_type and entity_id = p_entity) into v_first;
  insert into public.entity_images (tenant_id, project_id, entity_type, entity_id, file_id, caption, is_cover, sort, folder)
  values (v_tenant, p_project, p_type, p_entity, p_file, nullif(btrim(coalesce(p_caption, '')), ''), v_first,
          coalesce((select max(sort) + 1 from public.entity_images where entity_type = p_type and entity_id = p_entity), 0), v_folder)
  returning id into v_id;
  insert into public.entity_image_versions (tenant_id, project_id, image_id, version_no, file_id) values (v_tenant, p_project, v_id, 1, p_file);
  return v_id;
end;
$$;
revoke execute on function public.entity_image_add(uuid, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.entity_image_add(uuid, text, uuid, uuid, text, text) to authenticated;

-- Папка изображения: перенести в другую папку («» — в корень)
create or replace function public.entity_image_move(p_image uuid, p_folder text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i        public.entity_images;
  v_folder text := btrim(coalesce(p_folder, ''), ' /');
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  if char_length(v_folder) > 200 or v_folder ~ '//' then raise exception 'invalid_folder' using errcode = '22023'; end if;
  update public.entity_images set folder = v_folder where id = i.id;
end;
$$;
revoke execute on function public.entity_image_move(uuid, text) from public, anon;
grant execute on function public.entity_image_move(uuid, text) to authenticated;

-- Новая версия изображения: становится текущей; возвращает её номер
create or replace function public.entity_image_add_version(p_image uuid, p_file uuid, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  i   public.entity_images;
  v_n integer;
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = i.project_id and f.tenant_id = i.tenant_id and f.created_by = auth.uid() and f.mime like 'image/%') then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  select coalesce(max(version_no), 0) + 1 into v_n from public.entity_image_versions where image_id = i.id;
  insert into public.entity_image_versions (tenant_id, project_id, image_id, version_no, file_id, note)
  values (i.tenant_id, i.project_id, i.id, v_n, p_file, nullif(btrim(coalesce(p_note, '')), ''));
  update public.entity_images set file_id = p_file where id = i.id;
  return v_n;
end;
$$;
revoke execute on function public.entity_image_add_version(uuid, uuid, text) from public, anon;
grant execute on function public.entity_image_add_version(uuid, uuid, text) to authenticated;

-- Вернуть прежнюю версию текущей (история сохраняется)
create or replace function public.entity_image_restore(p_image uuid, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i   public.entity_images;
  v   public.entity_image_versions;
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  select * into v from public.entity_image_versions where image_id = i.id and version_no = p_version;
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  update public.entity_images set file_id = v.file_id where id = i.id;
end;
$$;
revoke execute on function public.entity_image_restore(uuid, integer) from public, anon;
grant execute on function public.entity_image_restore(uuid, integer) to authenticated;

-- Удалить прежнюю версию (текущую удалить нельзя); возвращает ключ файла для очистки хранилища
create or replace function public.entity_image_version_delete(p_image uuid, p_version integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i      public.entity_images;
  v      public.entity_image_versions;
  v_key  text;
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  select * into v from public.entity_image_versions where image_id = i.id and version_no = p_version;
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if v.file_id = i.file_id then raise exception 'version_is_current' using errcode = '22023'; end if;
  select storage_key into v_key from public.files where id = v.file_id;
  delete from public.entity_image_versions where id = v.id;
  delete from public.files where id = v.file_id and not exists (select 1 from public.attachments a where a.file_id = v.file_id)
                                              and not exists (select 1 from public.entity_images x where x.file_id = v.file_id)
                                              and not exists (select 1 from public.entity_image_versions y where y.file_id = v.file_id);
  return v_key;
end;
$$;
revoke execute on function public.entity_image_version_delete(uuid, integer) from public, anon;
grant execute on function public.entity_image_version_delete(uuid, integer) to authenticated;

-- Убрать изображение целиком; возвращает ключи файлов всех версий, чтобы клиент удалил объекты из хранилища
drop function public.entity_image_delete(uuid);
create or replace function public.entity_image_delete(p_image uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  i       public.entity_images;
  v_keys  text[];
  v_files uuid[];
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  select coalesce(array_agg(distinct f), '{}') into v_files from (select i.file_id as f union select file_id from public.entity_image_versions where image_id = i.id) s;
  select coalesce(array_agg(storage_key), '{}') into v_keys from public.files where id = any (v_files)
     and not exists (select 1 from public.attachments a where a.file_id = files.id);
  delete from public.entity_images where id = i.id;
  delete from public.files where id = any (v_files) and not exists (select 1 from public.attachments a where a.file_id = files.id)
                                                    and not exists (select 1 from public.entity_images x where x.file_id = files.id)
                                                    and not exists (select 1 from public.entity_image_versions y where y.file_id = files.id);
  if i.is_cover then
    update public.entity_images set is_cover = true
     where id = (select id from public.entity_images where entity_type = i.entity_type and entity_id = i.entity_id order by sort, created_at limit 1);
  end if;
  return v_keys;
end;
$$;
revoke execute on function public.entity_image_delete(uuid) from public, anon;
grant execute on function public.entity_image_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
