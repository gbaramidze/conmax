-- Требует сид-данных. Ключи задач, guard-ы переходов, видимость для внешних, права на правку.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
select id as bc2 from public.projects where code = 'BC2' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select s.id as st_progress from public.workflow_statuses s join public.workflows w on w.id = s.workflow_id
  where s.code = 'in_progress' and w.tenant_id = (select tenant_id from public.projects where id = :'zk7') \gset
select s.id as st_blocked from public.workflow_statuses s join public.workflows w on w.id = s.workflow_id
  where s.code = 'blocked' and w.tenant_id = (select tenant_id from public.projects where id = :'zk7') \gset
select s.id as st_review from public.workflow_statuses s join public.workflows w on w.id = s.workflow_id
  where s.code = 'review' and w.tenant_id = (select tenant_id from public.projects where id = :'zk7') \gset
select s.id as st_done from public.workflow_statuses s join public.workflows w on w.id = s.workflow_id
  where s.code = 'done' and w.tenant_id = (select tenant_id from public.projects where id = :'zk7') \gset

-- 1. Создание и ключи
select pg_temp.act_as('pm1@demo.test');
select public.create_task(:'zk7', 'Тест: первая', 'task') as k1 \gset
select public.create_task(:'zk7', 'Тест: вторая', 'task') as k2 \gset
select ok((:'k1'::text) is not null, 'РП создаёт задачу через create_task');
select matches((select key from public.tasks where title = 'Тест: первая'), '^ZK7-T-\d+$', 'ключ имеет вид ZK7-T-N');
select is((select number from public.tasks where title = 'Тест: вторая') - (select number from public.tasks where title = 'Тест: первая'), 1,
          'номера последовательны внутри проекта и типа');
select public.generate_building(:'zk7', 'TP', 'Тестовый корпус', 0, 1, 1) as gen \gset
select id as tp_floor from public.locations where path::text = 'TP.F01' and project_id = :'zk7' \gset
select matches((public.create_task(:'zk7', 'Тест: замечание', 'punch', null, null, 'normal', null, null, :'tp_floor')).key, '^ZK7-P-\d+$',
               'у каждого типа свой счётчик и префикс');
select throws_ok(format($$select public.create_task(%L, 'x', 'task', %L)$$, :'zk7', (select id from public.users where email = 'admin@demo.test')),
                 '23514', null, 'исполнитель должен быть участником проекта');
select pg_temp.back();

-- 2. Guard-ы переходов
select pg_temp.act_as('pm1@demo.test');
select id as t1 from public.tasks where title = 'Тест: первая' \gset
select lives_ok(format($$select public.transition_task(%L, %L)$$, :'t1', :'st_progress'), 'Новая → В работе');
select throws_ok(format($$select public.transition_task(%L, %L)$$, :'t1', :'st_blocked'),
                 '22023', 'reason_required', 'блокировка без причины невозможна');
select throws_ok(format($$select public.transition_task(%L, %L, 'other')$$, :'t1', :'st_blocked'),
                 '22023', 'comment_required', 'причина «Другое» требует комментарий');
select lives_ok(format($$select public.transition_task(%L, %L, 'materials')$$, :'t1', :'st_blocked'), 'блокировка с причиной проходит');
select throws_ok(format($$select public.transition_task(%L, %L)$$, :'t1', :'st_done'),
                 '22023', 'transition_not_allowed', 'Заблокирована → Выполнена не разрешена workflow');
select throws_ok(format($$update public.tasks set status_id = %L where id = %L$$, :'st_review', :'t1'),
                 '42501', null, 'статус нельзя менять прямым UPDATE');
select pg_temp.back();

-- 3. Внешний подрядчик видит только свои задачи
select pg_temp.act_as('pm1@demo.test');
select public.create_task(:'zk7', 'Тест: для субподрядчика', 'task', :'sub1') as k3 \gset
select pg_temp.back();
select pg_temp.act_as('sub1@demo.test');
select ok((select count(*) from public.tasks) >= 1, 'субподрядчик видит свои задачи');
select is((select count(*)::int from public.tasks
            where assignee_id is distinct from :'sub1'
              and reporter_id is distinct from :'sub1'
              and visibility = 'internal'
              and organization_id is distinct from (select organization_id from public.users where id = :'sub1')),
          0, 'субподрядчик не видит чужие внутренние задачи');
select pg_temp.back();

-- 4. Права на правку: мастер может править «свою» задачу, но не назначать
select pg_temp.act_as('pm1@demo.test');
select public.create_task(:'zk7', 'Тест: задача мастера', 'task', (select id from public.users where email = 'master@demo.test')) as k4 \gset
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$update public.tasks set assignee_id = %L where title = 'Тест: задача мастера'$$, :'foreman1'),
                 '42501', null, 'мастер без task.assign не может переназначить задачу');
select pg_temp.back();

select * from finish();
rollback;
