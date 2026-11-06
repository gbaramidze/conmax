-- Требует сид-данных. Дерево локаций: генератор, права, пути, привязка задач.
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
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as bc2 from public.projects where code = 'BC2' \gset

-- Генератор: корпус + 2 секции × (этажи -1..2 без нулевого = 3) = 1 + 2 + 6 = 9
select pg_temp.act_as('pm1@demo.test');
select is(public.generate_building(:'zk7', 'TST', 'Тестовый корпус', 2, -1, 2), 9, 'генератор создаёт корпус, секции и этажи без нулевого');
select ok(exists (select 1 from public.locations where project_id = :'zk7' and path::text = 'TST.S2.B1'), 'подвал получает код B1');
select ok(exists (select 1 from public.locations where project_id = :'zk7' and path::text = 'TST.S1.F02'), 'путь строится из кодов родителей');
select throws_ok(format($$select public.generate_building(%L, 'TST', 'Дубль', 0, 1, 1)$$, :'zk7'), '23505', null, 'код корпуса уникален в проекте');
select throws_ok(format($$select public.generate_building(%L, 'BIG', 'Огромный', 50, 1, 100)$$, :'zk7'), '22023', null, 'слишком большой генератор отклоняется');
select id as tst_floor from public.locations where project_id = :'zk7' and path::text = 'TST.S1.F02' \gset
select id as tst_building from public.locations where project_id = :'zk7' and path::text = 'TST' \gset
select pg_temp.back();

-- Права
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.generate_building(%L, 'FOR', 'Прораб', 0, 1, 1)$$, :'zk7'), '42501', null, 'без location.manage генератор недоступен');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select ok((select count(*) from public.locations where project_id = :'zk7') > 0, 'внешний видит локации своего проекта');
select pg_temp.back();

-- Привязка задач
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.create_task(%L, 'Замечание без места', 'punch')$$, :'zk7'),
                 '22023', 'location_required', 'замечание без локации создать нельзя');
select is((public.create_task(:'zk7', 'Задача на этаже', 'task', null, null, 'normal', null, null, :'tst_floor')).location_path, 'TST.S1.F02',
          'путь локации денормализуется в задачу');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select id as bc2_loc from public.locations where project_id = :'bc2' limit 1 \gset
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.create_task(%L, 'Чужая локация', 'task', null, null, 'normal', null, null, %L)$$, :'zk7', :'bc2_loc'),
                 '23503', null, 'локация другого проекта отклоняется');

-- Нельзя архивировать узел с потомками
select throws_ok(format($$update public.locations set deleted_at = now() where id = %L$$, :'tst_building'),
                 '23503', null, 'нельзя архивировать корпус с активными этажами');
select pg_temp.back();

select * from finish();
rollback;
