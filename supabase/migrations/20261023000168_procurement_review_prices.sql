-- Закупки, часть 3.1 — по уточнённой процедуре компании:
--
-- 1. Должности закупок в справочнике должностей (их назначают позициям оргструктуры в «Персонале»):
--    Закупщик, Руководитель закупок, Бухгалтер, Финансовый директор, Директор проектов, Кладовщик.
--    Закупщик и руководитель закупок автоматически получают роль компании «Отдел закупок» (все заявки, все проекты).
-- 2. Подтверждение заявки руководителем сотрудника (первый шаг): руководитель из оргструктуры (staff_profiles.manager_id,
--    иначе руководитель отдела и выше); для заявки проекта без руководителя в оргструктуре — руководитель проекта.
--    Статус review («У руководителя»): подтвердить → в закупки, вернуть на доработку, отклонить.
-- 3. Проверка на складе: закупщик переводит заявку в stock_check, кладовщики отмечают «нет / частично / есть»,
--    заявка возвращается закупщику, инициатор узнаёт, если что-то есть.
-- 4. Цены видят только финансы и согласующие: закупщики, должности руководителя закупок, бухгалтера, финансового директора,
--    директора проектов, право бюджета (budget.view), согласующие этой заявки. Инициатор и его руководитель цен не видят,
--    но видят, что выбрано: у предложения по каждой позиции — описание модели (rfq_quote_lines.model).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Должности закупок
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.seed_procurement_positions(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x record;
begin
  for x in select * from (values
      ('buyer', 'Закупщик'), ('procurement_head', 'Руководитель закупок'), ('accountant', 'Бухгалтер'),
      ('finance_director', 'Финансовый директор'), ('projects_director', 'Директор проектов'), ('storekeeper', 'Кладовщик')
    ) v(code, name)
  loop
    -- должность с таким названием уже заведена вручную (из оргструктуры) — узнаём её по коду
    update public.roles set code = x.code
     where tenant_id = p_tenant and scope = 'project' and deleted_at is null and lower(name) = lower(x.name) and code like 'custom\_%'
       and not exists (select 1 from public.roles r2 where r2.tenant_id = p_tenant and r2.scope = 'project' and r2.code = x.code);
    insert into public.roles (tenant_id, scope, code, name, is_system)
    select p_tenant, 'project', x.code, x.name, false
     where not exists (select 1 from public.roles r2 where r2.tenant_id = p_tenant and r2.scope = 'project'
                         and (r2.code = x.code or (lower(r2.name) = lower(x.name) and r2.deleted_at is null)))
    on conflict (tenant_id, scope, code) do nothing;
  end loop;
end;
$$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop perform private.seed_procurement_positions(t.id); end loop;
end $$;

create or replace function private.roles_procurement_dept() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'tenant' and new.code = 'tenant_admin' then
    perform private.seed_procurement_role(new.tenant_id);
    perform private.seed_procurement_positions(new.tenant_id);
  end if;
  return null;
end;
$$;

-- Должности человека в оргструктуре (коды ролей позиций)
create or replace function private.user_positions(p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct r.code), '{}')
    from public.staff_positions sp join public.roles r on r.id = sp.role_id
   where sp.user_id = p_user and r.deleted_at is null;
$$;

create or replace function private.user_holds(p_user uuid, p_codes text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_positions(p_user) && p_codes;
$$;

-- Закупщик и руководитель закупок в оргструктуре = роль компании «Отдел закупок» (права на все заявки и проекты)
create or replace function private.sync_procurement_role(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   uuid;
begin
  if p_user is null then return; end if;
  select tenant_id into v_tenant from public.users where id = p_user;
  select id into v_role from public.roles where tenant_id = v_tenant and scope = 'tenant' and code = 'procurement' and deleted_at is null;
  if v_role is null then return; end if;
  if private.user_holds(p_user, array['buyer', 'procurement_head']) then
    insert into public.user_tenant_roles (user_id, role_id, tenant_id) values (p_user, v_role, v_tenant) on conflict do nothing;
  end if;
end;
$$;

create or replace function private.staff_positions_procurement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform private.sync_procurement_role(new.user_id); end if;
  return null;
end;
$$;
create trigger staff_positions_procurement after insert or update of user_id, role_id on public.staff_positions
  for each row execute function private.staff_positions_procurement();

do $$
declare u record;
begin
  for u in select distinct user_id from public.staff_positions where user_id is not null loop perform private.sync_procurement_role(u.user_id); end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2–3. Новые шаги: у руководителя (review) и проверка на складе (stock_check)
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.material_requests drop constraint material_requests_status_check;
alter table public.material_requests add constraint material_requests_status_check
  check (status in ('draft', 'review', 'submitted', 'sourcing', 'stock_check', 'approval', 'confirming', 'confirmed', 'ordered', 'shipped', 'delivered', 'rejected', 'cancelled'));
alter table public.material_requests
  add column manager_id   uuid references public.users(id),
  add column reviewed_by  uuid references public.users(id),
  add column reviewed_at  timestamptz,
  add column stock_return text check (stock_return in ('submitted', 'sourcing'));

alter table public.rfq_quote_lines add column model text not null default '' check (char_length(model) <= 500);

-- Руководитель сотрудника: из оргструктуры (непосредственный, иначе руководитель отдела и выше по дереву);
-- для заявки проекта без руководителя в оргструктуре — руководитель проекта
create or replace function private.request_manager_for(p_user uuid, p_project uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mgr  uuid;
  v_dep  uuid;
  i      integer := 0;
begin
  select manager_id, department_id into v_mgr, v_dep from public.staff_profiles where user_id = p_user;
  while v_mgr is null and v_dep is not null and i < 30 loop
    select case when head_user_id is distinct from p_user then head_user_id end, parent_id into v_mgr, v_dep from public.staff_departments where id = v_dep;
    i := i + 1;
  end loop;
  if v_mgr is null and p_project is not null then
    select pm.user_id into v_mgr
      from public.project_members pm join public.roles ro on ro.id = pm.role_id join public.users u on u.id = pm.user_id
     where pm.project_id = p_project and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
       and ro.code = 'project_manager' and pm.user_id <> p_user and u.status <> 'blocked'
     order by pm.created_at limit 1;
  end if;
  if v_mgr = p_user then return null; end if;
  return v_mgr;
end;
$$;

-- Видит цены этой заявки: закупщики и финансы, право бюджета, согласующие этой заявки
create or replace function private.user_can_see_prices(p_user uuid, p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.material_requests r join public.users u on u.id = p_user and u.tenant_id = r.tenant_id and not u.is_external
     where r.id = p_request
       and (private.user_is_buyer(p_user, r.project_id)
            or private.user_holds(p_user, array['buyer', 'procurement_head', 'accountant', 'finance_director', 'projects_director'])
            or private.user_has_tenant_permission(p_user, r.tenant_id, 'budget.view')
            or (private.user_can_see_project(p_user, r.project_id) and private.user_has_project_permission(p_user, r.project_id, 'budget.view'))
            or exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.user_id = p_user)));
$$;

create or replace function private.user_can_see_request(p_user uuid, p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.material_requests r
      join public.users u on u.id = p_user and u.tenant_id = r.tenant_id and u.status <> 'blocked'
     where r.id = p_request and r.deleted_at is null
       and (r.requested_by = p_user
            or r.manager_id = p_user
            or exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.user_id = p_user)
            or (not u.is_external and private.user_has_tenant_permission(p_user, r.tenant_id, 'procurement.manage'))
            or (not u.is_external and private.user_holds(p_user, array['buyer', 'procurement_head', 'accountant', 'finance_director', 'projects_director', 'storekeeper']))
            or (not u.is_external and private.user_can_see_project(p_user, r.project_id)
                and (private.user_has_project_permission(p_user, r.project_id, 'procurement.view')
                     or private.user_has_project_permission(p_user, r.project_id, 'procurement.request')
                     or private.user_has_project_permission(p_user, r.project_id, 'procurement.approve'))))
  );
$$;

create or replace function private.user_is_buyer(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p join public.users u on u.id = p_user and u.tenant_id = p.tenant_id
     where p.id = p_project and not u.is_external and u.status <> 'blocked'
       and (private.user_has_tenant_permission(p_user, p.tenant_id, 'procurement.manage')
            or private.user_holds(p_user, array['buyer', 'procurement_head'])
            or (private.user_can_see_project(p_user, p_project) and private.user_has_project_permission(p_user, p_project, 'procurement.approve')))
  );
$$;

-- Кладовщики компании (должность в оргструктуре)
create or replace function private.request_storekeepers(p_request uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct sp.user_id
    from public.staff_positions sp join public.roles ro on ro.id = sp.role_id join public.users u on u.id = sp.user_id
    join public.material_requests r on r.id = p_request and r.tenant_id = u.tenant_id
   where ro.code = 'storekeeper' and u.status <> 'blocked' and not u.is_external;
$$;

create or replace function public.material_request_transition(p_request uuid, p_to text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r       public.material_requests;
  v_me    uuid := auth.uid();
  v_note  text := btrim(coalesce(p_note, ''));
  v_buyer boolean;
  v_req   boolean;
  v_mgr   boolean;
  v_ok    boolean := false;
  v_num   integer;
  v_code  text;
  v_rfq   uuid;
  v_from  text;
  v_to    text := p_to;
  v_manager uuid;
  u       uuid;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(v_me, p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  v_from := r.status;
  v_buyer := private.user_is_buyer(v_me, r.project_id);
  v_req := private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request');
  v_mgr := r.manager_id = v_me;

  if r.status = 'draft' and p_to = 'submitted' then
    v_ok := v_req;
    if v_ok and not exists (select 1 from public.material_request_lines where request_id = r.id) then raise exception 'lines_required' using errcode = '22023'; end if;
    -- сначала руководитель сотрудника подтверждает, что это действительно нужно
    v_manager := private.request_manager_for(coalesce(r.requested_by, v_me), r.project_id);
    if v_manager is not null then v_to := 'review'; end if;
  elsif r.status = 'review' and p_to = 'submitted' then
    v_ok := v_mgr;
  elsif r.status = 'review' and p_to in ('draft', 'rejected') then
    v_ok := v_mgr;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'sourcing' then
    v_ok := v_buyer;
    if v_ok and r.status = 'sourcing' and r.buyer_id = v_me then raise exception 'transition_invalid' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'stock_check' then
    v_ok := v_buyer;
  elsif r.status in ('submitted', 'sourcing') and p_to in ('draft', 'rejected') then
    v_ok := v_buyer;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'delivered' then
    v_ok := v_buyer;
    if v_ok and r.stock_status <> 'available' then raise exception 'stock_not_available' using errcode = '22023'; end if;
  elsif r.status = 'approval' and p_to = 'sourcing' then
    v_ok := v_buyer;
  elsif r.status = 'confirming' and p_to = 'confirmed' then
    v_ok := private.user_is_initiator(v_me, r);
  elsif r.status = 'confirming' and p_to = 'sourcing' then
    v_ok := private.user_is_initiator(v_me, r);
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif p_to = 'cancelled' and r.status in ('draft', 'review', 'submitted', 'sourcing', 'stock_check', 'approval', 'confirming', 'confirmed') then
    v_ok := v_req or v_buyer or r.requested_by = v_me;
  elsif p_to = 'cancelled' and r.status in ('ordered', 'shipped') then
    v_ok := v_buyer;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  else
    raise exception 'transition_invalid' using errcode = '22023';
  end if;
  if not v_ok then raise exception 'permission denied: procurement' using errcode = '42501'; end if;

  if v_to = 'sourcing' and r.status in ('submitted', 'sourcing')
     and not exists (select 1 from public.rfqs where request_id = r.id and status = 'open' and deleted_at is null) then
    select code into v_code from public.projects where id = r.project_id;
    insert into public.project_counters as pc (project_id, kind, last_number) values (r.project_id, 'RQ', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_num;
    insert into public.rfqs (tenant_id, project_id, number, key, title, request_id, note, created_by)
    values (r.tenant_id, r.project_id, v_num, v_code || '-RQ-' || v_num, r.title, r.id, 'По заявке ' || r.key, v_me)
    returning id into v_rfq;
    insert into public.rfq_lines (tenant_id, rfq_id, position, name, unit, qty)
    select r.tenant_id, v_rfq, position, name, unit, qty from public.material_request_lines where request_id = r.id order by position;
  end if;

  if r.status = 'approval' or v_to in ('cancelled', 'rejected') then
    update public.material_request_approvals set status = 'cancelled' where request_id = r.id and round = r.approval_round and status = 'pending';
  end if;
  if v_to in ('cancelled', 'rejected') then
    update public.rfqs set status = 'cancelled', updated_at = now() where request_id = r.id and status = 'open';
  end if;

  update public.material_requests
     set status = v_to, updated_at = now(),
         manager_id = case when v_to = 'review' then v_manager else manager_id end,
         reviewed_by = case when v_from = 'review' and v_to = 'submitted' then v_me else reviewed_by end,
         reviewed_at = case when v_from = 'review' and v_to = 'submitted' then now() else reviewed_at end,
         stock_return = case when v_to = 'stock_check' then v_from else stock_return end,
         stock_status = case when v_to = 'stock_check' then 'unchecked' else stock_status end,
         buyer_id = case when v_to in ('sourcing', 'stock_check') and r.status in ('submitted', 'sourcing') then v_me else buyer_id end,
         decision_note = case when v_note <> '' and v_to in ('draft', 'rejected', 'cancelled', 'sourcing') then v_note else decision_note end,
         decided_by = case when v_to in ('rejected', 'confirmed') then v_me else decided_by end,
         decided_at = case when v_to in ('rejected', 'confirmed') then now() else decided_at end,
         delivered_at = case when v_to = 'delivered' then now() else delivered_at end,
         receipt = case when v_to = 'delivered' then 'full' else receipt end,
         receipt_note = case when v_to = 'delivered' then coalesce(nullif(v_note, ''), 'Выдано со склада') else receipt_note end,
         received_by = case when v_to = 'delivered' then v_me else received_by end
   where id = r.id
  returning * into r;
  perform private.request_event(r, v_from, v_to, v_note);

  if v_to = 'review' then
    perform private.request_notify(r.manager_id, r.id, 'assigned', 'high', 'procurement.review',
                                   format('Подтвердите заявку сотрудника «%s»: действительно ли это нужно', r.title));
  elsif v_to = 'submitted' then
    for u in select private.request_buyers(r.id) loop
      perform private.request_notify(u, r.id, 'assigned', case when r.urgent then 'high' else 'normal' end, 'procurement.submitted',
                                     format(case when r.urgent then 'Срочная заявка на закупку «%s»' else 'Новая заявка на закупку «%s»' end, r.title));
    end loop;
    if v_from = 'review' then
      perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.reviewed', format('Руководитель подтвердил заявку «%s» — она у закупщиков', r.title));
    end if;
  elsif v_to = 'stock_check' then
    for u in select private.request_storekeepers(r.id) loop
      perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.stock_check', format('Проверьте на складе позиции заявки «%s»', r.title));
    end loop;
  elsif v_to = 'sourcing' and v_from = 'submitted' then
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.taken', format('Заявка «%s» взята в работу — ищем цены', r.title));
  elsif v_to = 'sourcing' and v_from = 'approval' then
    for u in select a.user_id from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'cancelled' loop
      perform private.request_notify(u, r.id, 'watching', 'normal', 'procurement.recalled', format('Согласование закупки «%s» отозвано', r.title));
    end loop;
  elsif v_to = 'sourcing' and v_from = 'confirming' then
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.returned', format('Инициатор вернул закупку «%s»: %s', r.title, v_note));
  elsif v_to = 'draft' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.returned', format('Заявку «%s» вернули на доработку: %s', r.title, v_note));
  elsif v_to = 'rejected' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.rejected', format('Заявка «%s» отклонена: %s', r.title, v_note));
  elsif v_to = 'confirmed' then
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.confirmed', format('Инициатор подтвердил закупку «%s» — можно заказывать', r.title));
  elsif v_to = 'delivered' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.delivered', format('Есть на складе: «%s» — можно забирать', r.title));
  elsif v_to = 'cancelled' then
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.cancelled', format('Заявка «%s» отменена', r.title));
    perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.cancelled', format('Заявка «%s» отменена', r.title));
  end if;
end;
$$;

-- Склад: закупщик отмечает сам (как раньше) или кладовщик отвечает на запрос «проверить на складе»
create or replace function public.material_request_stock(p_request uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  v_keep boolean;
  v_text text;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if p_status not in ('none', 'partial', 'available') then raise exception 'stock_invalid' using errcode = '22023'; end if;
  if r.status = 'stock_check' then
    if not (private.user_holds(auth.uid(), array['storekeeper']) or private.user_is_buyer(auth.uid(), r.project_id)) then
      raise exception 'permission denied: procurement' using errcode = '42501';
    end if;
  elsif r.status in ('submitted', 'sourcing') then
    if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  else
    raise exception 'request_locked' using errcode = '22023';
  end if;
  v_keep := r.status <> 'stock_check';
  update public.material_requests
     set stock_status = p_status, stock_note = left(btrim(coalesce(p_note, '')), 1000), updated_at = now(),
         status = case when v_keep then status else coalesce(stock_return, 'submitted') end
   where id = r.id
  returning * into r;
  if not v_keep then perform private.request_event(r, 'stock_check', r.status, left(btrim(coalesce(p_note, '')), 200)); end if;
  v_text := format('Склад по заявке «%s»: %s', r.title, case p_status when 'none' then 'нет в наличии' when 'partial' then 'есть частично' else 'есть в наличии' end);
  perform private.request_notify(r.requested_by, r.id, 'watching', case when p_status = 'none' then 'normal' else 'high' end, 'procurement.stock', v_text);
  if not v_keep then perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.stock', v_text); end if;
end;
$$;

-- Цены предложений по заявке — только тем, кто видит цены (страница «Запросы цен» проекта читает таблицу напрямую)
drop policy rfq_quote_lines_select on public.rfq_quote_lines;
create policy rfq_quote_lines_select on public.rfq_quote_lines for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and exists (select 1 from public.rfq_quotes q join public.rfqs f on f.id = q.rfq_id
                      where q.id = quote_id and (f.request_id is null or private.user_can_see_prices(auth.uid(), f.request_id))));

-- суммы заявки напрямую из таблицы не читаются (только через procurement_request с проверкой)
revoke select on public.material_requests from authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'material_requests' and column_name not in ('amount', 'amount_base', 'over_budget');
  execute format('grant select (%s) on public.material_requests to authenticated', v_cols);
end $$;

drop function public.rfq_quote_save(uuid, text, text, integer, text, jsonb, uuid, text);
-- p_models: {"<id позиции>": "модель, артикул, ссылка"} — что именно предлагает поставщик (видят и те, кому цены не показываются)
create or replace function public.rfq_quote_save(
  p_rfq uuid, p_supplier text, p_currency text, p_delivery_days integer default null, p_terms text default '', p_prices jsonb default '{}',
  p_id uuid default null, p_note text default '', p_models jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r      public.rfqs;
  v_id   uuid;
  k      text;
  v_cur  text := upper(btrim(coalesce(p_currency, '')));
  v_sup  uuid;
begin
  select * into r from public.rfqs where id = p_rfq and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'rfq_not_found' using errcode = 'P0002'; end if;
  perform private.rfq_guard(r);
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  if btrim(coalesce(p_supplier, '')) = '' then raise exception 'supplier_required' using errcode = '22023'; end if;
  if v_cur not in ('GEL', 'USD') then raise exception 'currency_invalid' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_prices, '{}'::jsonb)) <> 'object' then raise exception 'prices_invalid' using errcode = '22023'; end if;
  v_sup := private.supplier_for(r.tenant_id, p_supplier);

  if p_id is null then
    insert into public.rfq_quotes (tenant_id, rfq_id, supplier, supplier_id, currency, delivery_days, terms, note)
    values (r.tenant_id, r.id, btrim(p_supplier), v_sup, v_cur, p_delivery_days, coalesce(p_terms, ''), coalesce(p_note, '')) returning id into v_id;
  else
    update public.rfq_quotes set supplier = btrim(p_supplier), supplier_id = v_sup, currency = v_cur, delivery_days = p_delivery_days, terms = coalesce(p_terms, ''),
           note = coalesce(p_note, ''), updated_at = now()
     where id = p_id and rfq_id = r.id returning id into v_id;
    if v_id is null then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
    delete from public.rfq_quote_lines where quote_id = v_id;
  end if;

  for k in select jsonb_object_keys(coalesce(p_prices, '{}'::jsonb)) loop
    if not exists (select 1 from public.rfq_lines where id = k::uuid and rfq_id = r.id) then raise exception 'line_invalid' using errcode = '22023'; end if;
    if nullif(p_prices ->> k, '') is null then continue; end if;
    if (p_prices ->> k)::numeric < 0 then raise exception 'price_invalid' using errcode = '22023'; end if;
    insert into public.rfq_quote_lines (quote_id, line_id, tenant_id, unit_price, model)
    values (v_id, k::uuid, r.tenant_id, (p_prices ->> k)::numeric, left(btrim(coalesce(p_models ->> k, '')), 500));
  end loop;
  return v_id;
end;
$$;

create or replace function public.procurement_requests(p_project uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.urgent desc, x.created_at desc), '[]'::jsonb)
    from (
      select r.created_at, r.urgent and r.status in ('submitted', 'sourcing') as urgent,
             jsonb_build_object(
               'id', r.id, 'key', r.key, 'title', r.title, 'status', r.status, 'urgent', r.urgent, 'needed_by', r.needed_by,
               'created_at', r.created_at, 'updated_at', r.updated_at,
               'project_id', p.id, 'project_code', p.code, 'project_name', p.name,
               'requested_by', r.requested_by, 'requester_name', rq.full_name, 'buyer_id', r.buyer_id, 'buyer_name', b.full_name,
               'supplier', r.supplier,
               'amount', case when x2.prices then r.amount end, 'currency', case when x2.prices then r.currency end,
               'estimate', case when x2.prices then (select sum(l.qty * coalesce(l.est_price, 0)) from public.material_request_lines l where l.request_id = r.id) end,
               'can_see_prices', x2.prices, 'manager_id', r.manager_id, 'manager_name', (select full_name from public.users where id = r.manager_id),
               'my_stock', r.status = 'stock_check' and private.user_holds(auth.uid(), array['storekeeper']),
               'lines_count', (select count(*) from public.material_request_lines l where l.request_id = r.id),
               'expected_at', r.expected_at, 'over_budget', x2.prices and r.over_budget, 'stock_status', r.stock_status, 'tier', r.tier,
               'due_at', private.request_due(r), 'receipt', r.receipt,
               'approvals_total', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round),
               'approvals_done', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'approved'),
               'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                                         and a.user_id = auth.uid() and a.status = 'pending' and r.status = 'approval')
             ) as row
        from public.material_requests r
        join public.projects p on p.id = r.project_id
        left join public.users rq on rq.id = r.requested_by
        left join public.users b on b.id = r.buyer_id
        cross join lateral (select private.user_can_see_prices(auth.uid(), r.id) as prices) x2
       where r.tenant_id = private.tenant_id() and r.deleted_at is null
         and (p_project is null or r.project_id = p_project)
         and private.user_can_see_request(auth.uid(), r.id)
    ) x;
$$;

create or replace function public.procurement_request(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r      public.material_requests;
  p      public.projects;
  v_me   uuid := auth.uid();
  v_rfq  public.rfqs;
  v_out  jsonb;
  v_prices boolean;
begin
  select * into r from public.material_requests where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_see_request(v_me, p_id) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  select * into p from public.projects where id = r.project_id;
  v_prices := private.user_can_see_prices(v_me, r.id);
  select * into v_rfq from public.rfqs where request_id = r.id and deleted_at is null order by (status = 'cancelled'), created_at desc limit 1;

  v_out := to_jsonb(r) - 'tenant_id' - 'deleted_at' || jsonb_build_object(
    'company', (select name from public.tenants where id = r.tenant_id),
    'project', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'currency', p.currency, 'fx_rate', p.fx_rate),
    'requester_name', (select full_name from public.users where id = r.requested_by),
    'manager_name', (select full_name from public.users where id = r.manager_id),
    'reviewed_by_name', (select full_name from public.users where id = r.reviewed_by),
    'buyer_name', (select full_name from public.users where id = r.buyer_id),
    'decided_by_name', (select full_name from public.users where id = r.decided_by),
    'received_by_name', (select full_name from public.users where id = r.received_by),
    'due_at', private.request_due(r),
    'amount_gel', case when v_prices then private.request_amount_gel(r) end,
    'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = r.cbs_item_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty,
                                                          'est_price', case when v_prices then l.est_price end, 'note', l.note, 'received_qty', l.received_qty,
                                                          'photo', (select jsonb_build_object('file_id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'storage_key', f.storage_key)
                                                                      from public.files f where f.id = l.photo_file_id)) order by l.position)
                         from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb),
    'rfq', case when v_rfq.id is null then null else jsonb_build_object(
      'id', v_rfq.id, 'key', v_rfq.key, 'status', v_rfq.status,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty) order by l.position)
                           from public.rfq_lines l where l.rfq_id = v_rfq.id), '[]'::jsonb),
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'supplier', q.supplier, 'supplier_id', q.supplier_id,
                                                             'supplier_status', (select s.status from public.suppliers s where s.id = q.supplier_id),
                                                             'currency', q.currency, 'delivery_days', q.delivery_days,
                                                             'terms', case when v_prices then q.terms else '' end, 'note', case when v_prices then q.note else '' end, 'status', q.status,
                                                             'prices', coalesce((select jsonb_agg(jsonb_build_object('line_id', ql.line_id, 'unit_price', case when v_prices then ql.unit_price end, 'model', ql.model))
                                                                                   from public.rfq_quote_lines ql where ql.quote_id = q.id), '[]'::jsonb))
                                            order by q.created_at)
                            from public.rfq_quotes q where q.rfq_id = v_rfq.id), '[]'::jsonb)) end,
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', u.full_name, 'job_title', u.job_title, 'round', a.round,
                                                              'status', a.status, 'note', a.note, 'decided_at', a.decided_at) order by a.round desc, a.created_at)
                             from public.material_request_approvals a join public.users u on u.id = a.user_id where a.request_id = r.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('result', x.result, 'lines', x.lines, 'note', x.note, 'at', x.created_at,
                                                             'by', (select full_name from public.users where id = x.created_by)) order by x.created_at)
                            from public.material_request_receipts x where x.request_id = r.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes,
                                                          'storage_key', f.storage_key, 'quote_id', case when a.caption like 'quote:%' then substr(a.caption, 7)::uuid end,
                                                          'created_at', a.created_at, 'by', (select full_name from public.users where id = a.created_by),
                                                          'can_delete', a.created_by = v_me or private.user_is_buyer(v_me, r.project_id)) order by a.created_at)
                         from public.attachments a join public.files f on f.id = a.file_id
                        where a.entity_type = 'material_request' and a.entity_id = r.id and a.caption is distinct from 'line'
                          and (v_prices or a.caption not like 'quote:%')), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event_type, 'actor', u.full_name, 'changes', e.changes) order by e.occurred_at)
                           from public.entity_events e left join public.users u on u.id = e.actor_id
                          where e.entity_id = r.project_id and e.event_type in ('request_status', 'request_eta', 'request_receipt')
                            and (e.changes ->> 'request_id' = r.id::text or (e.changes ->> 'request_id' is null and e.changes ->> 'key' = r.key))), '[]'::jsonb),
    'me', jsonb_build_object(
      'is_buyer', private.user_is_buyer(v_me, r.project_id),
      'is_initiator', private.user_is_initiator(v_me, r),
      'is_owner', r.requested_by = v_me,
      'can_request', private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'),
      'can_budget', (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
                     and (private.has_project_permission(r.project_id, 'budget.view') or private.has_project_permission(r.project_id, 'procurement.approve')))
                    or private.user_is_buyer(v_me, r.project_id),
      'can_pick_item', private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
                       and private.has_project_permission(r.project_id, 'budget.view'),
      'can_attach', r.status not in ('rejected', 'cancelled')
                    and (private.user_is_buyer(v_me, r.project_id) or r.requested_by = v_me
                         or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'))),
      'can_see_prices', v_prices,
      'is_manager', r.manager_id = v_me and r.status = 'review',
      'is_storekeeper', private.user_holds(v_me, array['storekeeper']),
      'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                               and a.user_id = v_me and a.status = 'pending' and r.status = 'approval'))
  );
  if not v_prices then
    v_out := v_out - 'amount' - 'amount_base' - 'over_budget' - 'commitment_id' || jsonb_build_object('amount', null, 'amount_base', null, 'over_budget', false);
  end if;
  return v_out;
end;
$$;


drop function private.request_email_info(uuid);
create or replace function private.request_email_info(p_request uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'key', r.key, 'title', r.title, 'status', r.status, 'urgent', r.urgent, 'needed_by', r.needed_by,
           'project', p.code || ' · ' || p.name, 'supplier', r.supplier,
           'amount', case when private.user_can_see_prices(p_user, r.id) then r.amount end, 'currency', r.currency,
           'over_budget', r.over_budget and private.user_can_see_prices(p_user, r.id), 'approval_note', r.approval_note, 'single_source_reason', r.single_source_reason,
           'requester', (select full_name from public.users where id = r.requested_by),
           'buyer', (select full_name from public.users where id = r.buyer_id),
           'approvers', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round),
           'lines', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'qty', l.qty, 'unit', l.unit) order by l.position)
                                from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb))
    from public.material_requests r join public.projects p on p.id = r.project_id
   where r.id = p_request;
$$;
revoke execute on function private.request_email_info(uuid, uuid) from public, anon, authenticated;

create or replace function public.claim_emails(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o        public.email_outbox;
  n        public.notifications;
  v_out    jsonb := '[]';
  v_item   jsonb;
  v_items  jsonb;
  v_name   text;
  v_locale text;
  v_email  text;
  v_task   jsonb;
  v_comment uuid;
  v_files  jsonb;
begin
  -- письма, которые «зависли» в отправке, возвращаем в очередь
  update public.email_outbox set status = 'pending'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  for o in
    select * from public.email_outbox
     where status = 'pending' and send_after <= now()
     order by send_after
     limit p_limit
     for update skip locked
  loop
    select u.full_name, u.locale, u.email into v_name, v_locale, v_email from public.users u where u.id = o.user_id and u.status <> 'blocked';
    if not found or coalesce(v_email, o.to_email) is null then
      update public.email_outbox set status = 'skipped' where id = o.id;
      continue;
    end if;

    if o.kind = 'instant' then
      select * into n from public.notifications where id = o.notification_id;
      -- уведомления нет; наблюдателю письмо уже не нужно, если он прочитал или убрал; назначение, упоминание, эскалацию отправляем всегда
      if not found or (n.category = 'watching' and (n.read_at is not null or n.archived_at is not null)) then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_task := null;
      if n.entity_type = 'task' then
        select jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'due_date', t.due_date)
          into v_task from public.tasks t where t.id = n.entity_id;
      end if;
      -- файлы комментария, из-за которого пришло уведомление (упоминание, комментарий, заметка), — воркер приложит их к письму
      v_comment := coalesce((n.payload ->> 'comment_id')::uuid, case when n.entity_type = 'field_note' then n.entity_id end);
      v_files := '[]';
      if v_comment is not null then
        select coalesce(jsonb_agg(jsonb_build_object('name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'storage_key', f.storage_key) order by a.created_at, a.id), '[]')
          into v_files
          from public.attachments a join public.files f on f.id = a.file_id
         where a.comment_id = v_comment and f.status = 'ready';
      end if;
      v_item := jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale, 'attachments', v_files,
        'notification', jsonb_build_object(
          'title', n.title, 'body', n.body, 'priority', n.priority, 'category', n.category, 'event_type', n.event_type,
          'entity_type', n.entity_type, 'entity_id', n.entity_id, 'entity_key', n.payload ->> 'entity_key',
          'project_code', n.payload ->> 'project_code', 'actor_name', n.payload ->> 'actor_name',
          'link', n.payload ->> 'link'),
        'task', v_task,
        'request', case when n.entity_type = 'material_request' then private.request_email_info(n.entity_id, n.user_id) end);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', x.title, 'body', x.body, 'category', x.category, 'priority', x.priority,
               'entity_key', x.payload ->> 'entity_key', 'project_code', x.payload ->> 'project_code',
               'entity_type', x.entity_type, 'entity_id', x.entity_id, 'link', x.payload ->> 'link') order by x.created_at), '[]')
        into v_items
        from public.notifications x
       where x.id in (select (jsonb_array_elements_text(o.payload -> 'ids'))::uuid)
         and x.read_at is null and x.archived_at is null;
      if jsonb_array_length(v_items) = 0 then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_item := jsonb_build_object('id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale, 'items', v_items);
    end if;

    update public.email_outbox set status = 'sending', attempts = attempts + 1, claimed_at = now() where id = o.id;
    v_out := v_out || jsonb_build_array(v_item || jsonb_build_object('attempts', o.attempts + 1));
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.rfq_quote_save(uuid, text, text, integer, text, jsonb, uuid, text, jsonb) from public, anon;
grant execute on function public.rfq_quote_save(uuid, text, text, integer, text, jsonb, uuid, text, jsonb) to authenticated;
revoke execute on function private.request_storekeepers(uuid), private.sync_procurement_role(uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
