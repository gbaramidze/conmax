-- Закупки, этап P1 (Фаза 5, первая версия): заявки на материалы с площадки и их согласование с проверкой остатка бюджета статьи.
--
-- Заявка: название, статья бюджета (CBS), «нужно на площадке до», примечание и позиции (наименование, единица, количество, ориентировочная цена).
-- Ключ вида `RTG1-PR-4` по счётчику проекта (kind 'PR': 'P' занят задачами). Маршрут: черновик → на согласовании → согласована / отклонена → заказана → поставлена; отмена до заказа.
--   • создаёт, отправляет и отмечает поставку `procurement.request` (прораб, мастер, ПТО, ГИП, руководитель);
--   • согласует, отклоняет, возвращает, отмечает «заказано» `procurement.approve` (руководитель проекта);
--   • смотрит `procurement.view` (плюс все, у кого есть два других права).
-- Проверка бюджета: остаток статьи = бюджет − max(обязательства, факт) − уже согласованное, но не заказанное. Если оценка заявки больше остатка,
-- согласовать можно только с комментарием («сверх бюджета» уходит в ленту). Заявка без статьи бюджета не проверяется.
-- Внутреннее: внешние участники заявок не видят. Новые права выдаются системным ролям (существующим компаниям — здесь, новым — триггером на `roles`).
-- Не вошло: запрос цен и сравнение предложений (P2), заказы поставщику как обязательства, привязка к работе графика и ограничение `materials`,
-- приёмка по накладным, склад, номенклатура и ресурсная ведомость из сметы. См. docs: 05-roadmap/05-backlog.md.

create table public.material_requests (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  number          integer not null,
  key             text not null,
  title           text not null check (char_length(btrim(title)) between 1 and 200),
  cbs_item_id     uuid references public.cbs_items(id),
  needed_by       date,
  note            text not null default '' check (char_length(note) <= 4000),
  status          text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'delivered', 'cancelled')),
  decision_note   text not null default '' check (char_length(decision_note) <= 4000),
  order_ref       text not null default '' check (char_length(order_ref) <= 200),
  over_budget     boolean not null default false,
  requested_by    uuid default auth.uid() references public.users(id),
  decided_by      uuid references public.users(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (project_id, number)
);
create index on public.material_requests (project_id, status) where deleted_at is null;

create table public.material_request_lines (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  request_id  uuid not null references public.material_requests(id) on delete cascade,
  position    integer not null,
  name        text not null check (char_length(btrim(name)) between 1 and 300),
  unit        text not null default '' check (char_length(unit) <= 20),
  qty         numeric(14, 3) not null check (qty > 0),
  est_price   numeric(14, 2) check (est_price is null or est_price >= 0),
  note        text not null default '' check (char_length(note) <= 500),
  unique (request_id, position)
);

alter table public.material_requests enable row level security;
alter table public.material_requests force row level security;
alter table public.material_request_lines enable row level security;
alter table public.material_request_lines force row level security;
revoke insert, update, delete on public.material_requests, public.material_request_lines from authenticated;

create policy material_requests_select on public.material_requests for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and (private.has_project_permission(project_id, 'procurement.view') or private.has_project_permission(project_id, 'procurement.request')
              or private.has_project_permission(project_id, 'procurement.approve')));
create policy material_request_lines_select on public.material_request_lines for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and exists (select 1 from public.material_requests r where r.id = request_id));

-- Права: существующим компаниям и триггером для новых
create or replace function private.procurement_perms(p_code text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_code
    when 'project_manager' then array['procurement.view', 'procurement.request', 'procurement.approve']
    when 'chief_engineer'  then array['procurement.view', 'procurement.request']
    when 'pto'             then array['procurement.view', 'procurement.request']
    when 'foreman'         then array['procurement.view', 'procurement.request']
    when 'master'          then array['procurement.view', 'procurement.request']
    when 'economist'       then array['procurement.view']
    when 'observer'        then array['procurement.view']
    else array[]::text[]
  end
$$;

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, p
  from public.roles r, lateral unnest(private.procurement_perms(r.code)) as p
 where r.scope = 'project' and r.is_system and r.deleted_at is null
on conflict do nothing;

create or replace function private.roles_procurement_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'project' and new.is_system then
    insert into public.role_permissions (tenant_id, role_id, permission)
    select new.tenant_id, new.id, p from unnest(private.procurement_perms(new.code)) as p
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger roles_procurement_defaults after insert on public.roles for each row execute function private.roles_procurement_defaults();

-- Остаток бюджета по статье для заявки: бюджет, обязательства, факт, зарезервировано согласованными заявками, оценка самой заявки
create or replace function private.request_budget_check(p_request uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (select * from public.material_requests where id = p_request),
  ver as (select id from public.budget_versions where project_id = (select project_id from r) and status in ('approved', 'draft') order by (status = 'approved') desc, number desc limit 1),
  b as (
    select coalesce((select amount from public.budget_amounts where version_id = (select id from ver) and item_id = (select cbs_item_id from r)), 0) as bac,
           coalesce((select sum(amount) from public.budget_commitments where item_id = (select cbs_item_id from r) and deleted_at is null and status = 'active'), 0) as committed,
           coalesce((select sum(amount) from public.budget_actuals where item_id = (select cbs_item_id from r) and deleted_at is null), 0) as actual,
           coalesce((select sum(l.qty * coalesce(l.est_price, 0)) from public.material_requests x join public.material_request_lines l on l.request_id = x.id
                      where x.cbs_item_id = (select cbs_item_id from r) and x.status = 'approved' and x.deleted_at is null and x.id <> p_request), 0) as reserved,
           coalesce((select sum(qty * coalesce(est_price, 0)) from public.material_request_lines where request_id = p_request), 0) as estimate)
  select case when (select cbs_item_id from r) is null then null
              else jsonb_build_object('bac', bac, 'committed', committed, 'actual', actual, 'reserved', reserved, 'estimate', estimate,
                                      'remaining', bac - greatest(committed, actual) - reserved)
         end
    from b
$$;

-- Публичная обёртка для экрана: проверка видимости заявки на стороне вызывающего
create or replace function public.material_request_budget(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
          and (private.has_project_permission(r.project_id, 'procurement.view') or private.has_project_permission(r.project_id, 'procurement.request')
               or private.has_project_permission(r.project_id, 'procurement.approve'))) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  return private.request_budget_check(p_request);
end;
$$;

-- Создать заявку (p_id пусто) или изменить черновик целиком. p_lines: [{name, unit, qty, price, note}, ...]
create or replace function public.material_request_save(
  p_project uuid, p_title text, p_id uuid default null, p_cbs_item uuid default null, p_needed_by date default null,
  p_note text default '', p_lines jsonb default '[]'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_old     public.material_requests;
  v_id      uuid;
  v_number  integer;
  v_title   text := btrim(coalesce(p_title, ''));
  l         jsonb;
  i         integer := 0;
begin
  perform private.week_guard(p_project, array['procurement.request']);
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'lines_invalid' using errcode = '22023'; end if;
  if p_cbs_item is not null and not exists (select 1 from public.cbs_items where id = p_cbs_item and project_id = p_project and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'PR', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_number;
    insert into public.material_requests (tenant_id, project_id, number, key, title, cbs_item_id, needed_by, note)
    values (v_tenant, p_project, v_number, v_project.code || '-PR-' || v_number, v_title, p_cbs_item, p_needed_by, coalesce(p_note, ''))
    returning id into v_id;
    perform private.record_event(v_tenant, p_project, 'project', p_project, 'request_status',
                                 jsonb_build_object('key', v_project.code || '-PR-' || v_number, 'title', v_title, 'from', null, 'to', 'draft', 'note', ''));
  else
    select * into v_old from public.material_requests where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
    if v_old.status <> 'draft' then raise exception 'request_locked' using errcode = '22023'; end if;
    update public.material_requests set title = v_title, cbs_item_id = p_cbs_item, needed_by = p_needed_by, note = coalesce(p_note, ''), updated_at = now() where id = p_id;
    v_id := p_id;
    delete from public.material_request_lines where request_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    i := i + 1;
    if btrim(coalesce(l ->> 'name', '')) = '' or coalesce((l ->> 'qty')::numeric, 0) <= 0 then raise exception 'line_invalid' using errcode = '22023'; end if;
    insert into public.material_request_lines (tenant_id, request_id, position, name, unit, qty, est_price, note)
    values (v_tenant, v_id, i, btrim(l ->> 'name'), coalesce(l ->> 'unit', ''), (l ->> 'qty')::numeric, nullif(l ->> 'price', '')::numeric, coalesce(l ->> 'note', ''));
  end loop;
  return v_id;
end;
$$;

-- Переход по маршруту. p_note: комментарий (при отклонении обязателен; при согласовании сверх бюджета обязателен; при «заказано» — номер заказа или договора)
create or replace function public.material_request_transition(p_request uuid, p_to text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  v_ok   boolean := false;
  v_note text := btrim(coalesce(p_note, ''));
  v_chk  jsonb;
  v_over boolean := false;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['procurement.request', 'procurement.approve']);

  if r.status = 'draft' and p_to = 'submitted' then
    v_ok := private.has_project_permission(r.project_id, 'procurement.request');
    if v_ok and not exists (select 1 from public.material_request_lines where request_id = r.id) then raise exception 'lines_required' using errcode = '22023'; end if;
  elsif r.status in ('draft', 'submitted', 'approved') and p_to = 'cancelled' then
    v_ok := private.has_project_permission(r.project_id, 'procurement.request') or private.has_project_permission(r.project_id, 'procurement.approve');
  elsif r.status = 'submitted' and p_to in ('approved', 'rejected', 'draft') then
    v_ok := private.has_project_permission(r.project_id, 'procurement.approve');
    if v_ok and p_to = 'rejected' and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
    if v_ok and p_to = 'approved' then
      v_chk := private.request_budget_check(r.id);
      v_over := v_chk is not null and (v_chk ->> 'estimate')::numeric > (v_chk ->> 'remaining')::numeric + 0.005;
      if v_over and v_note = '' then raise exception 'over_budget_note_required' using errcode = '22023'; end if;
    end if;
  elsif r.status = 'approved' and p_to = 'ordered' then
    v_ok := private.has_project_permission(r.project_id, 'procurement.approve');
  elsif r.status = 'ordered' and p_to = 'delivered' then
    v_ok := private.has_project_permission(r.project_id, 'procurement.request') or private.has_project_permission(r.project_id, 'procurement.approve');
  else
    raise exception 'transition_invalid' using errcode = '22023';
  end if;
  if not v_ok then raise exception 'permission denied: procurement' using errcode = '42501'; end if;

  update public.material_requests
     set status = p_to, updated_at = now(),
         over_budget = case when p_to = 'approved' then v_over else over_budget end,
         decision_note = case when p_to in ('approved', 'rejected', 'draft') and v_note <> '' then v_note else decision_note end,
         order_ref = case when p_to = 'ordered' then v_note else order_ref end,
         decided_by = case when p_to in ('approved', 'rejected') then auth.uid() else decided_by end,
         decided_at = case when p_to in ('approved', 'rejected') then now() else decided_at end
   where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'request_status',
                               jsonb_build_object('key', r.key, 'title', r.title, 'from', r.status, 'to', p_to, 'note', v_note, 'over_budget', v_over));
end;
$$;

revoke execute on function public.material_request_budget(uuid), public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb), public.material_request_transition(uuid, text, text) from public, anon;
grant execute on function public.material_request_budget(uuid), public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb), public.material_request_transition(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
