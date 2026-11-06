-- Требует сид-данных. Запросы цен: создание из заявки и вручную, предложения, присуждение с обязательством в бюджете, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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
delete from public.rfqs where project_id = :'zk7';
delete from public.material_requests where project_id = :'zk7';
update public.projects set currency = 'GEL', fx_rate = 2.5 where id = :'zk7';
insert into public.cbs_items (tenant_id, project_id, code, name, cost_type) values (:'ten', :'zk7', 'T-RQ', 'Тестовая статья запросов цен', 'materials') returning id as item \gset

-- согласованная заявка
select pg_temp.act_as('pm1@demo.test');
select public.material_request_save(:'zk7', 'Арматура', null, :'item', null, '', '[{"name":"Арматура d12","unit":"т","qty":2},{"name":"Проволока","unit":"кг","qty":50}]') as pr \gset
select public.material_request_transition(:'pr', 'submitted');
select public.material_request_transition(:'pr', 'approved');

select public.rfq_create(:'zk7', 'Арматура на 5 этаж', :'pr', current_date + 7) as q1 \gset
select is((select key from public.rfqs where id = :'q1'), 'ZK7-RQ-' || (select number from public.rfqs where id = :'q1'), 'ключ строится из кода проекта и номера');
select is((select count(*)::int from public.rfq_lines where rfq_id = :'q1'), 2, 'позиции скопированы из заявки');
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'rfq_status' and changes ->> 'key' = (select key from public.rfqs where id = :'q1')), 1, 'создание попало в ленту');
select id as l1 from public.rfq_lines where rfq_id = :'q1' and position = 1 \gset
select id as l2 from public.rfq_lines where rfq_id = :'q1' and position = 2 \gset

-- два предложения: в лари и в долларах
select public.rfq_quote_save(:'q1', 'Металл-Тбилиси', 'GEL', 10, '50% предоплата', jsonb_build_object(:'l1', 1500, :'l2', 4)) as a \gset
select public.rfq_quote_save(:'q1', 'SteelCo', 'USD', 5, 'по факту', jsonb_build_object(:'l1', 500)) as b \gset
select is((select count(*)::int from public.rfq_quote_lines where quote_id = :'a'), 2, 'цены предложения сохранены');
select throws_ok(format($$select public.rfq_quote_save(%L, '', 'GEL')$$, :'q1'), '22023', 'supplier_required', 'без названия поставщика предложение не принимается');
select throws_ok(format($$select public.rfq_quote_save(%L, 'X', 'RUB')$$, :'q1'), '22023', 'currency_invalid', 'рубли отвергаются');
select throws_ok(format($$select public.rfq_quote_save(%L, 'X', 'GEL', null, '', jsonb_build_object(%L, 1))$$, :'q1', gen_random_uuid()), '22023', 'line_invalid', 'чужая позиция отвергается');
select public.rfq_quote_save(:'q1', 'SteelCo', 'USD', 5, 'по факту', jsonb_build_object(:'l1', 500, :'l2', 1.5), :'b');
select is((select count(*)::int from public.rfq_quote_lines where quote_id = :'b'), 2, 'правка предложения заменяет цены');
select pg_temp.back();

-- прораб может вносить предложения, но не присуждать
select pg_temp.act_as('foreman1@demo.test');
select public.rfq_quote_save(:'q1', 'Третий поставщик', 'GEL', 3, '', jsonb_build_object(:'l1', 1700)) as c \gset
select throws_ok(format($$select public.rfq_award(%L, %L)$$, :'q1', :'a'), '42501', null, 'прораб присудить не может');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.rfq_award(%L, %L)$$, :'q1', :'c'), '22023', 'quote_incomplete', 'предложение не по всем позициям присудить нельзя');
select public.rfq_quote_delete(:'c');
select is((select count(*)::int from public.rfq_quotes where rfq_id = :'q1'), 2, 'предложение удалено');

-- присуждаем доллары: 2 × 500 + 50 × 1,5 = 1075 USD → ×2,5 = 2687,50 GEL
select public.rfq_award(:'q1', :'b', null, 'Д-55') as com \gset
select is((select amount::text || '/' || orig_amount::text || '/' || currency || '/' || item_id::text from public.budget_commitments where id = :'com'), '2687.50/1075.00/USD/' || :'item', 'обязательство создано по статье заявки, сумма пересчитана по курсу');
select is((select status from public.rfqs where id = :'q1'), 'awarded', 'запрос присуждён');
select is((select status from public.rfq_quotes where id = :'a'), 'rejected', 'остальные предложения отклонены');
select is((select status || '/' || order_ref from public.material_requests where id = :'pr'), 'ordered/Д-55', 'заявка стала заказанной с номером договора');
select throws_ok(format($$select public.rfq_award(%L, %L)$$, :'q1', :'a'), '22023', 'rfq_closed', 'закрытый запрос повторно присудить нельзя');

-- ручной запрос без заявки требует статьи бюджета при присуждении
select public.rfq_create(:'zk7', 'Бетон', null, null, '', '[{"name":"Бетон В25","unit":"м3","qty":10}]') as q2 \gset
select id as l3 from public.rfq_lines where rfq_id = :'q2' \gset
select public.rfq_quote_save(:'q2', 'Бетонный завод', 'GEL', 1, '', jsonb_build_object(:'l3', 200)) as d \gset
select throws_ok(format($$select public.rfq_award(%L, %L)$$, :'q2', :'d'), '22023', 'budget_item_required', 'запрос без заявки требует статью бюджета');
select pg_temp.back();

-- внешний участник запросов не видит
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.rfqs where project_id = :'zk7'), 0, 'внешний участник запросов цен не видит');
select pg_temp.back();

select * from finish();
rollback;
