-- Требует сид-данных. Заметка с площадки: точка на схеме места (как в инспекции).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as floor1 from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null order by path limit 1 \gset

-- триггер файлов берёт организацию из токена: задаём его, затем возвращаем права владельца
select pg_temp.act_as('pm1@demo.test');
select pg_temp.back();

-- схема этажа: изображение, отмеченное как план; чужое изображение — не схема этого места
select :'tenant' || '/' || :'zk7' || '/' || gen_random_uuid() || '.png' as skey \gset
select :'tenant' || '/' || :'zk7' || '/' || gen_random_uuid() || '.png' as other_key \gset
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes) values (:'tenant', :'zk7', :'skey', 'plan.png', 'image/png', 10);
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes) values (:'tenant', :'zk7', :'other_key', 'other.png', 'image/png', 10);
select id as plan_file from public.files where storage_key = :'skey' \gset
select id as other_file from public.files where storage_key = :'other_key' \gset
insert into public.entity_images (tenant_id, project_id, entity_type, entity_id, file_id, is_plan) values (:'tenant', :'zk7', 'location', :'floor1', :'plan_file', true);

-- комната на другом этаже: у неё своей схемы нет, а у этажа над ней есть план
select r.id as room1, f.id as room_floor
  from public.locations r
  join public.locations f on f.project_id = r.project_id and f.kind = 'floor' and f.deleted_at is null and r.path::text like f.path::text || '.%'
 where r.project_id = :'zk7' and r.kind = 'room' and r.deleted_at is null order by r.path limit 1 \gset
insert into public.entity_images (tenant_id, project_id, entity_type, entity_id, file_id, is_plan) values (:'tenant', :'zk7', 'location', :'room_floor', :'plan_file', true);

select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility, is_note)
values ('location', :'floor1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Трещина у окна"}]}]}'::jsonb, 'external', true);
select id as note from public.comments where entity_type = 'location' and entity_id = :'floor1' and author_id = :'pm1' order by created_at desc limit 1 \gset

select ok(exists (select 1 from public.inspection_scheme_options(:'floor1') o where o.file_id = :'plan_file'), 'план этажа доступен как схема места');

-- нельзя: чужая схема, неполные координаты, координаты вне схемы, и файл, и версия сразу
select throws_ok(format($q$select public.register_field_note(%L, null, null, null, %L, null, 0.4, 0.6)$q$, :'note', :'other_file'), '42501', null, 'схема, которой нет у места, — отказ');
select throws_ok(format($q$select public.register_field_note(%L, null, null, null, %L, null, 0.4, null)$q$, :'note', :'plan_file'), '22023', null, 'точка без второй координаты — отказ');
select throws_ok(format($q$select public.register_field_note(%L, null, null, null, %L, null, 1.4, 0.2)$q$, :'note', :'plan_file'), '22023', null, 'координата вне схемы — отказ');
select throws_ok(format($q$select public.register_field_note(%L, null, null, null, null, null, 0.4, 0.6)$q$, :'note', :'plan_file'), '22023', null, 'точка без схемы — отказ');

-- можно: своя схема места
select lives_ok(format($q$select public.register_field_note(%L, null, null, null, %L, null, 0.4, 0.6)$q$, :'note', :'plan_file'), 'точка на схеме места сохраняется');
select is((select scheme_x::text || ',' || scheme_y::text from public.field_notes where comment_id = :'note'), '0.4000,0.6000', 'координаты записаны');

-- повторная регистрация без точки не стирает отмеченную
select lives_ok(format($q$select public.register_field_note(%L, null, null, null)$q$, :'note'), 'повторная регистрация без точки проходит');
select is((select scheme_file_id from public.field_notes where comment_id = :'note'), :'plan_file'::uuid, 'точка и схема остались');

-- комната: схема вышестоящего узла (план этажа) для точки не подходит
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility, is_note)
values ('location', :'room1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Розетка"}]}]}'::jsonb, 'external', true);
select id as room_note from public.comments where entity_type = 'location' and entity_id = :'room1' and author_id = :'pm1' order by created_at desc limit 1 \gset
select ok(exists (select 1 from public.inspection_scheme_options(:'room1') o where o.file_id = :'plan_file' and o.source = 'parent'), 'для комнаты план этажа предлагается только как вышестоящий');
select throws_ok(format($q$select public.register_field_note(%L, null, null, null, %L, null, 0.4, 0.6)$q$, :'room_note', :'plan_file'), '42501', null, 'точку комнаты нельзя поставить на схему этажа');

select * from finish();
rollback;
