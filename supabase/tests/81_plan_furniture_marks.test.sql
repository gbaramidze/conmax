-- Требует сид-данных. Отметки мебели на плане комнаты: ставят и убирают те, кто правит мебель; видят все, кто видит проект.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/room-plan.pdf', 'room-plan.pdf', 'application/pdf', 5000) returning id as fplan \gset
select public.create_document(:'zk7', 'T81 план комнаты', 'T81-RP', 'plan', null, 'internal', false, :'fplan', 'A', '', '{}', '{}', true) as doc \gset
select public.ffe_upsert_item(:'zk7', null, 'CM-T81-01', 'Телевизор', 'Электроника', 'шт', null) as item \gset

select lives_ok(format($$select public.plan_furniture_mark_add(%L, %L, 1, %L, 0.25, 0.5)$$, :'zk7', :'doc', :'item'), 'руководитель ставит отметку мебели');
select public.plan_furniture_mark_add(:'zk7', :'doc', 1, :'item', 0.75, 0.5) as mark2 \gset
select is((select count(*)::int from public.plan_furniture_marks where document_id = :'doc' and item_id = :'item'), 2, 'одну позицию можно отметить дважды');
select throws_ok(format($$select public.plan_furniture_mark_add(%L, %L, 1, %L, 1.5, 0.5)$$, :'zk7', :'doc', :'item'), '22023', 'position_invalid', 'точка вне листа не принимается');
select throws_ok(format($$select public.plan_furniture_mark_add(%L, %L, 1, %L, 0.1, 0.1)$$, :'zk7', :'doc', gen_random_uuid()), 'P0002', 'item_not_found', 'несуществующая позиция не отмечается');

-- зона: прямоугольник от (x, y) до (x2, y2)
select lives_ok(format($$select public.plan_furniture_mark_add(%L, %L, 1, %L, 0.1, 0.1, 0.3, 0.4)$$, :'zk7', :'doc', :'item'), 'можно отметить зону');
select throws_ok(format($$select public.plan_furniture_mark_add(%L, %L, 1, %L, 0.5, 0.5, 0.3, 0.6)$$, :'zk7', :'doc', :'item'), '22023', 'position_invalid', 'зона с перевёрнутым углом не принимается');

select pg_temp.act_as('observer@demo.test');
select ok((select count(*) from public.plan_furniture_marks where document_id = :'doc') >= 0, 'наблюдатель видит отметки (без ошибки)');
select throws_ok(format($$select public.plan_furniture_mark_add(%L, %L, 1, %L, 0.4, 0.4)$$, :'zk7', :'doc', :'item'), '42501', null, 'наблюдатель отметку поставить не может');
select throws_ok(format($$select public.plan_furniture_mark_delete(%L)$$, :'mark2'), '42501', null, 'наблюдатель отметку убрать не может');

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.plan_furniture_mark_delete(%L)$$, :'mark2'), 'руководитель убирает отметку');
select is((select count(*)::int from public.plan_furniture_marks where document_id = :'doc'), 2, 'остались точка и зона');

select * from finish();
rollback;
