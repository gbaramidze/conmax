-- Закупки, этап 1 процедуры PR-01: маршрут заявки от площадки до склада с отделом закупок, согласующими по выбору и статусами поставки.
--
-- Маршрут заявки (material_requests.status):
--   draft («Черновик») → submitted («Отправлена в закупки») → sourcing («Ищем цены») → approval («На согласовании»)
--   → confirming («Ждёт подтверждения инициатора») → confirmed («Подтверждена, оформляем заказ») → ordered («Заказано»)
--   → shipped («В пути», необязательный шаг) → delivered («Получено»);  rejected / cancelled — завершение без покупки.
--   Прежнее «approved» (руководитель согласовал до поиска цен) переходит в sourcing: по PR-01 согласуют уже выбранного поставщика и сумму.
--
-- Кто что делает:
--   • инициатор — `procurement.request` в проекте: заводит, отправляет, подтверждает выбранное («это то, что нужно»), отмечает получение;
--   • отдел закупок — новое право компании `procurement.manage` (роль компании «Отдел закупок»; руководитель проекта с
--     `procurement.approve` может вести закупки своего проекта сам): видит все заявки компании, берёт в работу, проверяет склад,
--     вносит предложения поставщиков (минимум 3, иначе обоснование), выбирает рекомендуемое, сам выбирает согласующих,
--     оформляет заказ (договор-обязательство в бюджете, если есть статья), ведёт поставку (транспорт, ожидаемая дата);
--   • согласующие — любые сотрудники компании, которых выбрал закупщик, решают параллельно; нужны все «да»;
--     одно «нет» с причиной возвращает заявку закупщику (новый круг согласования — новые строки с round + 1).
-- Уведомления (в приложении, письмо, push) — `private.request_notify`; ссылка ведёт на страницу компании /procurement?r=<id>,
-- потому что закупщик и согласующие могут не быть участниками проекта.
-- Предложения хранятся в запросе цен (rfqs), который создаётся автоматически, когда закупщик берёт заявку в работу.
-- Запрос цен, привязанный к заявке, ведётся только из заявки (`request_flow`); отдельные запросы цен работают как раньше.
-- Не вошло (этап 2): подсказки по порогам суммы, сроки и напоминания, Decision Sheet в PDF с подписями, справочник поставщиков,
-- частичные поставки по позициям, вложения (коммерческие предложения файлами).

-- ---------------------------------------------------------------------------------------------------------------------
-- Право и роль «Отдел закупок»
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.permissions (code, module, sort, label, tenant_only, external_ok) values
  ('procurement.manage', 'Закупки', 1104, 'Отдел закупок: видеть все заявки компании, искать цены, отправлять на согласование, вести заказ и поставку', true, false)
on conflict (code) do nothing;

create or replace function private.seed_procurement_role(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  insert into public.roles (tenant_id, scope, code, name, is_system)
  values (p_tenant, 'tenant', 'procurement', 'Отдел закупок', false)
  on conflict (tenant_id, scope, code) do nothing
  returning id into v_role;
  -- закупки ведутся в модуле проекта, поэтому отдел закупок видит все проекты компании
  if v_role is not null then
    insert into public.role_permissions (tenant_id, role_id, permission)
    values (p_tenant, v_role, 'procurement.manage'), (p_tenant, v_role, 'project.view.all') on conflict do nothing;
  end if;
end;
$$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop perform private.seed_procurement_role(t.id); end loop;
end $$;

-- новым компаниям: роль появляется вместе с ролью администратора
create or replace function private.roles_procurement_dept() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'tenant' and new.code = 'tenant_admin' then perform private.seed_procurement_role(new.tenant_id); end if;
  return null;
end;
$$;
create trigger roles_procurement_dept after insert on public.roles for each row execute function private.roles_procurement_dept();

-- ---------------------------------------------------------------------------------------------------------------------
-- Заявка: новые поля и статусы
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.entity_types (code, module, features) values ('material_request', 'procurement', '{}') on conflict (code) do nothing;

alter table public.material_requests
  add column urgent               boolean not null default false,
  add column buyer_id             uuid references public.users(id),
  add column stock_status         text not null default 'unchecked' check (stock_status in ('unchecked', 'none', 'partial', 'available')),
  add column stock_note           text not null default '' check (char_length(stock_note) <= 1000),
  add column quote_id             uuid references public.rfq_quotes(id) on delete set null,
  add column supplier             text not null default '' check (char_length(supplier) <= 200),
  add column amount               numeric(14, 2),
  add column currency             char(3),
  add column amount_base          numeric(14, 2),
  add column single_source_reason text not null default '' check (char_length(single_source_reason) <= 2000),
  add column approval_note        text not null default '' check (char_length(approval_note) <= 2000),
  add column approval_round       integer not null default 0,
  add column ordered_at           timestamptz,
  add column expected_at          date,
  add column shipped_at           date,
  add column transport            text not null default '' check (transport in ('', 'road', 'air', 'sea', 'rail', 'courier', 'pickup')),
  add column forwarder            text not null default '' check (char_length(forwarder) <= 200),
  add column tracking             text not null default '' check (char_length(tracking) <= 200),
  add column delivery_note        text not null default '' check (char_length(delivery_note) <= 2000),
  add column delivered_at         timestamptz,
  add column receipt              text not null default '' check (receipt in ('', 'full', 'partial', 'issues')),
  add column receipt_note         text not null default '' check (char_length(receipt_note) <= 2000),
  add column received_by          uuid references public.users(id),
  add column commitment_id        uuid references public.budget_commitments(id) on delete set null;

alter table public.material_requests drop constraint material_requests_status_check;
update public.material_requests set status = 'sourcing' where status = 'approved';
alter table public.material_requests add constraint material_requests_status_check
  check (status in ('draft', 'submitted', 'sourcing', 'approval', 'confirming', 'confirmed', 'ordered', 'shipped', 'delivered', 'rejected', 'cancelled'));
create index on public.material_requests (tenant_id, status) where deleted_at is null;

create table public.material_request_approvals (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  request_id  uuid not null references public.material_requests(id) on delete cascade,
  round       integer not null,
  user_id     uuid not null references public.users(id),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note        text not null default '' check (char_length(note) <= 2000),
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (request_id, round, user_id)
);
create index on public.material_request_approvals (user_id, status);
alter table public.material_request_approvals enable row level security;
alter table public.material_request_approvals force row level security;
revoke insert, update, delete on public.material_request_approvals from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Кто видит заявку и кто ведёт закупку
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.user_can_see_request(p_user uuid, p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.material_requests r
      join public.users u on u.id = p_user and u.tenant_id = r.tenant_id and u.status <> 'blocked'
     where r.id = p_request and r.deleted_at is null
       and (r.requested_by = p_user
            or exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.user_id = p_user)
            or (not u.is_external and private.user_has_tenant_permission(p_user, r.tenant_id, 'procurement.manage'))
            or (not u.is_external and private.user_can_see_project(p_user, r.project_id)
                and (private.user_has_project_permission(p_user, r.project_id, 'procurement.view')
                     or private.user_has_project_permission(p_user, r.project_id, 'procurement.request')
                     or private.user_has_project_permission(p_user, r.project_id, 'procurement.approve'))))
  );
$$;

-- Ведёт закупку: отдел закупок компании или руководитель проекта (procurement.approve)
create or replace function private.user_is_buyer(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p join public.users u on u.id = p_user and u.tenant_id = p.tenant_id
     where p.id = p_project and not u.is_external and u.status <> 'blocked'
       and (private.user_has_tenant_permission(p_user, p.tenant_id, 'procurement.manage')
            or (private.user_can_see_project(p_user, p_project) and private.user_has_project_permission(p_user, p_project, 'procurement.approve')))
  );
$$;

-- Подтверждает выбранное от имени площадки: автор заявки или руководитель проекта
create or replace function private.user_is_initiator(p_user uuid, r public.material_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.requested_by = p_user
      or (private.user_can_see_project(p_user, r.project_id) and private.user_has_project_permission(p_user, r.project_id, 'procurement.approve'));
$$;

drop policy material_requests_select on public.material_requests;
create policy material_requests_select on public.material_requests for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null and private.user_can_see_request(auth.uid(), id));
create policy material_request_approvals_select on public.material_request_approvals for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_see_request(auth.uid(), request_id));

drop policy rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and ((private.can_see_project(project_id) and private.can_see_internal(project_id)
               and (private.has_project_permission(project_id, 'procurement.view') or private.has_project_permission(project_id, 'procurement.request')
                    or private.has_project_permission(project_id, 'procurement.approve')))
              or (request_id is not null and private.user_can_see_request(auth.uid(), request_id))));

-- ---------------------------------------------------------------------------------------------------------------------
-- Уведомления по заявке
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.request_notify(p_user uuid, p_request uuid, p_category text, p_priority text, p_event text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r            record;
  v_pref       text;
  v_actor_name text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  select mr.id, mr.tenant_id, mr.project_id, mr.key, p.code into r
    from public.material_requests mr join public.projects p on p.id = mr.project_id where mr.id = p_request;
  if r.id is null or not private.user_can_see_request(p_user, p_request) then return; end if;
  select mode into v_pref from public.notification_preferences where user_id = p_user and category = p_category and channel = 'in_app';
  if v_pref = 'off' and p_priority <> 'critical' then return; end if;
  select full_name into v_actor_name from public.users where id = auth.uid();
  insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, actor_id, priority, category, title, body, payload)
  values (r.tenant_id, p_user, r.project_id, p_event, 'material_request', r.id, auth.uid(), p_priority, p_category,
          'Закупка · ' || r.key, p_body,
          jsonb_build_object('project_code', r.code, 'actor_name', v_actor_name, 'link', '/procurement?r=' || r.id, 'last_text', p_body));
end;
$$;

-- Кому сообщать о новой заявке: отдел закупок компании, а если его нет — руководители проекта с procurement.approve
create or replace function private.request_buyers(p_request uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request;
  return query
    select u.id from public.users u
     where u.tenant_id = r.tenant_id and not u.is_external and u.status <> 'blocked'
       and private.user_has_tenant_permission(u.id, r.tenant_id, 'procurement.manage');
  if not found then
    return query
      select distinct pm.user_id from public.project_members pm join public.users u on u.id = pm.user_id
       where pm.project_id = r.project_id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
         and not u.is_external and u.status <> 'blocked'
         and private.user_has_project_permission(pm.user_id, r.project_id, 'procurement.approve');
  end if;
end;
$$;

create or replace function private.request_event(r public.material_requests, p_from text, p_to text, p_note text default '') returns void
language sql security definer set search_path = '' as $$
  select private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'request_status',
                              jsonb_build_object('key', r.key, 'title', r.title, 'from', p_from, 'to', p_to, 'note', coalesce(p_note, ''),
                                                 'over_budget', r.over_budget, 'request_id', r.id));
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Остаток бюджета: резервируют заявки на согласовании и подтверждённые, но ещё не заказанные; сумма — выбранное предложение
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.request_estimate(p_request uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select amount_base from public.material_requests where id = p_request),
                  (select sum(qty * coalesce(est_price, 0)) from public.material_request_lines where request_id = p_request), 0);
$$;

create or replace function private.request_budget_check(p_request uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (select * from public.material_requests where id = p_request),
  ver as (select id from public.budget_versions where project_id = (select project_id from r) and status in ('approved', 'draft') order by (status = 'approved') desc, number desc limit 1),
  b as (
    select coalesce((select amount from public.budget_amounts where version_id = (select id from ver) and item_id = (select cbs_item_id from r)), 0) as bac,
           coalesce((select sum(amount) from public.budget_commitments where item_id = (select cbs_item_id from r) and deleted_at is null and status = 'active'), 0) as committed,
           coalesce((select sum(amount) from public.budget_actuals where item_id = (select cbs_item_id from r) and deleted_at is null), 0) as actual,
           coalesce((select sum(private.request_estimate(x.id)) from public.material_requests x
                      where x.cbs_item_id = (select cbs_item_id from r) and x.status in ('approval', 'confirming', 'confirmed') and x.deleted_at is null and x.id <> p_request), 0) as reserved,
           private.request_estimate(p_request) as estimate)
  select case when (select cbs_item_id from r) is null then null
              else jsonb_build_object('bac', bac, 'committed', committed, 'actual', actual, 'reserved', reserved, 'estimate', estimate,
                                      'remaining', bac - greatest(committed, actual) - reserved)
         end
    from b
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Создание и правка черновика: добавлен признак «Срочно»
-- ---------------------------------------------------------------------------------------------------------------------
drop function public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb);
create or replace function public.material_request_save(
  p_project uuid, p_title text, p_id uuid default null, p_cbs_item uuid default null, p_needed_by date default null,
  p_note text default '', p_lines jsonb default '[]', p_urgent boolean default false
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
    insert into public.material_requests (tenant_id, project_id, number, key, title, cbs_item_id, needed_by, note, urgent)
    values (v_tenant, p_project, v_number, v_project.code || '-PR-' || v_number, v_title, p_cbs_item, p_needed_by, coalesce(p_note, ''), coalesce(p_urgent, false))
    returning id into v_id;
    perform private.record_event(v_tenant, p_project, 'project', p_project, 'request_status',
                                 jsonb_build_object('key', v_project.code || '-PR-' || v_number, 'title', v_title, 'from', null, 'to', 'draft', 'note', '', 'request_id', v_id));
  else
    select * into v_old from public.material_requests where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
    if v_old.status <> 'draft' then raise exception 'request_locked' using errcode = '22023'; end if;
    update public.material_requests set title = v_title, cbs_item_id = p_cbs_item, needed_by = p_needed_by, note = coalesce(p_note, ''),
           urgent = coalesce(p_urgent, false), updated_at = now() where id = p_id;
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

-- ---------------------------------------------------------------------------------------------------------------------
-- Шаги маршрута без дополнительных данных. p_note: причина (возврат, отклонение, отмена после заказа обязательны)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_transition(p_request uuid, p_to text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r       public.material_requests;
  v_me    uuid := auth.uid();
  v_note  text := btrim(coalesce(p_note, ''));
  v_buyer boolean;
  v_req   boolean;
  v_ok    boolean := false;
  v_num   integer;
  v_code  text;
  v_rfq   uuid;
  v_from  text;
  u       uuid;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(v_me, p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  v_from := r.status;
  v_buyer := private.user_is_buyer(v_me, r.project_id);
  v_req := private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request');

  if r.status = 'draft' and p_to = 'submitted' then
    v_ok := v_req;
    if v_ok and not exists (select 1 from public.material_request_lines where request_id = r.id) then raise exception 'lines_required' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'sourcing' then
    v_ok := v_buyer;
    if v_ok and r.status = 'sourcing' and r.buyer_id = v_me then raise exception 'transition_invalid' using errcode = '22023'; end if;
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
  elsif p_to = 'cancelled' and r.status in ('draft', 'submitted', 'sourcing', 'approval', 'confirming', 'confirmed') then
    v_ok := v_req or v_buyer or r.requested_by = v_me;
  elsif p_to = 'cancelled' and r.status in ('ordered', 'shipped') then
    v_ok := v_buyer;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  else
    raise exception 'transition_invalid' using errcode = '22023';
  end if;
  if not v_ok then raise exception 'permission denied: procurement' using errcode = '42501'; end if;

  -- взяли в работу (или перевели на себя заявку без запроса цен, например перенесённую из прежнего «согласована»):
  -- запрос цен для предложений с позициями заявки
  if p_to = 'sourcing' and r.status in ('submitted', 'sourcing')
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

  -- согласование прервано: незавершённые решения текущего круга снимаются
  if r.status = 'approval' or p_to in ('cancelled', 'rejected') then
    update public.material_request_approvals set status = 'cancelled' where request_id = r.id and round = r.approval_round and status = 'pending';
  end if;
  if p_to in ('cancelled', 'rejected') then
    update public.rfqs set status = 'cancelled', updated_at = now() where request_id = r.id and status = 'open';
  end if;

  update public.material_requests
     set status = p_to, updated_at = now(),
         buyer_id = case when p_to = 'sourcing' and r.status in ('submitted', 'sourcing') then v_me else buyer_id end,
         decision_note = case when v_note <> '' and p_to in ('draft', 'rejected', 'cancelled', 'sourcing') then v_note else decision_note end,
         decided_by = case when p_to in ('rejected', 'confirmed') then v_me else decided_by end,
         decided_at = case when p_to in ('rejected', 'confirmed') then now() else decided_at end,
         delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
         receipt = case when p_to = 'delivered' then 'full' else receipt end,
         receipt_note = case when p_to = 'delivered' then coalesce(nullif(v_note, ''), 'Выдано со склада') else receipt_note end,
         received_by = case when p_to = 'delivered' then v_me else received_by end
   where id = r.id
  returning * into r;
  perform private.request_event(r, v_from, p_to, v_note);

  if p_to = 'submitted' then
    for u in select private.request_buyers(r.id) loop
      perform private.request_notify(u, r.id, 'assigned', case when r.urgent then 'high' else 'normal' end, 'procurement.submitted',
                                     format(case when r.urgent then 'Срочная заявка на закупку «%s»' else 'Новая заявка на закупку «%s»' end, r.title));
    end loop;
  elsif p_to = 'sourcing' and v_from = 'submitted' then
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.taken', format('Заявка «%s» взята в работу — ищем цены', r.title));
  elsif p_to = 'sourcing' and v_from = 'approval' then
    for u in select a.user_id from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'cancelled' loop
      perform private.request_notify(u, r.id, 'watching', 'normal', 'procurement.recalled', format('Согласование закупки «%s» отозвано', r.title));
    end loop;
  elsif p_to = 'sourcing' and v_from = 'confirming' then
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.returned', format('Инициатор вернул закупку «%s»: %s', r.title, v_note));
  elsif p_to = 'draft' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.returned', format('Заявку «%s» вернули на доработку: %s', r.title, v_note));
  elsif p_to = 'rejected' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.rejected', format('Заявка «%s» отклонена: %s', r.title, v_note));
  elsif p_to = 'confirmed' then
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.confirmed', format('Инициатор подтвердил закупку «%s» — можно заказывать', r.title));
  elsif p_to = 'delivered' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.delivered', format('Есть на складе: «%s» — можно забирать', r.title));
  elsif p_to = 'cancelled' then
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.cancelled', format('Заявка «%s» отменена', r.title));
    perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.cancelled', format('Заявка «%s» отменена', r.title));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Проверка склада (п. 4.5): закупщик отмечает, есть ли позиции на складе
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_stock(p_request uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  if r.status not in ('submitted', 'sourcing') then raise exception 'request_locked' using errcode = '22023'; end if;
  if p_status not in ('none', 'partial', 'available') then raise exception 'stock_invalid' using errcode = '22023'; end if;
  update public.material_requests set stock_status = p_status, stock_note = left(btrim(coalesce(p_note, '')), 1000), updated_at = now() where id = r.id;
  perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.stock',
                                 format('Склад по заявке «%s»: %s', r.title,
                                        case p_status when 'none' then 'нет в наличии' when 'partial' then 'есть частично' else 'есть в наличии' end));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- На согласование: выбранное предложение и согласующие, которых выбрал закупщик
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_send_approval(
  p_request uuid, p_quote uuid, p_approvers uuid[], p_reason text default '', p_note text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r        public.material_requests;
  q        public.rfq_quotes;
  v_rfq    uuid;
  v_total  numeric;
  v_count  integer;
  v_base   numeric;
  v_users  uuid[];
  v_chk    jsonb;
  v_over   boolean;
  u        uuid;
  m        record;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  if r.status <> 'sourcing' then raise exception 'transition_invalid' using errcode = '22023'; end if;

  select id into v_rfq from public.rfqs where request_id = r.id and status = 'open' and deleted_at is null order by created_at desc limit 1;
  select * into q from public.rfq_quotes where id = p_quote and rfq_id = v_rfq;
  if v_rfq is null or q.id is null then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.rfq_lines l where l.rfq_id = v_rfq
              and not exists (select 1 from public.rfq_quote_lines ql where ql.quote_id = q.id and ql.line_id = l.id)) then
    raise exception 'quote_incomplete' using errcode = '22023';
  end if;
  select sum(l.qty * ql.unit_price) into v_total from public.rfq_lines l join public.rfq_quote_lines ql on ql.line_id = l.id and ql.quote_id = q.id where l.rfq_id = v_rfq;
  select count(*) into v_count from public.rfq_quotes where rfq_id = v_rfq;
  if v_count < 3 and btrim(coalesce(p_reason, '')) = '' then raise exception 'reason_required' using errcode = '22023'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_users from unnest(coalesce(p_approvers, '{}')) x where x is not null;
  if cardinality(v_users) = 0 then raise exception 'approvers_required' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_users) x
              where not exists (select 1 from public.users uu where uu.id = x and uu.tenant_id = r.tenant_id and not uu.is_external and uu.status <> 'blocked')) then
    raise exception 'approver_invalid' using errcode = '22023';
  end if;

  begin
    select * into m from private.money_to_base(r.project_id, v_total, q.currency);
    v_base := m.base;
  exception when sqlstate '22023' then
    v_base := null;   -- нет курса: остаток бюджета считается по оценке позиций
  end;

  update public.material_requests
     set status = 'approval', quote_id = q.id, supplier = q.supplier, amount = v_total, currency = q.currency, amount_base = v_base,
         single_source_reason = case when v_count < 3 then left(btrim(p_reason), 2000) else '' end,
         approval_note = left(btrim(coalesce(p_note, '')), 2000), approval_round = r.approval_round + 1,
         buyer_id = coalesce(buyer_id, auth.uid()), updated_at = now()
   where id = r.id
  returning * into r;
  insert into public.material_request_approvals (tenant_id, request_id, round, user_id)
  select r.tenant_id, r.id, r.approval_round, x from unnest(v_users) x;

  v_chk := private.request_budget_check(r.id);
  v_over := v_chk is not null and (v_chk ->> 'estimate')::numeric > (v_chk ->> 'remaining')::numeric + 0.005;
  update public.material_requests set over_budget = v_over where id = r.id returning * into r;
  perform private.request_event(r, 'sourcing', 'approval', q.supplier);

  foreach u in array v_users loop
    perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.approval',
                                   format('Просят согласовать закупку «%s» у поставщика %s', r.title, q.supplier));
  end loop;
  perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.approval', format('Заявка «%s» на согласовании', r.title));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Решение согласующего. Нужны все «да»; одно «нет» с причиной возвращает заявку закупщику
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_decide(p_request uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  a      public.material_request_approvals;
  v_note text := btrim(coalesce(p_note, ''));
  v_name text;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if r.status <> 'approval' then raise exception 'transition_invalid' using errcode = '22023'; end if;
  select * into a from public.material_request_approvals
   where request_id = r.id and round = r.approval_round and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'permission denied: not an approver' using errcode = '42501'; end if;
  if not p_approve and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  select full_name into v_name from public.users where id = auth.uid();

  update public.material_request_approvals set status = case when p_approve then 'approved' else 'rejected' end, note = left(v_note, 2000), decided_at = now()
   where id = a.id;

  if not p_approve then
    update public.material_request_approvals set status = 'cancelled' where request_id = r.id and round = r.approval_round and status = 'pending';
    update public.material_requests set status = 'sourcing', decision_note = left(v_note, 4000), updated_at = now() where id = r.id returning * into r;
    perform private.request_event(r, 'approval', 'sourcing', v_name || ': ' || v_note);
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.declined', format('Закупку «%s» не согласовали: %s', r.title, v_note));
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.declined', format('Закупку «%s» не согласовали: %s', r.title, v_note));
  elsif not exists (select 1 from public.material_request_approvals where request_id = r.id and round = r.approval_round and status = 'pending') then
    update public.material_requests set status = 'confirming', updated_at = now() where id = r.id returning * into r;
    perform private.request_event(r, 'approval', 'confirming', '');
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.confirm',
                                   format('Закупка «%s» согласована — подтвердите, что заказываем именно это', r.title));
    perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.approved', format('Закупка «%s» согласована всеми', r.title));
  else
    perform private.request_notify(r.buyer_id, r.id, 'watching', 'low', 'procurement.approved', format('Закупку «%s» одобрил(а): %s', r.title, v_name));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Заказ поставщику: договор-обязательство в бюджете (если указана статья), запрос цен присуждён
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_order(p_request uuid, p_order_ref text default '', p_expected date default null, p_cbs_item uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  q      public.rfq_quotes;
  v_item uuid;
  v_com  uuid;
  v_ref  text := left(btrim(coalesce(p_order_ref, '')), 200);
  m      record;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  if r.status <> 'confirmed' then raise exception 'transition_invalid' using errcode = '22023'; end if;
  v_item := coalesce(p_cbs_item, r.cbs_item_id);
  if v_item is not null and not exists (select 1 from public.cbs_items where id = v_item and project_id = r.project_id and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;
  select * into q from public.rfq_quotes where id = r.quote_id;

  if v_item is not null and q.id is not null and r.amount is not null then
    select * into m from private.money_to_base(r.project_id, r.amount, r.currency);
    insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, currency, orig_amount, fx_rate, status, note, created_by)
    values (r.tenant_id, r.project_id, v_item, left('Заказ ' || r.key || ': ' || r.title, 300), r.supplier, nullif(v_ref, ''), current_date,
            m.base, m.cur, m.orig, m.rate, 'active', 'По заявке ' || r.key, auth.uid())
    returning id into v_com;
  end if;
  if q.id is not null then
    update public.rfq_quotes set status = case when id = q.id then 'selected' else 'rejected' end, updated_at = now() where rfq_id = q.rfq_id;
    update public.rfqs set status = 'awarded', winner_id = q.id, updated_at = now() where id = q.rfq_id and status = 'open';
  end if;

  update public.material_requests
     set status = 'ordered', order_ref = v_ref, ordered_at = now(), expected_at = p_expected, cbs_item_id = v_item, commitment_id = v_com, updated_at = now()
   where id = r.id
  returning * into r;
  perform private.request_event(r, 'confirmed', 'ordered', coalesce(nullif(v_ref, ''), r.supplier));
  perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.ordered',
                                 case when p_expected is null then format('Заказано: «%s» у %s', r.title, r.supplier)
                                      else format('Заказано: «%s» у %s, ожидается %s', r.title, r.supplier, to_char(p_expected, 'DD.MM.YYYY')) end);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Поставка (Cargo in Transit): транспорт, экспедитор, номер груза, ожидаемая дата; «в пути» — по отметке закупщика
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_delivery(
  p_request uuid, p_in_transit boolean, p_expected date default null, p_transport text default '', p_forwarder text default '',
  p_tracking text default '', p_note text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  v_from text;
  v_to   text;
  v_old  date;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  if r.status not in ('ordered', 'shipped') then raise exception 'transition_invalid' using errcode = '22023'; end if;
  if coalesce(p_transport, '') not in ('', 'road', 'air', 'sea', 'rail', 'courier', 'pickup') then raise exception 'transport_invalid' using errcode = '22023'; end if;
  v_from := r.status;
  v_old := r.expected_at;
  v_to := case when coalesce(p_in_transit, false) then 'shipped' else r.status end;

  update public.material_requests
     set status = v_to, expected_at = p_expected, transport = coalesce(p_transport, ''),
         forwarder = left(btrim(coalesce(p_forwarder, '')), 200), tracking = left(btrim(coalesce(p_tracking, '')), 200),
         delivery_note = left(btrim(coalesce(p_note, '')), 2000),
         shipped_at = case when v_to = 'shipped' and v_from = 'ordered' then current_date else shipped_at end, updated_at = now()
   where id = r.id
  returning * into r;

  if v_from = 'ordered' and v_to = 'shipped' then
    perform private.request_event(r, 'ordered', 'shipped', case when p_expected is null then '' else to_char(p_expected, 'DD.MM.YYYY') end);
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.shipped',
                                   case when p_expected is null then format('В пути: «%s»', r.title)
                                        else format('В пути: «%s», ожидается %s', r.title, to_char(p_expected, 'DD.MM.YYYY')) end);
  elsif p_expected is not null and p_expected is distinct from v_old then
    perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'request_eta',
                                 jsonb_build_object('key', r.key, 'title', r.title, 'from', v_old, 'to', p_expected, 'request_id', r.id));
    perform private.request_notify(r.requested_by, r.id, 'watching', 'high', 'procurement.eta',
                                   format('Срок поставки «%s» изменился: ожидается %s', r.title, to_char(p_expected, 'DD.MM.YYYY')));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Получение: полностью, частично или с замечаниями (частично и с замечаниями — с описанием)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.material_request_receive(p_request uuid, p_result text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  v_from text;
  v_note text := btrim(coalesce(p_note, ''));
  v_text text;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.user_is_buyer(auth.uid(), r.project_id) or r.requested_by = auth.uid()
          or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'))) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  if r.status not in ('ordered', 'shipped') then raise exception 'transition_invalid' using errcode = '22023'; end if;
  if p_result not in ('full', 'partial', 'issues') then raise exception 'receipt_invalid' using errcode = '22023'; end if;
  if p_result <> 'full' and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  v_from := r.status;

  update public.material_requests
     set status = 'delivered', delivered_at = now(), receipt = p_result, receipt_note = left(v_note, 2000), received_by = auth.uid(), updated_at = now()
   where id = r.id
  returning * into r;
  perform private.request_event(r, v_from, 'delivered', v_note);
  v_text := case p_result when 'full' then format('Получено: «%s» — можно забирать', r.title)
                          when 'partial' then format('Получено частично: «%s»: %s', r.title, v_note)
                          else format('Получено с замечаниями: «%s»: %s', r.title, v_note) end;
  perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.delivered', v_text);
  perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.delivered', v_text);
end;
$$;

-- Статья бюджета: тот, у кого есть данные бюджета (budget.view в проекте), или закупщик — до заказа. Инициатор её не знает
create or replace function public.material_request_set_item(p_request uuid, p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.user_is_buyer(auth.uid(), r.project_id)
          or (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id) and private.has_project_permission(r.project_id, 'budget.view'))) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'submitted', 'sourcing', 'approval', 'confirming', 'confirmed') then raise exception 'request_locked' using errcode = '22023'; end if;
  if p_item is not null and not exists (select 1 from public.cbs_items where id = p_item and project_id = r.project_id and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;
  update public.material_requests set cbs_item_id = p_item, updated_at = now() where id = r.id;
end;
$$;

create or replace function public.material_request_budget(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not ((private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
           and (private.has_project_permission(r.project_id, 'budget.view') or private.has_project_permission(r.project_id, 'procurement.approve')))
          or private.user_is_buyer(auth.uid(), r.project_id)) then
    raise exception 'permission denied: budget' using errcode = '42501';
  end if;
  return private.request_budget_check(p_request);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Запрос цен: привязанный к заявке ведётся из заявки (закупщик, пока заявка «ищем цены»)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.rfq_guard(r public.rfqs) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status text;
begin
  if r.request_id is null then
    perform private.week_guard(r.project_id, array['procurement.request']);
    return;
  end if;
  if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  select status into v_status from public.material_requests where id = r.request_id;
  if v_status <> 'sourcing' then raise exception 'request_locked' using errcode = '22023'; end if;
end;
$$;

create or replace function public.rfq_quote_save(
  p_rfq uuid, p_supplier text, p_currency text, p_delivery_days integer default null, p_terms text default '', p_prices jsonb default '{}',
  p_id uuid default null, p_note text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r      public.rfqs;
  v_id   uuid;
  k      text;
  v_cur  text := upper(btrim(coalesce(p_currency, '')));
begin
  select * into r from public.rfqs where id = p_rfq and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'rfq_not_found' using errcode = 'P0002'; end if;
  perform private.rfq_guard(r);
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  if btrim(coalesce(p_supplier, '')) = '' then raise exception 'supplier_required' using errcode = '22023'; end if;
  if v_cur not in ('GEL', 'USD') then raise exception 'currency_invalid' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_prices, '{}'::jsonb)) <> 'object' then raise exception 'prices_invalid' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.rfq_quotes (tenant_id, rfq_id, supplier, currency, delivery_days, terms, note)
    values (r.tenant_id, r.id, btrim(p_supplier), v_cur, p_delivery_days, coalesce(p_terms, ''), coalesce(p_note, '')) returning id into v_id;
  else
    update public.rfq_quotes set supplier = btrim(p_supplier), currency = v_cur, delivery_days = p_delivery_days, terms = coalesce(p_terms, ''),
           note = coalesce(p_note, ''), updated_at = now()
     where id = p_id and rfq_id = r.id returning id into v_id;
    if v_id is null then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
    delete from public.rfq_quote_lines where quote_id = v_id;
  end if;

  for k in select jsonb_object_keys(coalesce(p_prices, '{}'::jsonb)) loop
    if not exists (select 1 from public.rfq_lines where id = k::uuid and rfq_id = r.id) then raise exception 'line_invalid' using errcode = '22023'; end if;
    if nullif(p_prices ->> k, '') is null then continue; end if;
    if (p_prices ->> k)::numeric < 0 then raise exception 'price_invalid' using errcode = '22023'; end if;
    insert into public.rfq_quote_lines (quote_id, line_id, tenant_id, unit_price) values (v_id, k::uuid, r.tenant_id, (p_prices ->> k)::numeric);
  end loop;
  return v_id;
end;
$$;

create or replace function public.rfq_quote_delete(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.rfq_quotes;
  r public.rfqs;
begin
  select * into q from public.rfq_quotes where id = p_quote and tenant_id = private.tenant_id();
  if not found then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
  select * into r from public.rfqs where id = q.rfq_id and deleted_at is null;
  perform private.rfq_guard(r);
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  delete from public.rfq_quotes where id = q.id;
end;
$$;

create or replace function public.rfq_create(
  p_project uuid, p_title text, p_request uuid default null, p_due date default null, p_note text default '', p_lines jsonb default '[]'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_id      uuid;
  v_number  integer;
  v_title   text := btrim(coalesce(p_title, ''));
  l         jsonb;
  i         integer := 0;
begin
  perform private.week_guard(p_project, array['procurement.request']);
  if p_request is not null then raise exception 'request_flow' using errcode = '22023'; end if;
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'lines_invalid' using errcode = '22023'; end if;

  insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'RQ', 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;
  insert into public.rfqs (tenant_id, project_id, number, key, title, due_date, note)
  values (v_tenant, p_project, v_number, v_project.code || '-RQ-' || v_number, v_title, p_due, coalesce(p_note, ''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    i := i + 1;
    if btrim(coalesce(l ->> 'name', '')) = '' or coalesce((l ->> 'qty')::numeric, 0) <= 0 then raise exception 'line_invalid' using errcode = '22023'; end if;
    insert into public.rfq_lines (tenant_id, rfq_id, position, name, unit, qty)
    values (v_tenant, v_id, i, btrim(l ->> 'name'), coalesce(l ->> 'unit', ''), (l ->> 'qty')::numeric);
  end loop;
  if not exists (select 1 from public.rfq_lines where rfq_id = v_id) then raise exception 'lines_required' using errcode = '22023'; end if;

  perform private.record_event(v_tenant, p_project, 'project', p_project, 'rfq_status',
                               jsonb_build_object('key', v_project.code || '-RQ-' || v_number, 'title', v_title, 'from', null, 'to', 'open', 'note', ''));
  return v_id;
end;
$$;

create or replace function public.rfq_award(p_rfq uuid, p_quote uuid, p_cbs_item uuid default null, p_doc_number text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r      public.rfqs;
  q      public.rfq_quotes;
  v_sum  numeric;
  m      record;
  v_com  uuid;
begin
  select * into r from public.rfqs where id = p_rfq and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'rfq_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['procurement.approve']);
  if r.request_id is not null then raise exception 'request_flow' using errcode = '22023'; end if;
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  select * into q from public.rfq_quotes where id = p_quote and rfq_id = r.id;
  if not found then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.rfq_lines l where l.rfq_id = r.id
              and not exists (select 1 from public.rfq_quote_lines ql where ql.quote_id = q.id and ql.line_id = l.id)) then
    raise exception 'quote_incomplete' using errcode = '22023';
  end if;
  select sum(l.qty * ql.unit_price) into v_sum from public.rfq_lines l join public.rfq_quote_lines ql on ql.line_id = l.id and ql.quote_id = q.id where l.rfq_id = r.id;
  if p_cbs_item is null then raise exception 'budget_item_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.cbs_items where id = p_cbs_item and project_id = r.project_id and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;

  select * into m from private.money_to_base(r.project_id, v_sum, q.currency);
  insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, currency, orig_amount, fx_rate, status, note, created_by)
  values (r.tenant_id, r.project_id, p_cbs_item, left('Заказ ' || r.key || ': ' || r.title, 300), q.supplier, nullif(btrim(coalesce(p_doc_number, '')), ''), current_date,
          m.base, m.cur, m.orig, m.rate, 'active', 'По запросу цен ' || r.key, auth.uid())
  returning id into v_com;

  update public.rfq_quotes set status = case when id = q.id then 'selected' else 'rejected' end, updated_at = now() where rfq_id = r.id;
  update public.rfqs set status = 'awarded', winner_id = q.id, updated_at = now() where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'rfq_status',
                               jsonb_build_object('key', r.key, 'title', r.title, 'from', 'open', 'to', 'awarded', 'note', q.supplier));
  return v_com;
end;
$$;

create or replace function public.rfq_cancel(p_rfq uuid, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rfqs;
begin
  select * into r from public.rfqs where id = p_rfq and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'rfq_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['procurement.request', 'procurement.approve']);
  if r.request_id is not null then raise exception 'request_flow' using errcode = '22023'; end if;
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  update public.rfqs set status = 'cancelled', updated_at = now() where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'rfq_status',
                               jsonb_build_object('key', r.key, 'title', r.title, 'from', 'open', 'to', 'cancelled', 'note', btrim(coalesce(p_note, ''))));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Чтение для экранов: список и карточка заявки одним ответом (закупщик и согласующие могут не видеть сам проект)
-- ---------------------------------------------------------------------------------------------------------------------
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
               'supplier', r.supplier, 'amount', r.amount, 'currency', r.currency, 'estimate', (select sum(l.qty * coalesce(l.est_price, 0)) from public.material_request_lines l where l.request_id = r.id),
               'lines_count', (select count(*) from public.material_request_lines l where l.request_id = r.id),
               'expected_at', r.expected_at, 'over_budget', r.over_budget, 'stock_status', r.stock_status,
               'approvals_total', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round),
               'approvals_done', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'approved'),
               'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                                         and a.user_id = auth.uid() and a.status = 'pending' and r.status = 'approval')
             ) as row
        from public.material_requests r
        join public.projects p on p.id = r.project_id
        left join public.users rq on rq.id = r.requested_by
        left join public.users b on b.id = r.buyer_id
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
begin
  select * into r from public.material_requests where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_see_request(v_me, p_id) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  select * into p from public.projects where id = r.project_id;
  select * into v_rfq from public.rfqs where request_id = r.id and deleted_at is null order by (status = 'cancelled'), created_at desc limit 1;

  v_out := to_jsonb(r) - 'tenant_id' - 'deleted_at' || jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'currency', p.currency, 'fx_rate', p.fx_rate),
    'requester_name', (select full_name from public.users where id = r.requested_by),
    'buyer_name', (select full_name from public.users where id = r.buyer_id),
    'received_by_name', (select full_name from public.users where id = r.received_by),
    'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = r.cbs_item_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty,
                                                          'est_price', l.est_price, 'note', l.note) order by l.position)
                         from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb),
    'rfq', case when v_rfq.id is null then null else jsonb_build_object(
      'id', v_rfq.id, 'key', v_rfq.key, 'status', v_rfq.status,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty) order by l.position)
                           from public.rfq_lines l where l.rfq_id = v_rfq.id), '[]'::jsonb),
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'supplier', q.supplier, 'currency', q.currency, 'delivery_days', q.delivery_days,
                                                             'terms', q.terms, 'note', q.note, 'status', q.status,
                                                             'prices', coalesce((select jsonb_agg(jsonb_build_object('line_id', ql.line_id, 'unit_price', ql.unit_price))
                                                                                   from public.rfq_quote_lines ql where ql.quote_id = q.id), '[]'::jsonb))
                                            order by q.created_at)
                            from public.rfq_quotes q where q.rfq_id = v_rfq.id), '[]'::jsonb)) end,
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', u.full_name, 'job_title', u.job_title, 'round', a.round,
                                                              'status', a.status, 'note', a.note, 'decided_at', a.decided_at) order by a.round desc, a.created_at)
                             from public.material_request_approvals a join public.users u on u.id = a.user_id where a.request_id = r.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event_type, 'actor', u.full_name, 'changes', e.changes) order by e.occurred_at)
                           from public.entity_events e left join public.users u on u.id = e.actor_id
                          where e.entity_id = r.project_id and e.event_type in ('request_status', 'request_eta')
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
      'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                               and a.user_id = v_me and a.status = 'pending' and r.status = 'approval'))
  );
  return v_out;
end;
$$;

-- Кого можно позвать согласовать: сотрудники компании (не внешние, не заблокированные)
create or replace function public.procurement_people() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'job_title', u.job_title) order by u.full_name), '[]'::jsonb)
    from public.users u
   where u.tenant_id = private.tenant_id() and not u.is_external and u.status <> 'blocked'
     and exists (select 1 from public.users me where me.id = auth.uid() and not me.is_external);
$$;

revoke execute on function public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb, boolean),
  public.material_request_stock(uuid, text, text), public.material_request_send_approval(uuid, uuid, uuid[], text, text),
  public.material_request_decide(uuid, boolean, text), public.material_request_order(uuid, text, date, uuid),
  public.material_request_delivery(uuid, boolean, date, text, text, text, text), public.material_request_receive(uuid, text, text),
  public.procurement_requests(uuid), public.procurement_request(uuid), public.procurement_people() from public, anon;
grant execute on function public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb, boolean),
  public.material_request_stock(uuid, text, text), public.material_request_send_approval(uuid, uuid, uuid[], text, text),
  public.material_request_decide(uuid, boolean, text), public.material_request_order(uuid, text, date, uuid),
  public.material_request_delivery(uuid, boolean, date, text, text, text, text), public.material_request_receive(uuid, text, text),
  public.procurement_requests(uuid), public.procurement_request(uuid), public.procurement_people() to authenticated;
revoke execute on function private.request_notify(uuid, uuid, text, text, text, text), private.request_buyers(uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
