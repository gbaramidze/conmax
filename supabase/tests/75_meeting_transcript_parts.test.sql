-- Требует сид-данных. Расшифровка по кускам: права, сборка текста с говорящими, итоги без повторной расшифровки файла.
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
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as mst from public.users where email = 'master@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
select public.create_meeting(:'zk7', 'Совещание по кускам', 'client', now() + interval '1 day', 60, null, 'internal', null, array[:'fm1', :'mst']::uuid[], '{}') as m1 \gset
select is(public.meeting_transcript_allowed(:'m1'), true, 'ведущий вправе расшифровывать');
select pg_temp.back();

select pg_temp.act_as('master@demo.test');
select is(public.meeting_transcript_allowed(:'m1'), false, 'обычный участник — нет');
select pg_temp.back();

-- функция пишет куски под сервисной ролью (в тесте — напрямую); сеанс один, куски идут не по порядку вставки
select gen_random_uuid() as sess \gset
insert into public.meeting_transcript_parts (tenant_id, project_id, meeting_id, session_id, seq, offset_sec, duration_sec, speaker, text) values
  (:'ten', :'zk7', :'m1', :'sess', 1, 30, 30, 'Иван Петров', 'Поставщика подтвержу до пятницы, бетон привезут во вторник.'),
  (:'ten', :'zk7', :'m1', :'sess', 0, 0, 30, null, 'Добрый день, начинаем совещание по бетону на пятый этаж.'),
  (:'ten', :'zk7', :'m1', :'sess', 2, 60, 30, 'Анна Сидорова', 'Хорошо, тогда назначаем приёмку на среду утром.');

select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.meeting_transcript_parts where meeting_id = :'m1'), 3, 'куски видит ведущий');
select pg_temp.back();
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.meeting_transcript_parts where meeting_id = :'m1'), 0, 'участник кусков не видит');
select pg_temp.back();

select is(private.transcript_from_parts(:'m1', :'sess'),
  E'Добрый день, начинаем совещание по бетону на пятый этаж.\nИван Петров: Поставщика подтвержу до пятницы, бетон привезут во вторник.\nАнна Сидорова: Хорошо, тогда назначаем приёмку на среду утром.',
  'текст собирается по порядку, говорящий — в начале реплики');

-- запись с сеансом и запрос итогов
select pg_temp.act_as('pm1@demo.test');
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/rec-parts.webm', 'Запись.webm', 'audio/webm', 120000) returning id as f1 \gset
select public.add_meeting_recording(:'m1', :'f1', 95, :'sess') as rec \gset
select is((select session_id from public.meeting_recordings where id = :'rec'), :'sess'::uuid, 'запись помнит сеанс');
select public.meeting_summary_request(:'rec') as s1 \gset
select is((select from_parts from public.meeting_summaries where id = :'s1'), true, 'итоги строятся из кусков');
select is((select left(transcript, 11) from public.meeting_summaries where id = :'s1'), 'Добрый день', 'расшифровка подставлена без обработки файла');

-- запись без сеанса работает как раньше
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/rec-plain.webm', 'Запись2.webm', 'audio/webm', 120000) returning id as f2 \gset
select public.add_meeting_recording(:'m1', :'f2', 40) as rec2 \gset
select public.meeting_summary_request(:'rec2') as s2 \gset
select is((select from_parts::text || '/' || transcript from public.meeting_summaries where id = :'s2'), 'false/', 'запись без кусков расшифровывается файлом, как прежде');
select pg_temp.back();

select * from finish();
rollback;
