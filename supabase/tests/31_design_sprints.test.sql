-- Требует сид-данных. Спринты проектирования: создание, бэклог, старт, закрытие с причинами и переносом, права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
select id as ar from public.disciplines where project_id = :'zk7' and deleted_at is null order by sort limit 1 \gset

select pg_temp.act_as('pm1@demo.test');
select (public.create_task(:'zk7', 'Разработать узел А', 'task', null, current_date + 20, 'normal', null, :'ar')).id as t1 \gset
select (public.create_task(:'zk7', 'Разработать узел Б', 'task', null, current_date + 20, 'normal', null, :'ar')).id as t2 \gset
select (public.create_task(:'zk7', 'Разработать узел В', 'task', null, current_date + 25, 'normal', null, :'ar')).id as t3 \gset

select public.create_sprint(:'zk7', 'Спринт 1', current_date, current_date + 13, :'ar', 'Закрыть узлы') as s1 \gset
select public.create_sprint(:'zk7', 'Спринт 2', current_date + 14, current_date + 27) as s2 \gset
select throws_ok(format($$select public.create_sprint(%L, 'X', current_date, current_date - 1)$$, :'zk7'), '22023', 'bad_dates', 'конец раньше начала отклоняется');
select throws_ok(format($$select public.create_sprint(%L, ' ', current_date, current_date + 5)$$, :'zk7'), '22023', 'title_required', 'пустое название отклоняется');

-- ---- бэклог → спринт ----
select is(public.add_sprint_tasks(:'s1', array[:'t1', :'t2']::uuid[]), 2, 'две задачи взяты в спринт');
select is(public.add_sprint_tasks(:'s2', array[:'t1', :'t3']::uuid[]), 1, 'занятая другим открытым спринтом задача не берётся второй раз');
select throws_ok(format($$select public.start_sprint(%L)$$, (select (public.create_sprint(:'zk7', 'Пустой', current_date, current_date + 6)))), '23514', 'no_tasks', 'пустой спринт не начать');
select public.start_sprint(:'s1');
select public.add_sprint_tasks(:'s1', array[(select (public.create_task(:'zk7', 'Внеплановая', 'task', null, null, 'normal', null, :'ar')).id)]::uuid[]);
select is((select count(*)::int from public.sprint_tasks where sprint_id = :'s1' and added_late), 1, 'добавленная после старта помечена «позже»');
select throws_ok(format($$select public.remove_sprint_task(%L, %L)$$, :'s1', :'t1'), '23514', 'sprint_started', 'исходную задачу из начатого спринта не убрать');

-- ---- закрытие ----
select throws_ok(format($$select public.close_sprint(%L)$$, :'s1'), '23514', 'reasons_required', 'без причин невыполненные не закрыть');
select pg_temp.back();
update public.tasks set status_category = 'done', completed_at = now() where id = :'t1';
select pg_temp.act_as('pm1@demo.test');
select is((public.close_sprint(:'s1', :'s2', jsonb_build_object(:'t2', 'design') || (select coalesce(jsonb_object_agg(task_id, 'planning'), '{}') from public.sprint_tasks where sprint_id = :'s1' and task_id not in (:'t1', :'t2'))) ->> 'completed')::int, 1, 'закрыт: выполнена 1 из исходных');
select is((select reason from public.sprint_tasks where sprint_id = :'s1' and task_id = :'t2'), 'design', 'причина сохранена');
select is((select count(*)::int from public.sprint_tasks where sprint_id = :'s2' and task_id = :'t2'), 1, 'невыполненная перенесена в следующий спринт');
select pg_temp.back();

-- ---- права и видимость ----
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.create_sprint(%L, 'Чужой', current_date, current_date + 6)$$, :'zk7'), '42501', null, 'мастер без прав спринт не создаёт');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.design_sprints), 0, 'внешние спринты не видят');
select pg_temp.back();

select * from finish();
rollback;
