-- Требует сид-данных. Чат проекта: общий чат только внутренним, чат организации, личные переписки, непрочитанное, удаление, присутствие.
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
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select id as client from public.users where email = 'client@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select organization_id as suborg from public.users where email = 'sub1@demo.test' \gset
select organization_id as clientorg from public.users where email = 'client@demo.test' \gset

-- общий чат: внутренним можно, внешнему нельзя; повторное открытие даёт тот же канал
-- тест идёт в откатываемой транзакции: убираем чужие переписки из локальной базы, чтобы счётчики были точными
delete from public.chat_messages;
delete from public.chat_channels;

select pg_temp.act_as('pm1@demo.test');
select public.chat_open(:'zk7', 'project') as ch_project \gset
select is(public.chat_open(:'zk7', 'project'), :'ch_project'::uuid, 'общий чат один на проект');
select public.chat_open(:'zk7', 'org', :'suborg') as ch_org \gset
select public.chat_send(:'ch_org', '  Привет, МонолитСтрой  ') as msg1 \gset
select is((select body from public.chat_messages where id = :'msg1'), 'Привет, МонолитСтрой', 'пробелы по краям убираются');
select throws_ok(format($$select public.chat_send(%L, '   ')$$, :'ch_org'), '22023', 'invalid_message', 'пустое сообщение нельзя');
select public.chat_send(:'ch_project', 'Только для своих');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.chat_open(%L, 'project')$$, :'zk7'), '42501', null, 'внешний не открывает общий чат');
select throws_ok(format($$select public.chat_send(%L, 'я тут')$$, :'ch_project'), '42501', null, 'внешний не пишет в общий чат');
select is((select count(*)::int from public.chat_messages where channel_id = :'ch_project'), 0, 'сообщений общего чата внешний не видит');
select is(public.chat_open(:'zk7', 'org', :'suborg'), :'ch_org'::uuid, 'свой чат организации открывается');
select throws_ok(format($$select public.chat_open(%L, 'org', %L)$$, :'zk7', :'clientorg'), '42501', null, 'чужой чат организации — нельзя');
select is((select count(*)::int from public.chat_messages where id = :'msg1'), 1, 'сообщение организации видно');
select is(public.chat_unread_count(), 1, 'одно непрочитанное');
select is(jsonb_array_length(public.chat_overview()), 1, 'в списке внешнего только чат его организации');
select public.chat_mark_read(:'ch_org');
select is(public.chat_unread_count(), 0, 'после прочтения непрочитанных нет');

-- личная переписка: с внутренним можно, с сотрудником чужой организации нельзя
select public.chat_open(:'zk7', 'direct', null, :'pm1') as ch_dm \gset
select lives_ok(format($$select public.chat_send(%L, 'Вопрос по армированию')$$, :'ch_dm'), 'личное сообщение отправлено');
select throws_ok(format($$select public.chat_open(%L, 'direct', null, %L)$$, :'zk7', :'client'), '42501', null, 'сотрудник другой внешней организации недоступен');
select pg_temp.back();

select pg_temp.act_as('gip@demo.test');
select is((select count(*)::int from public.chat_channels where kind = 'direct'), 0, 'чужую переписку не видно');
select pg_temp.back();

-- удалять можно только своё
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.chat_delete(%L)$$, (select id from public.chat_messages where channel_id = :'ch_dm' limit 1)), '42501', null, 'чужое сообщение не удалить');
select lives_ok(format($$select public.chat_delete(%L)$$, :'msg1'), 'своё сообщение удаляется');

-- присутствие
select public.presence_ping();
select ok((select online from public.chat_online() where user_id = :'pm1'), 'отметившийся — онлайн');
select pg_temp.back();

select * from finish();
rollback;
