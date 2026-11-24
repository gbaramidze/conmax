-- Раскладка бюджета по месяцам (Look-Ahead) и закрытие месяцев. См. docs: 04-modules/09-budget-progress-evm.md (0.2).
--
-- Прогноз по месяцам живой, а не часть версии: утверждённая версия бюджета неизменна, а раскладку экономист правит каждый
-- месяц. Месяцы до «закрыто по» включительно — закрытые: в них показывается факт из `budget_actuals`, прогноз за них
-- больше не правится и остаётся как история («что ожидали»). Открытые месяцы — прогноз из `budget_forecast`.
-- «Не распределено» = бюджет − факт закрытых месяцев − прогноз открытых; считается на экране.
-- Импорт файла вида «Budget … Look Ahead»: статьи (с вторым названием и кодом из файла), факт по месяцам, прогноз и
-- граница закрытых месяцев — одной функцией, атомарно.

alter table public.cbs_items
  add column alt_name    text check (alt_name is null or length(alt_name) <= 300),
  add column source_code text check (source_code is null or length(source_code) <= 40);
comment on column public.cbs_items.alt_name is 'Второе название статьи (например, на грузинском из файла бюджета)';
comment on column public.cbs_items.source_code is 'Код статьи в исходном файле, если при импорте его пришлось исправить';

alter table public.budget_actuals add column source text check (source is null or source = 'lookahead_import');
comment on column public.budget_actuals.source is 'lookahead_import — факт, перенесённый из файла раскладки; при повторном импорте заменяется';

create table public.budget_forecast (
  item_id    uuid not null references public.cbs_items(id),
  month      date not null check (extract(day from month) = 1),
  tenant_id  uuid not null references public.tenants(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  amount     numeric(16,2) not null check (amount > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.users(id),
  primary key (item_id, month)
);
create index on public.budget_forecast (project_id, month);

create table public.budget_settings (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id),
  -- первое число последнего закрытого месяца; null — закрытых месяцев нет
  closed_through date check (closed_through is null or extract(day from closed_through) = 1),
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid() references public.users(id)
);

do $$
declare t text;
begin
  foreach t in array array['budget_forecast', 'budget_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'budget.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

create or replace function private.budget_closed_through(p_project uuid) returns date
language sql stable security definer set search_path = '' as $$
  select closed_through from public.budget_settings where project_id = p_project
$$;

-- Удаление статьи убирает и её прогноз по месяцам (прогноз сам по себе не мешает удалению)
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
  delete from public.budget_forecast where item_id = it.id;
  update public.cbs_items set deleted_at = now(), code = code || '~' || left(it.id::text, 8) where id = it.id;
end;
$$;

-- Прогноз статьи на месяц; 0 убирает прогноз. Закрытый месяц не правится.
create or replace function public.set_budget_forecast(p_item uuid, p_month date, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.cbs_items;
  v_month date := date_trunc('month', p_month)::date;
  v_amount numeric := private.budget_money(p_amount);
begin
  select * into it from public.cbs_items where id = p_item and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(it.project_id, array['cost.record', 'budget.edit', 'budget.approve']);
  if v_month is null then raise exception 'bad_month' using errcode = '22023'; end if;
  if v_month <= coalesce(private.budget_closed_through(it.project_id), '-infinity'::date) then
    raise exception 'month_closed' using errcode = '23514';
  end if;
  if v_amount < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_amount = 0 then
    delete from public.budget_forecast where item_id = it.id and month = v_month;
  else
    insert into public.budget_forecast (item_id, month, tenant_id, project_id, amount, updated_by)
    values (it.id, v_month, it.tenant_id, it.project_id, v_amount, auth.uid())
    on conflict (item_id, month) do update set amount = excluded.amount, updated_at = now(), updated_by = auth.uid();
  end if;
end;
$$;

-- Разложить сумму по статье на p_months месяцев с p_from: поровну или колоколом (S-кривая накопленным итогом).
-- Прежний прогноз статьи во всех открытых месяцах заменяется. Копейки остатка уходят в последний месяц.
create or replace function public.spread_budget_forecast(p_item uuid, p_from date, p_months integer, p_amount numeric, p_shape text default 'equal') returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.cbs_items;
  v_from date := date_trunc('month', p_from)::date;
  v_total numeric := private.budget_money(p_amount);
  v_weight numeric := 0;
  v_given numeric := 0;
  v_part numeric;
  i integer;
begin
  select * into it from public.cbs_items where id = p_item and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(it.project_id, array['cost.record', 'budget.edit', 'budget.approve']);
  if v_from is null or p_months is null or p_months < 1 or p_months > 120 then raise exception 'bad_month' using errcode = '22023'; end if;
  if p_shape not in ('equal', 'scurve') then raise exception 'bad_status' using errcode = '22023'; end if;
  if v_total < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if v_from <= coalesce(private.budget_closed_through(it.project_id), '-infinity'::date) then
    raise exception 'month_closed' using errcode = '23514';
  end if;

  delete from public.budget_forecast where item_id = it.id and month > coalesce(private.budget_closed_through(it.project_id), '-infinity'::date);
  if v_total = 0 then return; end if;

  for i in 0 .. p_months - 1 loop
    v_weight := v_weight + case when p_shape = 'equal' then 1 else sin(pi() * (i + 0.5) / p_months)::numeric end;
  end loop;
  for i in 0 .. p_months - 1 loop
    v_part := case when i = p_months - 1 then v_total - v_given
                   else round(v_total * (case when p_shape = 'equal' then 1 else sin(pi() * (i + 0.5) / p_months)::numeric end) / v_weight, 2) end;
    v_given := v_given + v_part;
    if v_part > 0 then
      insert into public.budget_forecast (item_id, month, tenant_id, project_id, amount, updated_by)
      values (it.id, (v_from + make_interval(months => i))::date, it.tenant_id, it.project_id, v_part, auth.uid());
    end if;
  end loop;
end;
$$;

-- Закрыть прошедшие месяцы по p_month включительно: в них остаётся факт, прогноз за них больше не правится
create or replace function public.close_budget_month(p_project uuid, p_month date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  perform private.week_guard(p_project, array['budget.edit', 'budget.approve']);
  if v_month is null then raise exception 'bad_month' using errcode = '22023'; end if;
  if v_month >= date_trunc('month', current_date)::date then raise exception 'month_not_over' using errcode = '23514'; end if;
  if v_month <= coalesce(private.budget_closed_through(p_project), '-infinity'::date) then raise exception 'month_closed' using errcode = '23514'; end if;
  insert into public.budget_settings (project_id, tenant_id, closed_through, updated_by)
  values (p_project, private.tenant_id(), v_month, auth.uid())
  on conflict (project_id) do update set closed_through = excluded.closed_through, updated_at = now(), updated_by = auth.uid();
end;
$$;

-- Открыть последний закрытый месяц снова (исправить ошибку закрытия) — только утверждающий
create or replace function public.reopen_budget_month(p_project uuid) returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_closed date;
begin
  perform private.week_guard(p_project, array['budget.approve']);
  v_closed := private.budget_closed_through(p_project);
  if v_closed is null then raise exception 'nothing_closed' using errcode = '23514'; end if;
  update public.budget_settings set closed_through = (v_closed - interval '1 month')::date, updated_at = now(), updated_by = auth.uid()
   where project_id = p_project;
  return v_closed;
end;
$$;

-- Импорт раскладки в черновик версии. p_payload:
--   items: [{code, name, amount, cost_type?, alt_name?, source_code?}] — как в import_budget (родитель по префиксу кода);
--   actuals: [{item_code, month, amount}] — факт закрытых месяцев, ложится строкой «Перенесено из Excel» на конец месяца;
--   forecast: [{item_code, month, amount}] — прогноз открытых месяцев, заменяет прежний прогноз этих статей;
--   closed_through: 'YYYY-MM-01' | null; replace_actuals: true — убрать факт прежнего импорта раскладки.
create or replace function public.import_budget_lookahead(p_version uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.budget_versions;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_actuals jsonb := coalesce(p_payload -> 'actuals', '[]'::jsonb);
  v_forecast jsonb := coalesce(p_payload -> 'forecast', '[]'::jsonb);
  v_closed date := date_trunc('month', nullif(p_payload ->> 'closed_through', '')::date)::date;
  v_res jsonb;
  r jsonb;
  n integer := 0;
  v_item uuid;
  v_month date;
  v_amount numeric;
  v_act integer := 0;
  v_fc integer := 0;
begin
  select * into v from public.budget_versions where id = p_version and tenant_id = private.tenant_id();
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(v.project_id, array['budget.edit', 'budget.approve']);
  if v.status <> 'draft' then raise exception 'version_locked' using errcode = '23514'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_actuals) <> 'array' or jsonb_typeof(v_forecast) <> 'array'
     or jsonb_array_length(v_actuals) > 20000 or jsonb_array_length(v_forecast) > 40000 then
    raise exception 'bad_rows' using errcode = '22023';
  end if;
  if v_closed is not null and v_closed >= date_trunc('month', current_date)::date then raise exception 'month_not_over' using errcode = '23514'; end if;

  -- статьи и суммы версии
  v_res := public.import_budget(p_version, v_items);
  update public.cbs_items i
     set alt_name = nullif(left(btrim(coalesce(x ->> 'alt_name', '')), 300), ''),
         source_code = nullif(left(btrim(coalesce(x ->> 'source_code', '')), 40), '')
    from jsonb_array_elements(v_items) x
   where i.project_id = v.project_id and i.deleted_at is null and lower(i.code) = lower(btrim(x ->> 'code'));

  -- граница закрытых месяцев
  if p_payload ? 'closed_through' then
    insert into public.budget_settings (project_id, tenant_id, closed_through, updated_by)
    values (v.project_id, v.tenant_id, v_closed, auth.uid())
    on conflict (project_id) do update set closed_through = excluded.closed_through, updated_at = now(), updated_by = auth.uid();
  end if;
  v_closed := private.budget_closed_through(v.project_id);

  -- факт
  if coalesce((p_payload ->> 'replace_actuals')::boolean, false) then
    update public.budget_actuals set deleted_at = now() where project_id = v.project_id and source = 'lookahead_import' and deleted_at is null;
  end if;
  n := 0;
  for r in select * from jsonb_array_elements(v_actuals) loop
    n := n + 1;
    select id into v_item from public.cbs_items where project_id = v.project_id and lower(code) = lower(btrim(coalesce(r ->> 'item_code', ''))) and deleted_at is null;
    v_month := date_trunc('month', nullif(r ->> 'month', '')::date)::date;
    v_amount := private.budget_money(nullif(r ->> 'amount', '')::numeric);
    if v_item is null or v_month is null then raise exception 'row_invalid:%', n using errcode = '22023'; end if;
    continue when v_amount = 0;
    insert into public.budget_actuals (tenant_id, project_id, item_id, doc_type, doc_date, amount, note, source, created_by)
    values (v.tenant_id, v.project_id, v_item, 'other', (v_month + interval '1 month' - interval '1 day')::date, v_amount,
            'Перенесено из Excel', 'lookahead_import', auth.uid());
    v_act := v_act + 1;
  end loop;

  -- прогноз: у статей из файла прежний прогноз открытых месяцев заменяется
  delete from public.budget_forecast f
   using public.cbs_items i
   where f.item_id = i.id and i.project_id = v.project_id and f.month > coalesce(v_closed, '-infinity'::date)
     and lower(i.code) in (select lower(btrim(x ->> 'code')) from jsonb_array_elements(v_items) x);
  n := 0;
  for r in select * from jsonb_array_elements(v_forecast) loop
    n := n + 1;
    select id into v_item from public.cbs_items where project_id = v.project_id and lower(code) = lower(btrim(coalesce(r ->> 'item_code', ''))) and deleted_at is null;
    v_month := date_trunc('month', nullif(r ->> 'month', '')::date)::date;
    v_amount := private.budget_money(nullif(r ->> 'amount', '')::numeric);
    if v_item is null or v_month is null or v_amount < 0 then raise exception 'row_invalid:%', n using errcode = '22023'; end if;
    continue when v_amount = 0 or v_month <= coalesce(v_closed, '-infinity'::date);
    insert into public.budget_forecast (item_id, month, tenant_id, project_id, amount, updated_by)
    values (v_item, v_month, v.tenant_id, v.project_id, v_amount, auth.uid())
    on conflict (item_id, month) do update set amount = public.budget_forecast.amount + excluded.amount, updated_at = now();
    v_fc := v_fc + 1;
  end loop;

  return v_res || jsonb_build_object('actuals', v_act, 'forecast', v_fc, 'closed_through', v_closed);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_budget_forecast(uuid,date,numeric)', 'spread_budget_forecast(uuid,date,integer,numeric,text)',
    'close_budget_month(uuid,date)', 'reopen_budget_month(uuid)', 'import_budget_lookahead(uuid,jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
