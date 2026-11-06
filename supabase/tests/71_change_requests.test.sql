-- Требует сид-данных. Запросы на изменение: создание, оценка, маршрут, права по ролям, лента.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
delete from public.change_requests where project_id = :'zk7';

-- главный инженер создаёт и ведёт к оценке
select pg_temp.act_as('gip@demo.test');
select public.change_save(:'zk7', 'Замена фасадной системы', null, 'Заказчик просит навесной вентилируемый фасад', 'client_request') as c1 \gset
select is((select key from public.change_requests where id = :'c1'), 'ZK7-CR-' || (select number from public.change_requests where id = :'c1'), 'ключ строится из кода проекта и номера');
select is((select status from public.change_requests where id = :'c1'), 'draft', 'новый запрос — черновик');
select is((select count(*)::int from public.entity_events where entity_id = :'zk7' and event_type = 'change_status' and changes ->> 'to' = 'draft' and changes ->> 'key' = (select key from public.change_requests where id = :'c1')), 1, 'создание попало в ленту проекта');
select public.change_save(:'zk7', 'Замена фасадной системы (уточнено)', :'c1', 'Описание', 'design_error');
select is((select title || '/' || reason from public.change_requests where id = :'c1'), 'Замена фасадной системы (уточнено)/design_error', 'черновик можно править');
select public.change_save(:'zk7', 'Второй запрос') as c2 \gset
select is((select number from public.change_requests where id = :'c2') - (select number from public.change_requests where id = :'c1'), 1, 'номера идут подряд');
select throws_ok(format($$select public.change_save(%L, '   ')$$, :'zk7'), '22023', 'title_required', 'пустое название отвергается');
select throws_ok(format($$select public.change_save(%L, 'X', null, '', 'weird')$$, :'zk7'), '22023', 'change_invalid', 'неизвестная причина отвергается');

select public.change_transition(:'c1', 'assessment');
select is((select status from public.change_requests where id = :'c1'), 'assessment', 'отправлен на оценку');
select throws_ok(format($$select public.change_save(%L, 'Поздно', %L)$$, :'zk7', :'c1'), '22023', 'change_locked', 'после отправки содержание не правится');
select throws_ok(format($$select public.change_transition(%L, 'approval')$$, :'c1'), '22023', 'assessment_required', 'без оценки на согласование не передать');
select public.change_assess(:'c1', 4500000, 21, 'Поставка 6 недель, монтаж +3');
select public.change_transition(:'c1', 'approval');
select is((select status || '/' || cost_impact::int || '/' || schedule_impact_days from public.change_requests where id = :'c1'), 'approval/4500000/21', 'оценка сохранена, запрос на согласовании');
select throws_ok(format($$select public.change_transition(%L, 'approved')$$, :'c1'), '42501', null, 'главный инженер утверждать не может');
select pg_temp.back();

-- руководитель проекта решает
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.change_transition(%L, 'rejected')$$, :'c1'), '22023', 'note_required', 'отклонение требует причины');
select public.change_transition(:'c1', 'approved', 'Согласовано с заказчиком');
select is((select status || '/' || decision_note from public.change_requests where id = :'c1'), 'approved/Согласовано с заказчиком', 'утверждён с заметкой');
select ok((select decided_by is not null and decided_at is not null from public.change_requests where id = :'c1'), 'кто и когда решил — записано');
select throws_ok(format($$select public.change_transition(%L, 'draft')$$, :'c1'), '22023', 'transition_invalid', 'перехода назад из утверждённого нет');
select public.change_transition(:'c1', 'implemented');
select is((select status from public.change_requests where id = :'c1'), 'implemented', 'внедрение отмечено');
select pg_temp.back();

-- прораб запросов не видит и не создаёт
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.change_requests where project_id = :'zk7'), 0, 'роль без прав на изменения реестр не видит');
select throws_ok(format($$select public.change_save(%L, 'Чужой')$$, :'zk7'), '42501', null, 'и создать не может');
select pg_temp.back();

select * from finish();
rollback;
