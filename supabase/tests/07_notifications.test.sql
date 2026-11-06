-- Требует сид-данных. Конвейер уведомлений: получатели, фильтр прав, группировка, настройки, RLS.
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
create function pg_temp.doc(p_text text, p_mention uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
    'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text))
      || case when p_mention is null then '[]'::jsonb
         else jsonb_build_array(jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('id', p_mention, 'label', 'X'))) end)));
$$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset

-- Чистое состояние: сид уже создал уведомления, они не должны мешать
delete from public.notifications;

-- 1. Назначение
select pg_temp.act_as('pm1@demo.test');
select id as t1 from public.create_task(:'zk7', 'Тест уведомлений', 'task', :'foreman1') \gset
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.notifications where entity_id = :'t1'), 1, 'исполнитель получает уведомление о назначении');
select is((select priority from public.notifications where entity_id = :'t1'), 'high', 'назначение — высокий приоритет');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.notifications), 0, 'автор действия себя не уведомляет');

-- 2. Упоминания: внутренний комментарий не доходит до внешнего, внешний — доходит
insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', pg_temp.doc('Проверьте, пожалуйста', :'foreman1'), 'internal');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', pg_temp.doc('Нужна ваша оценка', :'sub1'), 'internal');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.notifications where category = 'mentioned' and entity_type = 'project'), 1, 'упомянутый коллега получает уведомление');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.notifications where entity_type = 'project'), 0, 'внешний не получает уведомление о внутреннем комментарии');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', pg_temp.doc('Прошу ответить', :'sub1'), 'external');
select pg_temp.back();
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.notifications where category = 'mentioned'), 1, 'внешний получает уведомление о внешнем комментарии');
select pg_temp.back();

-- 3. Группировка: два комментария к задаче за окно → одно уведомление со счётчиком
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility) values ('task', :'t1', pg_temp.doc('Первый'), 'internal');
insert into public.comments (entity_type, entity_id, body, visibility) values ('task', :'t1', pg_temp.doc('Второй'), 'internal');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.notifications where entity_id = :'t1'), 1, 'изменения одной задачи схлопываются в одно уведомление');
select is((select (payload -> 'counts' ->> 'commented')::int from public.notifications where entity_id = :'t1'), 2, 'счётчик комментариев в группе');
select ok((select body from public.notifications where entity_id = :'t1') like '%2 комментария%', 'текст группы: «2 комментария»');
select pg_temp.back();

-- 4. Настройки: «Наблюдаю» выключено — наблюдательские уведомления не приходят, назначения приходят
select pg_temp.act_as('foreman1@demo.test');
insert into public.notification_preferences (category, channel, mode) values ('watching', 'in_app', 'off');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select id as t2 from public.create_task(:'zk7', 'Вторая тестовая', 'task', :'foreman1') \gset
insert into public.comments (entity_type, entity_id, body, visibility) values ('task', :'t2', pg_temp.doc('Комментарий при выключенном наблюдении'), 'internal');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select is((select (payload -> 'counts' ->> 'commented') from public.notifications where entity_id = :'t2'), null, 'выключенная категория не создаёт уведомлений');
select pg_temp.back();

-- 5. Права на сами уведомления
select pg_temp.act_as('foreman1@demo.test');
update public.notifications set read_at = now() where entity_id = :'t1';
select is((select (public.my_notification_counts() ->> 'all')::int), 2, 'прочитанное уходит из счётчика (остаются упоминание в проекте и задача t2)');
select throws_ok($$update public.notifications set title = 'взлом'$$, '42501', null, 'текст уведомления клиент менять не может');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.notifications where user_id = :'foreman1'), 0, 'чужие уведомления не видны');
select throws_ok(format($$insert into public.watchers (entity_type, entity_id, user_id) values ('task', %L, %L)$$, :'t1', :'sub1'),
                 '42501', null, 'нельзя следить за недоступной задачей');
select pg_temp.back();

select * from finish();
rollback;
