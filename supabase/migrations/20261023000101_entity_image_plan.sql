-- Изображения места: отметка «схема».
--
-- У места лежат рендеры и планировки в одном списке; отчёт об инспекции брал схемой любое из них, и вместо плана попадал рендер.
-- Теперь у изображения есть признак `is_plan` («схема»): в отчёт об инспекции подставляются и предлагаются только такие изображения.
-- Отметить схему может тот, кто вправе менять изображения места (`entity_image_set_plan`).
-- Схемы в уже созданных отчётах выбирались без этого признака, поэтому сбрасываются (вместе с точками замечаний): их нужно выбрать заново
-- среди отмеченных схем. См. docs: 04-modules/19-quality-control.md.

alter table public.entity_images add column is_plan boolean not null default false;

create or replace function public.entity_image_set_plan(p_image uuid, p_plan boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.entity_images;
begin
  select * into i from public.entity_images where id = p_image and tenant_id = private.tenant_id();
  if not found then raise exception 'image_not_found' using errcode = 'P0002'; end if;
  perform private.image_guard(i.project_id, i.entity_type);
  update public.entity_images set is_plan = coalesce(p_plan, false) where id = i.id;
end;
$$;
revoke execute on function public.entity_image_set_plan(uuid, boolean) from public, anon;
grant execute on function public.entity_image_set_plan(uuid, boolean) to authenticated;

-- Варианты схемы для места: только изображения, отмеченные как схема
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
      from public.entity_images i, loc where i.is_plan and i.entity_type = 'location' and i.entity_id = loc.id and i.project_id = loc.project_id
    union all
    select i.file_id, i.caption, 'room_type', 2, i.is_cover, i.sort
      from public.entity_images i, loc, public.room_specs rs
     where i.is_plan and rs.location_id = loc.id and i.entity_type = 'room_type' and i.entity_id = rs.type_id and i.project_id = loc.project_id
    union all
    select i.file_id, i.caption, 'parent', 3 + (1000 - length(a.path::text)), i.is_cover, i.sort
      from public.entity_images i, loc
      join public.locations a on a.project_id = loc.project_id and a.deleted_at is null and loc.path::text like a.path::text || '.%'
     where i.is_plan and i.entity_type = 'location' and i.entity_id = a.id and i.project_id = loc.project_id
  )
  select c.file_id, c.caption, f.name, f.storage_key, c.source, c.rank, c.is_cover, c.sort
    from cand c join public.files f on f.id = c.file_id
   where f.mime like 'image/%'
   order by c.rank, c.is_cover desc, c.sort
$$;

-- Прежние схемы в отчётах выбирались без признака: сбрасываем их и точки на них
update public.inspection_items set scheme_x = null, scheme_y = null where scheme_x is not null;
update public.inspection_reports set scheme_file_id = null where scheme_file_id is not null;
notify pgrst, 'reload schema';
