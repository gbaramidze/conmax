-- Требует сид-данных. Чат вне проекта: личная переписка одна на пару людей, группы без проекта, кого можно позвать, общий список и присутствие.
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
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset
select id as director from public.users where email = 'director@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset

-- тест идёт в откатываемой транзакции: убираем чужие переписки из локальной базы, чтобы счётчики были точными
delete from public.chat_messages;
delete from public.chat_channels;

select pg_temp.act_as('pm1@demo.test');
-- личная переписка не зависит от проекта: с любой стороны и с любым значением проекта — один и тот же канал
select public.chat_open(null, 'direct', null, :'sub1') as dm \gset
select is(public.chat_open(:'zk7', 'direct', null, :'sub1'), :'dm'::uuid, 'переписка с коллегой одна на все проекты');
select is((select project_id from public.chat_channels where id = :'dm'), null, 'у личной переписки проекта нет');
-- внутренние сотрудники пишут друг другу независимо от проектов (директор не участвует ни в одном проекте)
select lives_ok(format($$select public.chat_open(null, 'direct', null, %L)$$, :'director'), 'внутренний сотрудник доступен всем внутренним');
select public.chat_group_create('Планёрка по объектам', array[:'director', :'pm2']::uuid[]) as grp \gset
select is((select project_id from public.chat_channels where id = :'grp'), null, 'у группы проекта нет');
select lives_ok(format($$select public.chat_send(%L, 'Всем привет')$$, :'grp'), 'группа из людей разных проектов работает');
select pg_temp.back();

-- внешний: только своя организация и внутренняя команда с общим проектом
select pg_temp.act_as('sub1@demo.test');
select lives_ok(format($$select public.chat_send(%L, 'Добрый день')$$, :'dm'), 'подрядчик отвечает в личной переписке');
select throws_ok(format($$select public.chat_open(null, 'direct', null, %L)$$, :'pm2'), '42501', null, 'сотрудник из другого проекта подрядчику недоступен');
select throws_ok(format($$select public.chat_open(null, 'direct', null, %L)$$, :'director'), '42501', null, 'сотрудник без общего проекта тоже недоступен');
select throws_ok(format($$select public.chat_group_create('Моя', array[%L]::uuid[])$$, :'pm2'), '42501', null, 'в группу подрядчика чужих сотрудников не добавить');
select is((select count(*)::int from public.chat_channels where kind in ('direct', 'group')), 1, 'подрядчик видит только свою переписку');
select pg_temp.back();

-- общий список: проектные каналы подписаны проектом, личные — нет
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from jsonb_array_elements(public.chat_overview()) e where e ->> 'kind' = 'project' and e ->> 'project_code' = 'ZK7'), 1, 'общий чат проекта виден в общем списке с кодом проекта');
select public.presence_ping();
select ok((select online from public.chat_online() where user_id = :'pm1'), 'присутствие общее для всего приложения');
select pg_temp.back();

select * from finish();
rollback;
