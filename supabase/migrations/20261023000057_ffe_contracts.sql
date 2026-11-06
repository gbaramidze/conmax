-- Договоры на мебель: какой подрядчик делает мебель на каких этажах (корпусах, секциях, номерах), кто и когда подписал,
-- по какой цене (прейскурант: цена за единицу по каждой позиции каталога). Мебель в охвате договора относится к его подрядчику;
-- более конкретный охват (номер) перекрывает более общий (этаж). Сумма договора = количество × цена по всем строкам охвата
-- и по желанию уходит обязательством в статью бюджета (budget_commitments).
-- Права: смотреть договоры и охват — внутренние участники; цены — budget.view; править — как мебель (location.manage или schedule.edit).
-- См. docs: 05-roadmap/05-backlog.md, раздел «Мебель и оборудование по номерам».

create table public.ffe_contracts (
  id                   uuid primary key default public.uuidv7(),
  tenant_id            uuid not null references public.tenants(id),
  project_id           uuid not null references public.projects(id) on delete cascade,
  title                text not null check (length(btrim(title)) between 1 and 300),
  number               text check (number is null or length(number) <= 60),
  organization_id      uuid references public.organizations(id),
  contractor_name      text check (contractor_name is null or length(contractor_name) <= 200),
  signed_on            date,
  signed_by_user       uuid references public.users(id),
  contractor_signatory text check (contractor_signatory is null or length(contractor_signatory) <= 200),
  status               text not null default 'draft' check (status in ('draft', 'signed', 'terminated')),
  cbs_item_id          uuid references public.cbs_items(id),
  commitment_id        uuid references public.budget_commitments(id) on delete set null,
  note                 text check (note is null or length(note) <= 2000),
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid() references public.users(id),
  deleted_at           timestamptz,
  check (organization_id is not null or length(btrim(coalesce(contractor_name, ''))) > 0)
);
create index on public.ffe_contracts (project_id) where deleted_at is null;

create table public.ffe_contract_scopes (
  contract_id uuid not null references public.ffe_contracts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  primary key (contract_id, location_id),
  unique (location_id)
);

create table public.ffe_contract_prices (
  contract_id uuid not null references public.ffe_contracts(id) on delete cascade,
  item_id     uuid not null references public.ffe_items(id),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  primary key (contract_id, item_id)
);

do $$
declare t text;
begin
  foreach t in array array['ffe_contracts', 'ffe_contract_scopes', 'ffe_contract_prices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
create policy ffe_contracts_select on public.ffe_contracts for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id));
create policy ffe_contract_scopes_select on public.ffe_contract_scopes for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id));
create policy ffe_contract_prices_select on public.ffe_contract_prices for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and private.has_project_permission(project_id, 'budget.view'));

-- ---------------------------------------------------------------------------
-- Расчёт и обязательство в бюджете
-- ---------------------------------------------------------------------------
-- Сумма договора: строки мебели, чей ближайший (самый конкретный) охват принадлежит этому договору, × цена позиции
create or replace function private.ffe_contract_amount(p_contract uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(f.qty * pr.unit_price), 0)
    from public.room_ffe f
    join public.locations lr on lr.id = f.location_id
    join public.ffe_contract_prices pr on pr.contract_id = p_contract and pr.item_id = f.item_id
   where f.project_id = (select project_id from public.ffe_contracts where id = p_contract)
     and (
       select s.contract_id
         from public.ffe_contract_scopes s
         join public.locations ls on ls.id = s.location_id
        where s.project_id = f.project_id and (lr.path::text = ls.path::text or lr.path::text like ls.path::text || '.%')
        order by length(ls.path::text) desc
        limit 1
     ) = p_contract
$$;

create or replace function private.ffe_sync_commitment(p_contract uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.ffe_contracts;
  v_amount numeric;
  v_name text;
  v_status text;
begin
  select * into c from public.ffe_contracts where id = p_contract;
  if not found or c.cbs_item_id is null then return; end if;
  v_amount := private.ffe_contract_amount(p_contract);
  v_name := coalesce((select name from public.organizations where id = c.organization_id), c.contractor_name);
  -- обязательством считается только подписанный договор
  v_status := case when c.status = 'signed' and c.deleted_at is null then 'active' else 'cancelled' end;
  if c.commitment_id is null then
    insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, status)
    values (c.tenant_id, c.project_id, c.cbs_item_id, left(c.title, 300), left(v_name, 200), left(c.number, 60), c.signed_on, round(v_amount, 2), v_status)
    returning id into c.commitment_id;
    update public.ffe_contracts set commitment_id = c.commitment_id where id = p_contract;
  else
    update public.budget_commitments set item_id = c.cbs_item_id, title = left(c.title, 300), counterparty = left(v_name, 200),
           doc_number = left(c.number, 60), signed_on = c.signed_on, amount = round(v_amount, 2), status = v_status
     where id = c.commitment_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Договоры
-- ---------------------------------------------------------------------------
create or replace function public.ffe_contract_upsert(
  p_project uuid, p_id uuid, p_title text, p_number text, p_organization uuid, p_contractor_name text,
  p_signed_on date, p_signed_by uuid, p_contractor_signatory text, p_status text, p_cbs_item uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_title text := btrim(coalesce(p_title, ''));
begin
  perform private.ffe_guard(p_project);
  if v_title = '' then raise exception 'title_required' using errcode = '22023'; end if;
  if p_organization is null and btrim(coalesce(p_contractor_name, '')) = '' then raise exception 'contractor_required' using errcode = '22023'; end if;
  if p_status not in ('draft', 'signed', 'terminated') then raise exception 'bad_status' using errcode = '22023'; end if;
  if p_organization is not null and not exists (select 1 from public.organizations where id = p_organization and tenant_id = private.tenant_id()) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if p_signed_by is not null and not exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = p_signed_by) then
    raise exception 'signer_not_member' using errcode = '22023';
  end if;
  if p_cbs_item is not null then
    if not (private.has_project_permission(p_project, 'budget.edit') or private.has_project_permission(p_project, 'budget.approve')) then
      raise exception 'permission denied: budget.edit' using errcode = '42501';
    end if;
    if not exists (select 1 from public.cbs_items where id = p_cbs_item and project_id = p_project and deleted_at is null) then
      raise exception 'item_not_found' using errcode = 'P0002';
    end if;
  end if;
  if v_id is null then
    insert into public.ffe_contracts (tenant_id, project_id, title, number, organization_id, contractor_name, signed_on, signed_by_user, contractor_signatory, status, cbs_item_id, note)
    values (private.tenant_id(), p_project, v_title, nullif(btrim(coalesce(p_number, '')), ''), p_organization, nullif(btrim(coalesce(p_contractor_name, '')), ''),
            p_signed_on, p_signed_by, nullif(btrim(coalesce(p_contractor_signatory, '')), ''), p_status, p_cbs_item, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  else
    update public.ffe_contracts set title = v_title, number = nullif(btrim(coalesce(p_number, '')), ''), organization_id = p_organization,
           contractor_name = nullif(btrim(coalesce(p_contractor_name, '')), ''), signed_on = p_signed_on, signed_by_user = p_signed_by,
           contractor_signatory = nullif(btrim(coalesce(p_contractor_signatory, '')), ''), status = p_status, cbs_item_id = p_cbs_item,
           note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_id and project_id = p_project and deleted_at is null;
    if not found then raise exception 'contract_not_found' using errcode = 'P0002'; end if;
  end if;
  perform private.ffe_sync_commitment(v_id);
  return v_id;
end;
$$;

create or replace function public.ffe_contract_delete(p_project uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ffe_guard(p_project);
  update public.ffe_contracts set deleted_at = now() where id = p_id and project_id = p_project and deleted_at is null;
  if not found then raise exception 'contract_not_found' using errcode = 'P0002'; end if;
  delete from public.ffe_contract_scopes where contract_id = p_id;
  perform private.ffe_sync_commitment(p_id);
end;
$$;

-- Охват: добавить места (p_move — забрать их у другого договора, иначе ошибка scope_taken)
create or replace function public.ffe_contract_add_scope(p_project uuid, p_contract uuid, p_locations uuid[], p_move boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_loc uuid;
  v_n integer := 0;
  v_other uuid;
begin
  perform private.ffe_guard(p_project);
  if not exists (select 1 from public.ffe_contracts where id = p_contract and project_id = p_project and deleted_at is null) then raise exception 'contract_not_found' using errcode = 'P0002'; end if;
  if coalesce(array_length(p_locations, 1), 0) > 3000 then raise exception 'too many rooms' using errcode = '22023'; end if;
  for v_loc in select l.id from public.locations l where l.id = any (p_locations) and l.project_id = p_project and l.deleted_at is null and l.kind in ('building', 'section', 'floor', 'room') loop
    select contract_id into v_other from public.ffe_contract_scopes where location_id = v_loc;
    if v_other is not null and v_other <> p_contract then
      if not p_move then raise exception 'scope_taken' using errcode = '23505'; end if;
      delete from public.ffe_contract_scopes where location_id = v_loc;
      perform private.ffe_sync_commitment(v_other);
    end if;
    insert into public.ffe_contract_scopes (contract_id, location_id, tenant_id, project_id) values (p_contract, v_loc, private.tenant_id(), p_project)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  perform private.ffe_sync_commitment(p_contract);
  return v_n;
end;
$$;

create or replace function public.ffe_contract_remove_scope(p_project uuid, p_contract uuid, p_locations uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.ffe_guard(p_project);
  delete from public.ffe_contract_scopes where project_id = p_project and contract_id = p_contract and location_id = any (p_locations);
  get diagnostics n = row_count;
  perform private.ffe_sync_commitment(p_contract);
  return n;
end;
$$;

-- Цена за единицу позиции в договоре (null — убрать)
create or replace function public.ffe_contract_set_price(p_project uuid, p_contract uuid, p_item uuid, p_price numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ffe_guard(p_project);
  if not (private.has_project_permission(p_project, 'budget.view')) then raise exception 'permission denied: budget.view' using errcode = '42501'; end if;
  if not exists (select 1 from public.ffe_contracts where id = p_contract and project_id = p_project and deleted_at is null) then raise exception 'contract_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.ffe_items where id = p_item and project_id = p_project and deleted_at is null) then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  if p_price is not null and (p_price < 0 or p_price > 1000000000) then raise exception 'bad_price' using errcode = '22023'; end if;
  if p_price is null then
    delete from public.ffe_contract_prices where contract_id = p_contract and item_id = p_item;
  else
    insert into public.ffe_contract_prices (contract_id, item_id, tenant_id, project_id, unit_price) values (p_contract, p_item, private.tenant_id(), p_project, round(p_price, 2))
    on conflict (contract_id, item_id) do update set unit_price = excluded.unit_price;
  end if;
  perform private.ffe_sync_commitment(p_contract);
end;
$$;

-- Пересчитать суммы всех договоров с обязательством в бюджете (после смены состава номеров)
create or replace function public.ffe_contracts_resync(p_project uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_c uuid;
  n integer := 0;
begin
  perform private.ffe_guard(p_project);
  for v_c in select id from public.ffe_contracts where project_id = p_project and cbs_item_id is not null loop
    perform private.ffe_sync_commitment(v_c);
    n := n + 1;
  end loop;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ffe_contract_upsert(uuid, uuid, text, text, uuid, text, date, uuid, text, text, uuid, text)', 'ffe_contract_delete(uuid, uuid)',
    'ffe_contract_add_scope(uuid, uuid, uuid[], boolean)', 'ffe_contract_remove_scope(uuid, uuid, uuid[])',
    'ffe_contract_set_price(uuid, uuid, uuid, numeric)', 'ffe_contracts_resync(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
