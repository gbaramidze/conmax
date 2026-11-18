-- Требует сид-данных. Фото-обложка карточки (первое фото — обложка сама, цвет и фото взаимоисключают, обложка только
-- из картинок этой карточки, снимается вместе с вложением), переименование вложения-файла, вложение «другая карточка»
-- (только видимая добавляющему, без названия в базе и в истории; скрытая остаётся скрытой для остальных).
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

select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' and tenant_id = :'tenant' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset

-- ---------- фото-обложка (общая доска, карточка прораба) ----------
select pg_temp.act_as('pm1@demo.test');
select public.board_create(:'zk7', 'shared', 'Обложки', 'blue', false, array['Сделать']) as board \gset
select id as list from public.board_lists where board_id = :'board' \gset
insert into public.board_members (board_id, user_id) values (:'board', :'master'), (:'board', :'foreman1');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
insert into public.board_cards (board_id, list_id, title) values (:'board', :'list', 'Фасад') returning id as card \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/facade-1.jpg', 'Фасад 1.jpg', 'image/jpeg', 1000) returning id as f1 \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/facade-2.jpg', 'Фасад 2.jpg', 'image/jpeg', 1000) returning id as f2 \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
values (:'zk7', :'tenant' || '/' || :'zk7' || '/smeta.pdf', 'Смета.pdf', 'application/pdf', 1000) returning id as fpdf \gset

insert into public.board_card_attachments (board_id, card_id, file_id, name) values (:'board', :'card', :'fpdf', 'x') returning id as a_pdf \gset
select is((select cover_attachment_id from public.board_cards where id = :'card'), null, 'PDF обложкой не становится');
insert into public.board_card_attachments (board_id, card_id, file_id, name) values (:'board', :'card', :'f1', 'x') returning id as a1 \gset
select is((select cover_attachment_id from public.board_cards where id = :'card'), :'a1'::uuid, 'первое фото стало обложкой само');
insert into public.board_card_attachments (board_id, card_id, file_id, name) values (:'board', :'card', :'f2', 'x') returning id as a2 \gset
select is((select cover_attachment_id from public.board_cards where id = :'card'), :'a1'::uuid, 'второе фото обложку не меняет');

update public.board_cards set cover_attachment_id = :'a2' where id = :'card';
select is((select cover_attachment_id from public.board_cards where id = :'card'), :'a2'::uuid, '«сделать обложкой» другое фото');
select throws_ok(format($$update public.board_cards set cover_attachment_id = %L where id = %L$$, :'a_pdf', :'card'), 'P0001', 'cover_not_image', 'PDF обложкой сделать нельзя');
update public.board_cards set cover = 'red' where id = :'card';
select is((select cover_attachment_id from public.board_cards where id = :'card'), null, 'цветная обложка снимает фото');
update public.board_cards set cover_attachment_id = :'a1' where id = :'card';
select is((select cover from public.board_cards where id = :'card'), null, 'а фото снимает цвет');
delete from public.board_card_attachments where id = :'a1';
select is((select cover_attachment_id from public.board_cards where id = :'card'), null, 'убрали вложение — обложка снялась');

-- переименование
select lives_ok(format($$update public.board_card_attachments set name = '  Фасад, вид с улицы.jpg ' where id = %L$$, :'a2'), 'автор переименовывает вложение');
select is((select name from public.board_card_attachments where id = :'a2'), 'Фасад, вид с улицы.jpg', 'название сохранено без пробелов по краям');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
update public.board_card_attachments set name = 'взлом' where id = :'a2';
select pg_temp.back();
select is((select name from public.board_card_attachments where id = :'a2'), 'Фасад, вид с улицы.jpg', 'чужое вложение не переименовать');

-- ---------- комментарий к вложению ----------
select pg_temp.act_as('foreman1@demo.test');
select lives_ok(format($$insert into public.board_comments (board_id, card_id, body, attachment_id) values (%L, %L, 'Цвет не тот', %L)$$, :'board', :'card', :'a2'),
  'комментарий привязывается к вложению своей карточки');
insert into public.board_cards (board_id, list_id, title) values (:'board', :'list', 'Другая') returning id as other \gset
select throws_ok(format($$insert into public.board_comments (board_id, card_id, body, attachment_id) values (%L, %L, 'x', %L)$$, :'board', :'other', :'a2'),
  'P0001', 'attachment_not_on_card', 'к вложению чужой карточки — нельзя');
delete from public.board_card_attachments where id = :'a2';
select is((select attachment_id from public.board_comments where body = 'Цвет не тот'), null, 'убрали вложение — комментарий остался без ссылки');
select pg_temp.back();

-- ---------- вложение «другая карточка» ----------
select pg_temp.act_as('pm1@demo.test');
insert into public.board_cards (board_id, list_id, title, visibility) values (:'board', :'list', 'Секретная смета', 'selected') returning id as hidden \gset
insert into public.board_cards (board_id, list_id, title) values (:'board', :'list', 'Общий план') returning id as open \gset
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$insert into public.board_card_attachments (board_id, card_id, linked_card_id, name) values (%L, %L, %L, 'x')$$, :'board', :'card', :'hidden'),
  '42501', null, 'скрытую от себя карточку прикрепить нельзя');
select lives_ok(format($$insert into public.board_card_attachments (board_id, card_id, linked_card_id, name) values (%L, %L, %L, 'Подделка')$$, :'board', :'card', :'open'),
  'видимую карточку прикрепить можно');
select is((select name from public.board_card_attachments where card_id = :'card' and linked_card_id = :'open'), 'Карточка', 'название в базе не хранится');
select throws_ok(format($$insert into public.board_card_attachments (board_id, card_id, linked_card_id, name) values (%L, %L, %L, 'x')$$, :'board', :'card', :'card'),
  '23514', null, 'саму себя прикрепить нельзя');
select pg_temp.back();

-- руководитель прикрепляет скрытую карточку к общей: остальные видят вложение, но не карточку и не её название
select pg_temp.act_as('pm1@demo.test');
insert into public.board_card_attachments (board_id, card_id, linked_card_id, name) values (:'board', :'open', :'hidden', 'x');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.board_card_attachments a left join public.board_cards c on c.id = a.linked_card_id
            where a.card_id = :'open' and c.id is null), 1, 'участник видит вложение, но связанная скрытая карточка ему недоступна');
select is((select data from public.board_activity where card_id = :'open' and kind = 'attached'), '{"card": true}'::jsonb, 'в истории — без названия');
select pg_temp.back();

select * from finish();
rollback;
