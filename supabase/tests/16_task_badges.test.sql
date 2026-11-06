-- Требует сид-данных. Сводка значков задачи считается с правами вызывающего.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

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
select id as task from public.tasks where project_id = :'zk7' and key = 'ZK7-T-1' \gset

select pg_temp.act_as('pm1@demo.test');
insert into public.checklists (entity_type, entity_id, title) values ('task', :'task', 'Значки');
insert into public.checklist_items (checklist_id, text, done)
select id, x.t, x.d from public.checklists, (values ('один', true), ('два', false), ('три', false)) as x(t, d) where entity_id = :'task' and title = 'Значки';
select is((select checklist_total from public.task_badges(array[:'task'::uuid])), 3, 'в сводке три пункта чек-листа');
select is((select checklist_done from public.task_badges(array[:'task'::uuid])), 1, 'один из них выполнен');
select is((select count(*)::int from public.task_badges(array[:'task'::uuid, gen_random_uuid()])), 2, 'для каждого запрошенного id возвращается строка');
select pg_temp.back();

-- подрядчик не видит чужую задачу, поэтому и её чек-лист не попадает в счёт
select pg_temp.act_as('sub1@demo.test');
select is((select checklist_total from public.task_badges(array[:'task'::uuid])), 0, 'подрядчик не видит чек-лист чужой задачи');
select is((select comments from public.task_badges(array[:'task'::uuid])), 0, 'и её комментарии');
select pg_temp.back();

select * from finish();
rollback;
