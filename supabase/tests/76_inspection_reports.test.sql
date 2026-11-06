-- Требует сид-данных. Инспекция выполненных работ: создание по месту, разделы, замечания, итог, выдача, подписи, права, внешние участники.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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
select id as org from public.organizations where tenant_id = :'ten' and deleted_at is null limit 1 \gset
delete from public.inspection_reports where project_id = :'zk7';

-- схема привязана к месту: изображение в изображениях места
select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/insp-plan.png', 'plan.png', 'image/png', 2000) returning id as fplan \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/insp-render.png', 'render.png', 'image/png', 2000) returning id as frender \gset
select pg_temp.back();
-- у места рендер (обложка) и схема: схемой отчёта должна стать только отмеченная
insert into public.entity_images (tenant_id, project_id, entity_type, entity_id, file_id, is_cover, is_plan) values (:'ten', :'zk7', 'location', :'loc', :'frender', true, false), (:'ten', :'zk7', 'location', :'loc', :'fplan', false, true);
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
select public.inspection_save(:'zk7', null, :'loc', null, '2026-11-03', :'org', 'Схема: коридор слева, санузел справа', 'Общее замечание') as r1 \gset
select is((select key from public.inspection_reports where id = :'r1'), 'ZK7-IR-' || (select number from public.inspection_reports where id = :'r1'), 'ключ строится из кода проекта и номера');
select is((select title from public.inspection_reports where id = :'r1'), (select name from public.locations where id = :'loc'), 'название по умолчанию — название места');
select is((select count(*)::int from public.inspection_sections where report_id = :'r1'), 8, 'заведены восемь стандартных разделов');
select is((select string_agg(code, ',' order by position) from public.inspection_sections where report_id = :'r1'), 'walls,floor,ceiling,doors,windows,electrical,sanitary,ffe', 'порядок разделов как в форме');
select is((select result from public.inspection_reports where id = :'r1'), null, 'пока ничего не проверено — итога нет');
select is((select scheme_file_id from public.inspection_reports where id = :'r1'), :'fplan'::uuid, 'схема подставилась от места');
select is((select count(*)::int from public.inspection_scheme_options(:'loc') where kind = 'file'), 1, 'среди изображений в вариантах схемы только отмеченные как схема');

select id as s_walls from public.inspection_sections where report_id = :'r1' and code = 'walls' \gset
select id as s_floor from public.inspection_sections where report_id = :'r1' and code = 'floor' \gset
select public.inspection_item_save(:'s_walls', null, 'Дефект окраски', 'C') as i1 \gset
select public.inspection_item_save(:'s_walls', null, 'Шов у стены', null) as i2 \gset
select is((select position from public.inspection_items where id = :'i2'), 2, 'замечания нумеруются внутри раздела');
select is((select cnt_c || '/' || cnt_open from public.inspection_reports where id = :'r1'), '1/1', 'счётчики: одно с замечанием, одно без статуса');
select throws_ok(format($$select public.inspection_issue(%L)$$, :'r1'), '22023', 'items_without_status', 'выдать с замечанием без статуса нельзя');
select public.inspection_item_point(:'i2', 0.25, 0.75);
select is((select scheme_x::text || '/' || scheme_y::text from public.inspection_items where id = :'i2'), '0.2500/0.7500', 'точка замечания на схеме сохранена');
select throws_ok(format($$select public.inspection_item_point(%L, 1.5, 0.5)$$, :'i2'), '22023', 'point_invalid', 'точка вне схемы отклоняется');
select throws_ok(format($$select public.inspection_set_scheme(%L, gen_random_uuid())$$, :'r1'), '22023', 'scheme_not_from_place', 'схему можно выбрать только из изображений места');
select public.inspection_item_save(:'s_walls', :'i2', 'Шов у стены', 'R');
select is((select result from public.inspection_reports where id = :'r1'), 'R', 'есть «не принято» — итог R');
select throws_ok(format($$select public.inspection_section_set(%L, true)$$, :'s_walls'), '22023', 'section_has_remarks', 'раздел с замечаниями нельзя пометить «без замечаний»');
select public.inspection_section_set(:'s_floor', true);
select public.inspection_item_delete(:'i2');
select is((select result from public.inspection_reports where id = :'r1'), 'C', 'после удаления R итог C');
select public.inspection_item_delete(:'i1');
select is((select result from public.inspection_reports where id = :'r1'), 'A', 'остался раздел «без замечаний» — итог A');
select public.inspection_section_add(:'r1', 'Лоджия') as s_custom \gset
select throws_ok(format($$select public.inspection_section_set(%L, null, 'Переименован')$$, :'s_walls'), '22023', 'section_standard', 'стандартный раздел не переименовать');
select public.inspection_section_set(:'s_custom', null, 'Лоджия и балкон');
select is((select title from public.inspection_sections where id = :'s_custom'), 'Лоджия и балкон', 'свой раздел переименовывается');

-- фото и подпись
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/insp-photo.jpg', 'foto.jpg', 'image/jpeg', 1000) returning id as f1 \gset
select public.inspection_photo_add(:'r1', :'f1', null, 'Общий вид') as ph1 \gset
select is((select count(*)::int from public.inspection_photos where report_id = :'r1'), 1, 'фото добавлено');
select public.inspection_issue(:'r1');
select is((select status from public.inspection_reports where id = :'r1'), 'issued', 'отчёт выдан');
select throws_ok(format($$select public.inspection_item_save(%L, null, 'после выдачи', 'A')$$, :'s_walls'), '22023', 'report_issued', 'выданный отчёт править нельзя');
select public.inspection_sign(:'r1', 'client', 'Кто-то другой');
select is((select client_name from public.inspection_reports where id = :'r1'), (select full_name from public.users where email = 'pm1@demo.test'), 'подпись заказчика — от имени автора из профиля, введённое имя не берётся');
select pg_temp.back();
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$select public.inspection_sign(%L, 'contractor', 'Подрядчик')$$, :'r1'), '42501', 'sign_author_only', 'подписывает только тот, кто провёл инспекцию');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select public.inspection_reopen(:'r1');
select public.inspection_set_scheme(:'r1', null);
select is((select count(*)::int from public.inspection_items where report_id = :'r1' and scheme_x is not null), 0, 'при смене схемы точки сбрасываются');

-- план этажа в «Документах»: чертёж, привязанный к месту, тоже может быть схемой
select pg_temp.back();
insert into public.documents (tenant_id, project_id, title, doc_type) values (:'ten', :'zk7', 'L05 Floor Plan', 'drawing') returning id as doc \gset
insert into public.document_versions (tenant_id, project_id, document_id, version_no, file_id) values (:'ten', :'zk7', :'doc', 1, :'f1') returning id as ver \gset
update public.documents set current_version_id = :'ver' where id = :'doc';
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.users where email = 'pm1@demo.test'), 'role', 'authenticated', 'tenant_id', :'ten', 'is_external', false)::text, true);
insert into public.document_links (document_id, entity_type, entity_id) values (:'doc', 'location', :'loc');
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.inspection_scheme_options(:'loc') where kind = 'document' and title = 'L05 Floor Plan'), 1, 'чертёж, привязанный к месту, попал в варианты схемы');
select public.inspection_set_scheme(:'r1', null, :'ver');
select is((select (scheme_version_id = :'ver'::uuid and scheme_file_id is null)::text from public.inspection_reports where id = :'r1'), 'true', 'схемой отчёта выбрана версия чертежа');
select public.inspection_save(:'zk7', :'r1', :'loc', 'Повтор', '2026-11-03', null, '', '');
select is((select scheme_version_id from public.inspection_reports where id = :'r1'), :'ver'::uuid, 'при сохранении с тем же местом выбранная схема сохраняется');
select is((select status || '/' || coalesce(client_name, '-') from public.inspection_reports where id = :'r1'), 'draft/-', 'открытие заново возвращает в черновик и снимает подписи');
select pg_temp.back();

-- права и внешние
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.inspection_reports where project_id = :'zk7'), 1, 'мастер видит отчёты');
select throws_ok(format($$select public.inspection_item_save(%L, null, 'x', 'A')$$, :'s_walls'), '42501', 'permission denied: inspection.conduct', 'мастер отчёты не ведёт');
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
select is((select count(*)::int from public.inspection_reports where project_id = :'zk7'), 0, 'посторонний отчётов не видит');
select pg_temp.back();

select * from finish();
rollback;
