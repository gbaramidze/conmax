-- Требует сид-данных. Чат: вложения (файл, фото, голос), доступ к файлам в хранилище, реакции, удаление с вложениями.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select organization_id as suborg from public.users where email = 'sub1@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
select public.chat_open(:'zk7', 'org', :'suborg') as ch \gset
select pg_temp.back();

-- два файла, загруженные pm1 в папку канала
select format('%s/%s/%s/', :'tenant', :'zk7', :'ch') as prefix \gset
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('chat', :'prefix' || 'a.pdf', :'pm1', '{"size": 1234, "mimetype": "application/pdf"}'),
  ('chat', :'prefix' || 'v.webm', :'pm1', '{"size": 4000, "mimetype": "audio/webm"}');

select pg_temp.act_as('pm1@demo.test');
select public.chat_send(:'ch', '', jsonb_build_array(
  jsonb_build_object('storage_key', :'prefix' || 'a.pdf', 'name', 'Смета.pdf', 'kind', 'file'),
  jsonb_build_object('storage_key', :'prefix' || 'v.webm', 'name', 'Голосовое.webm', 'kind', 'voice', 'duration_sec', 12))) as msg \gset
select is((select count(*)::int from public.chat_attachments where message_id = :'msg'), 2, 'сообщение только с вложениями отправлено');
select is((select size_bytes from public.chat_attachments where message_id = :'msg' and kind = 'file'), 1234::bigint, 'размер берётся из хранилища');
select is((select duration_sec from public.chat_attachments where message_id = :'msg' and kind = 'voice'), 12, 'длительность голосового сохранена');
select throws_ok(format($$select public.chat_send(%L, '')$$, :'ch'), '22023', 'invalid_message', 'без текста и вложений отправить нельзя');
select throws_ok(format($$select public.chat_send(%L, 'x', %L::jsonb)$$, :'ch', jsonb_build_array(jsonb_build_object('storage_key', :'prefix' || 'нет.pdf', 'name', 'нет', 'kind', 'file'))), '22023', 'invalid_attachment', 'несуществующий файл прикрепить нельзя');
select throws_ok(format($$select public.chat_send(%L, 'x', %L::jsonb)$$, :'ch', jsonb_build_array(jsonb_build_object('storage_key', :'tenant' || '/' || :'zk7' || '/00000000-0000-0000-0000-000000000000/a.pdf', 'name', 'a', 'kind', 'file'))), '22023', 'invalid_attachment', 'файл из чужой папки прикрепить нельзя');
select pg_temp.back();

-- видят вложения и скачивают файл те, кто видит канал
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.chat_attachments where message_id = :'msg'), 2, 'подрядчик видит вложения своего чата');
select is((select count(*)::int from storage.objects where bucket_id = 'chat' and name = :'prefix' || 'a.pdf'), 1, 'и может скачать файл');
select is(public.chat_react(:'msg', '👍'), true, 'реакция поставлена');
select is(public.chat_react(:'msg', '👍'), false, 'повторное нажатие снимает реакцию');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'chat' and name = :'prefix' || 'a.pdf'), 0, 'другая организация файл не видит');
select throws_ok(format($$select public.chat_react(%L, '👍')$$, :'msg'), '42501', null, 'и реагировать на чужое сообщение не может');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.chat_react(%L, '')$$, :'msg'), '22023', 'invalid_emoji', 'пустую реакцию поставить нельзя');
select throws_ok(format($$select public.chat_delete(%L)$$, :'msg'), '42501', null, 'чужое сообщение не удалить');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
-- правка: подписать сообщение с вложениями, нельзя стереть текст у сообщения без вложений
select lives_ok(format($$select public.chat_edit(%L, 'Смета и голосовое')$$, :'msg'), 'сообщение с вложениями можно подписать');
select isnt((select edited_at from public.chat_messages where id = :'msg'), null, 'остаётся пометка «изменено»');
select public.chat_send(:'ch', 'Первый вариант') as msg2 \gset
select throws_ok(format($$select public.chat_edit(%L, '  ')$$, :'msg2'), '22023', 'invalid_message', 'текст сообщения без вложений стереть нельзя');
select pg_temp.back();
select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($$select public.chat_edit(%L, 'чужое')$$, :'msg2'), '42501', null, 'чужое сообщение не править');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is(cardinality(public.chat_delete(:'msg')), 2, 'удаление возвращает ключи двух файлов');
select pg_temp.back();

select * from finish();
rollback;
