-- Закупки, часть 3.2 — код бюджета по позициям и оплаты по процедуре компании.
--
-- 1. Код бюджета на каждую позицию: заявка хранит код «для всех» (material_requests.cbs_item_id), у позиции — исключение
--    (material_request_lines.cbs_item_id). При заказе обязательства в бюджете создаются по каждому коду отдельно.
-- 2. Оплаты частями (аванс, частичная, окончательная): у заявки несколько платежей. Каждый платёж проходит согласование
--    ПО ОЧЕРЕДИ: бухгалтер (проверяет документ) → руководитель закупок → директор проектов → финансовый директор → директор
--    → учредитель. Кто входит в цепочку — по сумме платежа (пороги в настройках закупок); учредитель — от своего порога или
--    по галочке на платеже. Шаг без людей на этой должности пропускается. Отказ с причиной останавливает платёж.
--    Согласованный платёж бухгалтер отмечает оплаченным и загружает платёжное поручение.
-- 3. Итоги: по заявке — оплачено, из них аванс, остаток; по поставщику — заказано, оплачено, аванс, остаток.
-- Видят платежи только те, кто видит цены (private.user_can_see_prices).

-- ---------------------------------------------------------------------------------------------------------------------
-- Должность «Учредитель» и видимость заявок для директора компании
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.seed_procurement_positions(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x record;
begin
  for x in select * from (values
      ('buyer', 'Закупщик'), ('procurement_head', 'Руководитель закупок'), ('accountant', 'Бухгалтер'),
      ('finance_director', 'Финансовый директор'), ('projects_director', 'Директор проектов'), ('storekeeper', 'Кладовщик'),
      ('owner', 'Учредитель')
    ) v(code, name)
  loop
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

-- Шаг цепочки оплаты: должность в оргструктуре; «директор» — роль компании «Директор»
create or replace function private.user_has_pay_role(p_user uuid, p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_code = 'director'
              then exists (select 1 from public.user_tenant_roles utr join public.roles r on r.id = utr.role_id
                            where utr.user_id = p_user and r.scope = 'tenant' and r.code = 'director' and r.deleted_at is null)
                   or private.user_holds(p_user, array['director'])
              else private.user_holds(p_user, array[p_code]) end;
$$;

create or replace function private.pay_role_holders(p_tenant uuid, p_code text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.users u
   where u.tenant_id = p_tenant and u.status <> 'blocked' and not u.is_external and private.user_has_pay_role(u.id, p_code);
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Настройки: пороги шагов цепочки оплаты (GEL); null — шаг только по галочке (для учредителя)
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.procurement_settings
  add column pay_procurement_head  numeric(14, 2) default 0,
  add column pay_projects_director numeric(14, 2) default 2000,
  add column pay_finance_director  numeric(14, 2) default 2000,
  add column pay_director          numeric(14, 2) default 11000,
  add column pay_owner             numeric(14, 2);

create or replace function private.procurement_settings_of(p_tenant uuid) returns public.procurement_settings
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.procurement_settings;
begin
  select * into s from public.procurement_settings where tenant_id = p_tenant;
  if not found then
    s.tenant_id := p_tenant; s.tier1_limit := 2000; s.tier2_limit := 11000;
    s.sla_stock := 1; s.sla_sourcing := 3; s.sla_approval := 2; s.sla_committee := 5; s.sla_confirm := 1;
    s.pay_procurement_head := 0; s.pay_projects_director := 2000; s.pay_finance_director := 2000; s.pay_director := 11000; s.pay_owner := null;
  end if;
  return s;
end;
$$;

drop function public.procurement_settings_save(numeric, numeric, integer, integer, integer, integer, integer);
create or replace function public.procurement_settings_save(
  p_tier1 numeric, p_tier2 numeric, p_stock integer, p_sourcing integer, p_approval integer, p_committee integer, p_confirm integer,
  p_pay_head numeric default 0, p_pay_projects numeric default 2000, p_pay_finance numeric default 2000, p_pay_director numeric default 11000,
  p_pay_owner numeric default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_tenant_permission('admin.workflows') or private.has_tenant_permission('procurement.manage')) then
    raise exception 'permission denied: procurement settings' using errcode = '42501';
  end if;
  if p_tier1 is null or p_tier2 is null or p_tier1 <= 0 or p_tier2 <= p_tier1 then raise exception 'limits_invalid' using errcode = '22023'; end if;
  insert into public.procurement_settings (tenant_id, tier1_limit, tier2_limit, sla_stock, sla_sourcing, sla_approval, sla_committee, sla_confirm,
                                           pay_procurement_head, pay_projects_director, pay_finance_director, pay_director, pay_owner, updated_at, updated_by)
  values (private.tenant_id(), p_tier1, p_tier2, p_stock, p_sourcing, p_approval, p_committee, p_confirm,
          p_pay_head, p_pay_projects, p_pay_finance, p_pay_director, p_pay_owner, now(), auth.uid())
  on conflict (tenant_id) do update
    set tier1_limit = excluded.tier1_limit, tier2_limit = excluded.tier2_limit, sla_stock = excluded.sla_stock, sla_sourcing = excluded.sla_sourcing,
        sla_approval = excluded.sla_approval, sla_committee = excluded.sla_committee, sla_confirm = excluded.sla_confirm,
        pay_procurement_head = excluded.pay_procurement_head, pay_projects_director = excluded.pay_projects_director,
        pay_finance_director = excluded.pay_finance_director, pay_director = excluded.pay_director, pay_owner = excluded.pay_owner,
        updated_at = now(), updated_by = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Код бюджета по позициям
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.material_request_lines add column cbs_item_id uuid references public.cbs_items(id);

-- Код «для всех» и исключения по позициям: p_lines = {"<id позиции>": "<id статьи>" | null (как у всех)}
create or replace function public.material_request_set_items(p_request uuid, p_default uuid, p_lines jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.material_requests;
  k text;
  v uuid;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.user_is_buyer(auth.uid(), r.project_id)
          or (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id) and private.has_project_permission(r.project_id, 'budget.view'))) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  if r.status in ('ordered', 'shipped', 'delivered', 'rejected', 'cancelled') then raise exception 'request_locked' using errcode = '22023'; end if;
  if p_default is not null and not exists (select 1 from public.cbs_items where id = p_default and project_id = r.project_id and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;
  update public.material_requests set cbs_item_id = p_default, updated_at = now() where id = r.id;
  for k in select jsonb_object_keys(coalesce(p_lines, '{}'::jsonb)) loop
    v := nullif(p_lines ->> k, '')::uuid;
    if v is not null and not exists (select 1 from public.cbs_items where id = v and project_id = r.project_id and deleted_at is null) then
      raise exception 'budget_item_invalid' using errcode = '22023';
    end if;
    update public.material_request_lines set cbs_item_id = case when v is distinct from p_default then v end
     where id = k::uuid and request_id = r.id;
    if not found then raise exception 'line_invalid' using errcode = '22023'; end if;
  end loop;
end;
$$;

-- Заказ: обязательства в бюджете — по каждому коду (позиции считаются по ценам выбранного предложения)
create or replace function public.material_request_order(p_request uuid, p_order_ref text default '', p_expected date default null, p_cbs_item uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  q      public.rfq_quotes;
  v_item uuid;
  v_com  uuid;
  v_first uuid;
  v_ref  text := left(btrim(coalesce(p_order_ref, '')), 200);
  g      record;
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

  if q.id is not null then
    for g in
      select coalesce(ml.cbs_item_id, v_item) as item, sum(rl.qty * ql.unit_price) as amount
        from public.rfq_lines rl
        join public.rfq_quote_lines ql on ql.line_id = rl.id and ql.quote_id = q.id
        left join public.material_request_lines ml on ml.request_id = r.id and ml.position = rl.position
       where rl.rfq_id = q.rfq_id
       group by 1
      having coalesce(ml.cbs_item_id, v_item) is not null
    loop
      select * into m from private.money_to_base(r.project_id, g.amount, r.currency);
      insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, currency, orig_amount, fx_rate, status, note, created_by)
      values (r.tenant_id, r.project_id, g.item, left('Заказ ' || r.key || ': ' || r.title, 300), r.supplier, nullif(v_ref, ''), current_date,
              m.base, m.cur, m.orig, m.rate, 'active', 'По заявке ' || r.key, auth.uid())
      returning id into v_com;
      v_first := coalesce(v_first, v_com);
    end loop;
    update public.rfq_quotes set status = case when id = q.id then 'selected' else 'rejected' end, updated_at = now() where rfq_id = q.rfq_id;
    update public.rfqs set status = 'awarded', winner_id = q.id, updated_at = now() where id = q.rfq_id and status = 'open';
  end if;

  update public.material_requests
     set status = 'ordered', order_ref = v_ref, ordered_at = now(), expected_at = p_expected, cbs_item_id = v_item, commitment_id = v_first, updated_at = now()
   where id = r.id
  returning * into r;
  perform private.request_event(r, 'confirmed', 'ordered', coalesce(nullif(v_ref, ''), r.supplier));
  perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.ordered',
                                 case when p_expected is null then format('Заказано: «%s» у %s', r.title, r.supplier)
                                      else format('Заказано: «%s» у %s, ожидается %s', r.title, r.supplier, to_char(p_expected, 'DD.MM.YYYY')) end);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Платежи и цепочка согласования
-- ---------------------------------------------------------------------------------------------------------------------
create table public.material_request_payments (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  request_id   uuid not null references public.material_requests(id) on delete cascade,
  number       integer not null,
  kind         text not null check (kind in ('advance', 'partial', 'final')),
  amount       numeric(14, 2) not null check (amount > 0),
  currency     char(3) not null,
  amount_gel   numeric(14, 2),
  invoice_ref  text not null default '' check (char_length(invoice_ref) <= 200),
  note         text not null default '' check (char_length(note) <= 2000),
  need_owner   boolean not null default false,
  status       text not null default 'approval' check (status in ('approval', 'approved', 'paid', 'rejected', 'cancelled')),
  decision_note text not null default '' check (char_length(decision_note) <= 2000),
  payment_ref  text not null default '' check (char_length(payment_ref) <= 200),
  paid_at      timestamptz,
  paid_by      uuid references public.users(id),
  created_by   uuid default auth.uid() references public.users(id),
  created_at   timestamptz not null default now(),
  unique (request_id, number)
);
create table public.material_request_payment_steps (
  payment_id  uuid not null references public.material_request_payments(id) on delete cascade,
  position    integer not null,
  role_code   text not null check (role_code in ('accountant', 'procurement_head', 'projects_director', 'finance_director', 'director', 'owner')),
  status      text not null default 'waiting' check (status in ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  user_id     uuid references public.users(id),
  note        text not null default '' check (char_length(note) <= 2000),
  decided_at  timestamptz,
  primary key (payment_id, position)
);
alter table public.material_request_payments enable row level security;
alter table public.material_request_payments force row level security;
alter table public.material_request_payment_steps enable row level security;
alter table public.material_request_payment_steps force row level security;
revoke insert, update, delete on public.material_request_payments, public.material_request_payment_steps from authenticated;
create policy material_request_payments_select on public.material_request_payments for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_see_prices(auth.uid(), request_id));
create policy material_request_payment_steps_select on public.material_request_payment_steps for select to authenticated
  using (exists (select 1 from public.material_request_payments p where p.id = payment_id));

-- Включить следующий шаг цепочки (пропуская должности, на которых никого нет) или закрыть согласование
create or replace function private.payment_advance(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p  public.material_request_payments;
  r  public.material_requests;
  st public.material_request_payment_steps;
  u  uuid;
begin
  select * into p from public.material_request_payments where id = p_payment;
  select * into r from public.material_requests where id = p.request_id;
  loop
    select * into st from public.material_request_payment_steps where payment_id = p.id and status = 'waiting' order by position limit 1;
    if not found then
      update public.material_request_payments set status = 'approved' where id = p.id;
      for u in select private.pay_role_holders(p.tenant_id, 'accountant') union select r.buyer_id loop
        perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.payment_approved',
                                       format('Платёж №%s по заявке «%s» согласован — можно оплачивать', p.number, r.title));
      end loop;
      return;
    end if;
    if not exists (select 1 from private.pay_role_holders(p.tenant_id, st.role_code)) then
      update public.material_request_payment_steps set status = 'skipped' where payment_id = p.id and position = st.position;
      continue;
    end if;
    update public.material_request_payment_steps set status = 'pending' where payment_id = p.id and position = st.position;
    for u in select private.pay_role_holders(p.tenant_id, st.role_code) loop
      perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.payment',
                                     format('Согласуйте платёж №%s по заявке «%s» (%s)', p.number, r.title, r.supplier));
    end loop;
    return;
  end loop;
end;
$$;

-- Новый платёж: закупщик или бухгалтер, после подтверждения инициатором; сумма — в валюте выбранного предложения
create or replace function public.material_request_payment_create(
  p_request uuid, p_kind text, p_amount numeric, p_invoice_ref text default '', p_note text default '', p_need_owner boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  s      public.procurement_settings;
  v_id   uuid;
  v_num  integer;
  v_gel  numeric;
  v_sum  numeric;
  v_chain text[] := array['accountant'];
  i      integer;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_prices(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.user_is_buyer(auth.uid(), r.project_id) or private.user_holds(auth.uid(), array['accountant'])) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  if r.status not in ('confirmed', 'ordered', 'shipped', 'delivered') or r.amount is null then raise exception 'transition_invalid' using errcode = '22023'; end if;
  if p_kind not in ('advance', 'partial', 'final') then raise exception 'kind_invalid' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_sum from public.material_request_payments where request_id = r.id and status not in ('rejected', 'cancelled');
  if v_sum + p_amount > r.amount + 0.005 then raise exception 'over_amount' using errcode = '22023'; end if;

  v_gel := case when r.currency = 'GEL' then p_amount when r.currency = 'USD' then p_amount * (select fx_rate from public.projects where id = r.project_id) end;
  s := private.procurement_settings_of(r.tenant_id);
  if coalesce(v_gel, p_amount) >= coalesce(s.pay_procurement_head, 0) then v_chain := array_append(v_chain, 'procurement_head'); end if;
  if coalesce(v_gel, p_amount) >= coalesce(s.pay_projects_director, 0) then v_chain := array_append(v_chain, 'projects_director'); end if;
  if coalesce(v_gel, p_amount) >= coalesce(s.pay_finance_director, 0) then v_chain := array_append(v_chain, 'finance_director'); end if;
  if coalesce(v_gel, p_amount) >= coalesce(s.pay_director, 0) then v_chain := array_append(v_chain, 'director'); end if;
  if coalesce(p_need_owner, false) or (s.pay_owner is not null and coalesce(v_gel, p_amount) >= s.pay_owner) then v_chain := array_append(v_chain, 'owner'); end if;

  select coalesce(max(number), 0) + 1 into v_num from public.material_request_payments where request_id = r.id;
  insert into public.material_request_payments (tenant_id, request_id, number, kind, amount, currency, amount_gel, invoice_ref, note, need_owner)
  values (r.tenant_id, r.id, v_num, p_kind, p_amount, r.currency, v_gel, left(btrim(coalesce(p_invoice_ref, '')), 200), left(btrim(coalesce(p_note, '')), 2000), coalesce(p_need_owner, false))
  returning id into v_id;
  for i in 1 .. cardinality(v_chain) loop
    insert into public.material_request_payment_steps (payment_id, position, role_code) values (v_id, i, v_chain[i]);
  end loop;
  perform private.payment_advance(v_id);
  return v_id;
end;
$$;

-- Решение шага: только тот, на чьей должности сейчас шаг; отказ — с причиной, платёж останавливается
create or replace function public.material_request_payment_decide(p_payment uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  p      public.material_request_payments;
  r      public.material_requests;
  st     public.material_request_payment_steps;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into p from public.material_request_payments where id = p_payment and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if p.status <> 'approval' then raise exception 'transition_invalid' using errcode = '22023'; end if;
  select * into st from public.material_request_payment_steps where payment_id = p.id and status = 'pending' order by position limit 1;
  if not found or not private.user_has_pay_role(auth.uid(), st.role_code) then raise exception 'permission denied: not your step' using errcode = '42501'; end if;
  if not p_approve and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  select * into r from public.material_requests where id = p.request_id;
  update public.material_request_payment_steps
     set status = case when p_approve then 'approved' else 'rejected' end, user_id = auth.uid(), note = left(v_note, 2000), decided_at = now()
   where payment_id = p.id and position = st.position;
  if p_approve then
    perform private.payment_advance(p.id);
  else
    update public.material_request_payments set status = 'rejected', decision_note = left(v_note, 2000) where id = p.id;
    perform private.request_notify(p.created_by, r.id, 'assigned', 'high', 'procurement.payment_rejected', format('Платёж №%s по заявке «%s» не согласован: %s', p.number, r.title, v_note));
    if r.buyer_id is distinct from p.created_by then
      perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.payment_rejected', format('Платёж №%s по заявке «%s» не согласован: %s', p.number, r.title, v_note));
    end if;
  end if;
end;
$$;

-- Оплачено: бухгалтер (или финансовый директор) отмечает и прикладывает платёжное поручение
create or replace function public.material_request_payment_paid(p_payment uuid, p_payment_ref text default '', p_file uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.material_request_payments;
  r public.material_requests;
begin
  select * into p from public.material_request_payments where id = p_payment and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if not private.user_holds(auth.uid(), array['accountant', 'finance_director']) then raise exception 'permission denied: accounting' using errcode = '42501'; end if;
  if p.status <> 'approved' then raise exception 'transition_invalid' using errcode = '22023'; end if;
  select * into r from public.material_requests where id = p.request_id;
  if p_file is not null then
    if not exists (select 1 from public.files where id = p_file and project_id = r.project_id and created_by = auth.uid()) then raise exception 'file_invalid' using errcode = '22023'; end if;
    insert into public.attachments (tenant_id, project_id, entity_type, entity_id, file_id, caption)
    values (r.tenant_id, r.project_id, 'material_request', r.id, p_file, 'pay:' || p.id);
  end if;
  update public.material_request_payments set status = 'paid', paid_at = now(), paid_by = auth.uid(), payment_ref = left(btrim(coalesce(p_payment_ref, '')), 200) where id = p.id;
  perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.paid', format('Оплачено: платёж №%s по заявке «%s» (%s)', p.number, r.title, r.supplier));
  if p.created_by is distinct from r.buyer_id then
    perform private.request_notify(p.created_by, r.id, 'watching', 'normal', 'procurement.paid', format('Оплачено: платёж №%s по заявке «%s» (%s)', p.number, r.title, r.supplier));
  end if;
end;
$$;

-- Отменить платёж, пока его не оплатили (автор, закупщик, бухгалтер)
create or replace function public.material_request_payment_cancel(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.material_request_payments;
  r public.material_requests;
begin
  select * into p from public.material_request_payments where id = p_payment and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  select * into r from public.material_requests where id = p.request_id;
  if not (p.created_by = auth.uid() or private.user_is_buyer(auth.uid(), r.project_id) or private.user_holds(auth.uid(), array['accountant'])) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  if p.status not in ('approval', 'approved') then raise exception 'transition_invalid' using errcode = '22023'; end if;
  update public.material_request_payments set status = 'cancelled' where id = p.id;
  update public.material_request_payment_steps set status = 'skipped' where payment_id = p.id and status in ('waiting', 'pending');
end;
$$;

-- Документ к платежу (инвойс, счёт-фактура): вложение заявки с подписью 'pay:<id платежа>'
create or replace function public.material_request_payment_attach(p_payment uuid, p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.material_request_payments;
  r public.material_requests;
begin
  select * into p from public.material_request_payments where id = p_payment and tenant_id = private.tenant_id();
  if not found or not private.user_can_see_prices(auth.uid(), p.request_id) then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  select * into r from public.material_requests where id = p.request_id;
  if not exists (select 1 from public.files where id = p_file and project_id = r.project_id and created_by = auth.uid()) then raise exception 'file_invalid' using errcode = '22023'; end if;
  insert into public.attachments (tenant_id, project_id, entity_type, entity_id, file_id, caption)
  values (r.tenant_id, r.project_id, 'material_request', r.id, p_file, 'pay:' || p.id);
end;
$$;

-- Платежи заявки для карточки (только тем, кто видит цены)
create or replace function private.request_payments_json(p_request uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'number', p.number, 'kind', p.kind, 'amount', p.amount, 'currency', p.currency, 'amount_gel', p.amount_gel,
           'invoice_ref', p.invoice_ref, 'note', p.note, 'need_owner', p.need_owner, 'status', p.status, 'decision_note', p.decision_note,
           'payment_ref', p.payment_ref, 'paid_at', p.paid_at, 'paid_by', (select full_name from public.users where id = p.paid_by),
           'created_at', p.created_at, 'created_by', (select full_name from public.users where id = p.created_by),
           'my_step', exists (select 1 from public.material_request_payment_steps s where s.payment_id = p.id and s.status = 'pending'
                                and private.user_has_pay_role(p_user, s.role_code)),
           'can_pay', p.status = 'approved' and private.user_holds(p_user, array['accountant', 'finance_director']),
           'steps', (select jsonb_agg(jsonb_build_object('position', s.position, 'role', s.role_code, 'status', s.status, 'note', s.note, 'decided_at', s.decided_at,
                                                         'by', (select full_name from public.users where id = s.user_id)) order by s.position)
                       from public.material_request_payment_steps s where s.payment_id = p.id),
           'files', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'storage_key', f.storage_key) order by a.created_at), '[]'::jsonb)
                       from public.attachments a join public.files f on f.id = a.file_id
                      where a.entity_type = 'material_request' and a.entity_id = p.request_id and a.caption = 'pay:' || p.id)
         ) order by p.number), '[]'::jsonb)
    from public.material_request_payments p
   where p.request_id = p_request and private.user_can_see_prices(p_user, p_request);
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
            or (not u.is_external and private.user_holds(p_user, array['buyer', 'procurement_head', 'accountant', 'finance_director', 'projects_director', 'storekeeper', 'owner']))
            or (not u.is_external and private.user_has_pay_role(p_user, 'director'))
            or (not u.is_external and private.user_can_see_project(p_user, r.project_id)
                and (private.user_has_project_permission(p_user, r.project_id, 'procurement.view')
                     or private.user_has_project_permission(p_user, r.project_id, 'procurement.request')
                     or private.user_has_project_permission(p_user, r.project_id, 'procurement.approve'))))
  );
$$;

create or replace function private.user_can_see_prices(p_user uuid, p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.material_requests r join public.users u on u.id = p_user and u.tenant_id = r.tenant_id and not u.is_external
     where r.id = p_request
       and (private.user_is_buyer(p_user, r.project_id)
            or private.user_holds(p_user, array['buyer', 'procurement_head', 'accountant', 'finance_director', 'projects_director', 'owner'])
            or private.user_has_pay_role(p_user, 'director')
            or private.user_has_tenant_permission(p_user, r.tenant_id, 'budget.view')
            or (private.user_can_see_project(p_user, r.project_id) and private.user_has_project_permission(p_user, r.project_id, 'budget.view'))
            or exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.user_id = p_user)));
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
               'my_payment', x2.prices and exists (select 1 from public.material_request_payments pp join public.material_request_payment_steps ps on ps.payment_id = pp.id
                                                    where pp.request_id = r.id and pp.status = 'approval' and ps.status = 'pending' and private.user_has_pay_role(auth.uid(), ps.role_code))
                             or (x2.prices and private.user_holds(auth.uid(), array['accountant', 'finance_director'])
                                 and exists (select 1 from public.material_request_payments pp where pp.request_id = r.id and pp.status = 'approved')),
               'paid', case when x2.prices then (select coalesce(sum(pp.amount), 0) from public.material_request_payments pp where pp.request_id = r.id and pp.status = 'paid') end,
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
                                                          'est_price', case when v_prices then l.est_price end, 'note', l.note, 'cbs_item_id', l.cbs_item_id,
                                                          'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = coalesce(l.cbs_item_id, r.cbs_item_id)), 'received_qty', l.received_qty,
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
                          and (v_prices or a.caption not like 'quote:%')
                          and a.caption not like 'pay:%'), '[]'::jsonb),
    'payments', private.request_payments_json(r.id, v_me),
    'pay_summary', case when v_prices then (
      select jsonb_build_object(
               'paid', coalesce(sum(pp.amount) filter (where pp.status = 'paid'), 0),
               'advance', coalesce(sum(pp.amount) filter (where pp.status = 'paid' and pp.kind = 'advance'), 0),
               'in_approval', coalesce(sum(pp.amount) filter (where pp.status in ('approval', 'approved')), 0),
               'remaining', coalesce(r.amount, 0) - coalesce(sum(pp.amount) filter (where pp.status = 'paid'), 0))
        from public.material_request_payments pp where pp.request_id = r.id) end,
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
      'can_pay_create', v_prices and r.status in ('confirmed', 'ordered', 'shipped', 'delivered')
                        and (private.user_is_buyer(v_me, r.project_id) or private.user_holds(v_me, array['accountant'])),
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

create or replace function public.suppliers_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.name), '[]'::jsonb) from (
    select s.name, to_jsonb(s) - 'tenant_id' - 'deleted_at' || jsonb_build_object(
             'quotes', (select count(*) from public.rfq_quotes q where q.supplier_id = s.id),
             'wins', (select count(*) from public.rfq_quotes q where q.supplier_id = s.id and q.status = 'selected'),
             'last_quote', (select max(q.created_at) from public.rfq_quotes q where q.supplier_id = s.id))
             || case when fin.ok then (
                  select jsonb_build_object(
                           'ordered_gel', coalesce(sum(private.request_amount_gel(mr)), 0),
                           'paid_gel', coalesce(sum((select sum(pp.amount_gel) from public.material_request_payments pp where pp.request_id = mr.id and pp.status = 'paid')), 0),
                           'advance_gel', coalesce(sum((select sum(pp.amount_gel) from public.material_request_payments pp where pp.request_id = mr.id and pp.status = 'paid' and pp.kind = 'advance')), 0))
                    from public.material_requests mr join public.rfq_quotes q on q.id = mr.quote_id
                   where q.supplier_id = s.id and mr.deleted_at is null and mr.status in ('confirmed', 'ordered', 'shipped', 'delivered'))
                else '{}'::jsonb end as row
      from public.suppliers s
      cross join (select private.can_manage_suppliers() or private.user_holds(auth.uid(), array['accountant', 'finance_director', 'projects_director', 'owner'])
                         or private.has_tenant_permission('budget.view') as ok) fin
     where s.tenant_id = private.tenant_id() and s.deleted_at is null and private.staff_insider()
  ) x;
$$;

revoke execute on function public.material_request_set_items(uuid, uuid, jsonb), public.material_request_payment_create(uuid, text, numeric, text, text, boolean),
  public.material_request_payment_decide(uuid, boolean, text), public.material_request_payment_paid(uuid, text, uuid), public.material_request_payment_cancel(uuid),
  public.material_request_payment_attach(uuid, uuid),
  public.procurement_settings_save(numeric, numeric, integer, integer, integer, integer, integer, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.material_request_set_items(uuid, uuid, jsonb), public.material_request_payment_create(uuid, text, numeric, text, text, boolean),
  public.material_request_payment_decide(uuid, boolean, text), public.material_request_payment_paid(uuid, text, uuid), public.material_request_payment_cancel(uuid),
  public.material_request_payment_attach(uuid, uuid),
  public.procurement_settings_save(numeric, numeric, integer, integer, integer, integer, integer, numeric, numeric, numeric, numeric, numeric) to authenticated;
revoke execute on function private.payment_advance(uuid), private.pay_role_holders(uuid, text) from public, anon, authenticated;
notify pgrst, 'reload schema';
