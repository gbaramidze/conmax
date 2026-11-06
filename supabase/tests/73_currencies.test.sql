-- Требует сид-данных. Валюты: только лари и доллар, договоры и факт в другой валюте пересчитываются по курсу проекта.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7, tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as item from public.cbs_items where project_id = :'zk7' and deleted_at is null order by code limit 1 \gset

select throws_ok($$update public.projects set currency = 'RUB' where code = 'ZK7'$$, '23514', null, 'рубли в проекте не допускаются');

-- основная валюта GEL, курс 2,7 лари за доллар
update public.projects set currency = 'GEL', fx_rate = 2.7 where id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.budget_save_commitment(:'zk7', null, :'item', 'Договор в долларах', 'Подрядчик', 'Д-1', current_date, 1000, 'active', null, 'USD') as c1 \gset
select is((select amount::text || '/' || orig_amount::text || '/' || currency || '/' || fx_rate::text from public.budget_commitments where id = :'c1'), '2700.00/1000.00/USD/2.700000', 'доллары пересчитаны в лари по курсу, исходная сумма сохранена');
select public.budget_save_commitment(:'zk7', null, :'item', 'Договор в лари', 'Подрядчик', 'Д-2', current_date, 500) as c2 \gset
select is((select amount::text || '/' || coalesce(currency, 'нет') from public.budget_commitments where id = :'c2'), '500.00/нет', 'сумма в основной валюте хранится как есть');
select public.budget_save_commitment(:'zk7', null, :'item', 'Договор в лари явно', 'Подрядчик', 'Д-3', current_date, 270, 'active', null, 'GEL') as c3 \gset
select is((select orig_amount from public.budget_commitments where id = :'c3'), null, 'явно указанная основная валюта не считается «другой»');
select throws_ok(format($$select public.budget_save_commitment(%L, null, %L, 'X', 'Y', null, null, 10, 'active', null, 'RUB')$$, :'zk7', :'item'), '22023', 'currency_invalid', 'рубли при вводе отвергаются');
select public.budget_save_actual(:'zk7', null, :'item', 'act', 'А-1', current_date, 100, 'Подрядчик', :'c1', null, null, 'USD') as a1 \gset
select is((select amount::text || '/' || currency from public.budget_actuals where id = :'a1'), '270.00/USD', 'факт в долларах тоже пересчитывается');
select pg_temp.back();

-- смена курса прошлые записи не трогает
update public.projects set fx_rate = 3 where id = :'zk7';
select is((select amount from public.budget_commitments where id = :'c1'), 2700.00, 'смена курса не пересчитывает прошлые записи (курс на дату ввода)');

-- без курса другую валюту вводить нельзя
update public.projects set fx_rate = null where id = :'zk7';
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.budget_save_commitment(%L, null, %L, 'X', 'Y', null, null, 10, 'active', null, 'USD')$$, :'zk7', :'item'), '22023', 'rate_required', 'без курса сумму в другой валюте принять нельзя');
select public.budget_save_commitment(:'zk7', null, :'item', 'Без курса в лари', 'Y', null, null, 10) as c4 \gset
select is((select amount from public.budget_commitments where id = :'c4'), 10.00, 'в основной валюте без курса вводить можно');
select pg_temp.back();

-- основная валюта USD: лари пересчитываются в доллары
update public.projects set currency = 'USD', fx_rate = 2.5 where id = :'zk7';
select pg_temp.act_as('pm1@demo.test');
select public.budget_save_commitment(:'zk7', null, :'item', 'Договор в лари при долларовом проекте', 'Y', null, null, 2500, 'active', null, 'GEL') as c5 \gset
select is((select amount::text || '/' || orig_amount::text || '/' || currency from public.budget_commitments where id = :'c5'), '1000.00/2500.00/GEL', 'в долларовом проекте лари делятся на курс');
select pg_temp.back();

-- правка существующей записи меняет валюту и сумму
select pg_temp.act_as('pm1@demo.test');
select public.budget_save_commitment(:'zk7', :'c5', :'item', 'Договор в лари при долларовом проекте', 'Y', null, null, 800, 'active', null, null);
select is((select amount::text || '/' || coalesce(currency, 'нет') from public.budget_commitments where id = :'c5'), '800.00/нет', 'правка без валюты возвращает основную');
select pg_temp.back();

select is((select count(*)::int from public.projects where currency not in ('GEL', 'USD')), 0, 'ни у одного проекта нет другой валюты');

select * from finish();
rollback;
