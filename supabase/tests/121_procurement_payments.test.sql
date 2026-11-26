-- Требует сид-данных. Закупки, часть 3.2: код бюджета по позициям, платежи частями с цепочкой согласования по очереди,
-- платёжное поручение, итоги по заявке и поставщику, видимость платежей.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
delete from public.procurement_settings where tenant_id = :'ten';
update public.projects set currency = 'GEL', fx_rate = 2.7 where id = :'zk7';
select id as econ from public.users where email = 'economist@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
insert into public.cbs_items (tenant_id, project_id, code, name, cost_type) values (:'ten', :'zk7', 'T-A', 'Статья А', 'materials') returning id as ia \gset
insert into public.cbs_items (tenant_id, project_id, code, name, cost_type) values (:'ten', :'zk7', 'T-B', 'Статья Б', 'materials') returning id as ib \gset

-- должности: бухгалтер — экономист, руководитель закупок — pm2; директора проектов и финдиректора нет (шаги пропускаются)
insert into public.staff_departments (tenant_id, name) values (:'ten', 'Финансы и закупки (тест)') returning id as dep \gset
insert into public.staff_positions (tenant_id, department_id, role_id, user_id)
select :'ten', :'dep', id, :'econ' from public.roles where tenant_id = :'ten' and scope = 'project' and code = 'accountant';
insert into public.staff_positions (tenant_id, department_id, role_id, user_id)
select :'ten', :'dep', id, :'pm2' from public.roles where tenant_id = :'ten' and scope = 'project' and code = 'procurement_head';
select ok(exists (select 1 from public.roles where tenant_id = :'ten' and scope = 'project' and code = 'owner'), 'должность «Учредитель» заведена');

-- заявка до подтверждения инициатором: 2 позиции, предложение 3000 GEL
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_save(:'zk7', 'Электрика', null, null, null, '', '[{"name":"Кабель","unit":"м","qty":100},{"name":"Щит","unit":"шт","qty":1}]') as r1 \gset
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.material_request_transition(:'r1', 'submitted');
select public.material_request_transition(:'r1', 'sourcing');
select id as q1 from public.rfqs where request_id = :'r1' \gset
select id as rl1 from public.rfq_lines where rfq_id = :'q1' and position = 1 \gset
select id as rl2 from public.rfq_lines where rfq_id = :'q1' and position = 2 \gset
select public.rfq_quote_save(:'q1', 'ЭлектроМир', 'GEL', 5, '', jsonb_build_object(:'rl1', 20, :'rl2', 1000)) as qa \gset
select public.material_request_send_approval(:'r1', :'qa', array[:'gip']::uuid[], 'Тест');
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
select public.material_request_decide(:'r1', true, '');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_transition(:'r1', 'confirmed');
select pg_temp.back();

-- 1. Код бюджета: А для всех, щит — Б
select id as ml2 from public.material_request_lines where request_id = :'r1' and position = 2 \gset
select pg_temp.act_as('pm1@demo.test');
select public.material_request_set_items(:'r1', :'ia', jsonb_build_object(:'ml2', :'ib'));
select is((public.procurement_request(:'r1') -> 'lines' -> 1 -> 'item' ->> 'code'), 'T-B', 'у щита своя статья');
select is((public.procurement_request(:'r1') -> 'lines' -> 0 -> 'item' ->> 'code'), 'T-A', 'у кабеля — статья для всех');
select public.material_request_order(:'r1', 'PO-9', current_date + 5);
select pg_temp.back();
select is((select string_agg(c.code || ':' || bc.amount::text, ',' order by c.code) from public.budget_commitments bc join public.cbs_items c on c.id = bc.item_id
            where bc.note = 'По заявке ' || (select key from public.material_requests where id = :'r1')), 'T-A:2000.00,T-B:1000.00', 'обязательства разложены по статьям');

-- 2. Аванс 1500: цепочка бухгалтер → руководитель закупок (директор проектов и финдиректор — от 2000)
select pg_temp.act_as('pm1@demo.test');
select public.material_request_payment_create(:'r1', 'advance', 1500, 'INV-1', 'Аванс 50%') as p1 \gset
select pg_temp.back();
select is((select string_agg(role_code || ':' || status, ',' order by position) from public.material_request_payment_steps where payment_id = :'p1'),
          'accountant:pending,procurement_head:waiting', 'цепочка по сумме, первым — бухгалтер');
select is((select count(*)::int from public.notifications where entity_id = :'r1' and user_id = :'econ' and event_type = 'procurement.payment'), 1, 'бухгалтер получил просьбу');
select pg_temp.act_as('pm2@demo.test');
select throws_ok(format($$select public.material_request_payment_decide(%L, true)$$, :'p1'), '42501', null, 'руководитель закупок не может раньше бухгалтера');
select pg_temp.back();
select pg_temp.act_as('economist@demo.test');
select public.material_request_payment_decide(:'p1', true, 'Документы в порядке');
select pg_temp.back();
select is((select status from public.material_request_payment_steps where payment_id = :'p1' and position = 2), 'pending', 'очередь перешла к руководителю закупок');
select pg_temp.act_as('pm2@demo.test');
select public.material_request_payment_decide(:'p1', true, '');
select pg_temp.back();
select is((select status from public.material_request_payments where id = :'p1'), 'approved', 'все согласовали');
select pg_temp.act_as('pm2@demo.test');
select throws_ok(format($$select public.material_request_payment_paid(%L, 'PP-1')$$, :'p1'), '42501', null, 'оплатить отмечает бухгалтерия');
select pg_temp.back();
select pg_temp.act_as('economist@demo.test');
select public.material_request_payment_paid(:'p1', 'ПП-77');
select pg_temp.back();
select is((select status || '/' || payment_ref from public.material_request_payments where id = :'p1'), 'paid/ПП-77', 'оплачено, номер платёжки записан');

-- 3. Остаток: больше суммы заказа не заплатить; итоги
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.material_request_payment_create(%L, 'final', 2000)$$, :'r1'), '22023', 'over_amount', 'больше остатка не заплатить');
select is((public.procurement_request(:'r1') -> 'pay_summary' ->> 'paid')::numeric, 1500::numeric, 'оплачено 1500');
select is((public.procurement_request(:'r1') -> 'pay_summary' ->> 'advance')::numeric, 1500::numeric, 'из них аванс 1500');
select is((public.procurement_request(:'r1') -> 'pay_summary' ->> 'remaining')::numeric, 1500::numeric, 'остаток 1500');

-- 4. Окончательный платёж с учредителем: никого на должности — шаг пропускается; отказ бухгалтера с причиной
select public.material_request_payment_create(:'r1', 'final', 1500, 'INV-2', '', true) as p2 \gset
select pg_temp.back();
select is((select string_agg(role_code || ':' || status, ',' order by position) from public.material_request_payment_steps where payment_id = :'p2'),
          'accountant:pending,procurement_head:waiting,owner:waiting', 'учредитель добавлен галочкой');
select pg_temp.act_as('economist@demo.test');
select throws_ok(format($$select public.material_request_payment_decide(%L, false)$$, :'p2'), '22023', 'note_required', 'отказ — с причиной');
select public.material_request_payment_decide(:'p2', false, 'Нет акта приёмки');
select pg_temp.back();
select is((select status || '/' || decision_note from public.material_request_payments where id = :'p2'), 'rejected/Нет акта приёмки', 'платёж остановлен с причиной');

-- 5. Видимость: прораб платежей не видит; у поставщика видны заказано и оплачено
select pg_temp.act_as('foreman1@demo.test');
select is(jsonb_array_length(public.procurement_request(:'r1') -> 'payments'), 0, 'инициатор платежей не видит');
select is(public.procurement_request(:'r1') -> 'pay_summary', 'null'::jsonb, 'и итогов оплаты');
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
select is((select (x ->> 'ordered_gel')::numeric || '/' || (x ->> 'paid_gel')::numeric from jsonb_array_elements(public.suppliers_list()) x where x ->> 'name' = 'ЭлектроМир'),
          '3000.00/1500.00', 'по поставщику: заказано 3000, оплачено 1500');
select pg_temp.back();

select * from finish();
rollback;
