-- Требует сид-данных. Договоры на мебель: охват по этажам и номерам, цены, сумма, обязательство в бюджете, права.
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as f7 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F07' \gset
select id as org from public.organizations where kind = 'subcontractor' order by name limit 1 \gset
select id as pm from public.users where email = 'pm1@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
select public.generate_rooms(:'zk7', :'f7', 2, 'floor', 'hotel_room');
select id as r1 from public.locations where parent_id = :'f7' and kind = 'room' order by sort limit 1 \gset
select id as r2 from public.locations where parent_id = :'f7' and kind = 'room' order by sort desc limit 1 \gset
select public.ffe_upsert_item(:'zk7', null, 'T46-BED', 'Кровать') as bed \gset
select public.ffe_upsert_item(:'zk7', null, 'T46-NS', 'Тумбочка') as ns \gset
select public.room_type_upsert(:'zk7', null, 'T46 King', null, null) as ty \gset
select public.room_type_set_item(:'zk7', :'ty', :'bed', 1);
select public.room_type_set_item(:'zk7', :'ty', :'ns', 2);
select public.apply_room_type(:'zk7', array[:'r1', :'r2']::uuid[], :'ty');
select public.budget_upsert_item(:'zk7', null, null, 'T46', 'Мебель номеров', 'materials', 0) as cbs \gset

-- договор А: этаж 7, 1000 за кровать, 100 за тумбочку
select public.ffe_contract_upsert(:'zk7', null, 'Мебель, этаж 7', 'Д-46/А', :'org', null, '2026-10-01', :'pm', 'Директор Иванов', 'signed', :'cbs', null) as ca \gset
select public.ffe_contract_add_scope(:'zk7', :'ca', array[:'f7']::uuid[]);
select public.ffe_contract_set_price(:'zk7', :'ca', :'bed', 1000);
select public.ffe_contract_set_price(:'zk7', :'ca', :'ns', 100);
select is(private.ffe_contract_amount(:'ca'), 2400::numeric, 'сумма договора по этажу: два номера по 1200');
select is((select amount from public.budget_commitments where id = (select commitment_id from public.ffe_contracts where id = :'ca')), 2400::numeric, 'сумма ушла обязательством в бюджет');
select is((select status from public.budget_commitments where id = (select commitment_id from public.ffe_contracts where id = :'ca')), 'active', 'подписанный договор — действующее обязательство');

-- договор Б забирает один номер: он перекрывает этаж
select public.ffe_contract_upsert(:'zk7', null, 'Мебель, номер', 'Д-46/Б', null, 'ООО Мебель-2', '2026-10-02', null, null, 'draft', null, null) as cb \gset
select public.ffe_contract_add_scope(:'zk7', :'cb', array[:'r2']::uuid[]);
select public.ffe_contract_set_price(:'zk7', :'cb', :'bed', 2000);
select public.ffe_contract_set_price(:'zk7', :'cb', :'ns', 200);
select is(private.ffe_contract_amount(:'cb'), 2400::numeric, 'номер под договором Б считается по его ценам');
select is(private.ffe_contract_amount(:'ca'), 1200::numeric, 'у договора А остался только второй номер');

-- один и тот же этаж двум договорам не отдать без явного переноса
select throws_ok(format($$select public.ffe_contract_add_scope(%L, %L, array[%L]::uuid[])$$, :'zk7', :'cb', :'f7'), '23505', 'scope_taken', 'место уже закреплено за другим договором');
select is(public.ffe_contract_add_scope(:'zk7', :'cb', array[:'f7']::uuid[], true), 1, 'с переносом место переходит к другому договору');
select is(private.ffe_contract_amount(:'ca'), 0::numeric, 'у прежнего договора охвата не осталось');

-- расторжение снимает обязательство
select public.ffe_contract_upsert(:'zk7', :'ca', 'Мебель, этаж 7', 'Д-46/А', :'org', null, '2026-10-01', :'pm', 'Директор Иванов', 'terminated', :'cbs', null);
select is((select status from public.budget_commitments where id = (select commitment_id from public.ffe_contracts where id = :'ca')), 'cancelled', 'расторгнутый договор — не обязательство');
select throws_ok(format($$select public.ffe_contract_upsert(%L, null, 'Без подрядчика', null, null, null, null, null, null, 'draft', null, null)$$, :'zk7'), '22023', 'contractor_required', 'подрядчик обязателен');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.ffe_contracts), 0, 'подрядчик не видит договоры');
select throws_ok(format($$select public.ffe_contract_set_price(%L, %L, %L, 1)$$, :'zk7', :'ca', :'bed'), '42501', null, 'подрядчик не может менять цены');
select pg_temp.back();

select * from finish();
rollback;
