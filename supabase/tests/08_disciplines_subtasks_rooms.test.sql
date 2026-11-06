-- Требует сид-данных. Направления проекта, подзадачи, генератор помещений.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as bc2 from public.projects where code = 'BC2' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select id as bc2_task from public.tasks where project_id = :'bc2' limit 1 \gset
select id as kr from public.disciplines where project_id = :'zk7' and code = 'KR' \gset
select id as mon from public.disciplines where project_id = :'zk7' and code = 'MON' \gset
select id as bc2_kr from public.disciplines where project_id = :'bc2' and code = 'KR' \gset
select s.id as st_done from public.workflow_statuses s where s.code = 'done' and s.tenant_id = :'tenant' \gset
select s.id as st_progress from public.workflow_statuses s where s.code = 'in_progress' and s.tenant_id = :'tenant' \gset
select s.id as st_new from public.workflow_statuses s where s.code = 'new' and s.tenant_id = :'tenant' \gset

-- 1. Направления
select is((select count(*)::int from public.disciplines where project_id = :'zk7' and parent_id is null),
          (select count(*)::int from public.disciplines where project_id is null and tenant_id = :'tenant'),
          'новый проект получает копию справочника направлений компании');
select is((select parent_id from public.disciplines where id = :'mon'), :'kr'::uuid, 'у направления есть родитель (поднаправление)');
select is((select count(*)::int from public.tasks t join public.disciplines d on d.id = t.discipline_id
            where d.project_id is distinct from t.project_id), 0, 'задачи ссылаются только на направления своего проекта');

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$insert into public.disciplines (project_id, parent_id, code, name, lead_user_id) values (%L, %L, 'ARM', 'Армирование', %L)$$, :'zk7', :'mon', :'foreman1'),
                'РП добавляет поднаправление с руководителем');
select throws_ok(format($$insert into public.disciplines (project_id, code, name, lead_user_id) values (%L, 'XX', 'Не участник', %L)$$, :'zk7', (select id from public.users where email = 'admin@demo.test')),
                 '23514', null, 'руководитель направления должен быть участником проекта');
select throws_ok(format($$update public.disciplines set parent_id = (select id from public.disciplines where code = 'ARM' and project_id = %L) where id = %L$$, :'zk7', :'kr'),
                 '23514', null, 'нельзя сделать родителем собственного потомка');
select throws_ok(format($$insert into public.disciplines (project_id, parent_id, code, name) values (%L, %L, 'BAD', 'Чужой родитель')$$, :'zk7', :'bc2_kr'),
                 '23503', null, 'родитель обязан быть из того же проекта');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$insert into public.disciplines (project_id, code, name) values (%L, 'NEW', 'Без прав')$$, :'zk7'),
                 '42501', null, 'прораб не управляет направлениями проекта');
select pg_temp.back();

-- 2. Руководитель направления автоматически наблюдает за задачами направления и его потомков
select pg_temp.act_as('pm1@demo.test');
select id as t_mon from public.create_task(:'zk7', 'Задача в «Монолите»', 'task', null, null, 'normal', null, :'mon') \gset
select pg_temp.back();
select ok(exists (select 1 from public.watchers where entity_id = :'t_mon' and user_id = :'foreman1' and reason = 'discipline_lead'),
          'руководитель поднаправления наблюдает за задачей');
select ok(exists (select 1 from public.watchers w join public.users u on u.id = w.user_id
                   where w.entity_id = :'t_mon' and u.email = 'gip@demo.test' and w.reason = 'discipline_lead'),
          'руководитель родительского направления тоже наблюдает');

-- 3. Подзадачи
select pg_temp.act_as('pm1@demo.test');
select public.generate_building(:'zk7', 'SUB', 'Корпус для подзадач', 0, 1, 2) as g \gset
select id as sub_floor from public.locations where project_id = :'zk7' and path::text = 'SUB.F01' \gset
select id as parent_task from public.create_task(:'zk7', 'Родитель', 'task', null, null, 'normal', null, :'mon', :'sub_floor') \gset
select id as child_task from public.create_task(:'zk7', 'Подзадача', 'task', null, null, 'normal', null, null, null, :'parent_task') \gset
select is((select discipline_id from public.tasks where id = :'child_task'), :'mon'::uuid, 'подзадача наследует направление родителя');
select is((select location_id from public.tasks where id = :'child_task'), :'sub_floor'::uuid, 'подзадача наследует локацию родителя');
select throws_ok(format($$select public.create_task(%L, 'Чужая подзадача', 'task', null, null, 'normal', null, null, null, %L)$$, :'zk7', :'bc2_task'),
                 '23503', null, 'родитель обязан быть из того же проекта');

select public.transition_task(:'parent_task', :'st_progress');
select throws_ok(format($$select public.transition_task(%L, %L)$$, :'parent_task', :'st_done'),
                 '22023', 'subtasks_open', 'нельзя закрыть задачу при открытых подзадачах');
select public.transition_task(:'child_task', :'st_progress');
select public.transition_task(:'child_task', :'st_done');
select lives_ok(format($$select public.transition_task(%L, %L)$$, :'parent_task', :'st_done'), 'после закрытия подзадач родителя закрыть можно');

-- 4. Помещения
select is(public.generate_rooms(:'zk7', (select id from public.locations where project_id = :'zk7' and path::text = 'SUB'), 3), 6,
          'генератор создаёт по 3 помещения на каждом из 2 этажей');
select ok(exists (select 1 from public.locations where project_id = :'zk7' and path::text = 'SUB.F02.R201'), 'нумерация по этажам: на 2 этаже — 201');
select pg_temp.back();

select * from finish();
rollback;
