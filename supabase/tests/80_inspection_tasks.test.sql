-- Требует сид-данных. Инспекция → задачи: замечание C/R превращается в задачу «замечание» с исполнителем, сроком, фото и ссылкой назад.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7, tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as loc from public.locations where project_id = :'zk7' and deleted_at is null and kind = 'floor' order by path limit 1 \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as mst from public.users where email = 'master@demo.test' \gset
delete from public.inspection_reports where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.inspection_save(:'zk7', null, :'loc', 'Этаж для задач', '2026-11-04') as r1 \gset
select id as s_walls from public.inspection_sections where report_id = :'r1' and code = 'walls' \gset
select id as s_floor from public.inspection_sections where report_id = :'r1' and code = 'floor' \gset
select public.inspection_item_save(:'s_walls', null, 'Дефект окраски у окна', 'C') as i1 \gset
select public.inspection_item_save(:'s_walls', null, 'Всё хорошо', 'A') as i2 \gset
select public.inspection_item_save(:'s_floor', null, 'Фуга не заполнена', 'R') as i3 \gset
select public.inspection_item_save(:'s_floor', null, 'Без статуса', null) as i4 \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/task-photo.jpg', 'foto.jpg', 'image/jpeg', 1000) returning id as f1 \gset
select public.inspection_photo_add(:'r1', :'f1', :'i1', null);

-- одно замечание
select public.inspection_item_assign(:'i1', :'fm1', current_date + 7) as t1 \gset
select is((select type || '/' || key from public.tasks where id = :'t1'), 'punch/' || (select key from public.tasks where id = :'t1'), 'создана задача типа «замечание»');
select is((select title from public.tasks where id = :'t1'), '[' || (select key from public.inspection_reports where id = :'r1') || ' · 1.1] Дефект окраски у окна', 'название: ключ отчёта, номер пункта, текст замечания');
select is((select assignee_id::text || '/' || due_date::text || '/' || priority from public.tasks where id = :'t1'), :'fm1' || '/' || (current_date + 7)::text || '/normal', 'исполнитель, срок и приоритет C — обычный');
select is((select location_id from public.tasks where id = :'t1'), :'loc'::uuid, 'место задачи — место отчёта');
select is((select count(*)::int from public.attachments where entity_type = 'task' and entity_id = :'t1'), 1, 'фото замечания прикреплено к задаче');
select is((select task_id from public.inspection_items where id = :'i1'), :'t1'::uuid, 'замечание помнит задачу');
select is((select source_type || '/' || source_id::text from public.tasks where id = :'t1'), 'inspection_item/' || :'i1', 'задача помнит замечание');
select throws_ok(format($$select public.inspection_item_assign(%L)$$, :'i1'), '22023', 'already_assigned', 'второй раз задачу по замечанию не создать');
select throws_ok(format($$select public.inspection_item_assign(%L)$$, :'i2'), '22023', 'item_not_remark', 'по принятому пункту (A) задача не нужна');

-- у выданного отчёта задачи тоже раздаются; «раздать все» берёт только замечания без задач
select public.inspection_item_save(:'s_floor', :'i4', 'Без статуса теперь C', 'C');
select public.inspection_issue(:'r1');
select is(public.inspection_assign_all(:'r1', :'fm1', current_date + 3), 2, '«раздать все» создало задачи для оставшихся C и R');
select is((select priority from public.tasks where id = (select task_id from public.inspection_items where id = :'i3')), 'high', 'приоритет R — высокий');

-- разным исполнителям за одно действие
select public.inspection_save(:'zk7', null, :'loc', 'Второй отчёт', '2026-11-04') as r2 \gset
select id as s2 from public.inspection_sections where report_id = :'r2' and code = 'walls' \gset
select public.inspection_item_save(:'s2', null, 'Первое замечание', 'C') as j1 \gset
select public.inspection_item_save(:'s2', null, 'Второе замечание', 'R') as j2 \gset
select is(public.inspection_assign_many(:'r2', jsonb_build_array(
  jsonb_build_object('item', :'j1', 'assignee', :'fm1', 'due', '2026-11-10'),
  jsonb_build_object('item', :'j2', 'assignee', :'mst', 'due', '2026-11-12'))), 2, 'раздача списком создала две задачи');
select is((select assignee_id::text || '/' || due_date::text from public.tasks where id = (select task_id from public.inspection_items where id = :'j1')), :'fm1' || '/2026-11-10', 'первое замечание — свой исполнитель и срок');
select is((select assignee_id::text || '/' || due_date::text from public.tasks where id = (select task_id from public.inspection_items where id = :'j2')), :'mst' || '/2026-11-12', 'второе замечание — другой исполнитель и срок');

-- фото можно убрать из задачи, пока оно нужно отчёту (файл не удаляется)
select lives_ok(format($$delete from public.attachments where entity_type = 'task' and entity_id = %L$$, :'t1'), 'фото можно убрать из задачи');
select is((select count(*)::int from public.files where id = :'f1'), 1, 'файл остался: он нужен отчёту');
select pg_temp.back();

-- задача выполнена: автор отчёта получает уведомление со ссылкой на отчёт
update public.tasks set status_category = 'done' where id = :'t1';
select is((select count(*)::int from public.notifications where user_id = (select id from public.users where email = 'pm1@demo.test') and entity_id = :'t1' and payload ->> 'link' like '%/inspection/%'), 1, 'автор отчёта получил уведомление о выполненной задаче со ссылкой на отчёт');

-- сводка для списка: три замечания, у всех задачи, выполнена одна; готовности к проверке ещё нет
select is((select remarks::text || '/' || with_task || '/' || done || '/' || ready from public.inspection_task_stats(:'zk7') where report_id = :'r1'), '3/3/1/false', 'сводка: 3 замечания, 3 задачи, выполнена 1, к проверке ещё не готово');
-- выполнены остальные: отчёт готов к проверке, автору приходит отдельное уведомление
update public.tasks set status_category = 'done' where source_type = 'inspection_item' and source_id in (:'i3', :'i4');
select is((select ready::text from public.inspection_task_stats(:'zk7') where report_id = :'r1'), 'true', 'все задачи выполнены: отчёт готов к проверке');
select is((select count(*)::int from public.notifications where user_id = (select id from public.users where email = 'pm1@demo.test') and payload ->> 'last_text' like 'Все задачи по отчёту%'), 1, 'автору пришло уведомление «зайдите проверить»');

-- подтверждение устранения у выданного отчёта
select pg_temp.act_as('pm1@demo.test');
select public.inspection_item_resolve(:'i1');
select is((select (resolved_at is not null)::text from public.inspection_items where id = :'i1'), 'true', 'замечание отмечено устранённым');
select public.inspection_item_resolve(:'i1', false);
select is((select (resolved_at is null)::text from public.inspection_items where id = :'i1'), 'true', 'отметку можно снять');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.inspection_item_resolve(%L)$$, :'i1'), '42501', 'permission denied: inspection.conduct', 'без права вести инспекции устранение не подтвердить');
select throws_ok(format($$select public.inspection_assign_all(%L)$$, :'r1'), '42501', 'permission denied: inspection.conduct', 'без права вести инспекции задачи не раздать');
select pg_temp.back();

select * from finish();
rollback;
