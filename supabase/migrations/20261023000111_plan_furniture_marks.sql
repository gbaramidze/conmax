-- План комнаты: отметки мебели. Нажатие на надпись «CM-TV-01» на плане комнаты открывает позицию каталога с тем же кодом.
-- Если в PDF есть текстовый слой, надписи находятся сами (в браузере). Когда текста нет (чертёж сохранён кривыми, скан, картинка),
-- точку ставят вручную: нажали место на плане, выбрали позицию. Отметка — точка в долях страницы (0…1), как у булавок и зон,
-- привязана к документу и странице, поэтому видна всем, кто открыл этот план (один план у типа номера — отметки общие для всех номеров типа).
-- Одна позиция может быть отмечена несколько раз (два стула). Ставят и убирают те, кто правит мебель (`location.manage`, `schedule.edit`).
-- См. docs: 05-roadmap/05-backlog.md, раздел «План комнаты: мебель на плане».

create table public.plan_furniture_marks (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page        integer not null default 1 check (page >= 1),
  item_id     uuid not null references public.ffe_items(id) on delete cascade,
  x           numeric not null check (x between 0 and 1),
  y           numeric not null check (y between 0 and 1),
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now()
);
create index on public.plan_furniture_marks (project_id, document_id);
create index on public.plan_furniture_marks (item_id);

alter table public.plan_furniture_marks enable row level security;
alter table public.plan_furniture_marks force row level security;
revoke insert, update, delete on public.plan_furniture_marks from authenticated;
create policy plan_furniture_marks_select on public.plan_furniture_marks for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id));

-- Поставить отметку мебели на лист плана
create or replace function public.plan_furniture_mark_add(p_project uuid, p_document uuid, p_page integer, p_item uuid, p_x numeric, p_y numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_id     uuid;
begin
  perform private.week_guard(p_project, array['location.manage', 'schedule.edit']);
  if not exists (select 1 from public.documents where id = p_document and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ffe_items where id = p_item and project_id = p_project and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if p_page is null or p_page < 1 or p_x is null or p_y is null or p_x not between 0 and 1 or p_y not between 0 and 1 then
    raise exception 'position_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.plan_furniture_marks where document_id = p_document) >= 500 then
    raise exception 'too_many_marks' using errcode = '22023';
  end if;
  insert into public.plan_furniture_marks (tenant_id, project_id, document_id, page, item_id, x, y)
  values (v_tenant, p_project, p_document, p_page, p_item, p_x, p_y)
  returning id into v_id;
  return v_id;
end;
$$;

-- Убрать отметку
create or replace function public.plan_furniture_mark_delete(p_mark uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.plan_furniture_marks;
begin
  select * into m from public.plan_furniture_marks where id = p_mark and tenant_id = private.tenant_id();
  if not found then raise exception 'mark_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(m.project_id, array['location.manage', 'schedule.edit']);
  delete from public.plan_furniture_marks where id = m.id;
end;
$$;

revoke execute on function public.plan_furniture_mark_add(uuid, uuid, integer, uuid, numeric, numeric), public.plan_furniture_mark_delete(uuid) from public, anon;
grant execute on function public.plan_furniture_mark_add(uuid, uuid, integer, uuid, numeric, numeric), public.plan_furniture_mark_delete(uuid) to authenticated;
notify pgrst, 'reload schema';
