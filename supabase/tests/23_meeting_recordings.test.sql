-- Требует сид-данных. Аудиозаписи совещаний видят и удаляют только ведущий и управляющие совещанием.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
select id as bc2 from public.projects where code = 'BC2' \gset
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as mst from public.users where email = 'master@demo.test' \gset
select id as cli from public.users where email = 'client@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
-- внешнее совещание: заказчик приглашён, но запись ему недоступна
select public.create_meeting(:'zk7', 'Совещание с записью', 'client', now() + interval '1 day', 60, null, 'external', null,
                             array[:'fm1', :'mst', :'cli']::uuid[], '{}') as m1 \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/rec-1.webm', 'Совещание.webm', 'audio/webm', 120000) returning id as f1 \gset
select is((select public.add_meeting_recording(:'m1', :'f1', 95) is not null), true, 'ведущий сохраняет запись');
select is((select duration_sec from public.meeting_recordings where meeting_id = :'m1'), 95, 'длительность записана');

-- файл другого проекта (его загрузил руководитель BC2)
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'bc2', :'ten' || '/' || :'bc2' || '/rec-2.webm', 'Другой.webm', 'audio/webm', 1000) returning id as f2 \gset
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($$select public.add_meeting_recording(%L, %L, 1)$$, :'m1', :'f2'), '23503', 'file_not_found', 'чужой файл из другого проекта не принимается');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.meeting_recordings), 0, 'участник без прав ведения записей не видит');
select is((select count(*)::int from public.files where id = :'f1'), 0, 'и сам файл ему недоступен');
select throws_ok(format($$select public.add_meeting_recording(%L, %L, 1)$$, :'m1', :'f1'), '42501', null, 'добавить запись он не может');
select pg_temp.back();

select pg_temp.act_as('client@demo.test');
select is((select count(*)::int from public.meeting_recordings), 0, 'внешний участник записи не видит');
select is((select count(*)::int from public.files where id = :'f1'), 0, 'файл записи внешнему недоступен');
select pg_temp.back();

select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.meeting_recordings where meeting_id = :'m1'), 1, 'роль с правом вести совещания видит запись');
select is((select count(*)::int from public.files where id = :'f1'), 1, 'и файл (значит, скачает из хранилища)');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select public.delete_meeting_recording((select id from public.meeting_recordings where meeting_id = :'m1'))), (:'ten' || '/' || :'zk7' || '/rec-1.webm'), 'удаление возвращает ключ файла для очистки хранилища');
select is((select count(*)::int from public.files where id = :'f1'), 0, 'запись о файле удалена');
select pg_temp.back();

select * from finish();
rollback;
