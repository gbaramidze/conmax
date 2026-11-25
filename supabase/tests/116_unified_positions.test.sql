-- Требует сид-данных. Одна должность: роль проекта из справочника. Подпись под именем (users.job_title) считается сама:
-- позиция в оргструктуре, иначе должность в последнем проекте. Руками её не пишут.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as worker, tenant_id as t from public.users where email = 'foreman1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' \gset
select id as r_arch   from public.roles where tenant_id = :'t' and scope = 'project' and code = 'architect' \gset
select id as r_master from public.roles where tenant_id = :'t' and scope = 'project' and code = 'master' \gset
select id as r_tenant from public.roles where tenant_id = :'t' and scope = 'tenant' and code = 'member' \gset

-- ручного ввода больше нет
select hasnt_column('public', 'project_members', 'title', 'у участника проекта нет отдельного текста должности');
select hasnt_function('public', 'staff_set_job_title', array['uuid', 'text'], 'функции ручной смены должности нет');

-- должность в проекте становится подписью
insert into public.project_members (tenant_id, project_id, user_id, role_id) values (:'t', :'zk7', :'worker', :'r_arch');
select is((select job_title from public.users where id = :'worker'), 'Architect', 'подпись — должность в последнем проекте');
select is(private.member_position(:'worker', :'zk7'), 'Architect', 'должность в конкретном проекте');

-- позиция в оргструктуре важнее проекта; название позиции берётся из справочника
select pg_temp.act_as('admin@demo.test');
insert into public.staff_departments (name) values ('Участок') returning id as dep \gset
insert into public.staff_positions (department_id, role_id, user_id, title) values (:'dep', :'r_master', :'worker', 'Что угодно') returning id as pos \gset
select is((select title from public.staff_positions where id = :'pos'), (select name from public.roles where id = :'r_master'), 'название позиции = название должности');
select is((select job_title from public.users where id = :'worker'), (select name from public.roles where id = :'r_master'), 'подпись — позиция в оргструктуре');
select throws_ok(format($$insert into public.staff_positions (department_id, role_id) values (%L, %L)$$, :'dep', :'r_tenant'),
                 '22023', 'invalid_position', 'роль компании должностью в оргструктуре не бывает');

-- переименовали должность — следом меняются позиция и подпись
select lives_ok(format($$select public.role_rename(%L, 'Мастер участка')$$, :'r_master'), 'должность переименована');
select is((select title from public.staff_positions where id = :'pos'), 'Мастер участка', 'позиция переименовалась');
select is((select job_title from public.users where id = :'worker'), 'Мастер участка', 'подпись переименовалась');

-- занятую в оргструктуре должность удалить нельзя
select public.role_create('project', 'Охранник') as r_guard \gset
insert into public.staff_positions (department_id, role_id, person_name, headcount) values (:'dep', :'r_guard', 'Охрана', 8);
select throws_ok(format($$select public.role_delete(%L)$$, :'r_guard'), '23503', 'role_in_use', 'должность из оргструктуры не удаляется');

-- убрали из оргструктуры — подпись снова из проекта
delete from public.staff_positions where id = :'pos';
select is((select job_title from public.users where id = :'worker'), 'Architect', 'без позиции подпись снова из проекта');
select pg_temp.back();

-- сам человек подпись не меняет
select pg_temp.act_as('foreman1@demo.test');
select throws_ok(format($$update public.users set job_title = 'Директор' where id = %L$$, :'worker'), '42501', null, 'прямой записи в колонку нет');
select public.update_my_profile('Прораб Первый', null, null, null);
select pg_temp.back();
select is((select job_title from public.users where id = :'worker'), 'Architect', 'профиль подпись не трогает');

select * from finish();
rollback;
