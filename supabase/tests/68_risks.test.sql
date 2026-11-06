-- Требует сид-данных. Реестр рисков: создание, оценка, валидация, права, внешние участники, лента.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as outsider from public.users where email = 'pm2@demo.test' \gset
delete from public.risks where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.risk_save(:'zk7', 'Срыв поставки арматуры', null, 'Поставщик задерживает', 'procurement', 4, 3, 1500000, 14, :'fm1', 'mitigate', 'Второй поставщик', 'Нет подтверждения отгрузки за 5 дней', 'open', current_date + 14) as r1 \gset
select is((select key from public.risks where id = :'r1'), 'ZK7-R-' || (select number from public.risks where id = :'r1'), 'ключ строится из кода проекта и номера');
select is((select score::int from public.risks where id = :'r1'), 12, 'оценка = вероятность × влияние');
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'risk_created' and changes ->> 'key' = (select key from public.risks where id = :'r1')), 1, 'создание попало в ленту проекта');
select public.risk_save(:'zk7', 'Срыв поставки арматуры', :'r1', '', 'procurement', 5, 4, 1500000, 14, :'fm1', 'mitigate', '', '', 'occurred', null);
select is((select score::int || '/' || status from public.risks where id = :'r1'), '20/occurred', 'правка пересчитывает оценку и меняет статус');
select is((select changes ->> 'to' from public.entity_events where entity_id = :'zk7' and event_type = 'risk_status' and changes ->> 'key' = (select key from public.risks where id = :'r1')), 'occurred', 'смена статуса попала в ленту проекта');
select public.risk_save(:'zk7', 'Второй риск') as r2 \gset
select is((select number from public.risks where id = :'r2') - (select number from public.risks where id = :'r1'), 1, 'номера идут подряд');

select throws_ok(format($$select public.risk_save(%L, 'X', null, '', 'other', 6, 3)$$, :'zk7'), '22023', 'scale_invalid', 'вероятность вне 1–5 отвергается');
select throws_ok(format($$select public.risk_save(%L, 'X', null, '', 'weird', 3, 3)$$, :'zk7'), '22023', 'risk_invalid', 'неизвестная категория отвергается');
select throws_ok(format($$select public.risk_save(%L, 'X', null, '', 'other', 3, 3, null, null, %L)$$, :'zk7', :'outsider'), '23514', 'owner_not_member', 'владелец должен быть участником проекта');
select pg_temp.back();

-- прораб смотрит, но не ведёт
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.risks where project_id = :'zk7'), 2, 'роль с правом просмотра видит реестр');
select throws_ok(format($$select public.risk_save(%L, 'Чужой')$$, :'zk7'), '42501', null, 'но создать риск не может');
select pg_temp.back();

-- внешний участник реестра не видит
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.risks), 0, 'внешний участник реестр рисков не видит');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select public.risk_delete(:'r2');
select is((select count(*)::int from public.risks where project_id = :'zk7'), 1, 'убранный риск не показывается');
select pg_temp.back();

select * from finish();
rollback;
