-- Бюджет стройки (S7): дерево статей затрат (CBS), версии бюджета, договоры (обязательства), факт затрат,
-- прогноз остатка (ETC) и привязка работ графика к статьям. См. docs: 04-modules/09-budget-progress-evm.md (часть B).
--
-- Структура статей общая для проекта, а суммы хранятся по версиям (`budget_amounts`): черновик → утверждён → заменён.
-- Утверждённая версия неизменна. Договоры и факт ссылаются на статью, а не на версию, поэтому переживают новые версии.
-- Сумма статьи = собственная сумма + суммы вложенных. Права: смотреть — budget.view; править статьи, суммы черновика,
-- договоры — budget.edit или budget.approve; вносить факт — cost.record (или права на правку); утверждать — budget.approve.

insert into public.entity_types (code, module, features) values ('budget_version', 'budget', array['activity']);

create table public.cbs_items (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id  uuid references public.cbs_items(id),
  code       text not null check (length(btrim(code)) between 1 and 40),
  name       text not null check (length(btrim(name)) between 1 and 300),
  cost_type  text not null default 'other' check (cost_type in ('labor','materials','equipment','subcontract','overhead','contingency','other')),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users(id),
  deleted_at timestamptz
);
create unique index cbs_items_code_uniq on public.cbs_items (project_id, lower(code)) where deleted_at is null;
create index on public.cbs_items (project_id, parent_id) where deleted_at is null;

create table public.budget_versions (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  number      integer not null,
  name        text not null check (length(btrim(name)) between 1 and 120),
  note        text check (note is null or length(note) <= 2000),
  status      text not null default 'draft' check (status in ('draft','approved','superseded')),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users(id),
  approved_at timestamptz,
  approved_by uuid references public.users(id),
  unique (project_id, number)
);
-- в проекте не больше одного черновика
create unique index budget_versions_one_draft on public.budget_versions (project_id) where status = 'draft';

create table public.budget_amounts (
  version_id uuid not null references public.budget_versions(id) on delete cascade,
  item_id    uuid not null references public.cbs_items(id),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  amount     numeric(16,2) not null check (amount >= 0),
  primary key (version_id, item_id)
);
create index on public.budget_amounts (item_id);

create table public.budget_commitments (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  item_id      uuid not null references public.cbs_items(id),
  title        text not null check (length(btrim(title)) between 1 and 300),
  counterparty text check (counterparty is null or length(counterparty) <= 200),
  doc_number   text check (doc_number is null or length(doc_number) <= 60),
  signed_on    date,
  amount       numeric(16,2) not null check (amount >= 0),
  status       text not null default 'active' check (status in ('active','cancelled')),
  note         text check (note is null or length(note) <= 1000),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users(id),
  deleted_at   timestamptz
);
create index on public.budget_commitments (project_id, item_id) where deleted_at is null;

create table public.budget_actuals (
  id            uuid primary key default public.uuidv7(),
  tenant_id     uuid not null references public.tenants(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  item_id       uuid not null references public.cbs_items(id),
  commitment_id uuid references public.budget_commitments(id),
  activity_id   uuid references public.schedule_activities(id) on delete set null,
  doc_type      text not null default 'act' check (doc_type in ('act','invoice','writeoff','payroll','other')),
  doc_number    text check (doc_number is null or length(doc_number) <= 60),
  doc_date      date not null default current_date,
  amount        numeric(16,2) not null check (amount <> 0),
  counterparty  text check (counterparty is null or length(counterparty) <= 200),
  note          text check (note is null or length(note) <= 1000),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.users(id),
  deleted_at    timestamptz
);
create index on public.budget_actuals (project_id, item_id) where deleted_at is null;

-- Прогноз остатка затрат по статье, введённый экономистом (без него ETC считается автоматически)
create table public.budget_etc (
  item_id    uuid primary key references public.cbs_items(id),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  etc_amount numeric(16,2) not null check (etc_amount >= 0),
  note       text check (note is null or length(note) <= 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.users(id)
);

-- Связь работы графика со статьёй и её доля бюджета (для будущих PV/EV). Отдельная таблица, чтобы суммы
-- не были видны всем, кто видит график: смотреть — budget.view.
create table public.activity_budgets (
  activity_id uuid primary key references public.schedule_activities(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  item_id     uuid not null references public.cbs_items(id),
  amount      numeric(16,2) not null check (amount >= 0)
);
create index on public.activity_budgets (item_id);

do $$
declare t text;
begin
  foreach t in array array['cbs_items', 'budget_versions', 'budget_amounts', 'budget_commitments', 'budget_actuals', 'budget_etc', 'activity_budgets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'budget.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Функции
-- ---------------------------------------------------------------------------
create or replace function private.budget_money(p_value numeric) returns numeric
language sql immutable as $$ select round(coalesce(p_value, 0), 2) $$;

-- Структура статей: создать (p_id null) или изменить
create or replace function public.budget_upsert_item(
  p_project uuid, p_id uuid, p_parent uuid, p_code text, p_name text, p_cost_type text default 'other', p_sort integer default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.week_guard(p_project, array['budget.edit', 'budget.approve']);
  if v_code = '' or v_name = '' then raise exception 'title_required' using errcode = '22023'; end if;
  if p_cost_type not in ('labor','materials','equipment','subcontract','overhead','contingency','other') then
    raise exception 'bad_cost_type' using errcode = '22023';
  end if;
  if p_parent is not null and not exists (select 1 from public.cbs_items where id = p_parent and project_id = p_project and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  begin
    if v_id is null then
      insert into public.cbs_items (tenant_id, project_id, parent_id, code, name, cost_type, sort, created_by)
      values (private.tenant_id(), p_project, p_parent, v_code, v_name, p_cost_type, coalesce(p_sort, 0), auth.uid()) returning id into v_id;
    else
      if not exists (select 1 from public.cbs_items where id = v_id and project_id = p_project and deleted_at is null) then
        raise exception 'item_not_found' using errcode = 'P0002';
      end if;
      if p_parent is not null and exists (
        with recursive up(id, parent_id) as (
          select i.id, i.parent_id from public.cbs_items i where i.id = p_parent
          union all
          select i.id, i.parent_id from public.cbs_items i join up on i.id = up.parent_id)
        select 1 from up where id = v_id) then
        raise exception 'cycle_in_hierarchy' using errcode = '23514';
      end if;
      update public.cbs_items set parent_id = p_parent, code = v_code, name = v_name, cost_type = p_cost_type, sort = coalesce(p_sort, sort)
       where id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'code_exists' using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- Удалить статью можно, пока на ней нет вложенных статей, договоров, факта, прогноза и сумм в утверждённых версиях
create or replace function public.budget_delete_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.cbs_items;
begin
  select * into it from public.cbs_items where id = p_item and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(it.project_id, array['budget.edit', 'budget.approve']);
  if exists (select 1 from public.cbs_items where parent_id = it.id and deleted_at is null)
     or exists (select 1 from public.budget_commitments where item_id = it.id and deleted_at is null)
     or exists (select 1 from public.budget_actuals where item_id = it.id and deleted_at is null)
     or exists (select 1 from public.budget_etc where item_id = it.id)
     or exists (select 1 from public.budget_amounts a join public.budget_versions v on v.id = a.version_id
                 where a.item_id = it.id and v.status <> 'draft' and a.amount > 0) then
    raise exception 'item_in_use' using errcode = '23514';
  end if;
  delete from public.budget_amounts a using public.budget_versions v where v.id = a.version_id and a.item_id = it.id and v.status = 'draft';
  delete from public.activity_budgets where item_id = it.id;
  update public.cbs_items set deleted_at = now(), code = code || '~' || left(it.id::text, 8) where id = it.id;
end;
$$;

-- Новый черновик: копия суммы последней утверждённой версии
create or replace function public.create_budget_draft(p_project uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_num  integer;
  v_base uuid;
begin
  perform private.week_guard(p_project, array['budget.edit', 'budget.approve']);
  if exists (select 1 from public.budget_versions where project_id = p_project and status = 'draft') then
    raise exception 'draft_exists' using errcode = '23505';
  end if;
  select coalesce(max(number), 0) + 1 into v_num from public.budget_versions where project_id = p_project;
  select id into v_base from public.budget_versions where project_id = p_project and status = 'approved';
  insert into public.budget_versions (tenant_id, project_id, number, name, created_by)
  values (private.tenant_id(), p_project, v_num, coalesce(nullif(btrim(coalesce(p_name, '')), ''), case when v_num = 1 then 'Исходный бюджет' else 'Версия ' || v_num end), auth.uid())
  returning id into v_id;
  if v_base is not null then
    insert into public.budget_amounts (version_id, item_id, tenant_id, project_id, amount)
    select v_id, a.item_id, a.tenant_id, a.project_id, a.amount from public.budget_amounts a
      join public.cbs_items i on i.id = a.item_id and i.deleted_at is null where a.version_id = v_base;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_budget_amount(p_version uuid, p_item uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.budget_versions;
  v_amount numeric := private.budget_money(p_amount);
begin
  select * into v from public.budget_versions where id = p_version and tenant_id = private.tenant_id();
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(v.project_id, array['budget.edit', 'budget.approve']);
  if v.status <> 'draft' then raise exception 'version_locked' using errcode = '23514'; end if;
  if v_amount < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if not exists (select 1 from public.cbs_items where id = p_item and project_id = v.project_id and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_amount = 0 then
    delete from public.budget_amounts where version_id = v.id and item_id = p_item;
  else
    insert into public.budget_amounts (version_id, item_id, tenant_id, project_id, amount) values (v.id, p_item, v.tenant_id, v.project_id, v_amount)
    on conflict (version_id, item_id) do update set amount = excluded.amount;
  end if;
end;
$$;

create or replace function public.discard_budget_draft(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.budget_versions;
begin
  select * into v from public.budget_versions where id = p_version and tenant_id = private.tenant_id();
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(v.project_id, array['budget.edit', 'budget.approve']);
  if v.status <> 'draft' then raise exception 'version_locked' using errcode = '23514'; end if;
  delete from public.budget_versions where id = v.id;
end;
$$;

create or replace function public.approve_budget_version(p_version uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.budget_versions;
begin
  select * into v from public.budget_versions where id = p_version and tenant_id = private.tenant_id();
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(v.project_id, array['budget.approve']);
  if v.status <> 'draft' then raise exception 'version_locked' using errcode = '23514'; end if;
  if not exists (select 1 from public.budget_amounts where version_id = v.id) then raise exception 'budget_empty' using errcode = '23514'; end if;
  update public.budget_versions set status = 'superseded' where project_id = v.project_id and status = 'approved';
  update public.budget_versions set status = 'approved', approved_at = now(), approved_by = auth.uid(),
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note) where id = v.id;
  perform private.record_event(v.tenant_id, v.project_id, 'budget_version', v.id, 'approved',
    jsonb_build_object('name', v.name, 'number', v.number,
                       'total', (select coalesce(sum(amount), 0) from public.budget_amounts where version_id = v.id)), 'internal');
end;
$$;

-- Импорт статей и сумм в черновик. Строка: {code, name, amount, cost_type?, parent_code?}.
-- Родитель — parent_code либо код без последнего сегмента («1.2.3» → «1.2»); недостающие родители создаются.
create or replace function public.import_budget(p_version uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.budget_versions;
  r jsonb;
  v_code text; v_name text; v_parent_code text; v_type text; v_amount numeric;
  v_parent uuid; v_id uuid;
  v_created integer := 0; v_updated integer := 0; n integer := 0;
begin
  select * into v from public.budget_versions where id = p_version and tenant_id = private.tenant_id();
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(v.project_id, array['budget.edit', 'budget.approve']);
  if v.status <> 'draft' then raise exception 'version_locked' using errcode = '23514'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'bad_rows' using errcode = '22023'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    v_code := btrim(coalesce(r ->> 'code', ''));
    v_name := left(btrim(coalesce(r ->> 'name', '')), 300);
    if v_code = '' or v_name = '' then raise exception 'row_invalid:%', n using errcode = '22023'; end if;
    v_type := coalesce(nullif(r ->> 'cost_type', ''), 'other');
    if v_type not in ('labor','materials','equipment','subcontract','overhead','contingency','other') then v_type := 'other'; end if;
    v_amount := private.budget_money(nullif(r ->> 'amount', '')::numeric);
    if v_amount < 0 then raise exception 'row_invalid:%', n using errcode = '22023'; end if;
    v_parent_code := nullif(btrim(coalesce(r ->> 'parent_code', '')), '');
    if v_parent_code is null and position('.' in v_code) > 0 then v_parent_code := regexp_replace(v_code, '\.[^.]*$', ''); end if;

    v_parent := null;
    if v_parent_code is not null then
      select id into v_parent from public.cbs_items where project_id = v.project_id and lower(code) = lower(v_parent_code) and deleted_at is null;
      if v_parent is null then
        insert into public.cbs_items (tenant_id, project_id, code, name, created_by) values (v.tenant_id, v.project_id, v_parent_code, v_parent_code, auth.uid())
        returning id into v_parent;
        v_created := v_created + 1;
      end if;
    end if;

    select id into v_id from public.cbs_items where project_id = v.project_id and lower(code) = lower(v_code) and deleted_at is null;
    if v_id is null then
      insert into public.cbs_items (tenant_id, project_id, parent_id, code, name, cost_type, sort, created_by)
      values (v.tenant_id, v.project_id, v_parent, v_code, v_name, v_type, n, auth.uid()) returning id into v_id;
      v_created := v_created + 1;
    else
      update public.cbs_items set parent_id = v_parent, name = v_name, cost_type = v_type, sort = n where id = v_id;
      v_updated := v_updated + 1;
    end if;

    if v_amount = 0 then
      delete from public.budget_amounts where version_id = v.id and item_id = v_id;
    else
      insert into public.budget_amounts (version_id, item_id, tenant_id, project_id, amount) values (v.id, v_id, v.tenant_id, v.project_id, v_amount)
      on conflict (version_id, item_id) do update set amount = excluded.amount;
    end if;
  end loop;
  return jsonb_build_object('rows', n, 'created', v_created, 'updated', v_updated);
end;
$$;

-- ---- договоры ----
create or replace function public.budget_save_commitment(
  p_project uuid, p_id uuid, p_item uuid, p_title text, p_counterparty text, p_doc_number text, p_signed_on date, p_amount numeric,
  p_status text default 'active', p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_amount numeric := private.budget_money(p_amount);
begin
  perform private.week_guard(p_project, array['budget.edit', 'budget.approve']);
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if v_amount < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if p_status not in ('active', 'cancelled') then raise exception 'bad_status' using errcode = '22023'; end if;
  if not exists (select 1 from public.cbs_items where id = p_item and project_id = p_project and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_id is null then
    insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, status, note, created_by)
    values (private.tenant_id(), p_project, p_item, btrim(p_title), nullif(btrim(coalesce(p_counterparty, '')), ''), nullif(btrim(coalesce(p_doc_number, '')), ''),
            p_signed_on, v_amount, p_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_id;
  else
    update public.budget_commitments set item_id = p_item, title = btrim(p_title), counterparty = nullif(btrim(coalesce(p_counterparty, '')), ''),
           doc_number = nullif(btrim(coalesce(p_doc_number, '')), ''), signed_on = p_signed_on, amount = v_amount, status = p_status,
           note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_id and project_id = p_project and deleted_at is null;
    if not found then raise exception 'commitment_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.budget_delete_commitment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.budget_commitments;
begin
  select * into c from public.budget_commitments where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'commitment_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(c.project_id, array['budget.edit', 'budget.approve']);
  update public.budget_commitments set deleted_at = now() where id = c.id;
  update public.budget_actuals set commitment_id = null where commitment_id = c.id;
end;
$$;

-- ---- факт ----
create or replace function public.budget_save_actual(
  p_project uuid, p_id uuid, p_item uuid, p_doc_type text, p_doc_number text, p_doc_date date, p_amount numeric,
  p_counterparty text default null, p_commitment uuid default null, p_note text default null, p_activity uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_amount numeric := private.budget_money(p_amount);
begin
  perform private.week_guard(p_project, array['cost.record', 'budget.edit', 'budget.approve']);
  if v_amount = 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if p_doc_type not in ('act','invoice','writeoff','payroll','other') then raise exception 'bad_status' using errcode = '22023'; end if;
  if not exists (select 1 from public.cbs_items where id = p_item and project_id = p_project and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if p_commitment is not null and not exists (select 1 from public.budget_commitments where id = p_commitment and project_id = p_project and deleted_at is null) then
    raise exception 'commitment_not_found' using errcode = 'P0002';
  end if;
  if p_activity is not null and not exists (select 1 from public.schedule_activities where id = p_activity and project_id = p_project and deleted_at is null) then
    raise exception 'activity_not_found' using errcode = 'P0002';
  end if;
  if v_id is null then
    insert into public.budget_actuals (tenant_id, project_id, item_id, commitment_id, activity_id, doc_type, doc_number, doc_date, amount, counterparty, note, created_by)
    values (private.tenant_id(), p_project, p_item, p_commitment, p_activity, p_doc_type, nullif(btrim(coalesce(p_doc_number, '')), ''), coalesce(p_doc_date, current_date),
            v_amount, nullif(btrim(coalesce(p_counterparty, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_id;
  else
    update public.budget_actuals set item_id = p_item, commitment_id = p_commitment, activity_id = p_activity, doc_type = p_doc_type,
           doc_number = nullif(btrim(coalesce(p_doc_number, '')), ''), doc_date = coalesce(p_doc_date, doc_date), amount = v_amount,
           counterparty = nullif(btrim(coalesce(p_counterparty, '')), ''), note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_id and project_id = p_project and deleted_at is null;
    if not found then raise exception 'actual_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.budget_delete_actual(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.budget_actuals;
begin
  select * into a from public.budget_actuals where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'actual_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(a.project_id, array['cost.record', 'budget.edit', 'budget.approve']);
  update public.budget_actuals set deleted_at = now() where id = a.id;
end;
$$;

-- Пакетный импорт договоров и факта: строки с кодом статьи
create or replace function public.import_budget_commitments(p_project uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; n integer := 0; v_item uuid;
begin
  perform private.week_guard(p_project, array['budget.edit', 'budget.approve']);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'bad_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    select id into v_item from public.cbs_items where project_id = p_project and lower(code) = lower(btrim(coalesce(r ->> 'item_code', ''))) and deleted_at is null;
    if v_item is null then raise exception 'row_invalid:%', n using errcode = '22023'; end if;
    perform public.budget_save_commitment(p_project, null, v_item, coalesce(nullif(r ->> 'title', ''), 'Договор'), r ->> 'counterparty', r ->> 'doc_number',
                                          nullif(r ->> 'signed_on', '')::date, nullif(r ->> 'amount', '')::numeric, 'active', r ->> 'note');
  end loop;
  return n;
end;
$$;

create or replace function public.import_budget_actuals(p_project uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; n integer := 0; v_item uuid;
begin
  perform private.week_guard(p_project, array['cost.record', 'budget.edit', 'budget.approve']);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'bad_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    select id into v_item from public.cbs_items where project_id = p_project and lower(code) = lower(btrim(coalesce(r ->> 'item_code', ''))) and deleted_at is null;
    if v_item is null then raise exception 'row_invalid:%', n using errcode = '22023'; end if;
    perform public.budget_save_actual(p_project, null, v_item, coalesce(nullif(r ->> 'doc_type', ''), 'act'), r ->> 'doc_number',
                                      nullif(r ->> 'doc_date', '')::date, nullif(r ->> 'amount', '')::numeric, r ->> 'counterparty', null, r ->> 'note');
  end loop;
  return n;
end;
$$;

-- Прогноз остатка по статье; p_amount = null возвращает расчётный ETC
create or replace function public.set_budget_etc(p_item uuid, p_amount numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.cbs_items;
begin
  select * into it from public.cbs_items where id = p_item and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(it.project_id, array['budget.edit', 'budget.approve', 'cost.record']);
  if p_amount is null then
    delete from public.budget_etc where item_id = it.id;
  else
    if p_amount < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
    insert into public.budget_etc (item_id, tenant_id, project_id, etc_amount, note) values (it.id, it.tenant_id, it.project_id, private.budget_money(p_amount), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (item_id) do update set etc_amount = excluded.etc_amount, note = excluded.note, updated_at = now(), updated_by = auth.uid();
  end if;
end;
$$;

-- Распределить бюджет статьи (с вложенными) по выбранным работам графика: поровну или пропорционально длительности.
-- Берётся действующая версия, а при её отсутствии — черновик.
create or replace function public.allocate_budget(p_item uuid, p_activities uuid[], p_basis text default 'duration') returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  it public.cbs_items;
  v_version uuid;
  v_total numeric;
  v_weight numeric;
  v_given numeric := 0;
  r record;
  v_part numeric;
  v_left integer;
begin
  select * into it from public.cbs_items where id = p_item and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(it.project_id, array['budget.edit', 'budget.approve']);
  if p_basis not in ('duration', 'equal') then raise exception 'bad_status' using errcode = '22023'; end if;
  if coalesce(array_length(p_activities, 1), 0) = 0 then raise exception 'activity_not_found' using errcode = 'P0002'; end if;

  select id into v_version from public.budget_versions where project_id = it.project_id and status in ('approved', 'draft') order by (status = 'approved') desc, number desc limit 1;
  with recursive sub(id) as (
    select it.id union all select i.id from public.cbs_items i join sub on i.parent_id = sub.id where i.deleted_at is null)
  select coalesce(sum(a.amount), 0) into v_total from public.budget_amounts a join sub on sub.id = a.item_id where a.version_id = v_version;

  select count(*), coalesce(sum(case when p_basis = 'equal' then 1 else greatest(duration_days, 1) end), 0) into v_left, v_weight
    from public.schedule_activities where id = any (p_activities) and project_id = it.project_id and deleted_at is null and kind = 'task';
  if v_left = 0 or v_weight = 0 then raise exception 'activity_not_found' using errcode = 'P0002'; end if;

  for r in
    select id, case when p_basis = 'equal' then 1 else greatest(duration_days, 1) end as w
      from public.schedule_activities where id = any (p_activities) and project_id = it.project_id and deleted_at is null and kind = 'task' order by start_date nulls last, id
  loop
    v_left := v_left - 1;
    v_part := case when v_left = 0 then v_total - v_given else round(v_total * r.w / v_weight, 2) end;
    v_given := v_given + v_part;
    insert into public.activity_budgets (activity_id, tenant_id, project_id, item_id, amount) values (r.id, it.tenant_id, it.project_id, it.id, v_part)
    on conflict (activity_id) do update set item_id = excluded.item_id, amount = excluded.amount;
  end loop;
  return v_total;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'budget_upsert_item(uuid,uuid,uuid,text,text,text,integer)', 'budget_delete_item(uuid)', 'create_budget_draft(uuid,text)',
    'set_budget_amount(uuid,uuid,numeric)', 'discard_budget_draft(uuid)', 'approve_budget_version(uuid,text)', 'import_budget(uuid,jsonb)',
    'budget_save_commitment(uuid,uuid,uuid,text,text,text,date,numeric,text,text)', 'budget_delete_commitment(uuid)',
    'budget_save_actual(uuid,uuid,uuid,text,text,date,numeric,text,uuid,text,uuid)', 'budget_delete_actual(uuid)',
    'import_budget_commitments(uuid,jsonb)', 'import_budget_actuals(uuid,jsonb)', 'set_budget_etc(uuid,numeric,text)', 'allocate_budget(uuid,uuid[],text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
