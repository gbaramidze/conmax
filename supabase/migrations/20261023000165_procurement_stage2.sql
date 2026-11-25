-- Закупки, этап 2 процедуры PR-01.
--
-- 1. Справочник поставщиков (п. 5.4): контакты, ИНН, категория, статус «работаем / ограниченный список». Предложение в заявке
--    привязывается к поставщику по названию (новый заводится сам), отсюда история цен и подсказки «почём брали раньше».
-- 2. Пороги суммы (п. 7): настройки компании — до 2 000 / до 11 000 / выше (GEL, с НДС). При отправке на согласование
--    система называет уровень и предлагает, кого спросить: главный инженер и прораб → + руководитель проекта и директор →
--    комитет (директор, руководитель проекта, финансисты). Это подсказка: решает закупщик.
-- 3. Сроки шагов (п. 13.1, рабочие дни): склад 1, поиск цен 3, согласование 2 (комитет 5), подтверждение инициатора 1;
--    поставка — ожидаемая дата. Просроченный шаг виден в списке и карточке, раз в сутки — напоминание тому, чей шаг.
-- 4. Частичные поставки по позициям: получено по каждой позиции, журнал приёмок; заявка закрывается, когда пришло всё.
-- 5. Вложения: BOQ, чертежи, коммерческие предложения поставщиков (к заявке или к конкретному предложению).
-- Decision Sheet (п. 7, дан. 3) собирается в PDF в браузере из карточки заявки — отдельной таблицы не нужно.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Поставщики
-- ---------------------------------------------------------------------------------------------------------------------
create table public.suppliers (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  tax_id      text not null default '' check (char_length(tax_id) <= 50),
  country     text not null default '' check (char_length(country) <= 80),
  contact     text not null default '' check (char_length(contact) <= 200),
  phone       text not null default '' check (char_length(phone) <= 100),
  email       text not null default '' check (char_length(email) <= 200),
  address     text not null default '' check (char_length(address) <= 500),
  category    text not null default '' check (char_length(category) <= 200),
  status      text not null default 'active' check (status in ('active', 'restricted')),
  note        text not null default '' check (char_length(note) <= 2000),
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index suppliers_name_uq on public.suppliers (tenant_id, lower(btrim(name))) where deleted_at is null;
alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;
revoke insert, update, delete on public.suppliers from authenticated;
create policy suppliers_select on public.suppliers for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null and (select private.staff_insider()));

alter table public.rfq_quotes add column supplier_id uuid references public.suppliers(id) on delete set null;
create index on public.rfq_quotes (supplier_id);

-- Поставщик по названию: найти или завести (база пополняется сама из предложений)
create or replace function private.supplier_for(p_tenant uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then return null; end if;
  select id into v_id from public.suppliers where tenant_id = p_tenant and deleted_at is null and lower(btrim(name)) = lower(v_name);
  if v_id is null then
    insert into public.suppliers (tenant_id, name) values (p_tenant, left(v_name, 200)) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- существующие предложения — в справочник
do $$
declare q record;
begin
  for q in select id, tenant_id, supplier from public.rfq_quotes where supplier_id is null loop
    update public.rfq_quotes set supplier_id = private.supplier_for(q.tenant_id, q.supplier) where id = q.id;
  end loop;
end $$;

-- Ведёт справочник и видит цены: отдел закупок или руководитель проекта (procurement.approve хотя бы в одном проекте)
create or replace function private.can_manage_suppliers() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.staff_insider()
     and (private.has_tenant_permission('procurement.manage')
          or private.has_tenant_permission('procurement.approve')
          or exists (select 1 from public.project_members pm join public.role_permissions rp on rp.role_id = pm.role_id
                      where pm.user_id = auth.uid() and pm.tenant_id = private.tenant_id() and pm.deleted_at is null
                        and (pm.left_at is null or pm.left_at > current_date) and rp.permission = 'procurement.approve'));
$$;

create or replace function public.supplier_save(
  p_id uuid, p_name text, p_tax_id text default '', p_country text default '', p_contact text default '', p_phone text default '',
  p_email text default '', p_address text default '', p_category text default '', p_status text default 'active', p_note text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     uuid;
begin
  if not private.can_manage_suppliers() then raise exception 'permission denied: suppliers' using errcode = '42501'; end if;
  if v_name = '' or char_length(v_name) > 200 then raise exception 'name_required' using errcode = '22023'; end if;
  if coalesce(p_status, '') not in ('active', 'restricted') then raise exception 'status_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.suppliers where tenant_id = v_tenant and deleted_at is null and lower(btrim(name)) = lower(v_name)
               and id is distinct from p_id) then
    raise exception 'supplier_exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.suppliers (tenant_id, name, tax_id, country, contact, phone, email, address, category, status, note)
    values (v_tenant, v_name, left(btrim(coalesce(p_tax_id, '')), 50), left(btrim(coalesce(p_country, '')), 80), left(btrim(coalesce(p_contact, '')), 200),
            left(btrim(coalesce(p_phone, '')), 100), left(btrim(coalesce(p_email, '')), 200), left(btrim(coalesce(p_address, '')), 500),
            left(btrim(coalesce(p_category, '')), 200), p_status, left(btrim(coalesce(p_note, '')), 2000))
    returning id into v_id;
  else
    update public.suppliers
       set name = v_name, tax_id = left(btrim(coalesce(p_tax_id, '')), 50), country = left(btrim(coalesce(p_country, '')), 80),
           contact = left(btrim(coalesce(p_contact, '')), 200), phone = left(btrim(coalesce(p_phone, '')), 100),
           email = left(btrim(coalesce(p_email, '')), 200), address = left(btrim(coalesce(p_address, '')), 500),
           category = left(btrim(coalesce(p_category, '')), 200), status = p_status, note = left(btrim(coalesce(p_note, '')), 2000),
           updated_at = now()
     where id = p_id and tenant_id = v_tenant and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'supplier_not_found' using errcode = 'P0002'; end if;
    -- название в предложениях держим тем же, что в справочнике
    update public.rfq_quotes set supplier = v_name where supplier_id = v_id and supplier <> v_name;
  end if;
  return v_id;
end;
$$;

-- Справочник со сводкой: сколько предложений, сколько выиграли, когда последнее
create or replace function public.suppliers_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.name), '[]'::jsonb) from (
    select s.name, to_jsonb(s) - 'tenant_id' - 'deleted_at' || jsonb_build_object(
             'quotes', (select count(*) from public.rfq_quotes q where q.supplier_id = s.id),
             'wins', (select count(*) from public.rfq_quotes q where q.supplier_id = s.id and q.status = 'selected'),
             'last_quote', (select max(q.created_at) from public.rfq_quotes q where q.supplier_id = s.id)) as row
      from public.suppliers s
     where s.tenant_id = private.tenant_id() and s.deleted_at is null and private.staff_insider()
  ) x;
$$;

-- История предложений поставщика с ценами по позициям (только тем, кто ведёт закупки)
create or replace function public.supplier_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_manage_suppliers() then raise exception 'permission denied: suppliers' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'quote_id', q.id, 'created_at', q.created_at, 'status', q.status, 'currency', q.currency, 'delivery_days', q.delivery_days, 'terms', q.terms,
             'rfq_key', f.key, 'title', f.title, 'project_code', p.code, 'request_id', f.request_id,
             'request_key', (select key from public.material_requests where id = f.request_id),
             'lines', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'unit', l.unit, 'qty', l.qty, 'unit_price', ql.unit_price) order by l.position)
                                  from public.rfq_quote_lines ql join public.rfq_lines l on l.id = ql.line_id where ql.quote_id = q.id), '[]'::jsonb))
             order by q.created_at desc)
      from public.rfq_quotes q join public.rfqs f on f.id = q.rfq_id join public.projects p on p.id = f.project_id
     where q.supplier_id = p_id and q.tenant_id = private.tenant_id() and f.deleted_at is null), '[]'::jsonb);
end;
$$;

-- Почём брали раньше: последние 3 цены по каждой позиции с тем же названием (без учёта регистра)
create or replace function public.procurement_price_hints(p_names text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_manage_suppliers() then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(n.key, n.hints) from (
      select lower(btrim(x)) as key,
             (select jsonb_agg(h.j order by h.at desc) from (
                select q.created_at as at,
                       jsonb_build_object('unit_price', ql.unit_price, 'currency', q.currency, 'unit', l.unit, 'supplier', q.supplier,
                                          'at', q.created_at, 'won', q.status = 'selected') as j
                  from public.rfq_lines l
                  join public.rfq_quote_lines ql on ql.line_id = l.id
                  join public.rfq_quotes q on q.id = ql.quote_id
                 where l.tenant_id = private.tenant_id() and lower(btrim(l.name)) = lower(btrim(x))
                 order by q.created_at desc limit 3) h) as hints
        from unnest(coalesce(p_names, '{}')) x
       where btrim(x) <> '') n
     where n.hints is not null), '{}'::jsonb);
end;
$$;

-- Предложение: поставщик привязывается к справочнику
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
    insert into public.rfq_quote_lines (quote_id, line_id, tenant_id, unit_price) values (v_id, k::uuid, r.tenant_id, (p_prices ->> k)::numeric);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Настройки закупок компании: пороги и сроки
-- ---------------------------------------------------------------------------------------------------------------------
create table public.procurement_settings (
  tenant_id      uuid primary key references public.tenants(id),
  tier1_limit    numeric(14, 2) not null default 2000 check (tier1_limit > 0),
  tier2_limit    numeric(14, 2) not null default 11000 check (tier2_limit > 0),
  sla_stock      integer not null default 1 check (sla_stock between 0 and 60),
  sla_sourcing   integer not null default 3 check (sla_sourcing between 0 and 60),
  sla_approval   integer not null default 2 check (sla_approval between 0 and 60),
  sla_committee  integer not null default 5 check (sla_committee between 0 and 60),
  sla_confirm    integer not null default 1 check (sla_confirm between 0 and 60),
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid() references public.users(id),
  check (tier2_limit > tier1_limit)
);
alter table public.procurement_settings enable row level security;
alter table public.procurement_settings force row level security;
revoke insert, update, delete on public.procurement_settings from authenticated;
create policy procurement_settings_select on public.procurement_settings for select to authenticated
  using (tenant_id = (select private.tenant_id()));

create or replace function private.procurement_settings_of(p_tenant uuid) returns public.procurement_settings
language sql stable security definer set search_path = '' as $$
  select coalesce((select s from public.procurement_settings s where s.tenant_id = p_tenant),
                  row(p_tenant, 2000, 11000, 1, 3, 2, 5, 1, now(), null)::public.procurement_settings);
$$;

create or replace function public.procurement_settings_get() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) - 'tenant_id' - 'updated_by' || jsonb_build_object('can_edit', private.has_tenant_permission('admin.workflows') or private.has_tenant_permission('procurement.manage'))
    from private.procurement_settings_of(private.tenant_id()) s;
$$;

create or replace function public.procurement_settings_save(
  p_tier1 numeric, p_tier2 numeric, p_stock integer, p_sourcing integer, p_approval integer, p_committee integer, p_confirm integer
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_tenant_permission('admin.workflows') or private.has_tenant_permission('procurement.manage')) then
    raise exception 'permission denied: procurement settings' using errcode = '42501';
  end if;
  if p_tier1 is null or p_tier2 is null or p_tier1 <= 0 or p_tier2 <= p_tier1 then raise exception 'limits_invalid' using errcode = '22023'; end if;
  insert into public.procurement_settings (tenant_id, tier1_limit, tier2_limit, sla_stock, sla_sourcing, sla_approval, sla_committee, sla_confirm, updated_at, updated_by)
  values (private.tenant_id(), p_tier1, p_tier2, p_stock, p_sourcing, p_approval, p_committee, p_confirm, now(), auth.uid())
  on conflict (tenant_id) do update
    set tier1_limit = excluded.tier1_limit, tier2_limit = excluded.tier2_limit, sla_stock = excluded.sla_stock, sla_sourcing = excluded.sla_sourcing,
        sla_approval = excluded.sla_approval, sla_committee = excluded.sla_committee, sla_confirm = excluded.sla_confirm,
        updated_at = now(), updated_by = auth.uid();
end;
$$;

-- Сумма выбранного предложения в лари (курс проекта: лари за 1 доллар); null — нет предложения или курса
create or replace function private.request_amount_gel(r public.material_requests) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when r.amount is null then null
              when r.currency = 'GEL' then r.amount
              when r.currency = 'USD' then (select r.amount * p.fx_rate from public.projects p where p.id = r.project_id)
         end;
$$;

-- Уровень согласования по порогам компании: 1 — до первого порога, 2 — до второго, 3 — комитет
create or replace function private.request_tier(r public.material_requests) returns integer
language sql stable security definer set search_path = '' as $$
  select case when a is null then null when a <= s.tier1_limit then 1 when a <= s.tier2_limit then 2 else 3 end
    from (select private.request_amount_gel(r) as a) x, private.procurement_settings_of(r.tenant_id) s;
$$;

alter table public.material_requests add column tier integer check (tier between 1 and 3);

-- Кого предложить в согласующие по уровню суммы (подсказка закупщику; решает он)
create or replace function public.procurement_suggest_for(p_request uuid, p_amount_gel numeric) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r       public.material_requests;
  s       public.procurement_settings;
  v_tier  integer;
  v_codes text[];
  v_dir   boolean;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  s := private.procurement_settings_of(r.tenant_id);
  v_tier := case when p_amount_gel is null then null when p_amount_gel <= s.tier1_limit then 1 when p_amount_gel <= s.tier2_limit then 2 else 3 end;
  v_codes := case v_tier
               when 1 then array['chief_engineer', 'foreman', 'senior_project_coordinator']
               when 2 then array['chief_engineer', 'foreman', 'senior_project_coordinator', 'project_manager']
               when 3 then array['project_manager', 'senior_financial_manager', 'financial_manager']
               else array[]::text[] end;
  v_dir := v_tier >= 2;
  return jsonb_build_object(
    'tier', v_tier, 'tier1_limit', s.tier1_limit, 'tier2_limit', s.tier2_limit,
    'suggest', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'job_title', x.job_title, 'role', x.role) order by x.ord, x.full_name)
        from (
          select distinct on (u.id) u.id, u.full_name, u.job_title, ro.name as role, array_position(v_codes, ro.code) as ord
            from public.project_members pm join public.users u on u.id = pm.user_id join public.roles ro on ro.id = pm.role_id
           where pm.project_id = r.project_id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
             and ro.code = any(v_codes) and not u.is_external and u.status <> 'blocked'
          union
          select u.id, u.full_name, u.job_title, ro.name, 0
            from public.user_tenant_roles utr join public.users u on u.id = utr.user_id join public.roles ro on ro.id = utr.role_id
           where v_dir and utr.tenant_id = r.tenant_id and ro.scope = 'tenant' and ro.code = 'director' and not u.is_external and u.status <> 'blocked'
        ) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Сроки шагов и напоминания
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.material_requests
  add column status_at   timestamptz not null default now(),
  add column reminded_at timestamptz;
update public.material_requests set status_at = updated_at;

create or replace function private.material_requests_status_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_at := now();
    new.reminded_at := null;
  elsif new.expected_at is distinct from old.expected_at then
    new.reminded_at := null;     -- новая дата поставки — напоминание об опоздании заново
  end if;
  return new;
end;
$$;
create trigger material_requests_status_at before update on public.material_requests
  for each row execute function private.material_requests_status_at();

-- Плюс N рабочих дней (пн–пт) к моменту: срок — конец этого дня по Тбилиси
create or replace function private.add_workdays(p_from timestamptz, p_days integer) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare
  d date := (p_from at time zone 'Asia/Tbilisi')::date;
  n integer := 0;
begin
  while n < greatest(p_days, 0) loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return ((d + 1)::timestamp at time zone 'Asia/Tbilisi');
end;
$$;

-- Срок текущего шага заявки; null — у шага нет срока
create or replace function private.request_due(r public.material_requests) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case r.status
           when 'submitted'  then private.add_workdays(r.status_at, s.sla_stock)
           when 'sourcing'   then private.add_workdays(r.status_at, s.sla_sourcing)
           when 'approval'   then private.add_workdays(r.status_at, case when r.tier = 3 then s.sla_committee else s.sla_approval end)
           when 'confirming' then private.add_workdays(r.status_at, s.sla_confirm)
           when 'ordered'    then case when r.expected_at is null then null else ((r.expected_at + 1)::timestamp at time zone 'Asia/Tbilisi') end
           when 'shipped'    then case when r.expected_at is null then null else ((r.expected_at + 1)::timestamp at time zone 'Asia/Tbilisi') end
         end
    from private.procurement_settings_of(r.tenant_id) s;
$$;

-- Напоминания по просроченным шагам: раз в сутки тому, чей шаг (по будням)
create or replace function private.procurement_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r   public.material_requests;
  u   uuid;
  n   integer := 0;
  v_text text;
begin
  if extract(isodow from (now() at time zone 'Asia/Tbilisi')) >= 6 then return 0; end if;
  for r in
    select * from public.material_requests
     where deleted_at is null and status in ('submitted', 'sourcing', 'approval', 'confirming', 'ordered', 'shipped')
       and (reminded_at is null or reminded_at < now() - interval '20 hours')
  loop
    if coalesce(private.request_due(r), 'infinity') > now() then continue; end if;
    if r.status = 'submitted' then
      for u in select private.request_buyers(r.id) loop
        perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.overdue', format('Заявку «%s» никто не взял в работу — срок прошёл', r.title));
      end loop;
    elsif r.status = 'sourcing' then
      perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.overdue', format('Срок поиска цен по заявке «%s» прошёл', r.title));
    elsif r.status = 'approval' then
      for u in select a.user_id from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'pending' loop
        perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.overdue', format('Напоминание: ждём вашего согласования закупки «%s»', r.title));
      end loop;
    elsif r.status = 'confirming' then
      perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.overdue', format('Напоминание: подтвердите закупку «%s»', r.title));
    else
      v_text := format('Поставка «%s» опаздывает: ждали %s', r.title, to_char(r.expected_at, 'DD.MM.YYYY'));
      perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.late', v_text);
      perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.late', v_text);
    end if;
    update public.material_requests set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function private.procurement_reminders() from public, anon, authenticated;
select cron.schedule('buildos-procurement-reminders', '35 * * * *', $$select private.procurement_reminders()$$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Частичные поставки по позициям
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.material_request_lines add column received_qty numeric(14, 3) not null default 0 check (received_qty >= 0);
update public.material_request_lines l set received_qty = l.qty
  from public.material_requests r where r.id = l.request_id and r.status = 'delivered';

create table public.material_request_receipts (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  request_id  uuid not null references public.material_requests(id) on delete cascade,
  result      text not null check (result in ('full', 'partial', 'issues')),
  lines       jsonb not null default '[]',
  note        text not null default '' check (char_length(note) <= 2000),
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now()
);
create index on public.material_request_receipts (request_id);
alter table public.material_request_receipts enable row level security;
alter table public.material_request_receipts force row level security;
revoke insert, update, delete on public.material_request_receipts from authenticated;
create policy material_request_receipts_select on public.material_request_receipts for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.user_can_see_request(auth.uid(), request_id));

-- Получение: «всё» (остаток целиком), «часть» (по позициям: {id позиции: сколько пришло сейчас}), «с замечаниями» (всё, но с описанием).
-- Заявка закрывается, когда по всем позициям пришло не меньше заказанного.
drop function public.material_request_receive(uuid, text, text);
create or replace function public.material_request_receive(p_request uuid, p_result text, p_note text default '', p_lines jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.material_requests;
  v_from text;
  v_note text := btrim(coalesce(p_note, ''));
  v_text text;
  v_got  jsonb := '[]';
  v_done boolean;
  k      text;
  v_qty  numeric;
  l      public.material_request_lines;
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

  if p_result = 'partial' then
    if p_lines is null or jsonb_typeof(p_lines) <> 'object' then raise exception 'lines_required' using errcode = '22023'; end if;
    for k in select jsonb_object_keys(p_lines) loop
      select * into l from public.material_request_lines where id = k::uuid and request_id = r.id;
      if not found then raise exception 'line_invalid' using errcode = '22023'; end if;
      v_qty := nullif(p_lines ->> k, '')::numeric;
      if v_qty is null or v_qty = 0 then continue; end if;
      if v_qty < 0 then raise exception 'qty_invalid' using errcode = '22023'; end if;
      update public.material_request_lines set received_qty = received_qty + v_qty where id = l.id;
      v_got := v_got || jsonb_build_array(jsonb_build_object('name', l.name, 'unit', l.unit, 'qty', v_qty));
    end loop;
    if jsonb_array_length(v_got) = 0 then raise exception 'lines_required' using errcode = '22023'; end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'unit', unit, 'qty', qty - received_qty) order by position), '[]') into v_got
      from public.material_request_lines where request_id = r.id and received_qty < qty;
    update public.material_request_lines set received_qty = greatest(received_qty, qty) where request_id = r.id;
  end if;
  insert into public.material_request_receipts (tenant_id, request_id, result, lines, note) values (r.tenant_id, r.id, p_result, v_got, left(v_note, 2000));

  v_done := not exists (select 1 from public.material_request_lines where request_id = r.id and received_qty < qty);
  if v_done then
    update public.material_requests
       set status = 'delivered', delivered_at = now(), receipt = case when p_result = 'issues' or receipt = 'issues' then 'issues' else 'full' end,
           receipt_note = case when v_note <> '' then left(v_note, 2000) else receipt_note end, received_by = auth.uid(), updated_at = now()
     where id = r.id
    returning * into r;
    perform private.request_event(r, v_from, 'delivered', v_note);
    v_text := case when r.receipt = 'issues' then format('Получено с замечаниями: «%s»: %s', r.title, coalesce(nullif(v_note, ''), r.receipt_note))
                   else format('Получено: «%s» — можно забирать', r.title) end;
  else
    update public.material_requests set receipt = 'partial', receipt_note = left(v_note, 2000), updated_at = now() where id = r.id returning * into r;
    perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'request_receipt',
                                 jsonb_build_object('key', r.key, 'title', r.title, 'note', v_note, 'request_id', r.id));
    v_text := format('Получено частично: «%s»: %s', r.title, v_note);
  end if;
  perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.delivered', v_text);
  perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.delivered', v_text);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Вложения заявки: BOQ, чертежи, коммерческие предложения (в общей таблице attachments, entity_type 'material_request';
--    caption — 'request' или 'quote:<id предложения>')
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.user_can_view_entity(p_user uuid, p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project' then private.user_can_see_project(p_user, p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and private.user_task_visible(p_user, t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    when 'location' then exists (
      select 1 from public.locations l
      where l.id = p_id and private.user_can_see_project(p_user, l.project_id))
    when 'document' then private.user_can_view_document(p_user, p_id)
    when 'meeting' then private.user_can_view_meeting(p_user, p_id)
    when 'signal' then exists (
      select 1 from public.signals s
      where s.id = p_id and private.user_can_see_project(p_user, s.project_id)
        and private.user_has_project_permission(p_user, s.project_id, 'signal.view')
        and private.user_has_project_permission(p_user, s.project_id, 'comment.internal.view'))
    when 'field_note' then exists (
      select 1 from public.field_notes f join public.comments c on c.id = f.comment_id
      where f.comment_id = p_id and c.deleted_at is null
        and private.user_can_see_project(p_user, f.project_id)
        and (c.visibility = 'external' or private.user_has_project_permission(p_user, f.project_id, 'comment.internal.view')))
    when 'board_card' then exists (
      select 1 from public.board_cards c
      where c.id = p_id and private.board_user_can_view(c.board_id, p_user)
        and private.board_card_user_visible(c.board_id, c.id, c.created_by, p_user))
    when 'material_request' then private.user_can_see_request(p_user, p_id)
    else false
  end;
$$;

-- проект вложения определяется по сущности (триггер attachments_before_insert)
create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'    then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'       then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
    when 'location'   then (select project_id from public.locations where id = p_id and tenant_id = private.tenant_id())
    when 'document'   then (select project_id from public.documents where id = p_id and tenant_id = private.tenant_id())
    when 'meeting'    then (select project_id from public.meetings where id = p_id and tenant_id = private.tenant_id())
    when 'signal'     then (select project_id from public.signals where id = p_id and tenant_id = private.tenant_id())
    when 'field_note' then (select project_id from public.field_notes where comment_id = p_id and tenant_id = private.tenant_id())
    when 'material_request' then (select project_id from public.material_requests where id = p_id and tenant_id = private.tenant_id())
  end;
$$;

-- загружать файлы в проект может и тот, кто ведёт закупки или заводит заявки
create or replace function private.can_upload_file(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_project_permission(p_project, 'comment.create')
      or private.has_project_permission(p_project, 'document.upload')
      or private.has_project_permission(p_project, 'project.edit')
      or private.has_project_permission(p_project, 'procurement.request')
      or private.has_project_permission(p_project, 'procurement.manage');
$$;

-- файл заявки скачивает любой, кто видит заявку (в том числе согласующий без доступа к проекту)
create or replace function private.can_read_request_file(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f join public.attachments a on a.file_id = f.id
     where f.storage_key = p_key and a.entity_type = 'material_request' and a.tenant_id = private.tenant_id()
       and private.user_can_see_request(auth.uid(), a.entity_id));
$$;
create policy files_storage_procurement on storage.objects for select to authenticated
  using (bucket_id = 'files' and private.can_read_request_file(name));

create or replace function public.material_request_attach(p_request uuid, p_file uuid, p_quote uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r    public.material_requests;
  v_id uuid;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.user_is_buyer(auth.uid(), r.project_id) or r.requested_by = auth.uid()
          or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'))) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  if r.status in ('rejected', 'cancelled') then raise exception 'request_locked' using errcode = '22023'; end if;
  if not exists (select 1 from public.files where id = p_file and project_id = r.project_id and created_by = auth.uid()) then
    raise exception 'file_invalid' using errcode = '22023';
  end if;
  if p_quote is not null and not exists (select 1 from public.rfq_quotes q join public.rfqs f on f.id = q.rfq_id where q.id = p_quote and f.request_id = r.id) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  insert into public.attachments (tenant_id, project_id, entity_type, entity_id, file_id, caption)
  values (r.tenant_id, r.project_id, 'material_request', r.id, p_file, case when p_quote is null then 'request' else 'quote:' || p_quote end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.material_request_detach(p_attachment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.attachments;
  r public.material_requests;
begin
  select * into a from public.attachments where id = p_attachment and tenant_id = private.tenant_id() and entity_type = 'material_request';
  if not found then raise exception 'attachment_not_found' using errcode = 'P0002'; end if;
  select * into r from public.material_requests where id = a.entity_id;
  if not (a.created_by = auth.uid() or private.user_is_buyer(auth.uid(), r.project_id)) then
    raise exception 'permission denied: procurement' using errcode = '42501';
  end if;
  delete from public.attachments where id = a.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Отправка на согласование: запоминаем уровень по порогу (от него зависит срок: комитету — дольше)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.material_requests_tier() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'approval' and (old.status is distinct from 'approval' or new.amount is distinct from old.amount or new.currency is distinct from old.currency) then
    new.tier := private.request_tier(new);
  end if;
  return new;
end;
$$;
create trigger material_requests_tier before update on public.material_requests
  for each row execute function private.material_requests_tier();

-- ---------------------------------------------------------------------------------------------------------------------
-- Чтение: список и карточка получают срок шага, уровень, получено по позициям, приёмки, файлы, поставщика из справочника
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
               'expected_at', r.expected_at, 'over_budget', r.over_budget, 'stock_status', r.stock_status, 'tier', r.tier,
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
    'company', (select name from public.tenants where id = r.tenant_id),
    'project', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'currency', p.currency, 'fx_rate', p.fx_rate),
    'requester_name', (select full_name from public.users where id = r.requested_by),
    'buyer_name', (select full_name from public.users where id = r.buyer_id),
    'decided_by_name', (select full_name from public.users where id = r.decided_by),
    'received_by_name', (select full_name from public.users where id = r.received_by),
    'due_at', private.request_due(r),
    'amount_gel', private.request_amount_gel(r),
    'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = r.cbs_item_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty,
                                                          'est_price', l.est_price, 'note', l.note, 'received_qty', l.received_qty) order by l.position)
                         from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb),
    'rfq', case when v_rfq.id is null then null else jsonb_build_object(
      'id', v_rfq.id, 'key', v_rfq.key, 'status', v_rfq.status,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty) order by l.position)
                           from public.rfq_lines l where l.rfq_id = v_rfq.id), '[]'::jsonb),
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'supplier', q.supplier, 'supplier_id', q.supplier_id,
                                                             'supplier_status', (select s.status from public.suppliers s where s.id = q.supplier_id),
                                                             'currency', q.currency, 'delivery_days', q.delivery_days,
                                                             'terms', q.terms, 'note', q.note, 'status', q.status,
                                                             'prices', coalesce((select jsonb_agg(jsonb_build_object('line_id', ql.line_id, 'unit_price', ql.unit_price))
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
                        where a.entity_type = 'material_request' and a.entity_id = r.id), '[]'::jsonb),
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
      'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                               and a.user_id = v_me and a.status = 'pending' and r.status = 'approval'))
  );
  return v_out;
end;
$$;

revoke execute on function public.supplier_save(uuid, text, text, text, text, text, text, text, text, text, text), public.suppliers_list(),
  public.supplier_history(uuid), public.procurement_price_hints(text[]), public.procurement_settings_get(),
  public.procurement_settings_save(numeric, numeric, integer, integer, integer, integer, integer), public.procurement_suggest_for(uuid, numeric),
  public.material_request_receive(uuid, text, text, jsonb), public.material_request_attach(uuid, uuid, uuid), public.material_request_detach(uuid)
  from public, anon;
grant execute on function public.supplier_save(uuid, text, text, text, text, text, text, text, text, text, text), public.suppliers_list(),
  public.supplier_history(uuid), public.procurement_price_hints(text[]), public.procurement_settings_get(),
  public.procurement_settings_save(numeric, numeric, integer, integer, integer, integer, integer), public.procurement_suggest_for(uuid, numeric),
  public.material_request_receive(uuid, text, text, jsonb), public.material_request_attach(uuid, uuid, uuid), public.material_request_detach(uuid)
  to authenticated;
revoke execute on function private.supplier_for(uuid, text) from public, anon, authenticated;
notify pgrst, 'reload schema';
