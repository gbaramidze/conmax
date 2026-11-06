-- Закупки, этап P2 (Фаза 5, первая версия): запросы цен поставщикам, сравнение предложений и заказ, который становится обязательством в бюджете.
--
-- Запрос цен (RFQ): название, срок ответа, позиции (из согласованной заявки на материалы или вручную), предложения поставщиков.
-- Ключ вида `RTG1-RQ-2` по счётчику проекта (kind 'RQ'). Статусы: открыт → присуждён / отменён.
-- Предложение: поставщик (название), валюта (лари или доллар), срок поставки в днях, условия оплаты, цена за единицу по каждой позиции.
-- Присуждение (`rfq_award`): выбранное предложение превращается в договор-обязательство по статье бюджета (сумма пересчитывается в основную валюту
-- проекта по курсу, как у остальных договоров), остальные предложения помечаются отклонёнными, связанная заявка получает статус «заказана».
--   • создаёт запрос и вносит предложения `procurement.request`; присуждает и отменяет `procurement.approve` (отмену может и `procurement.request`);
--   • смотрит `procurement.view` и обладатели двух других прав. Внутреннее: внешние участники не видят.
-- Не вошло: портал поставщика (внешний вход), рассылка запроса, оценка по весам критериев, вложения (коммерческие предложения файлом),
-- выбор поставщика из реестра организаций, разбивка заказа между поставщиками по позициям, рамочные договоры. См. docs: 05-roadmap/05-backlog.md.

create table public.rfqs (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  number      integer not null,
  key         text not null,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  request_id  uuid references public.material_requests(id),
  due_date    date,
  note        text not null default '' check (char_length(note) <= 4000),
  status      text not null default 'open' check (status in ('open', 'awarded', 'cancelled')),
  winner_id   uuid,
  created_by  uuid default auth.uid() references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (project_id, number)
);
create index on public.rfqs (project_id, status) where deleted_at is null;

create table public.rfq_lines (
  id        uuid primary key default public.uuidv7(),
  tenant_id uuid not null references public.tenants(id),
  rfq_id    uuid not null references public.rfqs(id) on delete cascade,
  position  integer not null,
  name      text not null check (char_length(btrim(name)) between 1 and 300),
  unit      text not null default '' check (char_length(unit) <= 20),
  qty       numeric(14, 3) not null check (qty > 0),
  unique (rfq_id, position)
);

create table public.rfq_quotes (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  rfq_id        uuid not null references public.rfqs(id) on delete cascade,
  supplier      text not null check (char_length(btrim(supplier)) between 1 and 200),
  currency      char(3) not null check (currency in ('GEL', 'USD')),
  delivery_days integer check (delivery_days is null or delivery_days between 0 and 3650),
  terms         text not null default '' check (char_length(terms) <= 1000),
  note          text not null default '' check (char_length(note) <= 2000),
  status        text not null default 'received' check (status in ('received', 'selected', 'rejected')),
  created_by    uuid default auth.uid() references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.rfq_quotes (rfq_id);

create table public.rfq_quote_lines (
  quote_id   uuid not null references public.rfq_quotes(id) on delete cascade,
  line_id    uuid not null references public.rfq_lines(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  primary key (quote_id, line_id)
);

alter table public.rfqs add constraint rfqs_winner_fk foreign key (winner_id) references public.rfq_quotes(id) on delete set null;

alter table public.rfqs enable row level security;
alter table public.rfqs force row level security;
alter table public.rfq_lines enable row level security;
alter table public.rfq_lines force row level security;
alter table public.rfq_quotes enable row level security;
alter table public.rfq_quotes force row level security;
alter table public.rfq_quote_lines enable row level security;
alter table public.rfq_quote_lines force row level security;
revoke insert, update, delete on public.rfqs, public.rfq_lines, public.rfq_quotes, public.rfq_quote_lines from authenticated;

create policy rfqs_select on public.rfqs for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and (private.has_project_permission(project_id, 'procurement.view') or private.has_project_permission(project_id, 'procurement.request')
              or private.has_project_permission(project_id, 'procurement.approve')));
create policy rfq_lines_select on public.rfq_lines for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.rfqs r where r.id = rfq_id));
create policy rfq_quotes_select on public.rfq_quotes for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.rfqs r where r.id = rfq_id));
create policy rfq_quote_lines_select on public.rfq_quote_lines for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.rfq_quotes q where q.id = quote_id));

-- Создать запрос цен. Позиции: из заявки (p_request, она должна быть согласована) или списком [{name, unit, qty}]
create or replace function public.rfq_create(
  p_project uuid, p_title text, p_request uuid default null, p_due date default null, p_note text default '', p_lines jsonb default '[]'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_req     public.material_requests;
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
  if p_request is not null then
    select * into v_req from public.material_requests where id = p_request and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
    if v_req.status <> 'approved' then raise exception 'request_not_approved' using errcode = '22023'; end if;
  end if;

  insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'RQ', 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into v_number;
  insert into public.rfqs (tenant_id, project_id, number, key, title, request_id, due_date, note)
  values (v_tenant, p_project, v_number, v_project.code || '-RQ-' || v_number, v_title, p_request, p_due, coalesce(p_note, ''))
  returning id into v_id;

  if p_request is not null and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    insert into public.rfq_lines (tenant_id, rfq_id, position, name, unit, qty)
    select v_tenant, v_id, position, name, unit, qty from public.material_request_lines where request_id = p_request order by position;
  else
    for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
      i := i + 1;
      if btrim(coalesce(l ->> 'name', '')) = '' or coalesce((l ->> 'qty')::numeric, 0) <= 0 then raise exception 'line_invalid' using errcode = '22023'; end if;
      insert into public.rfq_lines (tenant_id, rfq_id, position, name, unit, qty)
      values (v_tenant, v_id, i, btrim(l ->> 'name'), coalesce(l ->> 'unit', ''), (l ->> 'qty')::numeric);
    end loop;
  end if;
  if not exists (select 1 from public.rfq_lines where rfq_id = v_id) then raise exception 'lines_required' using errcode = '22023'; end if;

  perform private.record_event(v_tenant, p_project, 'project', p_project, 'rfq_status',
                               jsonb_build_object('key', v_project.code || '-RQ-' || v_number, 'title', v_title, 'from', null, 'to', 'open', 'note', ''));
  return v_id;
end;
$$;

-- Внести или заменить предложение поставщика. p_prices: {"<id позиции>": цена за единицу, ...}
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
  perform private.week_guard(r.project_id, array['procurement.request']);
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
  perform private.week_guard(r.project_id, array['procurement.request']);
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  delete from public.rfq_quotes where id = q.id;
end;
$$;

-- Присудить: выбранное предложение становится договором-обязательством по статье бюджета
create or replace function public.rfq_award(p_rfq uuid, p_quote uuid, p_cbs_item uuid default null, p_doc_number text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r      public.rfqs;
  q      public.rfq_quotes;
  req    public.material_requests;
  v_item uuid;
  v_sum  numeric;
  v_missing integer;
  m      record;
  v_com  uuid;
begin
  select * into r from public.rfqs where id = p_rfq and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'rfq_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['procurement.approve']);
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  select * into q from public.rfq_quotes where id = p_quote and rfq_id = r.id;
  if not found then raise exception 'quote_not_found' using errcode = 'P0002'; end if;

  select count(*) into v_missing from public.rfq_lines l where l.rfq_id = r.id
     and not exists (select 1 from public.rfq_quote_lines ql where ql.quote_id = q.id and ql.line_id = l.id);
  if v_missing > 0 then raise exception 'quote_incomplete' using errcode = '22023'; end if;
  select sum(l.qty * ql.unit_price) into v_sum from public.rfq_lines l join public.rfq_quote_lines ql on ql.line_id = l.id and ql.quote_id = q.id where l.rfq_id = r.id;

  if r.request_id is not null then select * into req from public.material_requests where id = r.request_id; end if;
  v_item := coalesce(p_cbs_item, req.cbs_item_id);
  if v_item is null then raise exception 'budget_item_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.cbs_items where id = v_item and project_id = r.project_id and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;

  select * into m from private.money_to_base(r.project_id, v_sum, q.currency);
  insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, currency, orig_amount, fx_rate, status, note, created_by)
  values (r.tenant_id, r.project_id, v_item, left('Заказ ' || r.key || ': ' || r.title, 300), q.supplier, nullif(btrim(coalesce(p_doc_number, '')), ''), current_date,
          m.base, m.cur, m.orig, m.rate, 'active', 'По запросу цен ' || r.key, auth.uid())
  returning id into v_com;

  update public.rfq_quotes set status = case when id = q.id then 'selected' else 'rejected' end, updated_at = now() where rfq_id = r.id;
  update public.rfqs set status = 'awarded', winner_id = q.id, updated_at = now() where id = r.id;
  if req.id is not null and req.status = 'approved' then
    update public.material_requests set status = 'ordered', order_ref = left(coalesce(nullif(btrim(p_doc_number), ''), r.key), 200), updated_at = now() where id = req.id;
    perform private.record_event(req.tenant_id, req.project_id, 'project', req.project_id, 'request_status',
                                 jsonb_build_object('key', req.key, 'title', req.title, 'from', 'approved', 'to', 'ordered', 'note', r.key, 'over_budget', false));
  end if;
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
  if r.status <> 'open' then raise exception 'rfq_closed' using errcode = '22023'; end if;
  update public.rfqs set status = 'cancelled', updated_at = now() where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'project', r.project_id, 'rfq_status',
                               jsonb_build_object('key', r.key, 'title', r.title, 'from', 'open', 'to', 'cancelled', 'note', btrim(coalesce(p_note, ''))));
end;
$$;

revoke execute on function public.rfq_create(uuid, text, uuid, date, text, jsonb), public.rfq_quote_save(uuid, text, text, integer, text, jsonb, uuid, text),
  public.rfq_quote_delete(uuid), public.rfq_award(uuid, uuid, uuid, text), public.rfq_cancel(uuid, text) from public, anon;
grant execute on function public.rfq_create(uuid, text, uuid, date, text, jsonb), public.rfq_quote_save(uuid, text, text, integer, text, jsonb, uuid, text),
  public.rfq_quote_delete(uuid), public.rfq_award(uuid, uuid, uuid, text), public.rfq_cancel(uuid, text) to authenticated;
notify pgrst, 'reload schema';
