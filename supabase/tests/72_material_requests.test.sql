-- Требует сид-данных. Заявки на материалы: создание, позиции, маршрут, проверка остатка бюджета, права, лента.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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
delete from public.material_requests where project_id = :'zk7';

-- статья бюджета с известным лимитом 1000 в утверждённой версии
insert into public.cbs_items (tenant_id, project_id, code, name, cost_type) values (:'ten', :'zk7', 'T-PR', 'Тестовая статья закупок', 'materials') returning id as item \gset
insert into public.budget_amounts (version_id, item_id, tenant_id, project_id, amount)
select id, :'item', :'ten', :'zk7', 1000 from public.budget_versions where project_id = :'zk7' and status = 'approved';

-- прораб заводит заявку
select pg_temp.act_as('foreman1@demo.test');
select public.material_request_save(:'zk7', 'Арматура на 5 этаж', null, :'item', current_date + 10, 'Срочно',
  '[{"name":"Арматура А500 d12","unit":"т","qty":2,"price":300},{"name":"Проволока вязальная","unit":"кг","qty":50,"price":2}]') as r1 \gset
select is((select key from public.material_requests where id = :'r1'), 'ZK7-PR-' || (select number from public.material_requests where id = :'r1'), 'ключ строится из кода проекта и номера');
select is((select count(*)::int from public.material_request_lines where request_id = :'r1'), 2, 'позиции сохранены');
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'request_status' and changes ->> 'key' = (select key from public.material_requests where id = :'r1')), 1, 'создание попало в ленту');
select public.material_request_save(:'zk7', 'Арматура на 5 этаж', :'r1', :'item', current_date + 10, 'Срочно', '[{"name":"Арматура А500 d12","unit":"т","qty":2,"price":300}]');
select is((select count(*)::int from public.material_request_lines where request_id = :'r1'), 1, 'правка черновика заменяет позиции');
select throws_ok(format($$select public.material_request_save(%L, 'Пусто', null, null, null, '', '[{"name":"X","qty":0}]')$$, :'zk7'), '22023', 'line_invalid', 'позиция с нулевым количеством отвергается');
select throws_ok(format($$select public.material_request_save(%L, 'X', null, %L)$$, :'zk7', gen_random_uuid()), '22023', 'budget_item_invalid', 'чужая или несуществующая статья отвергается');
select throws_ok(format($$select public.material_request_transition(%L, 'approved')$$, :'r1'), '22023', 'transition_invalid', 'из черновика сразу согласовать нельзя');
select public.material_request_save(:'zk7', 'Без позиций') as r0 \gset
select throws_ok(format($$select public.material_request_transition(%L, 'submitted')$$, :'r0'), '22023', 'lines_required', 'заявку без позиций отправить нельзя');
select public.material_request_transition(:'r1', 'submitted');
select is((select status from public.material_requests where id = :'r1'), 'submitted', 'отправлена на согласование');
select throws_ok(format($$select public.material_request_save(%L, 'Поздно', %L)$$, :'zk7', :'r1'), '22023', 'request_locked', 'после отправки состав не правится');
select throws_ok(format($$select public.material_request_transition(%L, 'approved')$$, :'r1'), '42501', null, 'прораб согласовать не может');
select throws_ok(format($$select public.material_request_budget(%L)$$, :'r1'), '42501', null, 'прораб цифр бюджета не получает');
select throws_ok(format($$select public.material_request_set_item(%L, null)$$, :'r1'), '42501', null, 'и статью бюджета проставить не может');
select pg_temp.back();

-- руководитель решает; оценка 600 при остатке 1000 — в бюджете
select pg_temp.act_as('pm1@demo.test');
select is((public.material_request_budget(:'r1') ->> 'remaining')::numeric, 1000::numeric, 'остаток статьи показан');
select public.material_request_transition(:'r1', 'approved');
select is((select status || '/' || over_budget::text from public.material_requests where id = :'r1'), 'approved/false', 'в рамках остатка согласуется без оговорок');

-- вторая заявка на 700 при остатке 400 (600 уже зарезервировано)
select public.material_request_save(:'zk7', 'Ещё арматура', null, :'item', null, '', '[{"name":"Арматура","unit":"т","qty":2,"price":350}]') as r2 \gset
select public.material_request_transition(:'r2', 'submitted');
select is((public.material_request_budget(:'r2') ->> 'remaining')::numeric, 400::numeric, 'согласованное, но не заказанное резервируется');
select throws_ok(format($$select public.material_request_transition(%L, 'approved')$$, :'r2'), '22023', 'over_budget_note_required', 'сверх остатка нужен комментарий');
select throws_ok(format($$select public.material_request_transition(%L, 'rejected')$$, :'r2'), '22023', 'note_required', 'отклонение требует причины');
select public.material_request_transition(:'r2', 'approved', 'Согласовано с директором, добавим в бюджет');
select is((select over_budget from public.material_requests where id = :'r2'), true, 'согласование сверх бюджета помечено');
select public.material_request_transition(:'r1', 'ordered', 'ЗП-77');
select is((select order_ref from public.material_requests where id = :'r1'), 'ЗП-77', 'номер заказа записан');
select public.material_request_transition(:'r1', 'delivered');
select is((select status from public.material_requests where id = :'r1'), 'delivered', 'поставка отмечена');
select public.material_request_set_item(:'r2', null);
select is((select cbs_item_id from public.material_requests where id = :'r2'), null, 'руководитель может сменить статью бюджета');
select public.material_request_set_item(:'r2', :'item');
select pg_temp.back();

-- наблюдатель смотрит, но не заводит; внешний заказчик не видит
select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$select public.material_request_save(%L, 'Чужая')$$, :'zk7'), '42501', null, 'роль только с просмотром создать заявку не может');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.material_requests where project_id = :'zk7'), 0, 'внешний участник заявок не видит');
select pg_temp.back();

select * from finish();
rollback;
