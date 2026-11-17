-- Требует сид-данных. Доски проекта: видны только тем, кто видит проект; личная — только владельцу; общую создаёт и настраивает
-- (колонки, участники) только `board.manage` (руководитель проекта, ГИП, администратор); участники работают с карточками;
-- «весь проект» открывает доску внутренним участникам проекта, но не внешним; история карточки.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.uid(p_email text) returns uuid language sql as $$ select id from public.users where email = p_email $$;
create function pg_temp.zk7() returns uuid language sql as $$
  select p.id from public.projects p join public.users u on u.tenant_id = p.tenant_id where p.code = 'ZK7' and u.email = 'pm1@demo.test'
$$;

-- ---------- личная доска ----------
select pg_temp.act_as('foreman1@demo.test');
select ok((select public.board_create(pg_temp.zk7(), 'personal', 'Мои дела', 'green', false, array['Сделать', 'В работе', 'Готово'])) is not null, 'прораб создаёт личную доску в своём проекте');
select is((select count(*)::int from public.board_lists l join public.boards b on b.id = l.board_id where b.title = 'Мои дела'), 3, 'со стартовыми колонками');
select is((select count(*)::int from public.board_labels l join public.boards b on b.id = l.board_id where b.title = 'Мои дела'), 6, 'и шестью метками');
select is((select owner_id from public.boards where title = 'Мои дела'), pg_temp.uid('foreman1@demo.test'), 'владелец — создатель');
select lives_ok($$insert into public.board_lists (board_id, title, position) select id, 'Отложено', 999999 from public.boards where title = 'Мои дела'$$, 'владелец сам добавляет колонку');
select lives_ok($$insert into public.board_cards (board_id, list_id, title) select b.id, l.id, 'Купить рулетку' from public.boards b join public.board_lists l on l.board_id = b.id where b.title = 'Мои дела' and l.title = 'Сделать'$$, 'и карточку');
select throws_ok($$select public.board_create(pg_temp.zk7(), 'shared', 'Общая без права', 'blue', true, null)$$, '42501', null, 'общую доску без права создать нельзя');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select throws_ok($$select public.board_create(pg_temp.zk7(), 'personal', 'Чужой проект', 'blue', false, null)$$, '42501', null, 'в чужом проекте доску не создать');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.boards where title = 'Мои дела'), 0, 'руководитель проекта чужую личную доску не видит');
select is((select count(*)::int from public.board_cards where title = 'Купить рулетку'), 0, 'и её карточки тоже');
select lives_ok($$update public.board_cards set title = 'взлом' where title = 'Купить рулетку'$$, 'попытка изменить чужое проходит вхолостую');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select title from public.board_cards where title in ('Купить рулетку', 'взлом')), 'Купить рулетку', 'карточка не изменилась');
select is((select kind from public.board_activity a join public.board_cards c on c.id = a.card_id where c.title = 'Купить рулетку'), 'created', 'история: карточка создана');
update public.board_cards set list_id = (select l.id from public.board_lists l join public.boards b on b.id = l.board_id where b.title = 'Мои дела' and l.title = 'Готово')
 where title = 'Купить рулетку';
select is((select data ->> 'to' from public.board_activity a join public.board_cards c on c.id = a.card_id where c.title = 'Купить рулетку' and a.kind = 'moved'), 'Готово', 'история: перенос в другую колонку');
select pg_temp.back();

-- ---------- общая доска ----------
select pg_temp.act_as('pm1@demo.test');
select ok((select public.board_create(pg_temp.zk7(), 'shared', 'Снабжение', 'blue', false, array['Заявка', 'Заказано', 'На объекте'])) is not null, 'руководитель проекта создаёт общую доску');
select is((select owner_id from public.boards where title = 'Снабжение'), null, 'у общей доски нет владельца');
select lives_ok($$insert into public.board_members (board_id, user_id) select id, (select id from public.users where email = 'master@demo.test') from public.boards where title = 'Снабжение'$$, 'и добавляет участника проекта');
select throws_ok($$insert into public.board_members (board_id, user_id) select id, (select id from public.users where email = 'pm2@demo.test') from public.boards where title = 'Снабжение'$$,
  'P0001', 'user_not_in_project', 'человека не из проекта добавить нельзя');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.boards where title = 'Снабжение'), 0, 'не участник общую доску не видит');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.board_lists l join public.boards b on b.id = l.board_id where b.title = 'Снабжение'), 3, 'участник видит колонки');
select lives_ok($$insert into public.board_cards (board_id, list_id, title) select b.id, l.id, 'Арматура А500' from public.boards b join public.board_lists l on l.board_id = b.id where b.title = 'Снабжение' and l.title = 'Заявка'$$, 'участник создаёт карточку');
select throws_ok($$insert into public.board_lists (board_id, title) select id, 'Своя колонка' from public.boards where title = 'Снабжение'$$, '42501', null, 'а колонку общей доски добавить не может');
update public.board_lists set title = 'Переименовал' where title = 'Заявка';
select is((select count(*)::int from public.board_lists where title = 'Заявка'), 1, 'и переименовать колонку тоже');
select throws_ok($$insert into public.board_card_members (card_id, user_id, board_id) select c.id, (select id from public.users where email = 'foreman1@demo.test'), c.board_id from public.board_cards c where c.title = 'Арматура А500'$$,
  'P0001', 'user_cannot_view_board', 'участником карточки не сделать того, кто доску не видит');
select pg_temp.back();

-- «весь проект»: видят внутренние участники проекта; внешние и люди из других проектов — нет
select pg_temp.act_as('pm1@demo.test');
update public.boards set all_staff = true where title = 'Снабжение';
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.boards where title = 'Снабжение'), 1, 'с «весь проект» доску видит участник проекта');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.boards where title = 'Снабжение'), 0, 'а внешний пользователь — нет');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select is((select count(*)::int from public.boards where title = 'Снабжение'), 0, 'и человек из другого проекта — тоже нет');
select pg_temp.back();

select pg_temp.act_as('gip@demo.test');
select lives_ok($$update public.board_lists set title = 'Нужно заказать' where title = 'Заявка'$$, 'ГИП настраивает колонки общей доски');
select is((select count(*)::int from public.board_lists where title = 'Нужно заказать'), 1, 'колонка переименована');
select pg_temp.back();

select pg_temp.act_as('admin@demo.test');
select is((select count(*)::int from public.boards where title = 'Снабжение'), 1, 'администратор компании видит общую доску проекта');
select pg_temp.back();

-- ---------- фото фона ----------
create function pg_temp.bg_path(p_title text) returns text language sql as $$
  select b.tenant_id::text || '/' || b.id::text || '/' || gen_random_uuid()::text || '.jpg' from public.boards b where b.title = p_title
$$;
select pg_temp.back();
create temp table bg (title text, path text);
insert into bg select 'Снабжение', pg_temp.bg_path('Снабжение');
grant select on bg to authenticated;

select pg_temp.act_as('master@demo.test');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) select 'board-backgrounds', path, auth.uid() from bg$$, '42501', null, 'участник общей доски фон не загружает');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) select 'board-backgrounds', path, auth.uid() from bg$$, 'руководитель проекта загружает фото фона');
select lives_ok($$update public.boards set background_image = (select path from bg) where title = 'Снабжение'$$, 'и ставит его фоном');
select throws_ok($$update public.boards set background_image = 'чужой/путь.jpg' where title = 'Снабжение'$$, '22023', null, 'чужой путь фоном не поставить');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'board-backgrounds' and name = (select path from bg)), 1, 'участник проекта видит фото фона общей доски');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'board-backgrounds' and name = (select path from bg)), 0, 'человек из другого проекта — нет');
select pg_temp.back();

-- ---------- видимость карточек общей доски ----------
-- Карточку видят её участники, автор и те, кто управляет доской; остальные участники доски — нет
create temp table sec (id uuid, board_id uuid);
grant select, insert on sec to authenticated;

select pg_temp.act_as('pm1@demo.test');
insert into public.board_cards (board_id, list_id, title)
select b.id, l.id, 'Секретная поставка' from public.boards b join public.board_lists l on l.board_id = b.id where b.title = 'Снабжение' order by l.position limit 1;
insert into sec select id, board_id from public.board_cards where title = 'Секретная поставка';
insert into public.board_checklists (board_id, card_id, title) select board_id, id, 'Проверить' from sec;
insert into public.board_checklist_items (board_id, card_id, checklist_id, title) select s.board_id, s.id, c.id, 'Пломбы' from sec s join public.board_checklists c on c.card_id = s.id;
insert into public.board_comments (board_id, card_id, body) select board_id, id, 'Цена 100' from sec;
select is((select count(*)::int from public.board_cards where title = 'Секретная поставка'), 1, 'автор видит свою карточку');
select is((select count(*)::int from public.board_cards where title = 'Арматура А500'), 1, 'руководитель видит чужие карточки доски');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.board_cards where title = 'Секретная поставка'), 0, 'участник доски не видит карточку, в которой его нет');
select is((select count(*)::int from public.board_checklist_items where title = 'Пломбы'), 0, 'и её чек-лист');
select is((select count(*)::int from public.board_comments where body = 'Цена 100'), 0, 'и её комментарии');
select throws_ok($$insert into public.board_comments (board_id, card_id, body) select board_id, id, 'Вижу?' from sec$$, '42501', null, 'и написать в неё не может');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.board_cards where title = 'Секретная поставка'), 0, '«весь проект» не открывает чужие карточки');
select is((select count(*)::int from public.board_cards where title = 'Арматура А500'), 0, 'в том числе карточку другого участника');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok($$insert into public.board_card_members (card_id, user_id, board_id) select id, (select id from public.users where email = 'master@demo.test'), board_id from sec$$, 'руководитель добавляет человека в карточку');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.board_cards where title = 'Секретная поставка'), 1, 'после этого человек видит карточку');
select is((select count(*)::int from public.board_checklist_items where title = 'Пломбы'), 1, 'и её чек-лист');
select is((select count(*)::int from public.board_comments where body = 'Цена 100'), 1, 'и комментарии');
select pg_temp.back();

select pg_temp.act_as('gip@demo.test');
select is((select count(*)::int from public.board_cards where title = 'Секретная поставка'), 1, 'ГИП (управляет доской) видит все карточки');
select pg_temp.back();

select * from finish();
rollback;
