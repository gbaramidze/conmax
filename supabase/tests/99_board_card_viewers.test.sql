-- Требует сид-данных. Видимость карточки общей доски (миграция 141): по умолчанию «все, кто видит доску»;
-- «только выбранные» — автор, участники карточки и выбранные автором люди. Менять видимость и список может только автор;
-- в скрытую карточку постороннего (в том числе @упоминанием) зовёт только автор; копия сохраняет видимость; история.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.sees(p_card uuid) returns int language sql as $$ select count(*)::int from public.board_cards where id = p_card $$;

select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' and tenant_id = :'tenant' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select full_name as foreman_name from public.users where email = 'foreman1@demo.test' \gset

-- общая доска: pm1 управляет, master и foreman1 — участники
select pg_temp.act_as('pm1@demo.test');
select public.board_create(:'zk7', 'shared', 'Видимость', 'blue', false, array['Сделать']) as board \gset
select id as list from public.board_lists where board_id = :'board' \gset
insert into public.board_members (board_id, user_id) values (:'board', :'master'), (:'board', :'foreman1');
select pg_temp.back();

-- master создаёт карточку: по умолчанию её видят все на доске
select pg_temp.act_as('master@demo.test');
insert into public.board_cards (board_id, list_id, title) values (:'board', :'list', 'Смета на отделку') returning id as card \gset
select is((select visibility from public.board_cards where id = :'card'), 'all', 'новая карточка — «видят все»');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.sees(:'card'), 1, 'участник доски видит обычную карточку');
select throws_ok(format($$update public.board_cards set visibility = 'selected' where id = %L$$, :'card'), 'P0001', 'only_author_sets_visibility',
  'не автор видимость не меняет');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$update public.board_cards set visibility = 'selected' where id = %L$$, :'card'), 'P0001', 'only_author_sets_visibility',
  'и управляющий доской тоже');
select pg_temp.back();

-- автор скрывает карточку и выбирает, кто видит
select pg_temp.act_as('master@demo.test');
select lives_ok(format($$update public.board_cards set visibility = 'selected' where id = %L$$, :'card'), 'автор делает карточку «только выбранным»');
insert into public.board_checklists (board_id, card_id, title) values (:'board', :'card', 'Этапы');
insert into public.board_comments (board_id, card_id, body) values (:'board', :'card', 'Цена 200');
select is(pg_temp.sees(:'card'), 1, 'автор видит свою скрытую карточку');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.sees(:'card'), 0, 'невыбранный участник доски скрытую карточку не видит');
select is((select count(*)::int from public.board_comments where body = 'Цена 200'), 0, 'и её комментарии');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is(pg_temp.sees(:'card'), 0, 'управляющий доской — тоже нет');
select throws_ok(format($$insert into public.board_card_viewers (card_id, user_id, board_id) values (%L, %L, %L)$$, :'card', :'pm1', :'board'),
  '42501', null, 'и сам себя в «кто видит» не добавит');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select lives_ok(format($$insert into public.board_card_viewers (card_id, user_id, board_id) values (%L, %L, %L)$$, :'card', :'gip', :'board'),
  'автор выбирает, кто видит (ГИП)');
select throws_ok(format($$insert into public.board_card_viewers (card_id, user_id, board_id) select %L, id, %L from public.users where email = 'pm2@demo.test'$$, :'card', :'board'),
  'P0001', 'user_cannot_view_board', 'выбрать того, кто не видит доску, нельзя');
select pg_temp.back();

select pg_temp.act_as('gip@demo.test');
select is(pg_temp.sees(:'card'), 1, 'выбранный видит карточку');
select is((select count(*)::int from public.board_checklists where card_id = :'card'), 1, 'и её содержимое');
select throws_ok(format($$insert into public.board_card_members (card_id, user_id, board_id) values (%L, %L, %L)$$, :'card', :'foreman1', :'board'),
  'P0001', 'card_hidden_from_user', 'не автор не зовёт в скрытую карточку того, кто её не видит');
-- упоминание не автора скрытую карточку не раскрывает
insert into public.board_comments (board_id, card_id, body) values (:'board', :'card', '@' || :'foreman_name' || ' глянь');
select pg_temp.back();
select is((select count(*)::int from public.board_card_members where card_id = :'card' and user_id = :'foreman1'), 0, 'упоминание не автора не добавляет в скрытую карточку');
select is((select count(*)::int from public.notifications where user_id = :'foreman1' and entity_id = :'card'), 0, 'и уведомления о ней не приходят');

-- копия сохраняет видимость; автор копии — копирующий, прежний автор и выбранные видят её
select pg_temp.act_as('gip@demo.test');
select public.board_card_copy(:'card', :'list', 'Смета (копия)', 1000000) as copy \gset
select is((select visibility from public.board_cards where id = :'copy'), 'selected', 'копия скрытой карточки тоже скрыта');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select is(pg_temp.sees(:'copy'), 1, 'прежний автор видит копию');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.sees(:'copy'), 0, 'невыбранный — нет');
select pg_temp.back();

-- снова для всех
select pg_temp.act_as('master@demo.test');
update public.board_cards set visibility = 'all' where id = :'card';
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select is(pg_temp.sees(:'card'), 1, 'вернули «видят все» — карточку снова видно');
select pg_temp.back();
select is((select count(*)::int from public.board_activity where card_id = :'card' and kind = 'visibility'), 2, 'история: смена видимости');

select * from finish();
rollback;
