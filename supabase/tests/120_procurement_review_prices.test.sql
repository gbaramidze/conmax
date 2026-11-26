-- Требует сид-данных. Закупки, часть 3.1: должности закупок, подтверждение руководителем, проверка складом, видимость цен.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset

-- 1. Должности закупок заведены; закупщик в оргструктуре получает роль «Отдел закупок»
select is((select count(*)::int from public.roles where tenant_id = :'ten' and scope = 'project' and deleted_at is null
            and code in ('buyer', 'procurement_head', 'accountant', 'finance_director', 'projects_director', 'storekeeper')), 6, 'шесть должностей закупок');
insert into public.staff_departments (tenant_id, name) values (:'ten', 'Тестовый отдел закупок') returning id as dep \gset
insert into public.staff_positions (tenant_id, department_id, role_id, user_id)
select :'ten', :'dep', id, :'pm2' from public.roles where tenant_id = :'ten' and scope = 'project' and code = 'buyer';
insert into public.staff_positions (tenant_id, department_id, role_id, user_id)
select :'ten', :'dep', id, :'master' from public.roles where tenant_id = :'ten' and scope = 'project' and code = 'storekeeper';
select ok(exists (select 1 from public.user_tenant_roles utr join public.roles r on r.id = utr.role_id where utr.user_id = :'pm2' and r.code = 'procurement'),
          'закупщик автоматически в «Отделе закупок»');

-- 2. Прораб отправляет — сначала руководитель
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_save(:'zk7', 'Ноутбук для прораба', null, null, null, '', '[{"name":"Ноутбук 14\"","unit":"шт","qty":1}]') as r1 \gset
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select is((select status from public.material_requests where id = :'r1'), 'review', 'заявка у руководителя');
select is((select count(*)::int from public.notifications where entity_id = :'r1' and user_id = :'pm1' and event_type = 'procurement.review'), 1, 'руководитель получил просьбу подтвердить');
select is((select count(*)::int from public.notifications where entity_id = :'r1' and user_id = :'pm2'), 0, 'закупщик до подтверждения не беспокоится');
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.material_request_transition(%L, 'draft')$$, :'r1'), '22023', 'note_required', 'вернуть можно только с причиной');
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select is((select status || '/' || (reviewed_by = :'pm1')::text from public.material_requests where id = :'r1'), 'submitted/true', 'руководитель подтвердил — заявка у закупщиков');
select is((select count(*)::int from public.notifications where entity_id = :'r1' and user_id = :'pm2' and event_type = 'procurement.submitted'), 1, 'теперь закупщик узнал');

-- 3. Проверка на складе
select pg_temp.act_as('pm2@demo.test');
select public.material_request_transition(:'r1', 'stock_check');
select pg_temp.back();
select is((select count(*)::int from public.notifications where entity_id = :'r1' and user_id = :'master' and event_type = 'procurement.stock_check'), 1, 'кладовщик получил запрос');
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.material_request_stock(%L, 'partial')$$, :'r1'), '42501', null, 'прораб за склад не отвечает');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select public.material_request_stock(:'r1', 'partial', 'Есть 1 старый, нужен новый');
select pg_temp.back();
select is((select status || '/' || stock_status from public.material_requests where id = :'r1'), 'submitted/partial', 'склад ответил — заявка вернулась закупщику');

-- 4. Предложение с моделью и ценой; цены видят только финансы и согласующие
select pg_temp.act_as('pm2@demo.test');
select public.material_request_transition(:'r1', 'sourcing');
select id as q1 from public.rfqs where request_id = :'r1' \gset
select id as l1 from public.rfq_lines where rfq_id = :'q1' \gset
select public.rfq_quote_save(:'q1', 'TechStore', 'GEL', 3, 'аванс 50%', jsonb_build_object(:'l1', 2500), null, '', jsonb_build_object(:'l1', 'Lenovo ThinkPad E14 Gen 5, i5/16/512')) as qa \gset
select public.material_request_send_approval(:'r1', :'qa', array[:'gip']::uuid[], 'Один поставщик в наличии');
select is((public.procurement_request(:'r1') ->> 'amount')::numeric, 2500::numeric, 'закупщик видит сумму');
select pg_temp.back();

select pg_temp.act_as('gip@demo.test');
select is((public.procurement_request(:'r1') -> 'rfq' -> 'quotes' -> 0 -> 'prices' -> 0 ->> 'unit_price')::numeric, 2500::numeric, 'согласующий видит цену');
select public.material_request_decide(:'r1', true, '');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is(public.procurement_request(:'r1') ->> 'amount', null, 'инициатор суммы не видит');
select is(public.procurement_request(:'r1') -> 'rfq' -> 'quotes' -> 0 -> 'prices' -> 0 ->> 'unit_price', null, 'и цены за единицу');
select is(public.procurement_request(:'r1') -> 'rfq' -> 'quotes' -> 0 -> 'prices' -> 0 ->> 'model', 'Lenovo ThinkPad E14 Gen 5, i5/16/512', 'но видит, какую модель выбрали');
select is((public.procurement_requests(:'zk7') -> 0 ->> 'amount'), null, 'в списке суммы нет');
select is((select count(*)::int from public.rfq_quote_lines where quote_id = :'qa'), 0, 'цены в таблице предложений закрыты');
select throws_ok('select amount from public.material_requests limit 1', '42501', null, 'столбец суммы напрямую не читается');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select is(public.procurement_request(:'r1') ->> 'amount', null, 'кладовщик заявку видит, а суммы — нет');
select pg_temp.back();

select * from finish();
rollback;
