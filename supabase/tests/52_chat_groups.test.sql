-- Требует сид-данных. Чат: группы (состав, выход, удаление) и чаты направлений (видят только внутренние сотрудники направления).
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select id as client from public.users where email = 'client@demo.test' \gset
select id as disc from public.disciplines where project_id = :'zk7' and code = 'MON' \gset

-- два сотрудника направления «Монолит»
update public.project_members set discipline_id = :'disc' where project_id = :'zk7' and user_id in (:'gip', :'foreman1');

-- группа: pm1 + gip + подрядчик sub1
-- тест идёт в откатываемой транзакции: убираем чужие переписки из локальной базы, чтобы счётчики были точными
delete from public.chat_messages;
delete from public.chat_channels;

select pg_temp.act_as('pm1@demo.test');
select throws_ok($$select public.chat_group_create('Одна', array[]::uuid[])$$, '22023', 'group_needs_members', 'в группе нужен хотя бы ещё один человек');
select throws_ok(format($$select public.chat_group_create('  ', array[%L]::uuid[])$$, :'gip'), '22023', 'invalid_name', 'у группы должно быть название');
select public.chat_group_create('Заливка этажа 7', array[:'gip', :'sub1']::uuid[]) as grp \gset
select is((select count(*)::int from public.chat_channel_members where channel_id = :'grp'), 3, 'создатель и двое приглашённых');
select lives_ok(format($$select public.chat_send(%L, 'Завтра заливка в 8:00')$$, :'grp'), 'создатель пишет в группу');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.chat_messages where channel_id = :'grp'), 1, 'подрядчик в группе читает');
select throws_ok(format($$select public.chat_group_create('Чужая', array[%L]::uuid[])$$, :'client'), '42501', null, 'внешний не видит сотрудников другой организации');
select throws_ok(format($$select public.chat_group_update(%L, 'Моя', array[%L]::uuid[])$$, :'grp', :'pm1'), '42501', null, 'состав меняет только создатель');
select lives_ok(format($$select public.chat_group_leave(%L)$$, :'grp'), 'участник выходит из группы');
select throws_ok(format($$select public.chat_send(%L, 'я вышел')$$, :'grp'), '42501', null, 'после выхода писать нельзя');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.chat_channels where id = :'grp'), 0, 'постороннему группа не видна');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.chat_group_update(%L, 'Заливка 7 этажа', array[%L, %L]::uuid[])$$, :'grp', :'gip', :'foreman1'), 'создатель меняет название и состав');
select is((select count(*)::int from public.chat_channel_members where channel_id = :'grp'), 3, 'в составе pm1, gip, foreman1');
select throws_ok(format($$select public.chat_group_leave(%L)$$, :'grp'), '22023', 'creator_cannot_leave', 'создатель не выходит — группу удаляют');
select lives_ok(format($$select public.chat_group_delete(%L)$$, :'grp'), 'создатель удаляет группу');
select is((select count(*)::int from public.chat_channels where id = :'grp'), 0, 'удалённая группа пропала из списка');
select pg_temp.back();

-- чат направления «Монолит»: gip и foreman1 видят, pm1 (без направления) и подрядчик — нет
select pg_temp.act_as('gip@demo.test');
select is((select count(*)::int from jsonb_array_elements(public.chat_overview()) e where e ->> 'kind' = 'discipline' and e ->> 'discipline_id' = :'disc'), 1, 'сотрудник направления видит чат направления');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from jsonb_array_elements(public.chat_overview()) e where e ->> 'kind' = 'discipline' and e ->> 'project_id' = :'zk7'), 0, 'руководитель без направления чат направления не видит');
select pg_temp.back();
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from jsonb_array_elements(public.chat_overview()) e where e ->> 'kind' in ('discipline', 'project')), 0, 'подрядчик не видит ни общий чат, ни чаты направлений');
select pg_temp.back();

select * from finish();
rollback;
