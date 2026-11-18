-- Требует сид-данных. Автоматизация досок (миграция 142): правила только на личной доске и только у владельца;
-- события (выполнена → в «Готово», перенос в «Готово» → новая карточка по шаблону), цепочка без зацикливания,
-- условия по времени (без обновлений N дней → метка и комментарий от «Автоматизации», лежит в колонке N дней → архив)
-- срабатывают один раз; проверка колонок и меток правила; история помечена как автоматическая.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

select tenant_id as tenant from public.users where email = 'foreman1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' and tenant_id = :'tenant' \gset

-- личная доска прораба
select pg_temp.act_as('foreman1@demo.test');
select public.board_create(:'zk7', 'personal', 'Автоматика', 'green', false, array['Сделать', 'В работе', 'Готово']) as board \gset
select id as todo from public.board_lists where board_id = :'board' and title = 'Сделать' \gset
select id as doing from public.board_lists where board_id = :'board' and title = 'В работе' \gset
select id as done from public.board_lists where board_id = :'board' and title = 'Готово' \gset
select id as red from public.board_labels where board_id = :'board' order by position limit 1 \gset

select lives_ok(format($$insert into public.board_automations (board_id, title, trigger, actions)
  values (%L, 'Выполнено — в Готово', 'completed', jsonb_build_array(jsonb_build_object('type', 'move', 'list_id', %L)))$$, :'board', :'done'),
  'владелец создаёт правило «выполнена → в Готово»');
select lives_ok(format($$insert into public.board_automations (board_id, trigger, trigger_list_id, actions)
  values (%L, 'moved_to_list', %L, jsonb_build_array(jsonb_build_object('type', 'create_card', 'list_id', %L, 'title', 'Приёмка: {{title}}', 'description', 'Проверить «{{title}}» из колонки {{list}}')))$$,
  :'board', :'done', :'todo'), 'и «перенесена в Готово → создать карточку»');
select throws_ok(format($$insert into public.board_automations (board_id, trigger, actions)
  values (%L, 'completed', jsonb_build_array(jsonb_build_object('type', 'move', 'list_id', gen_random_uuid())))$$, :'board'),
  'P0001', 'automation_bad_list', 'колонка не с этой доски — нельзя');
select throws_ok(format($$insert into public.board_automations (board_id, trigger, actions)
  values (%L, 'completed', '[{"type": "explode"}]')$$, :'board'), 'P0001', 'automation_bad_action', 'неизвестное действие — нельзя');
select throws_ok(format($$insert into public.board_automations (board_id, trigger, actions) values (%L, 'stale', '[{"type": "archive"}]')$$, :'board'),
  '23514', null, '«без обновлений» без числа дней — нельзя');

-- событие: выполнена → в Готово → новая карточка (цепочка)
insert into public.board_cards (board_id, list_id, title) values (:'board', :'todo', 'Купить краску') returning id as card \gset
update public.board_cards set completed = true where id = :'card';
select is((select list_id from public.board_cards where id = :'card'), :'done'::uuid, 'выполненная карточка сама ушла в «Готово»');
select is((select list_id from public.board_cards where title = 'Приёмка: Купить краску' and board_id = :'board'), :'todo'::uuid,
  'перенос запустил следующее правило: создана карточка по шаблону');
select is((select description from public.board_cards where title = 'Приёмка: Купить краску' and board_id = :'board'), 'Проверить «Купить краску» из колонки Готово',
  'описание по шаблону');
select is((select (data ->> 'auto')::boolean from public.board_activity where card_id = :'card' and kind = 'moved'), true, 'в истории перенос помечен как автоматический');
select pg_temp.back();

-- чужие правила не видны, на общей доске (пока) правил нет
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.board_automations where board_id = :'board'), 0, 'чужие правила не видны');
select public.board_create(:'zk7', 'shared', 'Общая с правилами', 'blue', false, array['Сделать']) as shared \gset
select throws_ok(format($$insert into public.board_automations (board_id, trigger, actions) values (%L, 'completed', '[{"type": "archive"}]')$$, :'shared'),
  'P0001', 'automation_personal_only', 'на общей доске правила пока не создаются');
select pg_temp.back();

-- цикл: «в работе → в Готово» и «в Готово → в работе» не зацикливаются
select pg_temp.act_as('foreman1@demo.test');
update public.board_automations set enabled = false where board_id = :'board';
insert into public.board_automations (board_id, trigger, trigger_list_id, actions)
values (:'board', 'moved_to_list', :'doing', jsonb_build_array(jsonb_build_object('type', 'move', 'list_id', :'done'))),
       (:'board', 'moved_to_list', :'done', jsonb_build_array(jsonb_build_object('type', 'move', 'list_id', :'doing')));
insert into public.board_cards (board_id, list_id, title) values (:'board', :'todo', 'Карусель') returning id as loop \gset
select lives_ok(format($$update public.board_cards set list_id = %L where id = %L$$, :'doing', :'loop'), 'взаимные правила не уходят в бесконечный цикл');
select ok((select count(*) from public.board_activity where card_id = :'loop' and kind = 'moved') between 2 and 4, 'цепочка остановилась через несколько шагов');
delete from public.board_automations where board_id = :'board' and trigger = 'moved_to_list' and enabled;

-- по времени: без обновлений 3 дня → метка и комментарий; лежит в «Готово» 7 дней → архив
insert into public.board_automations (board_id, trigger, trigger_days, actions)
values (:'board', 'stale', 3, jsonb_build_array(jsonb_build_object('type', 'add_label', 'label_id', :'red'),
                                                jsonb_build_object('type', 'comment', 'text', 'Требует обновления')));
insert into public.board_automations (board_id, trigger, trigger_list_id, trigger_days, actions)
values (:'board', 'in_list_for', :'done', 7, '[{"type": "archive"}]');
insert into public.board_cards (board_id, list_id, title) values (:'board', :'doing', 'Заказать окна') returning id as stale \gset
select pg_temp.back();

-- состарить карточки (без триггеров, которые ставят updated_at = now())
set local session_replication_role = replica;
update public.board_cards set updated_at = now() - interval '4 days', created_at = now() - interval '4 days' where id = :'stale';
update public.board_activity set created_at = now() - interval '4 days' where card_id = :'stale';
update public.board_activity set created_at = now() - interval '8 days' where card_id = :'card';
update public.board_cards set updated_at = now() - interval '8 days' where id = :'card';
set local session_replication_role = origin;

select ok(private.board_automations_tick() >= 2, 'фоновая проверка сработала');
select ok(:'red' = any (select label_id::text from public.board_card_labels where card_id = :'stale'), 'зависшей карточке поставлена метка');
select is((select body from public.board_comments where card_id = :'stale' and is_system), 'Требует обновления', 'и комментарий от автоматизации');
select is((select author_id from public.board_comments where card_id = :'stale' and is_system), null, 'без автора-человека');
select ok((select archived_at from public.board_cards where id = :'card') is not null, 'карточка, неделю лежащая в «Готово», ушла в архив');

select is(private.board_automations_tick(), 0, 'повторно то же самое не срабатывает');
select is((select count(*)::int from public.board_comments where card_id = :'stale' and is_system), 1, 'комментарий один');

-- человек обновил карточку — отсчёт начинается заново, сразу ничего не происходит
select pg_temp.act_as('foreman1@demo.test');
update public.board_cards set title = 'Заказать окна ПВХ' where id = :'stale';
select pg_temp.back();
select is(private.board_automations_tick(), 0, 'после обновления карточка не «зависшая»');

select * from finish();
rollback;
