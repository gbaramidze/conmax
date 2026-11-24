-- Требует сид-данных. Должность сотрудника: меняет сам человек или staff.manage / admin.users, внешнему — нельзя.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as worker from public.users where email = 'foreman1@demo.test' \gset
select id as pm from public.users where email = 'pm2@demo.test' \gset
select id as ext from public.users where email = 'sub1@demo.test' \gset

-- обычный сотрудник: свою можно, чужую нельзя
select pg_temp.act_as('foreman1@demo.test');
select lives_ok(format($$select public.staff_set_job_title(%L, 'Прораб участка')$$, :'worker'), 'сотрудник меняет свою должность');
select throws_ok(format($$select public.staff_set_job_title(%L, 'Стажёр')$$, :'pm'), '42501', null, 'чужую должность обычный сотрудник не меняет');
select throws_ok(format($$update public.users set job_title = 'Стажёр' where id = %L$$, :'worker'), '42501', null, 'прямой записи в колонку нет');
select pg_temp.back();

-- администратор (staff.manage, admin.users)
select pg_temp.act_as('admin@demo.test');
select lives_ok(format($$select public.staff_set_job_title(%L, '  Старший прораб  ')$$, :'worker'), 'администратор меняет должность сотрудника');
select is((select job_title from public.users where id = :'worker'), 'Старший прораб', 'должность сохранена без лишних пробелов');
select throws_ok(format($$select public.staff_set_job_title(%L, %L)$$, :'worker', repeat('x', 121)), '22023', 'invalid job_title', 'длиннее 120 знаков нельзя');
select throws_ok(format($$select public.staff_set_job_title(%L, 'Руководитель')$$, :'ext'), '42501', null, 'внешнему участнику должность не меняют');
select lives_ok(format($$select public.staff_set_job_title(%L, '')$$, :'worker'), 'пустая строка очищает должность');
select pg_temp.back();

select * from finish();
rollback;
