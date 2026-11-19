-- Требует сид-данных. Строгая видимость общей доски (миграция 148): без «Весь проект» доску видят только создатель
-- и добавленные участники — ни руководитель проекта, ни ГИП, ни администратор по праву board.manage.
-- Гость — человек проекта, добавленный в карточку, но не в доску: видит доску, только колонки со своими карточками
-- и только свои карточки; карточек, меток и колонок не создаёт; звать гостей может только участник доски.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.boards(p_board uuid) returns int language sql as $$ select count(*)::int from public.boards where id = p_board $$;
create function pg_temp.lists(p_board uuid) returns text language sql as $$
  select coalesce(string_agg(title, ',' order by position), '') from public.board_lists where board_id = p_board
$$;
create function pg_temp.cards(p_board uuid) returns text language sql as $$
  select coalesce(string_agg(title, ',' order by title), '') from public.board_cards where board_id = p_board
$$;

select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' and tenant_id = :'tenant' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select full_name as gip_name from public.users where email = 'gip@demo.test' \gset

delete from public.notifications;

-- ---------- без «Весь проект»: только создатель и участники ----------
select pg_temp.act_as('pm1@demo.test');
select public.board_create(:'zk7', 'shared', 'Строго', 'blue', false, array['А', 'Б', 'В']) as board \gset
insert into public.board_members (board_id, user_id) values (:'board', :'master');
select is(pg_temp.boards(:'board'), 1, 'создатель видит свою доску');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is(pg_temp.lists(:'board'), 'А,Б,В', 'участник доски видит все колонки');
select pg_temp.back();

select pg_temp.act_as('gip@demo.test');
select is(pg_temp.boards(:'board'), 0, 'ГИП (board.manage), не добавленный в доску, её не видит');
select is(pg_temp.lists(:'board'), '', 'и колонки тоже');
select throws_ok(format($$insert into public.board_lists (board_id, title) values (%L, 'Чужая')$$, :'board'), '42501', null, 'и не настраивает её');
select pg_temp.back();

select pg_temp.act_as('admin@demo.test');
select is(pg_temp.boards(:'board'), 0, 'администратор компании — тоже нет');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.boards(:'board'), 0, 'остальные сотрудники проекта — нет');
select pg_temp.back();

-- доска, созданная ГИП: руководитель проекта её не видит, пока его не добавят
select pg_temp.act_as('gip@demo.test');
select public.board_create(:'zk7', 'shared', 'Проектная', 'blue', false, array['Чертежи']) as gip_board \gset
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is(pg_temp.boards(:'gip_board'), 0, 'руководитель проекта не видит чужую доску без «Весь проект»');
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
insert into public.board_members (board_id, user_id) select :'gip_board', id from public.users where email = 'pm1@demo.test';
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is(pg_temp.boards(:'gip_board'), 1, 'после добавления — видит');
select lives_ok(format($$insert into public.board_lists (board_id, title) values (%L, 'Согласование')$$, :'gip_board'), 'и, имея board.manage, настраивает');
select pg_temp.back();

-- «Весь проект» открывает доску всем внутренним, снятие — снова закрывает
select pg_temp.act_as('pm1@demo.test');
update public.boards set all_staff = true where id = :'board';
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
select is(pg_temp.boards(:'board'), 1, 'с «Весь проект» ГИП видит доску');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
update public.boards set all_staff = false where id = :'board';
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
select is(pg_temp.boards(:'board'), 0, 'сняли «Весь проект» — снова не видит');
select pg_temp.back();

-- ---------- гость карточки ----------
select pg_temp.act_as('master@demo.test');
insert into public.board_cards (board_id, list_id, title)
select :'board', id, 'Плитка' from public.board_lists where board_id = :'board' and title = 'Б' returning id as tile \gset
insert into public.board_cards (board_id, list_id, title)
select :'board', id, 'Окна' from public.board_lists where board_id = :'board' and title = 'А' returning id as windows \gset
insert into public.board_checklists (board_id, card_id, title) values (:'board', :'tile', 'Раскладка');
select lives_ok(format($$insert into public.board_card_members (card_id, user_id, board_id) values (%L, %L, %L)$$, :'tile', :'foreman1', :'board'),
  'участник доски зовёт в карточку человека проекта, которого нет на доске');
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = :'foreman1' and event_type = 'board_card.assigned' and entity_id = :'tile'), 1,
  'гость получает «Вас добавили в карточку»');

select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.boards(:'board'), 1, 'гость видит доску');
select is(pg_temp.lists(:'board'), 'Б', 'но только колонку со своей карточкой');
select is(pg_temp.cards(:'board'), 'Плитка', 'и только свою карточку');
select is((select count(*)::int from public.board_checklists where card_id = :'tile'), 1, 'с её содержимым');
select is((select count(*)::int from public.board_labels where board_id = :'board'), 6, 'метки доски видны (для своей карточки)');
select is((select count(*)::int from public.board_members where board_id = :'board'), 1, 'список участников доски виден');
select lives_ok(format($$insert into public.board_comments (board_id, card_id, body) values (%L, %L, 'Начинаю')$$, :'board', :'tile'), 'гость комментирует свою карточку');
update public.board_cards set title = 'Плитка в санузлах' where id = :'tile';
update public.board_cards set title = 'взлом' where id = :'windows';
select throws_ok(format($$insert into public.board_cards (board_id, list_id, title) select %L, id, 'Своя' from public.board_lists where board_id = %L and title = 'Б'$$, :'board', :'board'),
  '42501', null, 'гость карточек не создаёт');
select throws_ok(format($$insert into public.board_labels (board_id, name, color) values (%L, 'Моя', 'red')$$, :'board'), '42501', null, 'и меток тоже');
select throws_ok(format($$insert into public.board_card_members (card_id, user_id, board_id) values (%L, %L, %L)$$, :'tile', :'gip', :'board'),
  'P0001', 'only_board_member_invites_guests', 'и других гостей не зовёт');
select is((select count(*)::int from public.board_card_members where card_id = :'windows'), 0, 'чужая карточка ему не видна вместе с участниками');
select pg_temp.back();

select is((select title from public.board_cards where id = :'tile'), 'Плитка в санузлах', 'свою карточку гость правит');
select is((select title from public.board_cards where id = :'windows'), 'Окна', 'чужую — нет');
select ok(private.board_user_can_view(:'board', :'foreman1') and not private.board_user_member(:'board', :'foreman1'), 'гость видит доску, но не участник');
select ok(private.user_can_view_entity(:'foreman1', 'board_card', :'tile') and not private.user_can_view_entity(:'foreman1', 'board_card', :'windows'),
  'уведомления — только по своей карточке');

-- карточку гостя перенесли — вместе с ней «переехала» видимая колонка
select pg_temp.act_as('master@demo.test');
update public.board_cards set list_id = (select id from public.board_lists where board_id = :'board' and title = 'В') where id = :'tile';
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.lists(:'board'), 'В', 'гость видит колонку, куда перенесли его карточку');
select pg_temp.back();

-- упоминание гостем не делает: упомянутый не участник доски в карточку не попадает
select pg_temp.act_as('master@demo.test');
insert into public.board_comments (board_id, card_id, body) values (:'board', :'windows', '@' || :'gip_name' || ' глянь');
select throws_ok(format($$insert into public.board_card_viewers (card_id, user_id, board_id) values (%L, %L, %L)$$, :'windows', :'gip', :'board'),
  'P0001', 'user_cannot_view_board', '«кто видит» выбирают только из участников доски');
select pg_temp.back();
select is((select count(*)::int from public.board_card_members where card_id = :'windows' and user_id = :'gip'), 0, '@упоминание не участника доски не добавляет его в карточку');
select is((select count(*)::int from public.notifications where user_id = :'gip' and entity_id = :'windows'), 0, 'и уведомления не шлёт');

-- убрали из карточки — доска пропала
select pg_temp.act_as('master@demo.test');
delete from public.board_card_members where card_id = :'tile' and user_id = :'foreman1';
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.boards(:'board'), 0, 'убрали из всех карточек — доску больше не видно');
select pg_temp.back();

select * from finish();
rollback;
