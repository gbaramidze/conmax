-- Требует сид-данных. Закупки, этап 2: справочник поставщиков и история цен, пороги и подсказка согласующих, сроки шагов
-- и напоминания, частичная приёмка по позициям, вложения заявки.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
select id as director from public.users where email = 'director@demo.test' \gset

-- заявка доходит до поиска цен (закупщик — руководитель проекта pm1)
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_save(:'zk7', 'Кабель', null, null, null, '', '[{"name":"Кабель ВВГнг 3x2,5","unit":"м","qty":100},{"name":"Гофра 20","unit":"м","qty":50}]') as r1 \gset
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.material_request_transition(:'r1', 'sourcing');
select id as q1 from public.rfqs where request_id = :'r1' \gset
select id as l1 from public.rfq_lines where rfq_id = :'q1' and position = 1 \gset
select id as l2 from public.rfq_lines where rfq_id = :'q1' and position = 2 \gset

-- 1. Поставщики: заводятся из предложений, без дублей по названию
select public.rfq_quote_save(:'q1', 'ЭлектроТорг', 'USD', 5, '', jsonb_build_object(:'l1', 1.2, :'l2', 0.4)) as qa \gset
select public.rfq_quote_save(:'q1', '  электроторг ', 'USD', 5, '', jsonb_build_object(:'l1', 1.1, :'l2', 0.4)) as qb \gset
select is((select count(distinct supplier_id)::int from public.rfq_quotes where rfq_id = :'q1'), 1, 'одно название в разном регистре — один поставщик');
select isnt((select supplier_id from public.rfq_quotes where id = :'qa'), null, 'предложение привязано к справочнику');
select id as sup from public.suppliers where tenant_id = :'ten' and lower(name) = 'электроторг' \gset
select public.supplier_save(:'sup', 'ЭлектроТорг ООО', '123456789', 'Грузия', 'Нино', '+995 555', 'sales@et.ge', '', 'Электрика', 'restricted', 'Срывал сроки');
select is((select supplier || '/' || (select status from public.suppliers where id = :'sup') from public.rfq_quotes where id = :'qa'), 'ЭлектроТорг ООО/restricted', 'переименование и ограниченный список');
select throws_ok(format($$select public.supplier_save(null, 'электроторг ооо')$$), '23505', 'supplier_exists', 'второго с тем же названием не завести');
select is((select (x ->> 'quotes')::int from jsonb_array_elements(public.suppliers_list()) x where (x ->> 'id')::uuid = :'sup'), 2, 'в справочнике видно число предложений');
select is(jsonb_array_length(public.supplier_history(:'sup')), 2, 'история предложений поставщика');
select is(jsonb_array_length(public.procurement_price_hints(array['кабель ввгнг 3x2,5']) -> 'кабель ввгнг 3x2,5'), 2, 'подсказка: прошлые цены по позиции');
select public.rfq_quote_delete(:'qb');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select throws_ok($$select public.supplier_save(null, 'Чужой')$$, '42501', null, 'прораб справочник не ведёт');
select is(public.procurement_price_hints(array['кабель ввгнг 3x2,5']), '{}'::jsonb, 'и цен прошлых закупок не видит');
select pg_temp.back();

-- 2. Пороги: настройки по умолчанию, подсказка согласующих по уровню
select pg_temp.act_as('pm1@demo.test');
select is((public.procurement_settings_get() ->> 'tier1_limit')::numeric, 2000::numeric, 'порог по умолчанию — 2000');
select throws_ok($$select public.procurement_settings_save(2000, 11000, 1, 3, 2, 5, 1)$$, '42501', null, 'менять пороги может администратор или отдел закупок');
select is((public.procurement_suggest_for(:'r1', 500) ->> 'tier')::int, 1, 'до первого порога — уровень 1');
select ok(exists (select 1 from jsonb_array_elements(public.procurement_suggest_for(:'r1', 500) -> 'suggest') x where x ->> 'role' = 'Прораб' or x ->> 'role' = 'ГИП'),
          'на уровне 1 предлагаются ГИП и прораб проекта');
select is((public.procurement_suggest_for(:'r1', 5000) ->> 'tier')::int, 2, 'до второго порога — уровень 2');
select ok(exists (select 1 from jsonb_array_elements(public.procurement_suggest_for(:'r1', 5000) -> 'suggest') x where (x ->> 'id')::uuid = :'director'),
          'на уровне 2 предлагается директор');
select is((public.procurement_suggest_for(:'r1', 50000) ->> 'tier')::int, 3, 'выше второго — комитет');
select pg_temp.back();
select pg_temp.act_as('admin@demo.test');
select public.procurement_settings_save(100, 1000, 1, 3, 2, 5, 1);
select pg_temp.back();
select is((select tier2_limit from public.procurement_settings where tenant_id = :'ten'), 1000::numeric, 'администратор сменил пороги');

-- 3. Уровень и срок: 120 USD × 2,7 = 324 GEL → уровень 2 при порогах 100/1000
select pg_temp.act_as('pm1@demo.test');
select public.material_request_send_approval(:'r1', :'qa', array[:'director']::uuid[], 'Единственный дилер');
select pg_temp.back();
select is((select tier from public.material_requests where id = :'r1'), 2, 'уровень записан при отправке на согласование');
select pg_temp.act_as('pm1@demo.test');
select ok((public.procurement_requests(:'zk7') -> 0 ->> 'due_at')::timestamptz > now(), 'у шага есть срок в будущем');
select pg_temp.back();
select is(private.add_workdays('2026-11-27 10:00+04'::timestamptz, 1), '2026-12-01 00:00+04'::timestamptz, 'пятница + 1 рабочий день = конец понедельника');
-- шаг просрочен: напоминание согласующему, повторно в тот же день — нет
update public.material_requests set status_at = now() - interval '10 days' where id = :'r1';
select private.procurement_reminders() as n1 \gset
select private.procurement_reminders() as n2 \gset
select is((select count(*)::int from public.notifications where entity_id = :'r1' and user_id = :'director' and event_type = 'procurement.overdue'),
          case when extract(isodow from (now() at time zone 'Asia/Tbilisi')) >= 6 then 0 else 1 end, 'напоминание о просрочке — один раз (по будням)');

-- 4. Частичная приёмка по позициям
select pg_temp.act_as('director@demo.test');
select public.material_request_decide(:'r1', true, '');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_transition(:'r1', 'confirmed');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.material_request_order(:'r1', 'PO-1', current_date + 3);
select pg_temp.back();
select id as ml1 from public.material_request_lines where request_id = :'r1' and position = 1 \gset
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.material_request_receive(%L, 'partial', 'Не всё')$$, :'r1'), '22023', 'lines_required', 'частичная приёмка — с количеством по позициям');
select public.material_request_receive(:'r1', 'partial', 'Кабель пришёл частично', jsonb_build_object(:'ml1', 60));
select is((select status || '/' || receipt from public.material_requests where id = :'r1'), 'ordered/partial', 'часть пришла — заявка ещё открыта');
select is((select received_qty from public.material_request_lines where id = :'ml1'), 60.000, 'получено по позиции записано');
select public.material_request_receive(:'r1', 'full');
select is((select status || '/' || receipt from public.material_requests where id = :'r1'), 'delivered/full', 'остаток пришёл — заявка закрыта');
select is((select count(*)::int from public.material_request_receipts where request_id = :'r1'), 2, 'в журнале две приёмки');

-- 5. Вложения
select public.material_request_save(:'zk7', 'С чертежом', null, null, null, '', '[{"name":"Анкер","unit":"шт","qty":10}]') as r2 \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes) values (:'zk7', :'ten' || '/' || :'zk7' || '/test-boq.pdf', 'BOQ.pdf', 'application/pdf', 100) returning id as f1 \gset
select public.material_request_attach(:'r2', :'f1');
select is(jsonb_array_length(public.procurement_request(:'r2') -> 'files'), 1, 'файл прикреплён к заявке');
select pg_temp.back();
select pg_temp.act_as('director@demo.test');
select is(private.can_read_request_file(:'ten' || '/' || :'zk7' || '/test-boq.pdf'), false, 'чужой заявки файл не скачать');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.material_request_attach(%L, %L)$$, :'r2', :'f1'), '22023', 'file_invalid', 'прикрепить можно только свой файл');
select pg_temp.back();

select * from finish();
rollback;
