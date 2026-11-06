-- Сигналы и индекс здоровья проекта (S9). Принцип: цифры считает код, правила — детерминированные.
-- См. docs: 04-modules/10-analytics-signals.md. Движок `private.evaluate_core(проект)` запускается по расписанию
-- (каждые два часа) и по кнопке: поднимает сигналы по правилам, обновляет живые (дедупликация по dedup_key),
-- автоматически закрывает те, по которым условие перестало выполняться, и пересчитывает индекс здоровья.
-- Отклонённый сигнал с тем же ключом не поднимается заново, пока не истечёт срок отклонения.

create table public.signals (
  id                uuid primary key default public.uuidv7(),
  tenant_id         uuid not null references public.tenants(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  rule              text not null,
  dedup_key         text not null,
  severity          text not null check (severity in ('info','warning','high','critical')),
  status            text not null default 'open' check (status in ('open','resolved','dismissed')),
  title             text not null,
  facts             jsonb not null default '[]',
  evidence          jsonb not null default '[]',
  rule_text         text,
  actions           jsonb not null default '[]',
  severity_history  jsonb not null default '[]',
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  resolved_at       timestamptz,
  auto_resolved     boolean not null default false,
  assignee_id       uuid references public.users(id),
  task_id           uuid references public.tasks(id) on delete set null,
  agenda_meeting_id uuid references public.meetings(id) on delete set null,
  dismissed_at      timestamptz,
  dismissed_by      uuid references public.users(id),
  dismiss_reason    text,
  dismiss_until     date,
  useful            boolean
);
create unique index signals_open_uniq on public.signals (project_id, dedup_key) where status = 'open';
create index on public.signals (project_id, status, severity);
create index on public.signals (project_id, dedup_key, dismissed_at) where status = 'dismissed';

create table public.project_health (
  project_id  uuid primary key references public.projects(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  score       integer not null check (score between 0 and 100),
  color       text not null check (color in ('green','yellow','red')),
  components  jsonb not null,
  computed_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['signals', 'project_health'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
             and private.has_project_permission(project_id, 'signal.view'))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Вспомогательное
-- ---------------------------------------------------------------------------
create or replace function private.emit_signal(
  p_project uuid, p_rule text, p_key text, p_severity text, p_title text, p_facts jsonb, p_evidence jsonb, p_rule_text text, p_actions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cur public.signals;
begin
  insert into _sig_seen values (p_key) on conflict do nothing;
  if exists (select 1 from public.signals where project_id = p_project and dedup_key = p_key and status = 'dismissed' and dismiss_until >= current_date) then
    return;
  end if;
  select * into cur from public.signals where project_id = p_project and dedup_key = p_key and status = 'open';
  if found then
    update public.signals set severity = p_severity, title = p_title, facts = p_facts, evidence = p_evidence, rule_text = p_rule_text,
           actions = p_actions, last_seen_at = now(),
           severity_history = case when cur.severity <> p_severity
             then cur.severity_history || jsonb_build_object('at', now(), 'from', cur.severity, 'to', p_severity) else cur.severity_history end
     where id = cur.id;
  else
    insert into public.signals (tenant_id, project_id, rule, dedup_key, severity, title, facts, evidence, rule_text, actions)
    select pr.tenant_id, p_project, p_rule, p_key, p_severity, p_title, p_facts, p_evidence, p_rule_text, p_actions from public.projects pr where pr.id = p_project;
  end if;
end;
$$;

create or replace function private.reason_label(p_code text) returns text
language sql immutable as $$
  select case p_code
    when 'design' then 'нет документации' when 'materials' then 'материалы' when 'labor' then 'нехватка людей' when 'equipment' then 'техника и инструмент'
    when 'weather' then 'погода' when 'predecessor' then 'предыдущая работа не закончена' when 'access' then 'фронт работ не освобождён'
    when 'client_decision' then 'ожидание решения заказчика' when 'finance' then 'оплата и финансирование' when 'safety' then 'требования безопасности'
    when 'rework' then 'переделка замечаний' when 'planning' then 'неверная оценка объёма' when 'not_specified' then 'причина не указана' else coalesce(p_code, 'другое') end
$$;

-- Бюджет проекта одним документом: BAC, обязательства, факт, EAC (как в таблице «Бюджет»), статьи с обязательствами сверх бюджета
create or replace function private.budget_summary(p_project uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ver as (
    select id from public.budget_versions where project_id = p_project and status in ('approved', 'draft') order by (status = 'approved') desc, number desc limit 1),
  items as (
    select i.id, i.code, i.name, i.cost_type,
           coalesce((select amount from public.budget_amounts where version_id = (select id from ver) and item_id = i.id), 0) as bac,
           coalesce((select sum(amount) from public.budget_commitments where item_id = i.id and deleted_at is null and status = 'active'), 0) as commit,
           coalesce((select sum(amount) from public.budget_actuals where item_id = i.id and deleted_at is null), 0) as actual,
           (select etc_amount from public.budget_etc where item_id = i.id) as manual
      from public.cbs_items i where i.project_id = p_project and i.deleted_at is null),
  calc as (
    select *, case when manual is not null then manual when cost_type = 'contingency' then 0 else greatest(greatest(bac, commit) - actual, 0) end as etc from items)
  select jsonb_build_object(
    'bac', coalesce(sum(bac), 0), 'commit', coalesce(sum(commit), 0), 'actual', coalesce(sum(actual), 0), 'eac', coalesce(sum(actual + etc), 0),
    'over', coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'bac', bac, 'commit', commit) order by code) filter (where commit > bac + 0.005), '[]'))
  from calc;
$$;

create or replace function private.score_index(p_value numeric) returns numeric
language sql immutable as $$ select case when p_value is null then null else greatest(0, least(100, 100 * (p_value - 0.7) / 0.3)) end $$;

-- ---------------------------------------------------------------------------
-- Индекс здоровья: взвешенная сумма компонентов; компоненты без данных не учитываются, веса нормируются
-- ---------------------------------------------------------------------------
create or replace function private.health_core(p_project uuid, p_evm jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_spi numeric := nullif(coalesce(p_evm ->> 'spit', p_evm ->> 'spi'), '')::numeric;
  v_cpi numeric := nullif(p_evm ->> 'cpi', '')::numeric;
  v_ppc numeric := nullif(p_evm ->> 'ppc4', '')::numeric;
  v_open integer := coalesce((p_evm ->> 'open_tasks')::integer, 0);
  v_over integer := coalesce((p_evm ->> 'overdue_tasks')::integer, 0);
  v_bud jsonb := private.budget_summary(p_project);
  v_bac numeric := (v_bud ->> 'bac')::numeric;
  v_eac numeric := (v_bud ->> 'eac')::numeric;
  v_slip integer;
  v_ready numeric;
  v_hi integer; v_crit integer; v_warn integer;
  comps jsonb := '[]';
  v_score numeric; v_weight numeric := 0; v_sum numeric := 0;
  c record;
begin
  -- сроки
  select max(a.start_date - bsa.start_date) into v_slip
    from public.schedule_activities a
    join public.schedule_baseline_activities bsa on bsa.activity_id = a.id
     and bsa.baseline_id = (select id from public.schedule_baselines where project_id = p_project order by number desc limit 1)
   where a.project_id = p_project and a.deleted_at is null and a.kind = 'milestone' and a.percent_complete < 100;
  v_score := private.score_index(v_spi);
  if v_score is not null then
    if coalesce(v_slip, 0) > 0 then v_score := greatest(0, v_score - least(40, v_slip * 2)); end if;
    comps := comps || jsonb_build_object('key', 'schedule', 'label', 'Сроки', 'weight', 0.30, 'score', round(v_score),
      'value', format('SPI(t) %s%s', replace(to_char(v_spi, 'FM0.00'), '.', ','), case when coalesce(v_slip, 0) > 0 then format(', веха сдвинута на %s дн.', v_slip) else '' end));
  end if;
  -- стоимость
  v_score := private.score_index(v_cpi);
  if v_bac > 0 and v_eac > 0 then
    v_score := least(coalesce(v_score, 100), greatest(0, least(100, 100 - 1000 * (v_eac - v_bac) / v_bac)));
  end if;
  if v_cpi is not null or (v_bac > 0 and (v_bud ->> 'actual')::numeric > 0) then
    comps := comps || jsonb_build_object('key', 'cost', 'label', 'Стоимость', 'weight', 0.25, 'score', round(v_score),
      'value', concat_ws(', ', case when v_cpi is not null then 'CPI ' || replace(to_char(v_cpi, 'FM0.00'), '.', ',') end,
                         case when v_bac > 0 then format('прогноз %s%% к бюджету', round(100 * v_eac / v_bac)) end));
  end if;
  -- надёжность плана
  select case when count(*) >= 3 then 100.0 * count(*) filter (where chk.activity_id is not null
              and not exists (select 1 from public.activity_constraints ac join public.tasks t on t.id = ac.task_id
                               where ac.activity_id = a.id and t.deleted_at is null and t.status_category not in ('done', 'cancelled'))) / count(*) end
    into v_ready
    from public.schedule_activities a left join public.activity_readiness_checks chk on chk.activity_id = a.id
   where a.project_id = p_project and a.deleted_at is null and a.kind = 'task' and a.percent_complete < 100
     and a.start_date between current_date and current_date + 14;
  if v_ppc is not null or v_ready is not null then
    comps := comps || jsonb_build_object('key', 'plan', 'label', 'Надёжность плана', 'weight', 0.15,
      'score', round((coalesce(v_ppc, v_ready) + coalesce(v_ready, v_ppc)) / 2),
      'value', concat_ws(', ', case when v_ppc is not null then format('PPC %s%%', v_ppc) end, case when v_ready is not null then format('готовых работ %s%%', round(v_ready)) end));
  end if;
  -- исполнение
  if v_open > 0 then
    comps := comps || jsonb_build_object('key', 'execution', 'label', 'Исполнение', 'weight', 0.10,
      'score', round(greatest(0, 100 - 200.0 * v_over / v_open)), 'value', format('просрочено %s из %s задач', v_over, v_open));
  end if;
  -- сигналы
  select count(*) filter (where severity = 'high'), count(*) filter (where severity = 'critical'), count(*) filter (where severity = 'warning')
    into v_hi, v_crit, v_warn from public.signals where project_id = p_project and status = 'open';
  comps := comps || jsonb_build_object('key', 'signals', 'label', 'Сигналы', 'weight', 0.10,
    'score', round(greatest(0, 100 - 30 * v_crit - 15 * v_hi - 5 * v_warn)), 'value', format('критических %s, важных %s, внимание %s', v_crit, v_hi, v_warn));

  for c in select * from jsonb_array_elements(comps) loop
    v_weight := v_weight + (c.value ->> 'weight')::numeric;
    v_sum := v_sum + (c.value ->> 'weight')::numeric * (c.value ->> 'score')::numeric;
  end loop;
  v_score := case when v_weight > 0 then v_sum / v_weight else 100 end;
  return jsonb_build_object('score', round(v_score), 'color', case when v_score >= 75 then 'green' when v_score >= 50 then 'yellow' else 'red' end,
    'components', comps);
end;
$$;

-- Точка расширения: правила, которые добавляют следующие миграции (погода и др.), подменяют эту функцию
create or replace function private.evaluate_extra(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Движок правил
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_core(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today   date := current_date;
  v_evm   jsonb;
  v_bud   jsonb;
  v_base  uuid;
  n integer; m integer; k integer;
  ev jsonb; hi boolean; txt text;
  r record;
  v_dow integer;
  v_last date;
  v_raised integer := 0; v_resolved integer := 0;
  v_health jsonb;
begin
  create temp table if not exists _sig_seen (key text primary key) on commit drop;
  truncate _sig_seen;
  v_evm := private.evm_core(p_project, today);
  v_bud := private.budget_summary(p_project);
  select id into v_base from public.schedule_baselines where project_id = p_project order by number desc limit 1;

  -- 1. заблокированные задачи > 24 ч
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', key, 'title', title)) filter (where rn <= 5), '[]'), coalesce(bool_or(priority in ('high', 'critical')), false)
    into n, ev, hi from (select key, title, priority, row_number() over (order by updated_at) rn from public.tasks
       where project_id = p_project and deleted_at is null and status_category = 'blocked' and updated_at < now() - interval '24 hours') t;
  if n > 0 then
    perform private.emit_signal(p_project, 'task_blocked', 'task_blocked', case when hi then 'high' else 'warning' end, format('Заблокированных задач больше суток: %s', n),
      jsonb_build_array(jsonb_build_object('label', 'Заблокировано > 24 ч', 'value', n)), ev, 'Задача в статусе «заблокировано» дольше 24 часов', '[{"type":"create_task","title":"Снять блокировку задач"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 2. просроченные работы критического пути
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'activity', 'id', id, 'title', name)) filter (where rn <= 5), '[]'), coalesce(max(today - finish_date), 0)
    into n, ev, m from (select id, name, finish_date, row_number() over (order by finish_date) rn from public.schedule_activities
       where project_id = p_project and deleted_at is null and kind = 'task' and is_critical and percent_complete < 100 and finish_date < today) t;
  if n > 0 then
    perform private.emit_signal(p_project, 'critical_activity_overdue', 'critical_activity_overdue', 'high', format('Просрочены работы критического пути: %s', n),
      jsonb_build_array(jsonb_build_object('label', 'Работ на критическом пути просрочено', 'value', n), jsonb_build_object('label', 'Максимальная просрочка, дн.', 'value', m)), ev,
      'Работа критического пути не закончена к плановой дате: она сдвигает завершение проекта', '[{"type":"create_task","title":"Восстановить график критического пути"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 3. отрицательный резерв
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'activity', 'id', id, 'title', name)) filter (where rn <= 5), '[]'), coalesce(bool_or(kind = 'milestone'), false), coalesce(min(total_float), 0)
    into n, ev, hi, m from (select id, name, kind, total_float, row_number() over (order by total_float) rn from public.schedule_activities
       where project_id = p_project and deleted_at is null and kind in ('task', 'milestone') and total_float < 0) t;
  if n > 0 then
    perform private.emit_signal(p_project, 'negative_float', 'negative_float', case when hi then 'critical' else 'high' end, format('Отрицательный резерв у %s работ', n),
      jsonb_build_array(jsonb_build_object('label', 'Работ с отрицательным резервом', 'value', n), jsonb_build_object('label', 'Наименьший резерв, раб. дн.', 'value', m)), ev,
      'Резерв времени меньше нуля: директивный срок не выдерживается', '[{"type":"create_task","title":"Провести совещание по восстановлению графика"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 4. график не обновляется: работы идут, а факта нет 10+ дней
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'activity', 'id', id, 'title', name)) filter (where rn <= 5), '[]') into n, ev
    from (select a.id, a.name, row_number() over (order by a.name) rn from public.schedule_activities a
       where a.project_id = p_project and a.deleted_at is null and a.kind = 'task' and a.actual_start is not null and a.percent_complete < 100
         and greatest(a.actual_start, coalesce((select max(entry_date) from public.progress_entries e where e.activity_id = a.id and e.status = 'approved'), a.actual_start)) < today - 10) t;
  if n > 0 then
    perform private.emit_signal(p_project, 'schedule_stale', 'schedule_stale', 'warning', format('По %s идущим работам нет факта больше 10 дней', n),
      jsonb_build_array(jsonb_build_object('label', 'Работ без свежего факта', 'value', n)), ev, 'Работа начата и не закончена, а факт не вводился более 10 дней',
      '[{"type":"create_task","title":"Обновить факт по работам"},{"type":"assign"}]');
  end if;

  -- 5. сдвиг вех относительно базового плана
  if v_base is not null then
    select max(a.start_date - bsa.start_date), count(*) filter (where a.start_date - bsa.start_date > 7),
           coalesce(jsonb_agg(jsonb_build_object('type', 'activity', 'id', a.id, 'title', a.name || ' (+' || (a.start_date - bsa.start_date) || ' дн.)')) filter (where a.start_date - bsa.start_date > 7), '[]')
      into m, n, ev
      from public.schedule_activities a join public.schedule_baseline_activities bsa on bsa.activity_id = a.id and bsa.baseline_id = v_base
     where a.project_id = p_project and a.deleted_at is null and a.kind = 'milestone' and a.percent_complete < 100;
    if n > 0 then
      perform private.emit_signal(p_project, 'milestone_slip', 'milestone_slip', case when m > 21 then 'high' else 'warning' end, format('Вехи сдвинуты относительно базового плана: %s', n),
        jsonb_build_array(jsonb_build_object('label', 'Максимальный сдвиг, дн.', 'value', m), jsonb_build_object('label', 'Вех со сдвигом > 7 дн.', 'value', n)), ev,
        'Прогнозная дата вехи позже базового плана более чем на 7 дней', '[{"type":"create_task","title":"Разобрать сдвиг вех"},{"type":"add_to_agenda"},{"type":"assign"}]');
    end if;
  elsif exists (select 1 from public.projects where id = p_project and status = 'active') and exists (select 1 from public.schedule_activities where project_id = p_project and deleted_at is null) then
    perform private.emit_signal(p_project, 'baseline_missing', 'baseline_missing', 'high', 'Нет базового плана',
      '[]', '[]', 'График есть, а базового плана нет: нельзя считать плановую стоимость и отставание', '[{"type":"create_task","title":"Утвердить базовый план"},{"type":"assign"}]');
  end if;

  -- 6. устойчиво низкий SPI(t)/SPI и CPI по последним двум снимкам
  select count(*), count(*) filter (where coalesce(nullif(metrics ->> 'spit', ''), nullif(metrics ->> 'spi', ''))::numeric < 0.85),
         count(*) filter (where nullif(metrics ->> 'cpi', '')::numeric < 0.90)
    into n, m, k from (select metrics from public.snapshots where project_id = p_project order by status_date desc, created_at desc limit 2) s;
  if n = 2 and m = 2 then
    perform private.emit_signal(p_project, 'spi_low_sustained', 'spi_low_sustained', 'high', 'Индекс сроков ниже допуска два снимка подряд',
      jsonb_build_array(jsonb_build_object('label', 'SPI(t) сейчас', 'value', coalesce(v_evm ->> 'spit', v_evm ->> 'spi'))), '[]',
      'SPI(t) ниже 0,85 в двух последних снимках', '[{"type":"create_task","title":"Разобрать причины отставания по срокам"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;
  if n = 2 and k = 2 then
    perform private.emit_signal(p_project, 'cpi_low_sustained', 'cpi_low_sustained', 'high', 'Индекс стоимости ниже допуска два снимка подряд',
      jsonb_build_array(jsonb_build_object('label', 'CPI сейчас', 'value', v_evm ->> 'cpi')), '[]',
      'CPI ниже 0,90 в двух последних снимках', '[{"type":"create_task","title":"Разобрать перерасход по статьям"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 7. расхождение прогнозов окончания (CPM и Earned Schedule)
  select max(finish_date) into v_last from public.schedule_activities where project_id = p_project and deleted_at is null and kind = 'task';
  if v_last is not null and (v_evm ->> 'forecast_finish') is not null and abs((v_evm ->> 'forecast_finish')::date - v_last) > 20 then
    perform private.emit_signal(p_project, 'forecast_divergence', 'forecast_divergence', 'warning', 'Прогнозы окончания расходятся больше чем на 20 дней',
      jsonb_build_array(jsonb_build_object('label', 'По графику (CPM)', 'value', v_last), jsonb_build_object('label', 'По освоенному объёму (ES)', 'value', v_evm ->> 'forecast_finish')), '[]',
      'Прогноз по графику и по освоению отличаются более чем на 20 дней: проверьте актуальность графика и факта', '[{"type":"create_task","title":"Сверить график и факт"},{"type":"assign"}]');
  end if;

  -- 8. PPC ниже допуска две недели подряд
  with per as (select id, starts_on from public.planning_periods where project_id = p_project and status = 'closed' order by starts_on desc limit 2),
       p as (select per.id, 100.0 * count(*) filter (where c.result = 'completed') / nullif(count(*), 0) as ppc
               from per join public.period_commitments c on c.period_id = per.id and not c.added_late group by per.id)
  select count(*), count(*) filter (where ppc < 60), round(avg(ppc)) into n, m, k from p;
  if n = 2 and m = 2 then
    perform private.emit_signal(p_project, 'ppc_low', 'ppc_low', 'high', 'PPC ниже 60% две недели подряд',
      jsonb_build_array(jsonb_build_object('label', 'Среднее PPC двух недель, %', 'value', k)), '[]', 'Выполнено меньше 60% обязательств две закрытые недели подряд',
      '[{"type":"create_task","title":"Разобрать срывы недельного плана"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 9. одна причина срывов лидирует три недели подряд
  with per as (select id from public.planning_periods where project_id = p_project and status = 'closed' order by starts_on desc limit 3),
       cnt as (select period_id, reason, count(*) c from public.period_commitments
                where period_id in (select id from per) and result = 'not_completed' and not added_late group by 1, 2),
       top as (select distinct on (period_id) period_id, reason, c from cnt order by period_id, c desc, reason)
  select (select count(*) from per), count(*), count(distinct reason), min(reason), coalesce(sum(c), 0) into n, m, k, txt, v_raised from top;
  if n = 3 and m = 3 and k = 1 and txt <> 'not_specified' then
    perform private.emit_signal(p_project, 'recurring_reason', 'recurring_reason', 'high', format('Одна причина срывов три недели подряд: %s', private.reason_label(txt)),
      jsonb_build_array(jsonb_build_object('label', 'Причина', 'value', private.reason_label(txt)), jsonb_build_object('label', 'Невыполненных обязательств по ней за 3 недели', 'value', v_raised)), '[]',
      'Одна причина лидирует среди невыполненных обязательств три закрытые недели подряд: это системная проблема', '[{"type":"create_task","title":"Устранить системную причину срывов"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;
  v_raised := 0;

  -- 10. просроченные ограничения look-ahead
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', key, 'title', title)) filter (where rn <= 5), '[]'), coalesce(bool_or(crit), false)
    into n, ev, hi from (select t.key, t.title, a.is_critical as crit, row_number() over (order by t.due_date) rn
       from public.activity_constraints ac join public.tasks t on t.id = ac.task_id join public.schedule_activities a on a.id = ac.activity_id
      where ac.project_id = p_project and t.deleted_at is null and t.status_category not in ('done', 'cancelled') and t.due_date < today) q;
  if n > 0 then
    perform private.emit_signal(p_project, 'constraint_overdue', 'constraint_overdue', case when hi then 'high' else 'warning' end, format('Просрочено снятие ограничений: %s', n),
      jsonb_build_array(jsonb_build_object('label', 'Ограничений просрочено', 'value', n)), ev, 'Ограничение не снято к сроку «снять до»', '[{"type":"create_task","title":"Снять просроченные ограничения"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 11. мало готовых работ на ближайшие две недели
  select count(*), count(*) filter (where chk.activity_id is not null and not exists (select 1 from public.activity_constraints ac join public.tasks t on t.id = ac.task_id
                                                                                           where ac.activity_id = a.id and t.deleted_at is null and t.status_category not in ('done', 'cancelled')))
    into n, m from public.schedule_activities a left join public.activity_readiness_checks chk on chk.activity_id = a.id
   where a.project_id = p_project and a.deleted_at is null and a.kind = 'task' and a.percent_complete < 100 and a.start_date between today and today + 14;
  if n >= 3 and m::numeric / n < 0.7 then
    perform private.emit_signal(p_project, 'lookahead_not_ready', 'lookahead_not_ready', 'warning', format('Готово к старту только %s из %s работ ближайших двух недель', m, n),
      jsonb_build_array(jsonb_build_object('label', 'Работ стартует за 2 недели', 'value', n), jsonb_build_object('label', 'Из них готовы', 'value', m)), '[]',
      'Меньше 70% работ ближайших двух недель проверены и свободны от ограничений', '[{"type":"create_task","title":"Провести сессию подготовки работ (make-ready)"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 12. обязательства недели взяты по неготовым работам
  select count(*) filter (where not c.added_late), count(*) filter (where not c.added_late and not c.was_ready) into n, m
    from public.period_commitments c where c.period_id = (select p.id from public.planning_periods p where p.project_id = p_project
        and exists (select 1 from public.period_commitments x where x.period_id = p.id) order by p.starts_on desc limit 1);
  if n >= 3 and m::numeric / n > 0.3 then
    perform private.emit_signal(p_project, 'commitment_unready', 'commitment_unready', 'warning', format('Неготовые работы в плане недели: %s из %s', m, n),
      jsonb_build_array(jsonb_build_object('label', 'Обязательств по неготовым работам', 'value', m)), '[]', 'Больше 30% обязательств последней недели взяты по работам с ограничениями или незавершённым предшественником',
      '[{"type":"create_task","title":"Пересмотреть план недели с учётом готовности"},{"type":"assign"}]');
  end if;

  -- 13. неделя не закрыта
  select count(*) into n from public.planning_periods where project_id = p_project and status = 'active' and ends_on < today - 1;
  if n > 0 then
    perform private.emit_signal(p_project, 'period_not_closed', 'period_not_closed', 'warning', 'Прошедшая неделя не закрыта',
      jsonb_build_array(jsonb_build_object('label', 'Незакрытых недель', 'value', n)), '[]', 'Неделя закончилась больше суток назад, а итоги не подведены', '[{"type":"create_task","title":"Закрыть неделю и отметить итоги"},{"type":"assign"}]');
  end if;

  -- 14. у исполнителя много просроченных задач
  for r in select t.assignee_id, u.full_name, count(*) c, coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', t.key, 'title', t.title)) filter (where rn <= 5), '[]') ev
             from (select *, row_number() over (partition by assignee_id order by due_date) rn from public.tasks
                    where project_id = p_project and deleted_at is null and status_category not in ('done', 'cancelled') and assignee_id is not null and due_date < today) t
             join public.users u on u.id = t.assignee_id group by t.assignee_id, u.full_name having count(*) > 5 loop
    perform private.emit_signal(p_project, 'overdue_cluster', 'overdue_cluster:' || r.assignee_id, case when r.c > 10 then 'high' else 'warning' end,
      format('У исполнителя %s просрочено задач: %s', r.full_name, r.c), jsonb_build_array(jsonb_build_object('label', 'Просроченных задач', 'value', r.c)), r.ev,
      'У одного исполнителя больше пяти просроченных задач', '[{"type":"create_task","title":"Разобрать просроченные задачи исполнителя"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end loop;

  -- 15. задачи без исполнителя
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', key, 'title', title)) filter (where rn <= 5), '[]') into n, ev
    from (select key, title, row_number() over (order by created_at) rn from public.tasks where project_id = p_project and deleted_at is null
           and status_category not in ('done', 'cancelled') and assignee_id is null and type in ('task', 'punch') and created_at < now() - interval '2 days') t;
  if n > 5 then
    perform private.emit_signal(p_project, 'unassigned_tasks', 'unassigned_tasks', 'info', format('Задач без исполнителя больше двух дней: %s', n),
      jsonb_build_array(jsonb_build_object('label', 'Без исполнителя', 'value', n)), ev, 'Больше пяти задач висят без исполнителя дольше двух дней', '[{"type":"create_task","title":"Назначить исполнителей на задачи"},{"type":"assign"}]');
  end if;

  -- 16. протокол совещания не опубликован
  select count(*) into n from public.meetings where project_id = p_project and status in ('in_progress', 'minutes_draft')
     and scheduled_at + make_interval(mins => duration_min) < now() - interval '24 hours';
  if n > 0 then
    perform private.emit_signal(p_project, 'minutes_late', 'minutes_late', 'warning', format('Протокол не опубликован больше суток: %s', n),
      jsonb_build_array(jsonb_build_object('label', 'Совещаний без протокола', 'value', n)), '[]', 'Совещание закончилось, а протокол не опубликован более 24 часов', '[{"type":"create_task","title":"Опубликовать протокол совещания"},{"type":"assign"}]');
  end if;

  -- 17. запрос на информацию (RFI) без ответа
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', key, 'title', title)) filter (where rn <= 5), '[]') into n, ev
    from (select key, title, row_number() over (order by created_at) rn from public.tasks where project_id = p_project and deleted_at is null
           and status_category not in ('done', 'cancelled') and type = 'rfi' and created_at < now() - interval '5 days') t;
  if n > 0 then
    perform private.emit_signal(p_project, 'rfi_sla_breach', 'rfi_sla_breach', 'warning', format('RFI без ответа дольше 5 дней: %s', n),
      jsonb_build_array(jsonb_build_object('label', 'RFI без ответа', 'value', n)), ev, 'Запрос открыт дольше срока ответа (5 дней)', '[{"type":"create_task","title":"Получить ответы на RFI"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 18. прогноз стоимости выше бюджета
  if (v_bud ->> 'bac')::numeric > 0 and (v_bud ->> 'eac')::numeric > (v_bud ->> 'bac')::numeric * 1.02 then
    m := round(100 * ((v_bud ->> 'eac')::numeric / (v_bud ->> 'bac')::numeric - 1));
    perform private.emit_signal(p_project, 'eac_over_budget', 'eac_over_budget', case when m > 10 then 'critical' when m > 5 then 'high' else 'warning' end,
      format('Прогноз затрат выше бюджета на %s%%', m),
      jsonb_build_array(jsonb_build_object('label', 'Бюджет', 'value', (v_bud ->> 'bac')::numeric), jsonb_build_object('label', 'Прогноз (EAC)', 'value', (v_bud ->> 'eac')::numeric)), '[]',
      'Прогноз затрат при завершении превышает текущий бюджет более чем на 2%', '[{"type":"create_task","title":"Подготовить меры по экономии или изменение бюджета"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 19. обязательства по статье больше её бюджета
  if jsonb_array_length(v_bud -> 'over') > 0 then
    perform private.emit_signal(p_project, 'line_overcommitted', 'line_overcommitted', 'high', format('Обязательства превышают бюджет по статьям: %s', jsonb_array_length(v_bud -> 'over')),
      jsonb_build_array(jsonb_build_object('label', 'Статей с превышением', 'value', jsonb_array_length(v_bud -> 'over'))),
      (select coalesce(jsonb_agg(jsonb_build_object('type', 'budget_item', 'title', x ->> 'code' || ' ' || (x ->> 'name'))), '[]') from jsonb_array_elements(v_bud -> 'over') x),
      'Сумма договоров по статье больше бюджета статьи', '[{"type":"create_task","title":"Перераспределить бюджет или пересмотреть договоры"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 20. требуемая эффективность нереалистична
  if nullif(v_evm ->> 'tcpi', '') is not null and (v_evm ->> 'tcpi')::numeric > 1.10 then
    perform private.emit_signal(p_project, 'tcpi_unrealistic', 'tcpi_unrealistic', 'warning', 'Уложиться в бюджет при текущей эффективности нереально',
      jsonb_build_array(jsonb_build_object('label', 'TCPI', 'value', v_evm ->> 'tcpi'), jsonb_build_object('label', 'CPI сейчас', 'value', v_evm ->> 'cpi')), '[]',
      'Требуемый CPI на остаток выше 1,10', '[{"type":"create_task","title":"Пересмотреть стоимость остатка работ"},{"type":"assign"}]');
  end if;

  -- 21. нет факта затрат при идущих работах
  if coalesce((v_evm ->> 'ev')::numeric, 0) > 0 and not exists (select 1 from public.budget_actuals where project_id = p_project and deleted_at is null and doc_date >= today - 30) then
    perform private.emit_signal(p_project, 'costs_not_recorded', 'costs_not_recorded', 'warning', 'Факт затрат не вносился больше 30 дней',
      jsonb_build_array(jsonb_build_object('label', 'Освоено, ₽', 'value', (v_evm ->> 'ev')::numeric)), '[]', 'Работы выполняются, а затраты за 30 дней не внесены: показатели стоимости недостоверны',
      '[{"type":"create_task","title":"Внести факт затрат"},{"type":"assign"}]');
  end if;

  -- 22. нет журнала за прошлый рабочий день
  v_dow := extract(isodow from today)::integer;
  v_last := case v_dow when 1 then today - 3 when 7 then today - 2 else today - 1 end;
  if exists (select 1 from public.schedule_activities where project_id = p_project and deleted_at is null and kind = 'task' and actual_start is not null and percent_complete < 100)
     and not exists (select 1 from public.daily_logs where project_id = p_project and log_date = v_last) then
    perform private.emit_signal(p_project, 'daily_log_missing', 'daily_log_missing', 'info', 'Нет журнала за прошлый рабочий день',
      jsonb_build_array(jsonb_build_object('label', 'Дата', 'value', v_last)), '[]', 'Работы идут, а журнал дня за прошлый рабочий день не заведён', '[{"type":"create_task","title":"Заполнить журнал дня"},{"type":"assign"}]');
  end if;

  -- 23. бюджет не распределён по работам
  if (v_evm ->> 'total_budget')::numeric > 0 and coalesce((v_evm ->> 'coverage')::numeric, 0) < 0.8 and exists (select 1 from public.schedule_activities where project_id = p_project and deleted_at is null) then
    perform private.emit_signal(p_project, 'activity_without_budget', 'activity_without_budget', 'warning', 'Бюджет не распределён по работам графика',
      jsonb_build_array(jsonb_build_object('label', 'Охват бюджета', 'value', coalesce(round(100 * (v_evm ->> 'coverage')::numeric), 0) || '%')), '[]',
      'Менее 80% бюджета закреплено за работами: освоенный объём и индексы считаются неполно', '[{"type":"create_task","title":"Распределить бюджет по работам"},{"type":"assign"}]');
  end if;

  perform private.evaluate_extra(p_project);

  -- автозакрытие: условие больше не выполняется
  update public.signals set status = 'resolved', resolved_at = now(), auto_resolved = true
   where project_id = p_project and status = 'open' and dedup_key not in (select key from _sig_seen);
  get diagnostics v_resolved = row_count;

  v_health := private.health_core(p_project, v_evm);
  insert into public.project_health (project_id, tenant_id, score, color, components, computed_at)
  select p_project, pr.tenant_id, (v_health ->> 'score')::integer, v_health ->> 'color', v_health -> 'components', now() from public.projects pr where pr.id = p_project
  on conflict (project_id) do update set score = excluded.score, color = excluded.color, components = excluded.components, computed_at = now();

  return jsonb_build_object('open', (select count(*) from public.signals where project_id = p_project and status = 'open'), 'resolved', v_resolved, 'health', v_health -> 'score');
end;
$$;

create or replace function public.evaluate_signals(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.week_guard(p_project, array['signal.manage']);
  return private.evaluate_core(p_project);
end;
$$;

create or replace function private.evaluate_all_signals() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p record; n integer := 0;
begin
  for p in select id from public.projects where deleted_at is null and status = 'active' loop
    begin
      perform private.evaluate_core(p.id);
      n := n + 1;
    exception when others then
      raise warning 'signals: проект % пропущен: %', p.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

-- В снимок попадает индекс здоровья на дату
create or replace function public.create_snapshot(p_project uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_metrics jsonb;
begin
  perform private.week_guard(p_project, array['snapshot.create']);
  v_metrics := private.evm_core(p_project, current_date);
  v_metrics := v_metrics || jsonb_build_object('health', private.health_core(p_project, v_metrics));
  insert into public.snapshots (tenant_id, project_id, status_date, kind, note, metrics, created_by)
  values (private.tenant_id(), p_project, current_date, 'manual', nullif(btrim(coalesce(p_note, '')), ''), v_metrics, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.weekly_snapshots() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  n integer := 0;
  v_metrics jsonb;
begin
  for p in
    select pr.id, pr.tenant_id from public.projects pr
     where pr.deleted_at is null and pr.status = 'active' and exists (select 1 from public.activity_budgets ab where ab.project_id = pr.id)
       and not exists (select 1 from public.snapshots s where s.project_id = pr.id and s.status_date >= date_trunc('week', current_date)::date)
  loop
    v_metrics := private.evm_core(p.id, current_date);
    v_metrics := v_metrics || jsonb_build_object('health', private.health_core(p.id, v_metrics));
    insert into public.snapshots (tenant_id, project_id, status_date, kind, metrics) values (p.tenant_id, p.id, current_date, 'weekly', v_metrics);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Действия над сигналом
-- ---------------------------------------------------------------------------
create or replace function public.signal_create_task(p_signal uuid, p_title text, p_assignee uuid default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.signals;
  t public.tasks;
begin
  select * into s from public.signals where id = p_signal and tenant_id = private.tenant_id();
  if not found then raise exception 'signal_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(s.project_id, array['signal.manage', 'task.create']);
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title_required' using errcode = '22023'; end if;
  t := public.create_task(s.project_id, p_title, 'task', p_assignee, p_due, case s.severity when 'critical' then 'critical' when 'high' then 'high' else 'normal' end);
  update public.signals set task_id = t.id, assignee_id = coalesce(p_assignee, assignee_id) where id = s.id;
  return t.id;
end;
$$;

create or replace function public.signal_assign(p_signal uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.signals;
begin
  select * into s from public.signals where id = p_signal and tenant_id = private.tenant_id();
  if not found then raise exception 'signal_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(s.project_id, array['signal.manage']);
  if p_user is not null and not exists (select 1 from public.project_members pm where pm.project_id = s.project_id and pm.user_id = p_user and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  update public.signals set assignee_id = p_user where id = s.id;
end;
$$;

create or replace function public.signal_to_agenda(p_signal uuid, p_meeting uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.signals;
  m public.meetings;
begin
  select * into s from public.signals where id = p_signal and tenant_id = private.tenant_id();
  if not found then raise exception 'signal_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(s.project_id, array['signal.manage', 'meeting.manage']);
  select * into m from public.meetings where id = p_meeting and project_id = s.project_id;
  if not found or m.status in ('published', 'cancelled') then raise exception 'meeting_closed' using errcode = '22023'; end if;
  insert into public.meeting_agenda_items (tenant_id, project_id, meeting_id, title, notes, duration_min)
  values (s.tenant_id, s.project_id, m.id, left('Сигнал: ' || s.title, 300),
          concat_ws(E'\n', s.rule_text, (select string_agg('— ' || (f ->> 'label') || ': ' || (f ->> 'value'), E'\n') from jsonb_array_elements(s.facts) f)), 10);
  update public.signals set agenda_meeting_id = m.id where id = s.id;
end;
$$;

create or replace function public.signal_dismiss(p_signal uuid, p_reason text, p_days integer default 14) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.signals;
begin
  select * into s from public.signals where id = p_signal and tenant_id = private.tenant_id();
  if not found then raise exception 'signal_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(s.project_id, array['signal.manage']);
  if p_reason not in ('false', 'known', 'unimportant') then raise exception 'bad_reason' using errcode = '22023'; end if;
  update public.signals set status = 'dismissed', dismissed_at = now(), dismissed_by = auth.uid(), dismiss_reason = p_reason,
         dismiss_until = current_date + greatest(least(coalesce(p_days, 14), 365), 1) where id = s.id and status = 'open';
end;
$$;

create or replace function public.signal_feedback(p_signal uuid, p_useful boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.signals;
begin
  select * into s from public.signals where id = p_signal and tenant_id = private.tenant_id();
  if not found then raise exception 'signal_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(s.project_id, array['signal.view']);
  update public.signals set useful = p_useful where id = s.id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['evaluate_signals(uuid)', 'signal_create_task(uuid,text,uuid,date)', 'signal_assign(uuid,uuid)',
                           'signal_to_agenda(uuid,uuid)', 'signal_dismiss(uuid,text,integer)', 'signal_feedback(uuid,boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$
begin
  perform cron.schedule('buildos-signals', '15 */2 * * *', 'select private.evaluate_all_signals()');
exception when others then
  raise notice 'pg_cron недоступен, расписание сигналов не создано: %', sqlerrm;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
