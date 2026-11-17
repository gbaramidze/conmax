-- Требует сид-данных. Напоминания о сроке карточек: «срок скоро» за сутки и «просрочена» — участникам карточки
-- (без участников — автору), один раз на срок; не трогаем выполненные, архивные, дальние и давно просроченные.
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
-- фоновое задание: без пользователя в сессии
create function pg_temp.as_cron() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.card(p_title text) returns uuid language sql as $$ select id from public.board_cards where title = p_title $$;

select id as zk7 from public.projects p where p.code = 'ZK7' and p.tenant_id = (select tenant_id from public.users where email = 'pm1@demo.test') \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
select public.board_create(:'zk7', 'shared', 'Сроки', 'blue', false, array['Сделать', 'Старое']) as board \gset
select id as list from public.board_lists where board_id = :'board' and title = 'Сделать' \gset
insert into public.board_members (board_id, user_id) values (:'board', :'master');
insert into public.board_cards (board_id, list_id, title, due_at, due_done) values
  (:'board', :'list', 'Скоро срок',        now() + interval '2 hours',  false),
  (:'board', :'list', 'Просрочена',        now() - interval '1 hour',   false),
  (:'board', :'list', 'Уже выполнена',     now() - interval '1 hour',   true),
  (:'board', :'list', 'Ещё нескоро',       now() + interval '3 days',   false),
  (:'board', :'list', 'В архиве',          now() - interval '1 hour',   false),
  (:'board', :'list', 'Давно забыта',      now() - interval '10 days',  false);
update public.board_cards set archived_at = now() where title = 'В архиве';
insert into public.board_card_members (card_id, user_id, board_id) values (pg_temp.card('Скоро срок'), :'master', :'board');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select public.board_create(:'zk7', 'personal', 'Мои сроки', 'green', false, array['Дела']) as pboard \gset
insert into public.board_cards (board_id, list_id, title, due_at)
select :'pboard', id, 'Личная просрочена', now() - interval '30 minutes' from public.board_lists where board_id = :'pboard';
select pg_temp.as_cron();

delete from public.notifications;
select private.board_due_reminders();

select is((select event_type from public.notifications where user_id = :'master' and entity_id = pg_temp.card('Скоро срок')), 'board_card.due_soon', 'участник карточки: «срок скоро»');
select is((select category from public.notifications where user_id = :'master' and entity_id = pg_temp.card('Скоро срок')), 'assigned', 'в категории «Назначено»');
select ok(exists (select 1 from public.email_outbox o join public.notifications n on n.id = o.notification_id
                   where n.user_id = :'master' and n.entity_id = pg_temp.card('Скоро срок')), 'и письмо поставлено в очередь');
select is((select event_type from public.notifications where user_id = :'pm1' and entity_id = pg_temp.card('Просрочена')), 'board_card.overdue', 'без участников — автору: «просрочена»');
select ok((select body from public.notifications where user_id = :'pm1' and entity_id = pg_temp.card('Просрочена')) like 'Карточка просрочена: срок был __.__.____ __:__', 'с датой срока');
select is((select count(*)::int from public.notifications
            where entity_id in (pg_temp.card('Уже выполнена'), pg_temp.card('Ещё нескоро'), pg_temp.card('В архиве'), pg_temp.card('Давно забыта'))), 0,
          'выполненные, дальние, архивные и давно просроченные — без напоминаний');
select is((select count(*)::int from public.notifications where user_id = :'foreman1' and entity_id = pg_temp.card('Личная просрочена')), 1, 'личная доска: напоминание владельцу');

update public.notifications set read_at = now();
select private.board_due_reminders();
select is((select count(*)::int from public.notifications where read_at is null), 0, 'повторный запуск не дублирует напоминания');

-- срок перенесли в прошлое: по новому сроку — «просрочена»
update public.board_cards set due_at = now() - interval '5 minutes' where id = pg_temp.card('Скоро срок');
update public.notifications set read_at = now();  -- уведомление «срок изменён» здесь не проверяем
select private.board_due_reminders();
select is((select event_type from public.notifications where user_id = :'master' and read_at is null), 'board_card.overdue', 'новый срок — новое напоминание');

-- выполнили — больше не напоминаем даже по новому сроку
update public.notifications set read_at = now();
update public.board_cards set due_at = now() + interval '1 hour', due_done = true where id = pg_temp.card('Скоро срок');
update public.notifications set read_at = now();
select private.board_due_reminders();
select is((select count(*)::int from public.notifications where read_at is null), 0, 'после отметки «выполнено» напоминаний нет');

-- снят с карточки — не получает
update public.board_cards set due_done = false, due_at = now() + interval '3 hours' where id = pg_temp.card('Скоро срок');
delete from public.board_card_members where card_id = pg_temp.card('Скоро срок');
update public.notifications set read_at = now();
select private.board_due_reminders();
select is((select count(*)::int from public.notifications where user_id = :'master' and read_at is null), 0, 'снятый с карточки напоминание не получает');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and read_at is null and entity_id = pg_temp.card('Скоро срок')), 1, '— его получает автор');

select * from finish();
rollback;
