-- Настройка сигналов на проект, уведомления о важных сигналах и автоповестка.
-- 1. Пороги правил. Движок (`evaluate_core`) читает пороги проекта (`signal_settings`), а не зашитые числа; без настройки действуют прежние значения,
--    поэтому сигналы не меняются, пока руководитель ничего не настроил. Правило можно выключить: тогда оно не поднимается, а открытый сигнал закрывается
--    системой при следующем пересчёте. Менять может тот, у кого `signal.manage`; допустимые границы проверяет сервер.
-- 2. Уведомления: новый сигнал «важный» или «критический», а также повышение важности до них приходят тем, кто управляет сигналами проекта (категория
--    «Эскалации», объект — сам сигнал); назначенный на сигнал получает уведомление «Вам назначен сигнал».
-- 3. Автоповестка `signals_high`: в оперативное и еженедельное совещание при его создании добавляется пункт «Важные сигналы проекта» со списком открытых
--    важных и критических сигналов. Пункты общие для участников, поэтому внутренние типы совещаний; в совещаниях с заказчиком и приёмке пункт не создаётся.
-- См. docs: 04-modules/10-analytics-signals.md.

create table public.signal_settings (
  project_id uuid not null references public.projects(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  rule       text not null,
  enabled    boolean not null default true,
  params     jsonb not null default '{}',
  updated_by uuid default auth.uid() references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, rule)
);
alter table public.signal_settings enable row level security;
alter table public.signal_settings force row level security;
revoke insert, update, delete on public.signal_settings from authenticated;
create policy signal_settings_select on public.signal_settings for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and private.has_project_permission(project_id, 'signal.view'));

create or replace function private.sig_enabled(p_project uuid, p_rule text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.signal_settings s where s.project_id = p_project and s.rule = p_rule), true);
$$;

create or replace function private.sig_param(p_project uuid, p_rule text, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.params ->> p_key)::numeric from public.signal_settings s where s.project_id = p_project and s.rule = p_rule), p_default);
$$;

-- Каталог: правило → параметр → [по умолчанию, минимум, максимум]. Значения по умолчанию совпадают с прежними зашитыми порогами.
create or replace function private.signal_catalog() returns jsonb
language sql immutable as $$
  select '{
    "task_blocked":              {"hours": [24, 1, 240]},
    "critical_activity_overdue": {},
    "negative_float":            {},
    "schedule_stale":            {"days": [10, 3, 60]},
    "milestone_slip":            {"warn_days": [7, 1, 60], "high_days": [21, 2, 120]},
    "baseline_missing":          {},
    "spi_low_sustained":         {"spi": [0.85, 0.3, 1]},
    "cpi_low_sustained":         {"cpi": [0.90, 0.3, 1]},
    "forecast_divergence":       {"days": [20, 5, 120]},
    "ppc_low":                   {"percent": [60, 10, 95]},
    "recurring_reason":          {},
    "constraint_overdue":        {},
    "lookahead_not_ready":       {"ready_percent": [70, 10, 100]},
    "commitment_unready":        {"unready_percent": [30, 5, 90]},
    "period_not_closed":         {},
    "overdue_cluster":           {"count": [5, 1, 50], "high_count": [10, 2, 100]},
    "unassigned_tasks":          {"count": [5, 1, 100], "days": [2, 1, 30]},
    "minutes_late":              {"hours": [24, 1, 240]},
    "rfi_sla_breach":            {"days": [5, 1, 60]},
    "eac_over_budget":           {"warn_pct": [2, 0.5, 50], "high_pct": [5, 1, 60], "critical_pct": [10, 2, 100]},
    "line_overcommitted":        {},
    "tcpi_unrealistic":          {"tcpi": [1.10, 1.0, 2.0]},
    "costs_not_recorded":        {"days": [30, 7, 120]},
    "daily_log_missing":         {},
    "activity_without_budget":   {"coverage_percent": [80, 10, 100]},
    "weather_risk":              {},
    "notify_signals":            {},
    "agenda_signals_high":       {}
  }'::jsonb;
$$;

-- Выключенное правило не поднимается (и, не попав в «увиденные», закрывается при пересчёте)
create or replace function private.emit_signal(
  p_project uuid, p_rule text, p_key text, p_severity text, p_title text, p_facts jsonb, p_evidence jsonb, p_rule_text text, p_actions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cur public.signals;
begin
  if not private.sig_enabled(p_project, p_rule) then return; end if;
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

-- ---------------------------------------------------------------------------
-- Движок правил с порогами проекта
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
       where project_id = p_project and deleted_at is null and status_category = 'blocked' and updated_at < now() - make_interval(hours => private.sig_param(p_project, 'task_blocked', 'hours', 24)::integer)) t;
  if n > 0 then
    perform private.emit_signal(p_project, 'task_blocked', 'task_blocked', case when hi then 'high' else 'warning' end, format('Заблокированных задач дольше %s ч: %s', private.sig_param(p_project, 'task_blocked', 'hours', 24)::integer, n),
      jsonb_build_array(jsonb_build_object('label', 'Заблокировано дольше порога', 'value', n)), ev, format('Задача в статусе «заблокировано» дольше %s ч', private.sig_param(p_project, 'task_blocked', 'hours', 24)::integer), '[{"type":"create_task","title":"Снять блокировку задач"},{"type":"add_to_agenda"},{"type":"assign"}]');
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
         and greatest(a.actual_start, coalesce((select max(entry_date) from public.progress_entries e where e.activity_id = a.id and e.status = 'approved'), a.actual_start)) < today - private.sig_param(p_project, 'schedule_stale', 'days', 10)::integer) t;
  if n > 0 then
    perform private.emit_signal(p_project, 'schedule_stale', 'schedule_stale', 'warning', format('По %s идущим работам нет факта больше %s дн.', n, private.sig_param(p_project, 'schedule_stale', 'days', 10)::integer),
      jsonb_build_array(jsonb_build_object('label', 'Работ без свежего факта', 'value', n)), ev, format('Работа начата и не закончена, а факт не вводился более %s дней', private.sig_param(p_project, 'schedule_stale', 'days', 10)::integer),
      '[{"type":"create_task","title":"Обновить факт по работам"},{"type":"assign"}]');
  end if;

  -- 5. сдвиг вех относительно базового плана
  if v_base is not null then
    select max(a.start_date - bsa.start_date), count(*) filter (where a.start_date - bsa.start_date > private.sig_param(p_project, 'milestone_slip', 'warn_days', 7)),
           coalesce(jsonb_agg(jsonb_build_object('type', 'activity', 'id', a.id, 'title', a.name || ' (+' || (a.start_date - bsa.start_date) || ' дн.)')) filter (where a.start_date - bsa.start_date > private.sig_param(p_project, 'milestone_slip', 'warn_days', 7)), '[]')
      into m, n, ev
      from public.schedule_activities a join public.schedule_baseline_activities bsa on bsa.activity_id = a.id and bsa.baseline_id = v_base
     where a.project_id = p_project and a.deleted_at is null and a.kind = 'milestone' and a.percent_complete < 100;
    if n > 0 then
      perform private.emit_signal(p_project, 'milestone_slip', 'milestone_slip', case when m > private.sig_param(p_project, 'milestone_slip', 'high_days', 21) then 'high' else 'warning' end, format('Вехи сдвинуты относительно базового плана: %s', n),
        jsonb_build_array(jsonb_build_object('label', 'Максимальный сдвиг, дн.', 'value', m), jsonb_build_object('label', 'Вех со сдвигом выше порога', 'value', n)), ev,
        format('Прогнозная дата вехи позже базового плана более чем на %s дн.', private.sig_param(p_project, 'milestone_slip', 'warn_days', 7)::integer), '[{"type":"create_task","title":"Разобрать сдвиг вех"},{"type":"add_to_agenda"},{"type":"assign"}]');
    end if;
  elsif exists (select 1 from public.projects where id = p_project and status = 'active') and exists (select 1 from public.schedule_activities where project_id = p_project and deleted_at is null) then
    perform private.emit_signal(p_project, 'baseline_missing', 'baseline_missing', 'high', 'Нет базового плана',
      '[]', '[]', 'График есть, а базового плана нет: нельзя считать плановую стоимость и отставание', '[{"type":"create_task","title":"Утвердить базовый план"},{"type":"assign"}]');
  end if;

  -- 6. устойчиво низкий SPI(t)/SPI и CPI по последним двум снимкам
  select count(*), count(*) filter (where coalesce(nullif(metrics ->> 'spit', ''), nullif(metrics ->> 'spi', ''))::numeric < private.sig_param(p_project, 'spi_low_sustained', 'spi', 0.85)),
         count(*) filter (where nullif(metrics ->> 'cpi', '')::numeric < private.sig_param(p_project, 'cpi_low_sustained', 'cpi', 0.9))
    into n, m, k from (select metrics from public.snapshots where project_id = p_project order by status_date desc, created_at desc limit 2) s;
  if n = 2 and m = 2 then
    perform private.emit_signal(p_project, 'spi_low_sustained', 'spi_low_sustained', 'high', 'Индекс сроков ниже допуска два снимка подряд',
      jsonb_build_array(jsonb_build_object('label', 'SPI(t) сейчас', 'value', coalesce(v_evm ->> 'spit', v_evm ->> 'spi'))), '[]',
      format('SPI(t) ниже %s в двух последних снимках', replace(private.sig_param(p_project, 'spi_low_sustained', 'spi', 0.85)::text, '.', ',')), '[{"type":"create_task","title":"Разобрать причины отставания по срокам"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;
  if n = 2 and k = 2 then
    perform private.emit_signal(p_project, 'cpi_low_sustained', 'cpi_low_sustained', 'high', 'Индекс стоимости ниже допуска два снимка подряд',
      jsonb_build_array(jsonb_build_object('label', 'CPI сейчас', 'value', v_evm ->> 'cpi')), '[]',
      format('CPI ниже %s в двух последних снимках', replace(private.sig_param(p_project, 'cpi_low_sustained', 'cpi', 0.9)::text, '.', ',')), '[{"type":"create_task","title":"Разобрать перерасход по статьям"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 7. расхождение прогнозов окончания (CPM и Earned Schedule)
  select max(finish_date) into v_last from public.schedule_activities where project_id = p_project and deleted_at is null and kind = 'task';
  if v_last is not null and (v_evm ->> 'forecast_finish') is not null and abs((v_evm ->> 'forecast_finish')::date - v_last) > private.sig_param(p_project, 'forecast_divergence', 'days', 20) then
    perform private.emit_signal(p_project, 'forecast_divergence', 'forecast_divergence', 'warning', format('Прогнозы окончания расходятся больше чем на %s дн.', private.sig_param(p_project, 'forecast_divergence', 'days', 20)::integer),
      jsonb_build_array(jsonb_build_object('label', 'По графику (CPM)', 'value', v_last), jsonb_build_object('label', 'По освоенному объёму (ES)', 'value', v_evm ->> 'forecast_finish')), '[]',
      format('Прогноз по графику и по освоению отличаются более чем на %s дн.: проверьте актуальность графика и факта', private.sig_param(p_project, 'forecast_divergence', 'days', 20)::integer), '[{"type":"create_task","title":"Сверить график и факт"},{"type":"assign"}]');
  end if;

  -- 8. PPC ниже допуска две недели подряд
  with per as (select id, starts_on from public.planning_periods where project_id = p_project and status = 'closed' order by starts_on desc limit 2),
       p as (select per.id, 100.0 * count(*) filter (where c.result = 'completed') / nullif(count(*), 0) as ppc
               from per join public.period_commitments c on c.period_id = per.id and not c.added_late group by per.id)
  select count(*), count(*) filter (where ppc < private.sig_param(p_project, 'ppc_low', 'percent', 60)), round(avg(ppc)) into n, m, k from p;
  if n = 2 and m = 2 then
    perform private.emit_signal(p_project, 'ppc_low', 'ppc_low', 'high', format('PPC ниже %s%% две недели подряд', private.sig_param(p_project, 'ppc_low', 'percent', 60)::integer),
      jsonb_build_array(jsonb_build_object('label', 'Среднее PPC двух недель, %', 'value', k)), '[]', format('Выполнено меньше %s%% обязательств две закрытые недели подряд', private.sig_param(p_project, 'ppc_low', 'percent', 60)::integer),
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
  if n >= 3 and m::numeric / n < private.sig_param(p_project, 'lookahead_not_ready', 'ready_percent', 70) / 100.0 then
    perform private.emit_signal(p_project, 'lookahead_not_ready', 'lookahead_not_ready', 'warning', format('Готово к старту только %s из %s работ ближайших двух недель', m, n),
      jsonb_build_array(jsonb_build_object('label', 'Работ стартует за 2 недели', 'value', n), jsonb_build_object('label', 'Из них готовы', 'value', m)), '[]',
      format('Меньше %s%% работ ближайших двух недель проверены и свободны от ограничений', private.sig_param(p_project, 'lookahead_not_ready', 'ready_percent', 70)::integer), '[{"type":"create_task","title":"Провести сессию подготовки работ (make-ready)"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 12. обязательства недели взяты по неготовым работам
  select count(*) filter (where not c.added_late), count(*) filter (where not c.added_late and not c.was_ready) into n, m
    from public.period_commitments c where c.period_id = (select p.id from public.planning_periods p where p.project_id = p_project
        and exists (select 1 from public.period_commitments x where x.period_id = p.id) order by p.starts_on desc limit 1);
  if n >= 3 and m::numeric / n > private.sig_param(p_project, 'commitment_unready', 'unready_percent', 30) / 100.0 then
    perform private.emit_signal(p_project, 'commitment_unready', 'commitment_unready', 'warning', format('Неготовые работы в плане недели: %s из %s', m, n),
      jsonb_build_array(jsonb_build_object('label', 'Обязательств по неготовым работам', 'value', m)), '[]', format('Больше %s%% обязательств последней недели взяты по работам с ограничениями или незавершённым предшественником', private.sig_param(p_project, 'commitment_unready', 'unready_percent', 30)::integer),
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
             join public.users u on u.id = t.assignee_id group by t.assignee_id, u.full_name having count(*) > private.sig_param(p_project, 'overdue_cluster', 'count', 5) loop
    perform private.emit_signal(p_project, 'overdue_cluster', 'overdue_cluster:' || r.assignee_id, case when r.c > private.sig_param(p_project, 'overdue_cluster', 'high_count', 10) then 'high' else 'warning' end,
      format('У исполнителя %s просрочено задач: %s', r.full_name, r.c), jsonb_build_array(jsonb_build_object('label', 'Просроченных задач', 'value', r.c)), r.ev,
      format('У одного исполнителя больше %s просроченных задач', private.sig_param(p_project, 'overdue_cluster', 'count', 5)::integer), '[{"type":"create_task","title":"Разобрать просроченные задачи исполнителя"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end loop;

  -- 15. задачи без исполнителя
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', key, 'title', title)) filter (where rn <= 5), '[]') into n, ev
    from (select key, title, row_number() over (order by created_at) rn from public.tasks where project_id = p_project and deleted_at is null
           and status_category not in ('done', 'cancelled') and assignee_id is null and type in ('task', 'punch') and created_at < now() - make_interval(days => private.sig_param(p_project, 'unassigned_tasks', 'days', 2)::integer)) t;
  if n > private.sig_param(p_project, 'unassigned_tasks', 'count', 5) then
    perform private.emit_signal(p_project, 'unassigned_tasks', 'unassigned_tasks', 'info', format('Задач без исполнителя больше %s дн.: %s', private.sig_param(p_project, 'unassigned_tasks', 'days', 2)::integer, n),
      jsonb_build_array(jsonb_build_object('label', 'Без исполнителя', 'value', n)), ev, format('Больше %s задач висят без исполнителя дольше %s дн.', private.sig_param(p_project, 'unassigned_tasks', 'count', 5)::integer, private.sig_param(p_project, 'unassigned_tasks', 'days', 2)::integer), '[{"type":"create_task","title":"Назначить исполнителей на задачи"},{"type":"assign"}]');
  end if;

  -- 16. протокол совещания не опубликован
  select count(*) into n from public.meetings where project_id = p_project and status in ('in_progress', 'minutes_draft')
     and scheduled_at + make_interval(mins => duration_min) < now() - make_interval(hours => private.sig_param(p_project, 'minutes_late', 'hours', 24)::integer);
  if n > 0 then
    perform private.emit_signal(p_project, 'minutes_late', 'minutes_late', 'warning', format('Протокол не опубликован дольше %s ч: %s', private.sig_param(p_project, 'minutes_late', 'hours', 24)::integer, n),
      jsonb_build_array(jsonb_build_object('label', 'Совещаний без протокола', 'value', n)), '[]', format('Совещание закончилось, а протокол не опубликован более %s ч', private.sig_param(p_project, 'minutes_late', 'hours', 24)::integer), '[{"type":"create_task","title":"Опубликовать протокол совещания"},{"type":"assign"}]');
  end if;

  -- 17. запрос на информацию (RFI) без ответа
  select count(*), coalesce(jsonb_agg(jsonb_build_object('type', 'task', 'key', key, 'title', title)) filter (where rn <= 5), '[]') into n, ev
    from (select key, title, row_number() over (order by created_at) rn from public.tasks where project_id = p_project and deleted_at is null
           and status_category not in ('done', 'cancelled') and type = 'rfi' and created_at < now() - make_interval(days => private.sig_param(p_project, 'rfi_sla_breach', 'days', 5)::integer)) t;
  if n > 0 then
    perform private.emit_signal(p_project, 'rfi_sla_breach', 'rfi_sla_breach', 'warning', format('RFI без ответа дольше %s дн.: %s', private.sig_param(p_project, 'rfi_sla_breach', 'days', 5)::integer, n),
      jsonb_build_array(jsonb_build_object('label', 'RFI без ответа', 'value', n)), ev, format('Запрос открыт дольше срока ответа (%s дн.)', private.sig_param(p_project, 'rfi_sla_breach', 'days', 5)::integer), '[{"type":"create_task","title":"Получить ответы на RFI"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 18. прогноз стоимости выше бюджета
  if (v_bud ->> 'bac')::numeric > 0 and (v_bud ->> 'eac')::numeric > (v_bud ->> 'bac')::numeric * (1 + private.sig_param(p_project, 'eac_over_budget', 'warn_pct', 2) / 100.0) then
    m := round(100 * ((v_bud ->> 'eac')::numeric / (v_bud ->> 'bac')::numeric - 1));
    perform private.emit_signal(p_project, 'eac_over_budget', 'eac_over_budget', case when m > private.sig_param(p_project, 'eac_over_budget', 'critical_pct', 10) then 'critical' when m > private.sig_param(p_project, 'eac_over_budget', 'high_pct', 5) then 'high' else 'warning' end,
      format('Прогноз затрат выше бюджета на %s%%', m),
      jsonb_build_array(jsonb_build_object('label', 'Бюджет', 'value', (v_bud ->> 'bac')::numeric), jsonb_build_object('label', 'Прогноз (EAC)', 'value', (v_bud ->> 'eac')::numeric)), '[]',
      format('Прогноз затрат при завершении превышает текущий бюджет более чем на %s%%', private.sig_param(p_project, 'eac_over_budget', 'warn_pct', 2)), '[{"type":"create_task","title":"Подготовить меры по экономии или изменение бюджета"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 19. обязательства по статье больше её бюджета
  if jsonb_array_length(v_bud -> 'over') > 0 then
    perform private.emit_signal(p_project, 'line_overcommitted', 'line_overcommitted', 'high', format('Обязательства превышают бюджет по статьям: %s', jsonb_array_length(v_bud -> 'over')),
      jsonb_build_array(jsonb_build_object('label', 'Статей с превышением', 'value', jsonb_array_length(v_bud -> 'over'))),
      (select coalesce(jsonb_agg(jsonb_build_object('type', 'budget_item', 'title', x ->> 'code' || ' ' || (x ->> 'name'))), '[]') from jsonb_array_elements(v_bud -> 'over') x),
      'Сумма договоров по статье больше бюджета статьи', '[{"type":"create_task","title":"Перераспределить бюджет или пересмотреть договоры"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;

  -- 20. требуемая эффективность нереалистична
  if nullif(v_evm ->> 'tcpi', '') is not null and (v_evm ->> 'tcpi')::numeric > private.sig_param(p_project, 'tcpi_unrealistic', 'tcpi', 1.1) then
    perform private.emit_signal(p_project, 'tcpi_unrealistic', 'tcpi_unrealistic', 'warning', 'Уложиться в бюджет при текущей эффективности нереально',
      jsonb_build_array(jsonb_build_object('label', 'TCPI', 'value', v_evm ->> 'tcpi'), jsonb_build_object('label', 'CPI сейчас', 'value', v_evm ->> 'cpi')), '[]',
      format('Требуемый CPI на остаток выше %s', replace(private.sig_param(p_project, 'tcpi_unrealistic', 'tcpi', 1.1)::text, '.', ',')), '[{"type":"create_task","title":"Пересмотреть стоимость остатка работ"},{"type":"assign"}]');
  end if;

  -- 21. нет факта затрат при идущих работах
  if coalesce((v_evm ->> 'ev')::numeric, 0) > 0 and not exists (select 1 from public.budget_actuals where project_id = p_project and deleted_at is null and doc_date >= today - private.sig_param(p_project, 'costs_not_recorded', 'days', 30)::integer) then
    perform private.emit_signal(p_project, 'costs_not_recorded', 'costs_not_recorded', 'warning', format('Факт затрат не вносился больше %s дн.', private.sig_param(p_project, 'costs_not_recorded', 'days', 30)::integer),
      jsonb_build_array(jsonb_build_object('label', 'Освоено, ₽', 'value', (v_evm ->> 'ev')::numeric)), '[]', format('Работы выполняются, а затраты за %s дн. не внесены: показатели стоимости недостоверны', private.sig_param(p_project, 'costs_not_recorded', 'days', 30)::integer),
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
  if (v_evm ->> 'total_budget')::numeric > 0 and coalesce((v_evm ->> 'coverage')::numeric, 0) < private.sig_param(p_project, 'activity_without_budget', 'coverage_percent', 80) / 100.0 and exists (select 1 from public.schedule_activities where project_id = p_project and deleted_at is null) then
    perform private.emit_signal(p_project, 'activity_without_budget', 'activity_without_budget', 'warning', 'Бюджет не распределён по работам графика',
      jsonb_build_array(jsonb_build_object('label', 'Охват бюджета', 'value', coalesce(round(100 * (v_evm ->> 'coverage')::numeric), 0) || '%')), '[]',
      format('Менее %s%% бюджета закреплено за работами: освоенный объём и индексы считаются неполно', private.sig_param(p_project, 'activity_without_budget', 'coverage_percent', 80)::integer), '[{"type":"create_task","title":"Распределить бюджет по работам"},{"type":"assign"}]');
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


-- ---------------------------------------------------------------------------
-- Настройки: чтение и запись
-- ---------------------------------------------------------------------------
create or replace function public.signal_rules(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.week_guard(p_project, array['signal.view']);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'rule', c.key,
             'enabled', coalesce(s.enabled, true),
             'params', coalesce((
               select jsonb_object_agg(p.key, jsonb_build_object(
                        'value', coalesce((s.params ->> p.key)::numeric, (p.value ->> 0)::numeric),
                        'default', (p.value ->> 0)::numeric, 'min', (p.value ->> 1)::numeric, 'max', (p.value ->> 2)::numeric))
                 from jsonb_each(c.value) p), '{}'::jsonb)
           ) order by c.key), '[]'::jsonb)
      from jsonb_each(private.signal_catalog()) c
      left join public.signal_settings s on s.project_id = p_project and s.rule = c.key);
end;
$$;

create or replace function public.signal_rule_set(p_project uuid, p_rule text, p_enabled boolean, p_params jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  c       jsonb := private.signal_catalog() -> p_rule;
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_all   jsonb;
  k       text;
  v       numeric;
begin
  perform private.week_guard(p_project, array['signal.manage']);
  if c is null then raise exception 'unknown_rule' using errcode = '22023'; end if;
  if jsonb_typeof(v_params) <> 'object' then raise exception 'invalid_param' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(v_params) loop
    if not (c ? k) then raise exception 'unknown_param' using errcode = '22023'; end if;
    begin
      v := (v_params ->> k)::numeric;
    exception when others then
      raise exception 'invalid_param' using errcode = '22023';
    end;
    if v is null or v < (c -> k ->> 1)::numeric or v > (c -> k ->> 2)::numeric then
      raise exception 'param_out_of_range' using errcode = '22023';
    end if;
  end loop;

  -- согласованность порогов: «важно» строго выше «предупреждения»
  select coalesce(jsonb_object_agg(p.key, to_jsonb((p.value ->> 0)::numeric)), '{}'::jsonb) into v_all from jsonb_each(c) p;
  v_all := v_all || v_params;
  if p_rule = 'milestone_slip' and (v_all ->> 'high_days')::numeric <= (v_all ->> 'warn_days')::numeric then
    raise exception 'params_inconsistent' using errcode = '22023';
  end if;
  if p_rule = 'overdue_cluster' and (v_all ->> 'high_count')::numeric <= (v_all ->> 'count')::numeric then
    raise exception 'params_inconsistent' using errcode = '22023';
  end if;
  if p_rule = 'eac_over_budget' and not ((v_all ->> 'warn_pct')::numeric < (v_all ->> 'high_pct')::numeric and (v_all ->> 'high_pct')::numeric < (v_all ->> 'critical_pct')::numeric) then
    raise exception 'params_inconsistent' using errcode = '22023';
  end if;

  insert into public.signal_settings (project_id, tenant_id, rule, enabled, params, updated_by, updated_at)
  select p_project, pr.tenant_id, p_rule, coalesce(p_enabled, true), v_params, auth.uid(), now() from public.projects pr where pr.id = p_project
  on conflict (project_id, rule) do update set enabled = excluded.enabled, params = excluded.params, updated_by = auth.uid(), updated_at = now();
  perform private.evaluate_core(p_project);
end;
$$;

-- Вернуть правило к значениям по умолчанию
create or replace function public.signal_rule_reset(p_project uuid, p_rule text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.week_guard(p_project, array['signal.manage']);
  delete from public.signal_settings where project_id = p_project and rule = p_rule;
  perform private.evaluate_core(p_project);
end;
$$;

revoke execute on function public.signal_rules(uuid), public.signal_rule_set(uuid, text, boolean, jsonb), public.signal_rule_reset(uuid, text) from public, anon;
grant  execute on function public.signal_rules(uuid), public.signal_rule_set(uuid, text, boolean, jsonb), public.signal_rule_reset(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Сигнал как объект уведомлений
-- ---------------------------------------------------------------------------
insert into public.entity_types (code, module, features) values ('signal', 'analytics', '{}') on conflict (code) do nothing;

create or replace function private.entity_project_id(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id and tenant_id = private.tenant_id())
    when 'task'     then (select project_id from public.tasks where id = p_id and tenant_id = private.tenant_id())
    when 'location' then (select project_id from public.locations where id = p_id and tenant_id = private.tenant_id())
    when 'document' then (select project_id from public.documents where id = p_id and tenant_id = private.tenant_id())
    when 'meeting'  then (select project_id from public.meetings where id = p_id and tenant_id = private.tenant_id())
    when 'signal'   then (select project_id from public.signals where id = p_id and tenant_id = private.tenant_id())
  end;
$$;

create or replace function private.entity_project_id_any(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'project'  then (select id from public.projects where id = p_id)
    when 'task'     then (select project_id from public.tasks where id = p_id)
    when 'location' then (select project_id from public.locations where id = p_id)
    when 'document' then (select project_id from public.documents where id = p_id)
    when 'meeting'  then (select project_id from public.meetings where id = p_id)
    when 'ffe_item' then (select project_id from public.ffe_items where id = p_id)
    when 'signal'   then (select project_id from public.signals where id = p_id)
  end;
$$;

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
    else false
  end;
$$;

create or replace function private.entity_display(p_type text, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'task' then (
      select jsonb_build_object('key', t.key, 'title', t.title, 'project_code', p.code)
        from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_id)
    when 'project' then (
      select jsonb_build_object('key', p.code, 'title', p.name, 'project_code', p.code)
        from public.projects p where p.id = p_id)
    when 'location' then (
      select jsonb_build_object('key', l.path::text, 'title', l.name, 'project_code', p.code)
        from public.locations l join public.projects p on p.id = l.project_id where l.id = p_id)
    when 'document' then (
      select jsonb_build_object('key', coalesce(d.code, 'Документ'), 'title', d.title, 'project_code', p.code)
        from public.documents d join public.projects p on p.id = d.project_id where d.id = p_id)
    when 'meeting' then (
      select jsonb_build_object('key', m.key, 'title', m.title, 'project_code', p.code)
        from public.meetings m join public.projects p on p.id = m.project_id where m.id = p_id)
    when 'signal' then (
      select jsonb_build_object('key', 'Сигнал', 'title', s.title, 'project_code', p.code)
        from public.signals s join public.projects p on p.id = s.project_id where s.id = p_id)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Уведомления о сигналах
-- ---------------------------------------------------------------------------
create or replace function private.signals_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sev  text[] := array['info', 'warning', 'high', 'critical'];
  v_up   boolean;
  v_new  boolean;
  r      record;
begin
  if tg_op = 'INSERT' then
    v_new := new.status = 'open' and new.severity in ('high', 'critical');
    v_up := v_new;
  else
    v_new := new.status = 'open' and new.severity in ('high', 'critical') and old.status <> 'open';
    v_up := new.status = 'open' and new.severity in ('high', 'critical')
            and (old.status <> 'open' or array_position(v_sev, new.severity) > array_position(v_sev, old.severity));
    if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id and new.status = 'open' then
      perform private.notify(new.assignee_id, 'signal', new.id, 'assigned', 'high', 'assigned', 'Вам назначен сигнал', true);
    end if;
  end if;

  if v_up and private.sig_enabled(new.project_id, 'notify_signals') then
    for r in
      select pm.user_id from public.project_members pm
       where pm.project_id = new.project_id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
         and private.user_has_project_permission(pm.user_id, new.project_id, 'signal.manage')
    loop
      perform private.notify(r.user_id, 'signal', new.id, 'escalation',
        case new.severity when 'critical' then 'critical' else 'high' end, 'raised',
        case when tg_op = 'INSERT' or v_new then
               case new.severity when 'critical' then 'Новый критический сигнал' else 'Новый важный сигнал' end
             else
               case new.severity when 'critical' then 'Важность сигнала повышена до критической' else 'Важность сигнала повышена до высокой' end
        end, true);
    end loop;
  end if;
  return null;
end;
$$;
create trigger signals_notify after insert or update of severity, status, assignee_id on public.signals
  for each row execute function private.signals_notify();

-- ---------------------------------------------------------------------------
-- Автоповестка `signals_high`
-- ---------------------------------------------------------------------------
create or replace function private.meetings_signals_agenda() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_n     integer;
  v_notes text;
begin
  if new.type not in ('operational', 'weekly') or not private.sig_enabled(new.project_id, 'agenda_signals_high') then return null; end if;
  select count(*) into v_n from public.signals where project_id = new.project_id and status = 'open' and severity in ('high', 'critical');
  if v_n = 0 then return null; end if;
  select string_agg(case severity when 'critical' then '— критический: ' else '— важный: ' end || title, E'\n' order by (severity = 'critical') desc, first_seen_at)
    into v_notes
    from (select severity, title, first_seen_at from public.signals
           where project_id = new.project_id and status = 'open' and severity in ('high', 'critical')
           order by (severity = 'critical') desc, first_seen_at limit 10) s;
  insert into public.meeting_agenda_items (tenant_id, project_id, meeting_id, sort, title, notes, duration_min)
  values (new.tenant_id, new.project_id, new.id, 1000, format('Важные сигналы проекта: %s', v_n), v_notes, 10);
  return null;
end;
$$;
create trigger meetings_signals_agenda after insert on public.meetings
  for each row execute function private.meetings_signals_agenda();

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
notify pgrst, 'reload schema';
