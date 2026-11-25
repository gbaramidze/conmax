-- Требует сид-данных. Фото у позиции заявки: сохраняется с позицией, видно согласующему без доступа к проекту,
-- чужой или не картинку прикрепить нельзя, убранное фото перестаёт быть вложением заявки.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
delete from public.rfqs where project_id = :'zk7';
delete from public.material_requests where project_id = :'zk7';
select id as director from public.users where email = 'director@demo.test' \gset

-- прораб загрузил фото модели и не-картинку
select pg_temp.act_as('foreman1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes) values (:'zk7', :'ten' || '/' || :'zk7' || '/t-photo.jpg', 'Смеситель.jpg', 'image/jpeg', 1000) returning id as photo \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes) values (:'zk7', :'ten' || '/' || :'zk7' || '/t-doc.pdf', 'Счёт.pdf', 'application/pdf', 1000) returning id as doc \gset
select public.material_request_save(:'zk7', 'Сантехника', null, null, null, '',
  jsonb_build_array(jsonb_build_object('name', 'Смеситель Grohe 32 xxx', 'unit', 'шт', 'qty', 4, 'photo', :'photo'), jsonb_build_object('name', 'Шланг', 'unit', 'шт', 'qty', 4))) as r1 \gset
select is((select photo_file_id from public.material_request_lines where request_id = :'r1' and position = 1), :'photo'::uuid, 'фото привязано к позиции');
select is((public.procurement_request(:'r1') -> 'lines' -> 0 -> 'photo' ->> 'name'), 'Смеситель.jpg', 'карточка отдаёт фото позиции');
select is(jsonb_array_length(public.procurement_request(:'r1') -> 'files'), 0, 'фото позиции не дублируется в списке файлов');
select throws_ok(format($$select public.material_request_save(%L, 'X', null, null, null, '', jsonb_build_array(jsonb_build_object('name', 'Y', 'qty', 1, 'photo', %L)))$$, :'zk7', :'doc'),
                 '22023', 'photo_invalid', 'вместо фото документ не прикрепить');
-- правка черновика: фото сохраняется (передаётся снова)
select public.material_request_save(:'zk7', 'Сантехника', :'r1', null, null, '',
  jsonb_build_array(jsonb_build_object('name', 'Смеситель Grohe 32 xxx', 'unit', 'шт', 'qty', 5, 'photo', :'photo')));
select is((select count(*)::int from public.attachments where entity_type = 'material_request' and entity_id = :'r1' and caption = 'line'), 1, 'вложение фото одно и после правки');
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();

-- чужое фото другой человек прикрепить не может
select pg_temp.act_as('master@demo.test');
select throws_ok(format($$select public.material_request_save(%L, 'Чужое', null, null, null, '', jsonb_build_array(jsonb_build_object('name', 'Y', 'qty', 1, 'photo', %L)))$$, :'zk7', :'photo'),
                 '22023', 'photo_invalid', 'чужой файл к своей заявке не прикрепить');
select pg_temp.back();

-- согласующий: пока его не позвали, фото не видит; позвали согласовать — видит
select pg_temp.act_as('director@demo.test');
select is(private.can_read_request_file(:'ten' || '/' || :'zk7' || '/t-photo.jpg'), false, 'не участвует в заявке — фото не видно');
select pg_temp.back();
insert into public.material_request_approvals (tenant_id, request_id, round, user_id) values (:'ten', :'r1', 1, :'director');
select pg_temp.act_as('director@demo.test');
select is(private.can_read_request_file(:'ten' || '/' || :'zk7' || '/t-photo.jpg'), true, 'согласующий видит фото позиции');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select is(private.can_read_request_file(:'ten' || '/' || :'zk7' || '/t-photo.jpg'), false, 'внешний участник фото не видит');
select pg_temp.back();

select * from finish();
rollback;
