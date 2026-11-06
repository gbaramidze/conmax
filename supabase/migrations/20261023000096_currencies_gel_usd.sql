-- Валюты проекта: рубли убраны, остаются лари и доллар, которые можно использовать вместе.
--
-- Проект ведётся в основной валюте (`projects.currency`: GEL или USD) и хранит текущий курс `fx_rate` (лари за 1 доллар). Все итоги, бюджет
-- и расчёты по-прежнему считаются в основной валюте: в `amount` лежит сумма в ней. Договор и факт можно вести в другой валюте: исходная
-- сумма (`orig_amount`), её валюта (`currency`) и курс на момент ввода (`fx_rate`) сохраняются, а `amount` пересчитывается по этому курсу.
-- Смена курса прошлые записи не пересчитывает (курс на дату ввода). Без указанного курса проекта вводить суммы в другой валюте нельзя.
-- Не вошло: курсы по датам и их история, суммы в другой валюте в мебели, рисках, запросах на изменение и заявках (они в основной валюте).

alter table public.projects drop constraint if exists projects_currency_check;
update public.projects set currency = 'GEL' where currency not in ('GEL', 'USD');
alter table public.projects alter column currency set default 'GEL';
alter table public.projects add constraint projects_currency_check check (currency in ('GEL', 'USD'));
alter table public.projects add column if not exists fx_rate numeric(12, 6) check (fx_rate is null or fx_rate > 0);

alter table public.budget_commitments add column if not exists currency char(3) check (currency is null or currency in ('GEL', 'USD')),
  add column if not exists orig_amount numeric(16, 2) check (orig_amount is null or orig_amount >= 0),
  add column if not exists fx_rate numeric(12, 6);
alter table public.budget_actuals add column if not exists currency char(3) check (currency is null or currency in ('GEL', 'USD')),
  add column if not exists orig_amount numeric(16, 2),
  add column if not exists fx_rate numeric(12, 6);

-- Перевод введённой суммы в основную валюту проекта: (сумма в основной, исходная сумма, валюта, курс); для основной валюты исходная и курс пустые
create or replace function private.money_to_base(p_project uuid, p_amount numeric, p_currency text)
returns table (base numeric, orig numeric, cur text, rate numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text;
  v_rate numeric;
begin
  select pr.currency, pr.fx_rate into v_base, v_rate from public.projects pr where pr.id = p_project and pr.tenant_id = private.tenant_id();
  if v_base is null then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  if p_currency is null or btrim(p_currency) = '' or upper(btrim(p_currency)) = v_base then
    return query select private.budget_money(p_amount), null::numeric, null::text, null::numeric;
    return;
  end if;
  if upper(btrim(p_currency)) not in ('GEL', 'USD') then raise exception 'currency_invalid' using errcode = '22023'; end if;
  if v_rate is null then raise exception 'rate_required' using errcode = '22023'; end if;
  return query select private.budget_money(case when v_base = 'GEL' then p_amount * v_rate else p_amount / v_rate end),
                      p_amount, upper(btrim(p_currency)), v_rate;
end;
$$;

drop function if exists public.budget_save_commitment(uuid, uuid, uuid, text, text, text, date, numeric, text, text);
create or replace function public.budget_save_commitment(
  p_project uuid, p_id uuid, p_item uuid, p_title text, p_counterparty text, p_doc_number text, p_signed_on date, p_amount numeric,
  p_status text default 'active', p_note text default null, p_currency text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  m record;
begin
  perform private.week_guard(p_project, array['budget.edit', 'budget.approve']);
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  if p_amount < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if p_status not in ('active', 'cancelled') then raise exception 'bad_status' using errcode = '22023'; end if;
  if not exists (select 1 from public.cbs_items where id = p_item and project_id = p_project and deleted_at is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  select * into m from private.money_to_base(p_project, p_amount, p_currency);
  if v_id is null then
    insert into public.budget_commitments (tenant_id, project_id, item_id, title, counterparty, doc_number, signed_on, amount, currency, orig_amount, fx_rate, status, note, created_by)
    values (private.tenant_id(), p_project, p_item, btrim(p_title), nullif(btrim(coalesce(p_counterparty, '')), ''), nullif(btrim(coalesce(p_doc_number, '')), ''),
            p_signed_on, m.base, m.cur, m.orig, m.rate, p_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_id;
  else
    update public.budget_commitments set item_id = p_item, title = btrim(p_title), counterparty = nullif(btrim(coalesce(p_counterparty, '')), ''),
           doc_number = nullif(btrim(coalesce(p_doc_number, '')), ''), signed_on = p_signed_on, amount = m.base, currency = m.cur, orig_amount = m.orig, fx_rate = m.rate,
           status = p_status, note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_id and project_id = p_project and deleted_at is null;
    if not found then raise exception 'commitment_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

drop function if exists public.budget_save_actual(uuid, uuid, uuid, text, text, date, numeric, text, uuid, text, uuid);
create or replace function public.budget_save_actual(
  p_project uuid, p_id uuid, p_item uuid, p_doc_type text, p_doc_number text, p_doc_date date, p_amount numeric,
  p_counterparty text default null, p_commitment uuid default null, p_note text default null, p_activity uuid default null, p_currency text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  m record;
begin
  perform private.week_guard(p_project, array['cost.record', 'budget.edit', 'budget.approve']);
  select * into m from private.money_to_base(p_project, p_amount, p_currency);
  if m.base = 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  if p_doc_type not in ('act', 'invoice', 'writeoff', 'payroll', 'other') then raise exception 'bad_status' using errcode = '22023'; end if;
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
    insert into public.budget_actuals (tenant_id, project_id, item_id, commitment_id, activity_id, doc_type, doc_number, doc_date, amount, currency, orig_amount, fx_rate, counterparty, note, created_by)
    values (private.tenant_id(), p_project, p_item, p_commitment, p_activity, p_doc_type, nullif(btrim(coalesce(p_doc_number, '')), ''), coalesce(p_doc_date, current_date),
            m.base, m.cur, m.orig, m.rate, nullif(btrim(coalesce(p_counterparty, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_id;
  else
    update public.budget_actuals set item_id = p_item, commitment_id = p_commitment, activity_id = p_activity, doc_type = p_doc_type,
           doc_number = nullif(btrim(coalesce(p_doc_number, '')), ''), doc_date = coalesce(p_doc_date, doc_date), amount = m.base, currency = m.cur, orig_amount = m.orig, fx_rate = m.rate,
           counterparty = nullif(btrim(coalesce(p_counterparty, '')), ''), note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_id and project_id = p_project and deleted_at is null;
    if not found then raise exception 'actual_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.budget_save_commitment(uuid, uuid, uuid, text, text, text, date, numeric, text, text, text),
  public.budget_save_actual(uuid, uuid, uuid, text, text, date, numeric, text, uuid, text, uuid, text) from public, anon;
grant execute on function public.budget_save_commitment(uuid, uuid, uuid, text, text, text, date, numeric, text, text, text),
  public.budget_save_actual(uuid, uuid, uuid, text, text, date, numeric, text, uuid, text, uuid, text) to authenticated;
notify pgrst, 'reload schema';
