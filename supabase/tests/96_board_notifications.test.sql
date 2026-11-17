-- Требует сид-данных. Уведомления досок: добавление на доску и в карточку, @упоминания в комментарии и описании,
-- комментарии и перенос карточки — её участникам; письмо ставится в очередь; себе и тем, кто доску не видит, — ничего.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7 from public.projects p where p.code = 'ZK7' and p.tenant_id = (select tenant_id from public.users where email = 'pm1@demo.test') \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select full_name as gip_name from public.users where email = 'gip@demo.test' \gset
select full_name as master_name from public.users where email = 'master@demo.test' \gset
select full_name as foreman_name from public.users where email = 'foreman1@demo.test' \gset

delete from public.notifications;

-- общая доска, участник доски
select pg_temp.act_as('pm1@demo.test');
select public.board_create(:'zk7', 'shared', 'Отделка', 'blue', false, array['Сделать', 'Готово']) as board \gset
insert into public.board_members (board_id, user_id) values (:'board', :'master');
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = :'master' and event_type = 'board.member_added'), 1, 'участнику общей доски — «Вас добавили на доску»');
select ok((select payload ->> 'link' from public.notifications where user_id = :'master' and event_type = 'board.member_added') like '/projects/ZK7/boards?kind=shared&board=%',
          'со ссылкой на доску');

-- карточка и её участник
select pg_temp.act_as('pm1@demo.test');
insert into public.board_cards (board_id, list_id, title)
select :'board', l.id, 'Покраска стен' from public.board_lists l where l.board_id = :'board' and l.title = 'Сделать';
select id as card from public.board_cards where board_id = :'board' and title = 'Покраска стен' \gset
insert into public.board_card_members (card_id, user_id, board_id) values (:'card', :'master', :'board');
select pg_temp.back();

select is((select category from public.notifications where user_id = :'master' and event_type = 'board_card.assigned'), 'assigned', 'участнику карточки — «Вас добавили в карточку»');
select is((select title from public.notifications where user_id = :'master' and event_type = 'board_card.assigned'), 'Карточка «Покраска стен»', 'заголовок — карточка');
select ok((select payload ->> 'link' from public.notifications where user_id = :'master' and event_type = 'board_card.assigned') like '%&card=' || :'card',
          'ссылка открывает карточку');
select ok(exists (select 1 from public.email_outbox o join public.notifications n on n.id = o.notification_id
                   where n.user_id = :'master' and n.event_type = 'board_card.assigned'), 'и письмо поставлено в очередь');

update public.notifications set read_at = now();

-- комментарий с упоминанием: ГИП (видит доску по праву board.manage) и прораб (доску не видит)
select pg_temp.act_as('pm1@demo.test');
insert into public.board_comments (board_id, card_id, body)
values (:'board', :'card', '@' || :'gip_name' || ', проверь цвет. @' || :'foreman_name' || ' тоже глянь');
select pg_temp.back();

select is((select category from public.notifications where user_id = :'gip' and event_type = 'board_card.mentioned' and read_at is null), 'mentioned', 'упомянутый получил «упоминание»');
select ok((select body from public.notifications where user_id = :'gip' and event_type = 'board_card.mentioned' and read_at is null) like 'Упоминание от %: «@%',
          'с текстом комментария');
select is((select count(*)::int from public.notifications where user_id = :'foreman1' and read_at is null), 0, 'упомянутый, который не видит доску, ничего не получает');
select is((select category from public.notifications where user_id = :'master' and event_type = 'board_card.commented' and read_at is null), 'watching', 'участник карточки узнаёт о комментарии');
select is((select count(*)::int from public.notifications where user_id = :'pm1' and read_at is null), 0, 'автор себя не уведомляет');

update public.notifications set read_at = now();

-- правка комментария без новых упоминаний — без повторного уведомления
select pg_temp.act_as('pm1@demo.test');
update public.board_comments set body = body || '!', edited_at = now() where card_id = :'card';
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'gip' and read_at is null), 0, 'правка не повторяет упоминание');

-- упоминание в описании
select pg_temp.act_as('master@demo.test');
update public.board_cards set description = 'Краска в подсобке, ключ у @' || :'gip_name' where id = :'card';
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'gip' and event_type = 'board_card.mentioned' and read_at is null), 1, 'упоминание в описании карточки');

-- перенос карточки
select pg_temp.act_as('pm1@demo.test');
update public.board_cards set list_id = (select id from public.board_lists where board_id = :'board' and title = 'Готово') where id = :'card';
select pg_temp.back();
select ok((select payload ->> 'last_text' from public.notifications where user_id = :'master' and event_type = 'board_card.changed' and read_at is null)
          like 'Карточка перемещена: «Сделать» → «Готово» (%)', 'участник узнаёт о переносе карточки');

update public.notifications set read_at = now();

-- срок и свои действия
select pg_temp.act_as('master@demo.test');
update public.board_cards set due_at = '2026-12-01 10:00+04' where id = :'card';
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'master' and read_at is null), 0, 'о своём изменении себе не уведомляем');

select pg_temp.act_as('pm1@demo.test');
update public.board_cards set due_at = '2026-12-05 10:00+04' where id = :'card';
select pg_temp.back();
select ok((select payload ->> 'last_text' from public.notifications where user_id = :'master' and event_type = 'board_card.due_changed' and read_at is null)
          like 'Срок: %.12.2026 % → %.12.2026 % (%)', 'участник узнаёт о новом сроке');

-- снят с карточки — больше не получает
select pg_temp.act_as('pm1@demo.test');
delete from public.board_card_members where card_id = :'card' and user_id = :'master';
select pg_temp.back();
update public.notifications set read_at = now() where user_id = :'master';
select pg_temp.act_as('pm1@demo.test');
insert into public.board_comments (board_id, card_id, body) values (:'board', :'card', 'Готово, принимаю');
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'master' and read_at is null), 0, 'снятый с карточки о комментариях не узнаёт');

-- карточка, которую участник доски не видит (он не её участник и не автор): упоминание добавляет его в карточку
select pg_temp.act_as('pm1@demo.test');
insert into public.board_cards (board_id, list_id, title)
select :'board', l.id, 'Плитка в санузлах' from public.board_lists l where l.board_id = :'board' and l.title = 'Сделать';
insert into public.board_comments (board_id, card_id, body)
select :'board', id, '@' || :'master_name' || ' посмотри' from public.board_cards where board_id = :'board' and title = 'Плитка в санузлах';
select pg_temp.back();
select is((select count(*)::int from public.board_card_members m join public.board_cards c on c.id = m.card_id
             where c.title = 'Плитка в санузлах' and m.user_id = :'master'), 1, 'упомянутого участника доски, который не видел карточку, добавили в неё');
select is((select count(*)::int from public.notifications where user_id = :'master' and read_at is null), 1, 'и он получил одно уведомление');
select is((select category from public.notifications where user_id = :'master' and read_at is null), 'mentioned', '— об упоминании, без отдельного «Вас добавили в карточку»');

select * from finish();
rollback;
