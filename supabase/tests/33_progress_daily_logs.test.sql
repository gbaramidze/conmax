-- Требует сид-данных. Прогресс по методам, подтверждение, фактические даты; журнал дня.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
delete from public.schedule_activities where project_id = :'zk7';
delete from public.daily_logs where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Кладка', 5) returning id as a \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Бетонирование', 3) returning id as b \gset
insert into public.schedule_activities (project_id, name, duration_days) values (:'zk7', 'Приёмка', 2) returning id as c \gset
insert into public.schedule_activities (project_id, name, kind) values (:'zk7', 'Группа', 'summary') returning id as g \gset
select public.set_progress_method(:'b', 'quantity', 200, 'м³');
select public.set_progress_method(:'c', 'zero_hundred');
select throws_ok(format($$select public.set_progress_method(%L, 'quantity')$$, :'a'), '22023', 'plan_quantity_required', 'для объёма нужен плановый объём');

-- ---- методы ----
select public.report_progress(:'a', current_date, 40, 'выложено 2 этажа');
select is((select percent_complete from public.schedule_activities where id = :'a'), 40.00, 'ручной ввод: процент применён');
select ok((select actual_start from public.schedule_activities where id = :'a') = current_date, 'первый ввод ставит фактическое начало');
select throws_ok(format($$select public.report_progress(%L, current_date, 30)$$, :'a'), '22023', 'comment_required', 'уменьшение процента — только с комментарием');
select throws_ok(format($$select public.report_progress(%L, current_date, 120, 'x')$$, :'a'), '22023', 'bad_value', 'процент больше 100 отклоняется');
select public.report_progress(:'b', current_date, 50);
select is((select percent_complete from public.schedule_activities where id = :'b'), 25.00, 'объём 50 из 200 = 25%');
select public.report_progress(:'c', current_date, 100);
select is((select percent_complete || '/' || (actual_finish is not null) from public.schedule_activities where id = :'c'), '100.00/true', '«закончена» ставит 100% и фактическое окончание');
select throws_ok(format($$select public.report_progress(%L, current_date, 40)$$, :'c'), '22023', 'bad_value', 'для «0/100» допустимы только 0 и 100');
select throws_ok(format($$select public.report_progress(%L, current_date, 10, 'x')$$, :'g'), 'P0002', 'activity_not_found', 'по суммарной работе факт не вводится');
select pg_temp.back();

-- ---- подтверждение ----
select pg_temp.act_as('master@demo.test');
select public.report_progress(:'a', current_date, 70, 'вторая смена') as e1 \gset
select is((select percent_complete from public.schedule_activities where id = :'a'), 40.00, 'запись мастера ждёт подтверждения и в расчёт не идёт');
select is((select status from public.progress_entries where id = :'e1'), 'pending', 'статус «ожидает»');
select throws_ok(format($$select public.decide_progress(%L, true)$$, :'e1'), '42501', null, 'мастер подтвердить не может');
select pg_temp.back();
select pg_temp.act_as('pto@demo.test');
select public.decide_progress(:'e1', true);
select is((select percent_complete from public.schedule_activities where id = :'a'), 70.00, 'после подтверждения процент применён');
select pg_temp.back();

-- ---- журнал дня ----
select pg_temp.act_as('foreman1@demo.test');
select public.save_daily_log(:'zk7', current_date, '{"weather":"ясно","temperature_c":12,"manpower":[{"organization":"СтройКладка","profession":"каменщик","count":8}],"works":"кладка 2 этажа"}'::jsonb) as lg \gset
select public.submit_daily_log(:'lg');
select throws_ok(format($$select public.save_daily_log(%L, current_date, '{"works":"правка"}'::jsonb)$$, :'zk7'), '23514', 'log_locked', 'отправленный журнал править нельзя');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.daily_logs), 0, 'внешние журнал не видят');
select pg_temp.back();

select * from finish();
rollback;
