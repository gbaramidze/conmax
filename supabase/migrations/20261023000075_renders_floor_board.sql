-- Рендеры и фото мест и типов номеров, сводка этажа для «плиток».
-- 1. `entity_images`: любое число изображений у места структуры (корпус, секция, этаж, помещение, зона) и у типа номера (King, Junior Suite…).
--    Одно изображение — обложка (показывается на плитках, в дереве, в шапке). Видят все, кто видит проект; добавляют, подписывают, назначают
--    обложку и убирают — те, кто управляет структурой (`location.manage`), а изображения типов номеров — ещё и ГИП/ПТО (`schedule.edit`), как и мебель.
--    Сами файлы лежат в общем хранилище (`files`): доступ к ним открывается наличием строки в `entity_images`.
-- 2. `floor_board(этаж)`: по каждому помещению этажа тип, площадь, мебель (всего и установлено), открытые и просроченные задачи, обложка — одним запросом
--    (с правами вызывающего: задачи считаются только те, что человек вправе видеть).
-- См. docs: 05-roadmap/05-backlog.md, раздел «Рендеры и плитки этажа».

create table public.entity_images (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('location', 'room_type')),
  entity_id   uuid not null,
  file_id     uuid not null references public.files(id),
  caption     text check (caption is null or char_length(caption) <= 300),
  is_cover    boolean not null default false,
  sort        integer not null default 0,
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now()
);
create index on public.entity_images (project_id, entity_type, entity_id, sort);
create index on public.entity_images (file_id);
create unique index entity_images_one_cover on public.entity_images (entity_type, entity_id) where is_cover;

alter table public.entity_images enable row level security;
alter table public.entity_images force row level security;
revoke insert, update, delete on public.entity_images from authenticated;
create policy entity_images_select on public.entity_images for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- Файл виден, если он — изображение места или типа номера (доступ к ним задаёт политика выше)
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id or v.preview_file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), id)
         or exists (select 1 from public.projects p where p.cover_file_id = files.id and p.deleted_at is null and private.can_see_project(p.id))
         or exists (select 1 from public.entity_images i where i.file_id = files.id))
  );

-- Право менять изображения: место — управляющие структурой, тип номера — ещё и ГИП/ПТО
create or replace function private.image_guard(p_project uuid, p_type text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type = 'location' then
    perform private.week_guard(p_project, array['location.manage']);
  else
    perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  end if;
end;
$$;

create or replace function public.entity_image_add(p_project uuid, p_type text, p_entity uuid, p_file uuid, p_caption text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
  v_first  boolean;
begin
  if p_type not in ('location', 'room_type') then raise exception 'invalid_type' using errcode = '22023'; end if;
  perform private.image_guard(p_project, p_type);
  if p_type = 'location' and not exists (select 1 from public.locations where id = p_entity and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  if p_type = 'room_type' and not exists (select 1 from public.room_types where id = p_entity and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  -- файл — свой, из этого проекта и изображение
  if not exists (select 1 from public.files f where f.id = p_file and f.project_id = p_project and f.tenant_id = v_tenant and f.created_by = auth.uid() and f.mime like 'image/%') then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  select not exists (select 1 from public.entity_images where entity_type = p_type and entity_id = p_entity) into v_first;
  insert into public.entity_images (tenant_id, project_id, entity_type, entity_id, file_id, caption, is_cover, sort)
  values (v_tenant, p_project, p_type, p_entity, p_file, nullif(btrim(coalesce(p_caption, '')), ''), v_first,
          coalesce((select max(sort) + 1 from public.entity_images where entity_type = p_type and entity_id = p_entity), 0))
  returning id into v_id;
  return v_id;
end;
$$;

-- Подпись и обложка: обложкой становится ровно одно изображение
create or replace function public.entity_image_set(p_image uuid, p_caption text, p_cover boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.entity_images;
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  if coalesce(p_cover, false) and not i.is_cover then
    update public.entity_images set is_cover = false where entity_type = i.entity_type and entity_id = i.entity_id and is_cover;
  end if;
  update public.entity_images set caption = nullif(btrim(coalesce(p_caption, '')), ''), is_cover = coalesce(p_cover, i.is_cover) where id = i.id;
end;
$$;

-- Убрать изображение; возвращает ключ файла, чтобы клиент удалил и сам объект из хранилища. Если обложку убрали, обложкой становится первое из оставшихся.
create or replace function public.entity_image_delete(p_image uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i      public.entity_images;
  v_key  text;
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  select storage_key into v_key from public.files where id = i.file_id;
  delete from public.entity_images where id = i.id;
  delete from public.files where id = i.file_id and not exists (select 1 from public.attachments a where a.file_id = i.file_id)
                                               and not exists (select 1 from public.entity_images x where x.file_id = i.file_id);
  if i.is_cover then
    update public.entity_images set is_cover = true
     where id = (select id from public.entity_images where entity_type = i.entity_type and entity_id = i.entity_id order by sort, created_at limit 1);
  end if;
  return v_key;
end;
$$;

-- Сводка этажа: помещения с типом, площадью, мебелью, задачами и обложкой (своя, иначе обложка типа номера)
create or replace function public.floor_board(p_floor uuid) returns table (
  id uuid, path text, code text, name text, purpose text, type_id uuid, type_name text, area numeric,
  ffe_total integer, ffe_installed integer, tasks_open integer, tasks_overdue integer, cover_key text
)
language sql stable set search_path = '' as $$
  select l.id, l.path::text, l.code, l.name, l.purpose, rs.type_id, rt.name, coalesce(rs.area, rt.area),
         coalesce(f.total, 0)::integer, coalesce(f.installed, 0)::integer, coalesce(t.open, 0)::integer, coalesce(t.overdue, 0)::integer, img.storage_key
    from public.locations l
    left join public.room_specs rs on rs.location_id = l.id
    left join public.room_types rt on rt.id = rs.type_id and rt.deleted_at is null
    left join lateral (select sum(r.qty) as total, sum(r.qty) filter (where r.status = 'installed') as installed
                         from public.room_ffe r where r.location_id = l.id) f on true
    left join lateral (select count(*) filter (where k.status_category not in ('done', 'cancelled')) as open,
                              count(*) filter (where k.status_category not in ('done', 'cancelled') and k.due_date < current_date) as overdue
                         from public.tasks k where k.location_id = l.id and k.deleted_at is null) t on true
    left join lateral (select fl.storage_key
                         from public.entity_images i join public.files fl on fl.id = i.file_id
                        where i.is_cover and ((i.entity_type = 'location' and i.entity_id = l.id) or (i.entity_type = 'room_type' and i.entity_id = rs.type_id))
                        order by (i.entity_type = 'location') desc limit 1) img on true
   where l.parent_id = p_floor and l.kind = 'room' and l.deleted_at is null
   order by coalesce(l.position, l.sort::numeric), l.code;
$$;

revoke execute on function public.entity_image_add(uuid, text, uuid, uuid, text), public.entity_image_set(uuid, text, boolean),
  public.entity_image_delete(uuid), public.floor_board(uuid) from public, anon;
grant execute on function public.entity_image_add(uuid, text, uuid, uuid, text), public.entity_image_set(uuid, text, boolean),
  public.entity_image_delete(uuid), public.floor_board(uuid) to authenticated;
grant execute on function private.image_guard(uuid, text) to authenticated;
notify pgrst, 'reload schema';
