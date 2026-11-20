-- Требует сид-данных (ZK7, pm1, foreman1, observer, sub1, pm2). Электронная подпись: отправка на подпись, очередь,
-- подпись свежей копии, итоговая версия документа, отказ, журнал и проверка по коду, подпись PDF из письма.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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

-- внутренний документ ZK7 с действующей PDF-версией
create temp table t_doc as
select d.id as doc, d.project_id as project, d.current_version_id as ver, v.file_id as file, p.tenant_id as tenant
  from public.documents d join public.projects p on p.id = d.project_id
  join public.document_versions v on v.id = d.current_version_id join public.files f on f.id = v.file_id
 where p.code = 'ZK7' and f.mime = 'application/pdf' and d.visibility = 'internal' and d.deleted_at is null
 order by d.created_at limit 1;
grant select on t_doc to authenticated;
create temp table t_req (id uuid);
grant select, insert on t_req to authenticated;

select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$ select public.create_signature_request(%L, array[%L]::uuid[], true, null) $$, (select doc from t_doc), pg_temp.uid('sub1@demo.test')),
  '22023', 'signer_no_access', 'внешний, который не видит внутренний документ, подписантом быть не может');
insert into t_req select public.create_signature_request((select doc from t_doc),
  array[pg_temp.uid('foreman1@demo.test'), pg_temp.uid('observer@demo.test')], true, 'Проверьте и подпишите');
select is((select status from public.signature_requests where id = (select id from t_req)), 'pending', 'запрос на подпись создан');
select throws_ok(format($$ select public.create_signature_request(%L, array[%L]::uuid[], true, null) $$, (select doc from t_doc), pg_temp.uid('observer@demo.test')),
  '23505', 'request_exists', 'второй открытый запрос на тот же документ не создать');
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('foreman1@demo.test') and event_type = 'signature.requested'
            and entity_id = (select doc from t_doc)), 1, 'первому по очереди пришло уведомление');
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('observer@demo.test') and event_type = 'signature.requested'
            and entity_id = (select doc from t_doc)), 0, 'второму — пока нет');

-- не его очередь
select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$ select public.sign_signature_request(%L, array[gen_random_uuid()], array[1], %L, %L, repeat('a', 64), repeat('b', 64), null) $$,
  (select id from t_req), (select file from t_doc), (select file from t_doc)), '22023', 'not_your_turn', 'по порядку — сначала первый подписант');
select pg_temp.back();

-- первый подписывает: загружает новый файл и подписывает рабочую копию
select pg_temp.act_as('foreman1@demo.test');
create temp table t_f1 as with x as (
  insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values ((select project from t_doc), (select tenant from t_doc) || '/' || (select project from t_doc) || '/sig-test-1.pdf', 'signed.pdf', 'application/pdf', 100)
  returning id) select id from x;
select throws_ok(format($$ select public.sign_signature_request(%L, array[gen_random_uuid()], array[1], %L, %L, repeat('a', 64), repeat('b', 64), null) $$,
  (select id from t_req), (select id from t_f1), (select id from t_f1)), '40001', 'stale_copy', 'подписывать можно только свежую рабочую копию');
select is(public.sign_signature_request((select id from t_req), array['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3']::uuid[], array[1, 2], (select file from t_doc), (select id from t_f1),
  repeat('a', 64), repeat('b', 64), 'test')->>'completed', 'false', 'первая подпись сохранена, запрос ещё открыт');
select is((select marks from public.my_signatures() where batch_id = '00000000-0000-4000-8000-0000000000a1'), 2, '«Мои подписи»: одно подписание из двух штампов — одна строка');
select pg_temp.back();
select is((select count(*)::int from public.signatures where batch_id = '00000000-0000-4000-8000-0000000000a1' and file_id = (select id from t_f1)), 2,
  'у подписи запомнен файл, получившийся после неё (для «Мои подписи»)');

select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('observer@demo.test') and event_type = 'signature.requested'
            and entity_id = (select doc from t_doc)), 1, 'теперь очередь второго — ему уведомление');
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('pm1@demo.test') and event_type = 'signature.signed'
            and entity_id = (select doc from t_doc)), 1, 'автору запроса — что первый подписал');

-- второй видит рабочую копию с первой подписью и подписывает её
select pg_temp.act_as('observer@demo.test');
select is((select count(*)::int from public.files where id = (select id from t_f1)), 1, 'рабочую копию видит следующий подписант');
create temp table t_f2 as with x as (
  insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values ((select project from t_doc), (select tenant from t_doc) || '/' || (select project from t_doc) || '/sig-test-2.pdf', 'signed.pdf', 'application/pdf', 100)
  returning id) select id from x;
select is(public.sign_signature_request((select id from t_req), array['00000000-0000-4000-8000-0000000000a2']::uuid[], array[1], (select id from t_f1), (select id from t_f2),
  repeat('b', 64), repeat('c', 64), 'test')->>'completed', 'true', 'подписали все');
select pg_temp.back();

select is((select status from public.signature_requests where id = (select id from t_req)), 'completed', 'запрос закрыт как подписанный');
select is((select v.file_id from public.documents d join public.document_versions v on v.id = d.current_version_id where d.id = (select doc from t_doc)),
  (select id from t_f2), 'подписанный файл — новая действующая версия');
select is((select status from public.document_versions where id = (select ver from t_doc)), 'superseded', 'прежняя версия заменена');

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.signatures where request_id = (select id from t_req)), 3, 'журнал: строка на каждый штамп (2 + 1), видны автору запроса');
select is((select marks from public.verify_signature('00000000-0000-4000-8000-0000000000a3')), 2, 'у второго штампа свой код, и он находит своё подписание из двух штампов');
select is((select page from public.verify_signature('00000000-0000-4000-8000-0000000000a3')), 2::smallint, 'по коду штампа видна его страница');
select is((select signer_name from public.verify_signature('00000000-0000-4000-8000-0000000000a2')), (select full_name from public.users where email = 'observer@demo.test'),
  'проверка по коду из штампа находит подписанта');
select is((select count(*)::int from public.verify_signature(null, repeat('c', 64))), 1, 'проверка по контрольной сумме файла');

-- отказ
insert into t_req select public.create_signature_request((select doc from t_doc), array[pg_temp.uid('observer@demo.test')], false, null);
select pg_temp.back();
select pg_temp.act_as('observer@demo.test');
select lives_ok(format($$ select public.decline_signature_request(%L, 'Не тот объём') $$,
  (select r.id from public.signature_requests r join t_req t on t.id = r.id where r.status = 'pending')), 'подписант может отказаться');
select pg_temp.back();
select is((select count(*)::int from public.signature_requests where document_id = (select doc from t_doc) and status = 'declined'), 1, 'запрос закрыт отказом');

-- подпись PDF из письма — только в журнал, видна только подписавшему
select pg_temp.act_as('pm2@demo.test');
select lives_ok($$ select public.record_signature(array['00000000-0000-4000-8000-0000000000b1']::uuid[], array[1], 'from-mail.pdf', repeat('d', 64), repeat('e', 64), null) $$,
  'подпись вложения письма записана в журнал');
select pg_temp.back();
select throws_ok($$ select public.record_signature(array[gen_random_uuid()], array[1], 'x.pdf', repeat('d', 64), repeat('e', 64), null, 'other/folder/x.pdf') $$,
  '22023', 'invalid_path', 'копия подписанного письма — только в своей папке');
select is((select count(*)::int from public.my_signatures()), 1, 'в «Мои подписи» — только свои подписания');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.signatures where id = '00000000-0000-4000-8000-0000000000b1'), 0, 'чужую подпись из письма в журнале не видно');
select pg_temp.back();

-- мои подписи: несколько, только свои
select pg_temp.act_as('pm2@demo.test');
insert into public.user_signatures (image) values ('data:image/png;base64,AAAA'), ('data:image/png;base64,BBBB');
select is((select count(*)::int from public.user_signatures), 2, 'можно сохранить несколько своих подписей');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.user_signatures where user_id = pg_temp.uid('pm2@demo.test')), 0, 'чужие подписи не видны');
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
insert into public.user_signatures (image) select 'data:image/png;base64,C' || g from generate_series(3, 10) g;
select throws_ok($$ insert into public.user_signatures (image) values ('data:image/png;base64,ZZ') $$, '23514', null, 'больше 10 подписей не сохранить');
select pg_temp.back();

select * from finish();
rollback;
