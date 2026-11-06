-- Требует сид-данных. Совещания: повестка, участники, решения, поручения, протокол; видимость для внешних.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- автоповестка сигналов добавляет пункт при создании совещания; в этом тесте проверяется только шаблонная повестка
delete from public.signals;

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.rows_changed(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as bc2 from public.projects where code = 'BC2' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as des from public.users where email = 'designer@demo.test' \gset
select id as mst from public.users where email = 'master@demo.test' \gset
select id as cli from public.users where email = 'client@demo.test' \gset
select id as sb1 from public.users where email = 'sub1@demo.test' \gset

-- ---- создание ----
select pg_temp.act_as('pm1@demo.test');
select public.create_meeting(:'zk7', 'Еженедельная планёрка', 'weekly', now() + interval '1 day', 90, 'Бытовка', 'internal',
                             null, array[:'fm1', :'des', :'mst']::uuid[], array['Итоги прошлой недели', 'Бетонирование F05']) as m1 \gset
select is((select count(*)::int from public.meeting_participants where meeting_id = :'m1'), 4, 'организатор и приглашённые в составе');
select is((select facilitator_id from public.meetings where id = :'m1'), :'pm1'::uuid, 'ведущий по умолчанию — организатор');
select is((select count(*)::int from public.meeting_agenda_items where meeting_id = :'m1'), 2, 'повестка создана');
select ok((select key from public.meetings where id = :'m1') like 'ZK7-M-%', 'у совещания сквозной номер проекта');

select throws_ok(format($$select public.create_meeting(%L, 'Чужое', 'weekly', now(), 60, null, 'internal', null, '{}', '{}')$$, :'bc2'),
                 '42501', null, 'в проекте, где не состоишь, создавать нельзя');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.create_meeting(%L, 'Мастер', 'weekly', now(), 60, null, 'internal', null, '{}', '{}')$$, :'zk7'),
                 '42501', null, 'без права meeting.create создать нельзя');
select pg_temp.back();

select ok(exists (select 1 from public.notifications where user_id = :'fm1' and entity_type = 'meeting' and entity_id = :'m1' and body like 'Вас пригласили на совещание%'),
          'приглашённый уведомлён');

-- ---- видимость и права на правку ----
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.meetings where id = :'m1'), 1, 'участник видит совещание');
select is(pg_temp.rows_changed(format($$update public.meetings set title = 'Взлом' where id = %L$$, :'m1')), 0, 'мастер не может менять параметры');
select is((select count(*)::int from public.meeting_participants where meeting_id = :'m1'), 4, 'состав виден');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.meetings where id = :'m1'), 0, 'внешний не видит внутреннее совещание');
select pg_temp.back();
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.meetings), 0, 'подрядчик не видит чужих совещаний');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is(pg_temp.rows_changed(format($$update public.meetings set place = 'Переговорная', duration_min = 60 where id = %L$$, :'m1')), 1, 'организатор правит параметры');
select lives_ok(format($$insert into public.meeting_agenda_items (meeting_id, title) values (%L, 'Вопросы подрядчиков')$$, :'m1'), 'организатор дополняет повестку');
select is((select max(sort) from public.meeting_agenda_items where meeting_id = :'m1'), 30, 'новый пункт встаёт в конец');
select throws_ok(format($$insert into public.meeting_decisions (meeting_id, text) values (%L, 'Рано')$$, :'m1'),
                 '22023', 'meeting_not_in_progress', 'решения до начала не фиксируются');
select throws_ok(format($$select public.set_meeting_status(%L, 'published')$$, :'m1'), '22023', 'invalid_transition', 'протокол нельзя выпустить, не проведя совещание');
select pg_temp.back();

-- ---- проведение ----
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.set_meeting_status(%L, 'in_progress')$$, :'m1'), '42501', null, 'начать совещание может только ведущий');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.set_meeting_status(%L, 'in_progress')$$, :'m1'), 'ведущий начинает совещание');
select is(pg_temp.rows_changed(format($$update public.meeting_participants set attendance = 'present' where meeting_id = %L and user_id in (%L, %L)$$, :'m1', :'pm1', :'fm1')), 2, 'присутствие отмечено');
select lives_ok(format($$insert into public.meeting_decisions (meeting_id, text) values (%L, 'Бетонирование F05 переносим на четверг')$$, :'m1'), 'решение зафиксировано');
select is((select number from public.meeting_decisions where meeting_id = :'m1'), 1, 'решение получило номер');
select ok((select (public.add_meeting_action(:'m1', 'Согласовать пересменку бетононасоса', :'fm1', current_date + 2, 'high')).meeting_id) = :'m1'::uuid,
          'поручение создано как задача и привязано к совещанию');
select is((select type from public.tasks where meeting_id = :'m1'), 'action_item', 'поручение — задача типа action_item');
select is((select assignee_id from public.tasks where meeting_id = :'m1'), :'fm1'::uuid, 'исполнитель назначен');
select pg_temp.back();

select ok(exists (select 1 from public.notifications where user_id = :'fm1' and entity_type = 'task' and entity_id = (select id from public.tasks where meeting_id = :'m1')),
          'исполнитель поручения уведомлён');

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.add_meeting_action(%L, 'Чужое', null, null, 'normal')$$, :'m1'), '42501', null, 'вести поручения может только ведущий');
select pg_temp.back();

-- ---- протокол ----
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.set_meeting_status(%L, 'minutes_draft')$$, :'m1'), 'совещание завершено, протокол — черновик');
select is(pg_temp.rows_changed(format($$update public.meetings set summary = 'Обсудили сроки бетонирования.' where id = %L$$, :'m1')), 1, 'краткое содержание записано');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.set_meeting_status(%L, 'published')$$, :'m1'), '42501', null, 'опубликовать протокол может руководитель проекта или ведущий');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.set_meeting_status(%L, 'published')$$, :'m1'), 'протокол опубликован');
select throws_ok(format($$update public.meetings set title = 'Позже' where id = %L$$, :'m1'), '22023', 'meeting_closed', 'опубликованное совещание не правится');
select throws_ok(format($$insert into public.meeting_decisions (meeting_id, text) values (%L, 'Позже')$$, :'m1'), '22023', 'meeting_closed', 'решение в закрытом совещании не добавить');
select is((select open_actions_count from public.meetings_overview where id = :'m1'), 1, 'в сводке считаются открытые поручения');
select pg_temp.back();

-- ---- внешнее совещание: заказчик видит решения только после публикации ----
select pg_temp.act_as('pm1@demo.test');
select public.create_meeting(:'zk7', 'Приёмка с заказчиком', 'client', now() + interval '2 days', 60, null, 'external',
                             null, array[:'cli']::uuid[], '{}') as m2 \gset
select public.set_meeting_status(:'m2', 'in_progress');
select lives_ok(format($$insert into public.meeting_decisions (meeting_id, text) values (%L, 'Принято с замечаниями')$$, :'m2'), 'решение внешнего совещания');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.meetings where id = :'m2'), 1, 'приглашённый заказчик видит внешнее совещание');
select is((select count(*)::int from public.meeting_decisions where meeting_id = :'m2'), 0, 'решения скрыты до публикации протокола');
select pg_temp.back();
select ok(exists (select 1 from public.notifications where user_id = :'cli' and entity_type = 'meeting' and entity_id = :'m2'), 'заказчик получил приглашение');

select pg_temp.act_as('pm1@demo.test');
select public.set_meeting_status(:'m2', 'minutes_draft');
select public.set_meeting_status(:'m2', 'published');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.meeting_decisions where meeting_id = :'m2'), 1, 'после публикации решения видны заказчику');
select pg_temp.back();

-- ---- отмена, обсуждение, чужие люди ----
select pg_temp.act_as('pm1@demo.test');
select public.create_meeting(:'zk7', 'Лишнее', 'other', now() + interval '3 days', 30, null, 'internal', null, '{}', '{}') as m3 \gset
select lives_ok(format($$select public.set_meeting_status(%L, 'cancelled')$$, :'m3'), 'совещание можно отменить до начала');
select throws_ok(format($$select public.set_meeting_status(%L, 'in_progress')$$, :'m3'), '22023', 'invalid_transition', 'отменённое не начать');
select throws_ok(format($$select public.create_meeting(%L, 'Без ведущего из проекта', 'other', now(), 30, null, 'internal', %L, '{}', '{}')$$, :'zk7', (select id from public.users where email = 'foreman2@demo.test')),
                 '23514', null, 'ведущий должен быть участником проекта');
select lives_ok(format($$insert into public.comments (entity_type, entity_id, body) values ('meeting', %L, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Прошу подготовить смету"}]}]}')$$, :'m1'),
                'совещание можно обсуждать комментариями');
select pg_temp.back();

select * from finish();
rollback;
