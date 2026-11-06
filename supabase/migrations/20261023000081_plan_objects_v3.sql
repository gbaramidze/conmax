-- Слои объектов, третья часть: свой цвет объекта и характеристики (камера — мегапиксели и объектив, светильник — мощность…).
--
-- `color` — цвет метки или трассы в виде #rrggbb; пусто — цвет типа из каталога.
-- `specs` — характеристики объекта: словарь «ключ → значение» (строка или число). Какие ключи у какого типа бывают и как они
-- подписаны, описывает каталог в приложении (камера: `mp`, `lens`; светильник: `watt`…), поэтому новая характеристика
-- не требует миграции. База проверяет только вид словаря: до 12 ключей, ключ из латиницы, значение до 40 знаков.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Слои объектов на планах».

-- Проверка характеристик: словарь из ≤ 12 ключей, значения — короткие строки или числа
create or replace function private.plan_specs_ok(p_specs jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
begin
  if p_specs is null or jsonb_typeof(p_specs) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_specs)) > 12 then return false; end if;
  for k, v in select * from jsonb_each(p_specs) loop
    if k !~ '^[a-z][a-z0-9_]{0,19}$' then return false; end if;
    if jsonb_typeof(v) = 'string' then
      if char_length(v #>> '{}') > 40 then return false; end if;
    elsif jsonb_typeof(v) <> 'number' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke execute on function private.plan_specs_ok(jsonb) from public, anon, authenticated;

alter table public.plan_objects
  add column color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  add column specs jsonb not null default '{}' check (private.plan_specs_ok(specs));

drop function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid, text, numeric, numeric);
create or replace function public.plan_object_set(
  p_project uuid, p_document uuid, p_page integer, p_type text, p_geometry text, p_points jsonb,
  p_label text default '', p_status text default 'installed', p_notes text default '', p_id uuid default null,
  p_variant text default null, p_rotation numeric default 0, p_size numeric default 1,
  p_color text default null, p_specs jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
  v_rot    numeric := coalesce(p_rotation, 0);
  v_specs  jsonb := coalesce(p_specs, '{}'::jsonb);
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 or p_type is null or p_type !~ '^[a-z][a-z0-9_]{1,29}$'
     or p_geometry not in ('point', 'line') or not private.plan_points_ok(p_points, p_geometry)
     or (p_variant is not null and p_variant !~ '^[a-z][a-z0-9_]{1,29}$')
     or coalesce(p_size, 1) not between 0.5 and 3
     or (p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$')
     or not private.plan_specs_ok(v_specs) then
    raise exception 'position_invalid' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'installed', 'checked', 'defect') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;
  -- направление приводим к 0…360: 370 и −10 означают 10 и 350
  v_rot := v_rot - floor(v_rot / 360) * 360;
  if p_id is null then
    insert into public.plan_objects (tenant_id, project_id, document_id, page, type_code, geometry, points, label, status, notes, variant, rotation, size, color, specs)
    values (v_tenant, p_project, p_document, p_page, p_type, p_geometry, p_points, coalesce(trim(p_label), ''), p_status, coalesce(trim(p_notes), ''),
            p_variant, v_rot, coalesce(p_size, 1), lower(p_color), v_specs)
    returning id into v_id;
  else
    update public.plan_objects
       set page = p_page, points = p_points, label = coalesce(trim(p_label), ''), status = p_status, notes = coalesce(trim(p_notes), ''),
           variant = p_variant, rotation = v_rot, size = coalesce(p_size, 1), color = lower(p_color), specs = v_specs, updated_at = now()
     where id = p_id and project_id = p_project and document_id = p_document and tenant_id = v_tenant and type_code = p_type and geometry = p_geometry
     returning id into v_id;
    if v_id is null then raise exception 'object_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid, text, numeric, numeric, text, jsonb) from public, anon;
grant execute on function public.plan_object_set(uuid, uuid, integer, text, text, jsonb, text, text, text, uuid, text, numeric, numeric, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
