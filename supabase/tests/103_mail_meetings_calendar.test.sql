-- Требует сид-данных. Приглашения из Outlook → личный календарь: запись по времени пользователя, обновление вместо
-- дубля, отмена одной встречи и всей серии, прошедшие не добавляются, без подключённой почты — ничего.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as master from public.users where email = 'master@demo.test' \gset
select tenant_id as tenant from public.users where email = 'pm1@demo.test' \gset
update public.users set timezone = 'Asia/Tbilisi' where id = :'pm1';
insert into public.mail_accounts (user_id, tenant_id, email, refresh_token_enc)
values (:'pm1', :'tenant', 'pm1@outlook.test', 'v1.x.y') on conflict (user_id) do nothing;
delete from public.personal_items where user_id = :'pm1' and source = 'outlook';

select throws_ok($$ set local role authenticated; select public.mail_calendar_apply(gen_random_uuid(), '[]') $$, '42501', null, 'сайту функция недоступна');
reset role;

-- встреча через 3 дня в 08:00 UTC = 12:00 по Тбилиси
select public.mail_calendar_apply(:'pm1', jsonb_build_array(jsonb_build_object(
  'kind', 'request', 'uid', 'G1#d1', 'subject', 'Планёрка на объекте', 'organizer', 'Иван Петров', 'location', 'Прорабская',
  'start', to_char((current_date + 3)::timestamp + interval '8 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'end',   to_char((current_date + 3)::timestamp + interval '9 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select is((select start_time from public.personal_items where user_id = :'pm1' and source_uid = 'G1#d1'), '12:00'::time, 'время — по часовому поясу пользователя');
select is((select end_time from public.personal_items where user_id = :'pm1' and source_uid = 'G1#d1'), '13:00'::time, 'и конец тоже');
select is((select place from public.personal_items where user_id = :'pm1' and source_uid = 'G1#d1'), 'Прорабская', 'место из приглашения');
select is((select kind from public.personal_items where user_id = :'pm1' and source_uid = 'G1#d1'), 'event', 'это событие личного календаря');

-- обновление приглашения: время сдвинули — та же запись
select public.mail_calendar_apply(:'pm1', jsonb_build_array(jsonb_build_object(
  'kind', 'request', 'uid', 'G1#d1', 'subject', 'Планёрка на объекте',
  'start', to_char((current_date + 3)::timestamp + interval '10 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select is((select count(*)::int from public.personal_items where user_id = :'pm1' and source = 'outlook'), 1, 'обновление не создаёт дубль');
select is((select start_time from public.personal_items where user_id = :'pm1' and source_uid = 'G1#d1'), '14:00'::time, 'время обновлено');

select is(jsonb_array_length(public.mail_calendar_apply(:'pm1', jsonb_build_array(jsonb_build_object(
  'kind', 'request', 'uid', 'OLD#x', 'subject', 'Было', 'start', '2020-01-01T08:00:00Z')))), 0, 'прошедшая встреча не добавляется');

-- серия из двух встреч и отмена всей серии
select public.mail_calendar_apply(:'pm1', jsonb_build_array(
  jsonb_build_object('kind', 'request', 'uid', 'S1#a', 'subject', 'Еженедельно', 'start', to_char((current_date + 2)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  jsonb_build_object('kind', 'request', 'uid', 'S1#b', 'subject', 'Еженедельно', 'start', to_char((current_date + 9)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select is((select count(*)::int from public.personal_items where user_id = :'pm1' and source_uid like 'S1#%'), 2, 'серия — по записи на встречу');
select public.mail_calendar_apply(:'pm1', '[{"kind":"cancel","uid":"S1#*","start":"2026-01-01T00:00:00Z"}]');
select is((select count(*)::int from public.personal_items where user_id = :'pm1' and source_uid like 'S1#%'), 0, 'отмена серии убирает все встречи');

select public.mail_calendar_apply(:'pm1', '[{"kind":"cancel","uid":"G1#d1","start":"2026-01-01T00:00:00Z"}]');
select is((select count(*)::int from public.personal_items where user_id = :'pm1' and source = 'outlook'), 0, 'отмена одной встречи');

select is(jsonb_array_length(public.mail_calendar_apply(:'master', jsonb_build_array(jsonb_build_object(
  'kind', 'request', 'uid', 'M#1', 'subject', 'x', 'start', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))), 0,
  'без подключённой почты — ничего');

select * from finish();
rollback;
