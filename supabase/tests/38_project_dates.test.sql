-- Требует сид-данных. Сроки проекта: смена с обоснованием, сдвиг графика, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as bc2 from public.projects where code = 'BC2' \gset
update public.projects set planned_start = null, planned_finish = null where id = :'bc2';

select pg_temp.act_as('pm2@demo.test');
select ok((public.set_project_dates(:'bc2', date '2026-11-02', date '2027-06-30') ->> 'changed')::boolean, 'первые сроки задаются без обоснования');
select throws_ok(format($$select public.set_project_dates(%L, date '2026-11-09', date '2027-06-30')$$, :'bc2'), '22023', 'reason_required', 'менять назначенные сроки нужно с обоснованием');
select throws_ok(format($$select public.set_project_dates(%L, date '2027-07-01', date '2027-06-30', 'x')$$, :'bc2'), '22023', 'bad_dates', 'окончание раньше начала отклоняется');
select is((public.set_project_dates(:'bc2', date '2026-11-02', date '2027-06-30') ->> 'changed')::boolean, false, 'без изменений ничего не пишется');

-- сдвиг начала на неделю вместе с ограничениями работ графика
insert into public.schedule_activities (project_id, name, duration_days, constraint_type, constraint_date)
  values (:'bc2', 'Подготовка', 3, 'snet', date '2026-11-02') returning id as a \gset
select is((public.set_project_dates(:'bc2', date '2026-11-09', date '2027-07-07', 'перенос поставки', true) ->> 'shift_days')::int, 7, 'сдвиг начала на 7 дней');
select is((select constraint_date from public.schedule_activities where id = :'a'), date '2026-11-09', 'ограничение работы сдвинуто вместе с проектом');
select is((select count(*)::int from public.entity_events where entity_type = 'project' and entity_id = :'bc2' and event_type = 'dates_changed' and changes ->> 'reason' = 'перенос поставки'), 1, 'обоснование осталось в истории проекта');
select pg_temp.back();

select pg_temp.act_as('foreman2@demo.test');
select throws_ok(format($$select public.set_project_dates(%L, date '2026-12-01', date '2027-08-01', 'x')$$, :'bc2'), '42501', null, 'прораб сроки проекта менять не может');
select pg_temp.back();
select pg_temp.act_as('admin@demo.test');
select ok((public.set_project_dates(:'bc2', date '2026-11-16', date '2027-08-01', 'решение заказчика') ->> 'changed')::boolean, 'администратор организации (не участник проекта) тоже может менять сроки');
select pg_temp.back();

select * from finish();
rollback;
