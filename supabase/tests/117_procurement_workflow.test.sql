-- Требует сид-данных. Маршрут заявки по процедуре закупок: отдел закупок, склад, предложения, согласующие по выбору,
-- подтверждение инициатора, заказ (обязательство в бюджете), поставка и получение, уведомления на каждом шаге.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.notes(p_email text, p_request uuid, p_event text) returns int language sql as $$
  select count(*)::int from public.notifications n join public.users u on u.id = n.user_id
   where u.email = p_email and n.entity_id = p_request and n.event_type = p_event
$$;

select id as zk7, tenant_id as ten from public.projects where code = 'ZK7' \gset
delete from public.rfqs where project_id = :'zk7';
delete from public.material_requests where project_id = :'zk7';
update public.projects set currency = 'GEL', fx_rate = 2.5 where id = :'zk7';
insert into public.cbs_items (tenant_id, project_id, code, name, cost_type) values (:'ten', :'zk7', 'T-PW', 'Тестовая статья маршрута закупок', 'materials') returning id as item \gset
insert into public.budget_amounts (version_id, item_id, tenant_id, project_id, amount)
select id, :'item', :'ten', :'zk7', 1000 from public.budget_versions where project_id = :'zk7' and status = 'approved';

-- отдел закупок: Полина (не участник ZK7) получает роль компании «Отдел закупок»
select id as buyer from public.users where email = 'pm2@demo.test' \gset
select id as director from public.users where email = 'director@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as client from public.users where email = 'client@demo.test' \gset
select ok(exists (select 1 from public.roles where tenant_id = :'ten' and scope = 'tenant' and code = 'procurement'), 'роль «Отдел закупок» заведена в компании');
select is((select array_agg(rp.permission order by rp.permission) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = :'ten' and r.scope = 'tenant' and r.code = 'procurement'), array['procurement.manage', 'project.view.all'], 'роль видит все проекты и ведёт закупки');
insert into public.user_tenant_roles (user_id, role_id, tenant_id)
select :'buyer', id, :'ten' from public.roles where tenant_id = :'ten' and scope = 'tenant' and code = 'procurement';
select ok(not exists (select 1 from public.project_members where project_id = :'zk7' and user_id = :'buyer' and deleted_at is null), 'закупщик не участник проекта');

-- 1. Прораб отправляет срочную заявку — отдел закупок получает уведомление
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_save(:'zk7', 'Арматура на 5 этаж', null, :'item', current_date + 10, '',
  '[{"name":"Арматура d12","unit":"т","qty":2,"price":300},{"name":"Проволока","unit":"кг","qty":50,"price":2}]', true) as r1 \gset
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select is(pg_temp.notes('pm2@demo.test', :'r1', 'procurement.submitted'), 1, 'отдел закупок узнал о новой заявке');
select is((select priority from public.notifications where user_id = :'buyer' and entity_id = :'r1'), 'high', 'срочная заявка — высокий приоритет');
select is((select payload ->> 'link' from public.notifications where user_id = :'buyer' and entity_id = :'r1'), '/procurement?r=' || :'r1', 'ссылка ведёт на страницу закупок компании');

-- 2. Закупщик видит заявку без доступа к проекту и берёт её в работу
select pg_temp.act_as('pm2@demo.test');
select is(jsonb_array_length(public.procurement_requests(:'zk7')), 1, 'закупщик видит заявку проекта, не будучи его участником');
select is((public.procurement_request(:'r1') -> 'me' ->> 'is_buyer')::boolean, true, 'в карточке закупщик отмечен как ведущий');
select public.material_request_transition(:'r1', 'sourcing');
select is((select status || '/' || (buyer_id = :'buyer')::text from public.material_requests where id = :'r1'), 'sourcing/true', 'заявка в работе у закупщика');
select pg_temp.back();
select is((select count(*)::int from public.rfq_lines l join public.rfqs q on q.id = l.rfq_id where q.request_id = :'r1'), 2, 'запрос цен создан с позициями заявки');
select is(pg_temp.notes('foreman1@demo.test', :'r1', 'procurement.taken'), 1, 'инициатор узнал, что заявку взяли в работу');
select id as q1 from public.rfqs where request_id = :'r1' \gset
select id as l1 from public.rfq_lines where rfq_id = :'q1' and position = 1 \gset
select id as l2 from public.rfq_lines where rfq_id = :'q1' and position = 2 \gset

-- 3. Склад и предложения
select pg_temp.act_as('pm2@demo.test');
select public.material_request_stock(:'r1', 'none', 'Проверено в 1C');
select is((select stock_status from public.material_requests where id = :'r1'), 'none', 'склад отмечен: нет в наличии');
select public.rfq_quote_save(:'q1', 'Металл-Тбилиси', 'GEL', 5, '', jsonb_build_object(:'l1', 300, :'l2', 2)) as qa \gset
select public.rfq_quote_save(:'q1', 'SteelCo', 'GEL', 3, '', jsonb_build_object(:'l1', 400, :'l2', 3)) as qb \gset
select is((select count(*)::int from public.rfq_quotes where rfq_id = :'q1'), 2, 'два предложения внесены');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.rfq_quote_save(%L, 'X', 'GEL')$$, :'q1'), '42501', null, 'прораб предложения в заявке не вносит');
select throws_ok(format($$select public.rfq_award(%L, %L, %L)$$, :'q1', :'qa', :'item'), '42501', null, 'запрос по заявке присуждается только через заявку');
select pg_temp.back();

-- 4. На согласование: проверки и отправка (директор выключил письма о назначениях — просьба согласовать всё равно придёт письмом)
select pg_temp.act_as('director@demo.test');
insert into public.notification_preferences (category, channel, mode) values ('assigned', 'email', 'off')
on conflict (user_id, category, channel) do update set mode = 'off';
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
select throws_ok(format($$select public.material_request_send_approval(%L, %L, array[%L]::uuid[])$$, :'r1', :'qa', :'director'), '22023', 'reason_required', 'меньше трёх предложений — нужно обоснование');
select throws_ok(format($$select public.material_request_send_approval(%L, %L, array[]::uuid[], 'Срочно')$$, :'r1', :'qa'), '22023', 'approvers_required', 'без согласующих отправить нельзя');
select throws_ok(format($$select public.material_request_send_approval(%L, %L, array[%L]::uuid[], 'Срочно')$$, :'r1', :'qa', :'client'), '22023', 'approver_invalid', 'внешний участник согласующим быть не может');
select public.material_request_send_approval(:'r1', :'qa', array[:'director', :'gip']::uuid[], 'Срочно, третьего поставщика нет', 'Дешевле на 250');
select is((select status || '/' || approval_round || '/' || supplier || '/' || amount::text || '/' || amount_base::text from public.material_requests where id = :'r1'),
          'approval/1/Металл-Тбилиси/700.00/700.00', 'на согласовании: поставщик и сумма выбранного предложения');
select is((select count(*)::int from public.material_request_approvals where request_id = :'r1' and status = 'pending'), 2, 'два согласующих ждут решения');
select is((select over_budget from public.material_requests where id = :'r1'), false, 'сумма в пределах остатка статьи');
select throws_ok(format($$select public.rfq_quote_save(%L, 'Поздно', 'GEL')$$, :'q1'), '22023', 'request_locked', 'на согласовании предложения не меняются');
select pg_temp.back();
select is(pg_temp.notes('director@demo.test', :'r1', 'procurement.approval'), 1, 'директор получил просьбу согласовать');
select is((select count(*)::int from public.email_outbox o join public.notifications n on n.id = o.notification_id where n.user_id = :'director' and n.entity_id = :'r1' and n.event_type = 'procurement.approval' and o.kind = 'instant' and o.send_after <= now() + interval '1 minute'), 1, 'письмо о согласовании уходит сразу, даже если письма выключены');
select is(pg_temp.notes('foreman1@demo.test', :'r1', 'procurement.in_approval'), 1, 'инициатор знает, что заявка на согласовании');

-- 5. Согласующие: директор видит заявку, не будучи в проекте; ГИП отклоняет — возврат закупщику
select pg_temp.act_as('director@demo.test');
select is((public.procurement_request(:'r1') -> 'me' ->> 'my_approval')::boolean, true, 'директор видит, что ждут его решения');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.material_request_decide(%L, true)$$, :'r1'), '42501', null, 'не согласующий решить не может');
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
select throws_ok(format($$select public.material_request_decide(%L, false)$$, :'r1'), '22023', 'note_required', 'отказ без причины не принимается');
select public.material_request_decide(:'r1', false, 'Нужен сертификат на арматуру');
select is((select status || '/' || decision_note from public.material_requests where id = :'r1'), 'sourcing/Нужен сертификат на арматуру', 'отказ вернул заявку закупщику с причиной');
select is((select status from public.material_request_approvals where request_id = :'r1' and user_id = :'director'), 'cancelled', 'решение директора в этом круге больше не нужно');
select pg_temp.back();
select is(pg_temp.notes('pm2@demo.test', :'r1', 'procurement.declined'), 1, 'закупщик узнал об отказе');

-- 6. Второй круг: оба «да» — заявка ждёт подтверждения инициатора
select pg_temp.act_as('pm2@demo.test');
select public.material_request_send_approval(:'r1', :'qa', array[:'director', :'gip']::uuid[], 'Сертификат приложен, третьего поставщика нет');
select pg_temp.back();
select pg_temp.act_as('director@demo.test');
select public.material_request_decide(:'r1', true, '');
select is((select status from public.material_requests where id = :'r1'), 'approval', 'пока не все решили — на согласовании');
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
select public.material_request_decide(:'r1', true, 'Ок');
select is((select status || '/' || approval_round from public.material_requests where id = :'r1'), 'confirming/2', 'все «да» — ждём подтверждения инициатора');
select pg_temp.back();
select is(pg_temp.notes('foreman1@demo.test', :'r1', 'procurement.confirm'), 1, 'инициатора просят подтвердить');

-- 7. Подтверждение: только инициатор (или руководитель проекта)
select pg_temp.act_as('pm2@demo.test');
select throws_ok(format($$select public.material_request_transition(%L, 'confirmed')$$, :'r1'), '42501', null, 'закупщик за инициатора не подтверждает');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_transition(:'r1', 'confirmed');
select pg_temp.back();
select is(pg_temp.notes('pm2@demo.test', :'r1', 'procurement.confirmed'), 1, 'закупщик узнал, что можно заказывать');

-- 8. Заказ: обязательство в бюджете, запрос цен присуждён, инициатор знает ожидаемую дату
select pg_temp.act_as('pm2@demo.test');
select public.material_request_order(:'r1', 'PO-17', current_date + 5);
select is((select status || '/' || order_ref || '/' || (expected_at = current_date + 5)::text from public.material_requests where id = :'r1'), 'ordered/PO-17/true', 'заказ оформлен с номером и ожидаемой датой');
select is((select status from public.rfqs where id = :'q1') || '/' || (select status from public.rfq_quotes where id = :'qb'), 'awarded/rejected', 'запрос присуждён, другое предложение отклонено');
select pg_temp.back();
select is((select c.amount::text || '/' || c.counterparty from public.budget_commitments c join public.material_requests r on r.commitment_id = c.id where r.id = :'r1'), '700.00/Металл-Тбилиси', 'в бюджете появилось обязательство');
select is(pg_temp.notes('foreman1@demo.test', :'r1', 'procurement.ordered'), 1, 'инициатор узнал о заказе');

-- 9. Поставка: «в пути», затем перенос даты
select pg_temp.act_as('pm2@demo.test');
select throws_ok(format($$select public.material_request_delivery(%L, true, null, 'boat')$$, :'r1'), '22023', 'transport_invalid', 'неизвестный вид транспорта отвергается');
select public.material_request_delivery(:'r1', true, current_date + 6, 'road', 'Pridex', 'TR-1');
select is((select status || '/' || transport || '/' || forwarder from public.material_requests where id = :'r1'), 'shipped/road/Pridex', 'груз в пути');
select public.material_request_delivery(:'r1', false, current_date + 9, 'road', 'Pridex', 'TR-1', 'Задержка на таможне');
select pg_temp.back();
select is(pg_temp.notes('foreman1@demo.test', :'r1', 'procurement.shipped') || '/' || pg_temp.notes('foreman1@demo.test', :'r1', 'procurement.eta'), '1/1', 'инициатор узнал об отправке и о новом сроке');

-- 10. Получение
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.material_request_receive(%L, 'partial')$$, :'r1'), '22023', 'note_required', 'частичное получение — с описанием');
select public.material_request_receive(:'r1', 'full');
select is((select status || '/' || receipt from public.material_requests where id = :'r1'), 'delivered/full', 'получено полностью');
select ok(jsonb_array_length(public.procurement_request(:'r1') -> 'history') >= 10, 'вся история шагов видна в карточке');
select pg_temp.back();
select is(pg_temp.notes('pm2@demo.test', :'r1', 'procurement.delivered'), 1, 'закупщик узнал о получении');

-- 11. Выдача со склада без закупки
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_save(:'zk7', 'Перчатки', null, null, null, '', '[{"name":"Перчатки","unit":"пар","qty":20}]') as r2 \gset
select public.material_request_transition(:'r2', 'submitted');
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
select throws_ok(format($$select public.material_request_transition(%L, 'delivered')$$, :'r2'), '22023', 'stock_not_available', 'выдать со склада можно только то, что там есть');
select public.material_request_stock(:'r2', 'available');
select public.material_request_transition(:'r2', 'delivered', 'Выдано со склада №2');
select is((select status || '/' || receipt_note from public.material_requests where id = :'r2'), 'delivered/Выдано со склада №2', 'выдано со склада');
select pg_temp.back();

-- 12. Видимость
select pg_temp.act_as('observer@demo.test');
select is(jsonb_array_length(public.procurement_requests(:'zk7')), 2, 'наблюдатель проекта видит заявки проекта');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is(jsonb_array_length(public.procurement_requests()), 0, 'внешний участник заявок не видит');
select pg_temp.back();

select * from finish();
rollback;
