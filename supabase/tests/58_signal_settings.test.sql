-- Требует сид-данных. Пороги правил на проект, выключение правил, уведомления о важных сигналах, автоповестка signals_high.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset

-- 1. каталог и права
select pg_temp.act_as('pm1@demo.test');
select ok(jsonb_array_length(public.signal_rules(:'zk7')) >= 26, 'каталог правил отдаёт все правила');
select is((select (r -> 'params' -> 'hours' ->> 'value')::numeric from jsonb_array_elements(public.signal_rules(:'zk7')) r where r ->> 'rule' = 'task_blocked'), 24::numeric, 'без настройки действует прежний порог');
select throws_ok(format($$select public.signal_rule_set(%L, 'task_blocked', true, '{"days": 3}')$$, :'zk7'), '22023', 'unknown_param', 'чужой параметр отвергается');
select throws_ok(format($$select public.signal_rule_set(%L, 'task_blocked', true, '{"hours": 9999}')$$, :'zk7'), '22023', 'param_out_of_range', 'значение вне границ отвергается');
select throws_ok(format($$select public.signal_rule_set(%L, 'milestone_slip', true, '{"warn_days": 30, "high_days": 20}')$$, :'zk7'), '22023', 'params_inconsistent', '«важно» должно быть строже «предупреждения»');
select throws_ok(format($$select public.signal_rule_set(%L, 'no_such_rule', true, '{}')$$, :'zk7'), '22023', 'unknown_rule', 'неизвестное правило отвергается');
select lives_ok(format($$select public.signal_rule_set(%L, 'task_blocked', true, '{"hours": 48}')$$, :'zk7'), 'руководитель задаёт порог');
select is((select (r -> 'params' -> 'hours' ->> 'value')::numeric from jsonb_array_elements(public.signal_rules(:'zk7')) r where r ->> 'rule' = 'task_blocked'), 48::numeric, 'порог сохранён');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.signal_rule_set(%L, 'task_blocked', false, '{}')$$, :'zk7'), '42501', null, 'без права управлять сигналами менять нельзя');
select pg_temp.back();

-- чистое поле для проверки поднятия сигналов и уведомлений
delete from public.signals where project_id = :'zk7';
delete from public.notifications where entity_type = 'signal';

-- 2. выключенное правило не поднимается
select pg_temp.act_as('pm1@demo.test');
select public.signal_rule_set(:'zk7', 'negative_float', false, '{}');
select pg_temp.back();
select private.emit_signal(:'zk7', 'negative_float', 'negative_float', 'high', 'Отрицательный резерв', '[]', '[]', 'тест', '[]');
select is((select count(*)::int from public.signals where project_id = :'zk7' and rule = 'negative_float'), 0, 'выключенное правило сигнал не поднимает');
select pg_temp.act_as('pm1@demo.test');
select public.signal_rule_reset(:'zk7', 'negative_float');
select pg_temp.back();

-- 3. уведомления: важный — да, предупреждение — нет, повышение — да
delete from public.signals where project_id = :'zk7';
delete from public.notifications where entity_type = 'signal';
select private.emit_signal(:'zk7', 'task_blocked', 'task_blocked', 'high', 'Заблокированные задачи', '[]', '[]', 'тест', '[]');
select private.emit_signal(:'zk7', 'schedule_stale', 'schedule_stale', 'warning', 'График не обновляется', '[]', '[]', 'тест', '[]');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and entity_type = 'signal' and priority = 'high'), 1, 'важный сигнал уведомил руководителя');
select is((select count(*)::int from public.notifications n join public.signals s on s.id = n.entity_id where s.rule = 'schedule_stale'), 0, 'предупреждение не уведомляет');
select is((select count(*)::int from public.notifications where entity_type = 'signal' and user_id = :'gip'), 0, 'тем, кто не управляет сигналами, уведомления не идут');
select private.emit_signal(:'zk7', 'schedule_stale', 'schedule_stale', 'critical', 'График не обновляется', '[]', '[]', 'тест', '[]');
select is((select priority from public.notifications n join public.signals s on s.id = n.entity_id where s.rule = 'schedule_stale' and n.user_id = :'pm1'), 'critical', 'повышение до критического уведомило');

-- 4. автоповестка: оперативное совещание получает пункт, совещание с заказчиком — нет
insert into public.meetings (tenant_id, project_id, number, key, title, type, scheduled_at) values
  (:'tenant', :'zk7', 9101, 'ZK7-M-9101', 'Оперативка', 'operational', now() + interval '1 day'),
  (:'tenant', :'zk7', 9102, 'ZK7-M-9102', 'С заказчиком', 'client', now() + interval '1 day');
select is((select count(*)::int from public.meeting_agenda_items i join public.meetings m on m.id = i.meeting_id where m.number = 9101 and m.project_id = :'zk7' and i.title like 'Важные сигналы проекта: %'), 1, 'в оперативку добавлен пункт о важных сигналах');
select is((select count(*)::int from public.meeting_agenda_items i join public.meetings m on m.id = i.meeting_id where m.number = 9102 and m.project_id = :'zk7'), 0, 'в совещание с заказчиком — нет');

select * from finish();
rollback;
