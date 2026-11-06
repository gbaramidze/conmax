-- Требует сид-данных. Итоги по записи совещания: запрос обработки, права, защита от дублей, принятие предложений.
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
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as fm1 from public.users where email = 'foreman1@demo.test' \gset
select id as mst from public.users where email = 'master@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');
select public.create_meeting(:'zk7', 'Совещание с итогами', 'client', now() + interval '1 day', 60, null, 'internal', null, array[:'fm1', :'mst']::uuid[], '{}') as m1 \gset
insert into public.files (project_id, storage_key, name, mime, size_bytes)
  values (:'zk7', :'ten' || '/' || :'zk7' || '/rec-s1.webm', 'Запись.webm', 'audio/webm', 120000) returning id as f1 \gset
select public.add_meeting_recording(:'m1', :'f1', 95);
select id as rec from public.meeting_recordings where meeting_id = :'m1' \gset

-- запрос обработки
select public.meeting_summary_request(:'rec') as s1 \gset
select is((select status from public.meeting_summaries where id = :'s1'), 'queued', 'запрос ставит обработку в очередь');
select is(public.meeting_summary_request(:'rec'), :'s1'::uuid, 'повторный запрос, пока обработка идёт, возвращает ту же строку');
select is((select count(*)::int from public.meeting_summaries where meeting_id = :'m1'), 1, 'строка одна на запись');
select pg_temp.back();

-- служебная функция записывает результат (в тесте — напрямую), пользователь читает
update public.meeting_summaries set status = 'ready', transcript = 'Решили перенести бетонирование', result = '{"summary":"Перенос бетонирования","decisions":[{"text":"Перенести бетонирование на четверг"}],"actions":[]}'::jsonb, finished_at = now() where id = :'s1';

select pg_temp.act_as('pm1@demo.test');
select is((select transcript from public.meeting_summaries where id = :'s1'), 'Решили перенести бетонирование', 'расшифровку видит тот, кто управляет совещанием');
select public.meeting_summary_accept(:'s1', 'd0');
select public.meeting_summary_accept(:'s1', 'd0');
select is((select accepted from public.meeting_summaries where id = :'s1'), array['d0'], 'принятое запоминается один раз');
select throws_ok(format($$select public.meeting_summary_accept(%L, 'x9')$$, :'s1'), '22023', 'invalid_key', 'ключ проверяется');
select is(public.meeting_summary_request(:'rec', true) = :'s1'::uuid, true, 'повторная обработка по готовой расшифровке — та же строка');
select is((select status || '/' || (transcript <> '')::text || '/' || coalesce(array_length(accepted, 1), 0)::text from public.meeting_summaries where id = :'s1'), 'queued/true/0', 'расшифровка сохранена для пересборки итогов');
select pg_temp.back();

-- участник без прав: не видит и не запрашивает
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.meeting_summaries), 0, 'участник без прав ведения итогов не видит');
select throws_ok(format($$select public.meeting_summary_request(%L)$$, :'rec'), 'P0002', 'recording_not_found', 'и запросить обработку не может');
select pg_temp.back();

-- удаление
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($$select public.meeting_summary_delete(%L)$$, :'s1'), 'итоги можно убрать');
select is((select count(*)::int from public.meeting_summaries where recording_id = :'rec'), 0, 'строки больше нет, запись осталась');
select pg_temp.back();

select * from finish();
rollback;
