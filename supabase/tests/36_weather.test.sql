-- Требует сид-данных. Погода: место объекта, права на запись, сигнал об опасной погоде.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
delete from public.project_weather where project_id = :'zk7';
delete from public.project_geo where project_id = :'zk7';
delete from public.signals where project_id = :'zk7';
delete from public.schedule_activities where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.set_project_geo(:'zk7', 55.7887, 49.1221, 'Казань');
select is((select place from public.project_geo where project_id = :'zk7'), 'Казань', 'руководитель проекта задаёт место объекта');
select throws_ok(format($$select public.set_project_geo(%L, 100, 49, 'x')$$, :'zk7'), '22023', 'bad_coords', 'широта вне диапазона отклоняется');
select throws_ok(format($$select public.weather_store(%L, '[]'::jsonb)$$, :'zk7'), '42501', null, 'записывать прогноз клиент не может (только воркер)');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.set_project_geo(%L, 55, 49, 'x')$$, :'zk7'), '42501', null, 'мастер место объекта менять не может');
select pg_temp.back();

-- воркер кладёт прогноз: завтра порывы 22 м/с; на объекте идёт работа
select public.weather_store(:'zk7', jsonb_build_array(jsonb_build_object('day', (current_date + 1)::text, 'code', 3, 'tmax', 8, 'tmin', 1, 'precip', 0, 'wind', 12, 'gust', 22)));
select is((select gust from public.project_weather where project_id = :'zk7' and day = current_date + 1), 22.0, 'прогноз сохранён по дням');

select pg_temp.act_as('pm1@demo.test');
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'zk7', 'Монтаж краном', 5, 'snet', current_date);
select public.recalculate_schedule(:'zk7');
select public.evaluate_signals(:'zk7');
select is((select severity from public.signals where project_id = :'zk7' and rule = 'weather_risk' and status = 'open'), 'high', 'порывы 22 м/с при идущих работах — важный сигнал');
-- прогноз стал спокойным: сигнал закрывается
select pg_temp.back();
update public.project_weather set gust = 5 where project_id = :'zk7';
select pg_temp.act_as('pm1@demo.test');
select public.evaluate_signals(:'zk7');
select is((select status from public.signals where project_id = :'zk7' and rule = 'weather_risk' order by first_seen_at desc limit 1), 'resolved', 'прогноз улучшился — сигнал закрыт системой');
select pg_temp.back();

select * from finish();
rollback;
