-- Требует сид-данных. Личный профиль: правка только через функции, фото, видимость аватаров, синхронизация почты.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as pm, tenant_id as ten from public.users where email = 'pm1@demo.test' \gset
select id as sub from public.users where email = 'sub1@demo.test' \gset
select id as foreman from public.users where email = 'foreman1@demo.test' \gset

select pg_temp.act_as('pm1@demo.test');

-- ---- прямые правки закрыты ----
select throws_ok($$update public.users set full_name = 'Взлом' where id = (select auth.uid())$$, '42501', null, 'прямой UPDATE users закрыт даже для себя');

-- ---- профиль ----
select lives_ok($$select public.update_my_profile('  Пётр Иванов ', '+7 (999) 123-45-67', 'Руководитель проекта', null, 'Asia/Yekaterinburg')$$, 'профиль обновляется функцией');
select is((select full_name || '|' || job_title || '|' || phone from public.users where id = :'pm'), 'Пётр Иванов|Руководитель проекта|+7 (999) 123-45-67', 'значения обрезаны и сохранены');
select is((select timezone from public.user_notification_settings where user_id = :'pm'), 'Asia/Yekaterinburg', 'часовой пояс попал и в настройки уведомлений');
select throws_ok($$select public.update_my_profile('', null, null, null, null)$$, '22023', null, 'пустое имя нельзя');
select throws_ok($$select public.update_my_profile('Пётр', 'не телефон', null, null, null)$$, '22023', null, 'телефон из букв нельзя');
select throws_ok($$select public.update_my_profile('Пётр', null, null, null, 'Mars/Olympus')$$, '22023', null, 'неизвестный часовой пояс нельзя');

-- смена пояса на экране уведомлений видна и в профиле
insert into public.user_notification_settings (timezone) values ('Europe/Samara')
  on conflict (user_id) do update set timezone = excluded.timezone;
select is((select timezone from public.users where id = :'pm'), 'Europe/Samara', 'пояс из настроек уведомлений синхронизируется в профиль');

-- ---- фото ----
select pg_temp.back();
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', :'ten' || '/' || :'pm' || '/a1.jpg', :'pm'),
  ('avatars', :'ten' || '/' || :'foreman' || '/f1.jpg', :'foreman');
select pg_temp.act_as('pm1@demo.test');

select lives_ok(format($$select public.set_my_avatar(%L)$$, :'ten' || '/' || :'pm' || '/a1.jpg'), 'своё фото ставится');
select is((select avatar_path from public.users where id = :'pm'), :'ten' || '/' || :'pm' || '/a1.jpg', 'путь сохранён');
select throws_ok(format($$select public.set_my_avatar(%L)$$, :'ten' || '/' || :'foreman' || '/f1.jpg'), '22023', null, 'чужую папку указать нельзя');
select throws_ok(format($$select public.set_my_avatar(%L)$$, :'ten' || '/' || :'pm' || '/нет.jpg'), '23503', null, 'несуществующий файл нельзя');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('avatars', %L)$$, :'ten' || '/' || :'foreman' || '/pwn.jpg'), '42501', null, 'загрузить в чужую папку нельзя');

-- ---- видимость ----
select is((select count(*)::int from storage.objects where bucket_id = 'avatars' and name like '%/f1.jpg'), 1, 'внутренний сотрудник видит фото коллеги');
select pg_temp.back();

-- внешний подрядчик не видит фото сотрудников, с которыми не работает по общим проектам, но видит своё
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars' and name like '%/a1.jpg'),
          (select count(*)::int from public.users where id = :'pm'), 'фото сотрудника видно внешнему ровно тогда, когда виден сам сотрудник');
select pg_temp.back();

-- ---- почта ----
update auth.users set email = 'pm1-new@demo.test' where id = :'pm';
select is((select email::text from public.users where id = :'pm'), 'pm1-new@demo.test', 'подтверждённая в Auth почта попадает в профиль');

select * from finish();
rollback;
