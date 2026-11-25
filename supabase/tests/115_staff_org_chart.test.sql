-- Требует сид-данных. Оргструктура-схема: описание и порядок работ отдела, аутсорс, помощник, штатные позиции и вакансии.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as pm from public.users where email = 'pm2@demo.test' \gset
select id as sub from public.users where email = 'sub1@demo.test' \gset
select r.id as r_foreman from public.roles r join public.users u on u.tenant_id = r.tenant_id where u.email = 'admin@demo.test' and r.scope = 'project' and r.code = 'foreman' \gset
select r.id as r_master from public.roles r join public.users u on u.tenant_id = r.tenant_id where u.email = 'admin@demo.test' and r.scope = 'project' and r.code = 'master' \gset

select pg_temp.act_as('admin@demo.test');
select ok('staff.manage' = any(public.my_tenant_permissions()), 'интерфейс узнаёт о праве staff.manage (кнопки правки видны)');
select pg_temp.back();

-- администратор (staff.manage) заводит отдел с описанием, шагами, помощником и аутсорсом
select pg_temp.act_as('admin@demo.test');
insert into public.staff_departments (name, description, steps) values
  ('Fit-Out', 'Отделочные и фасадные работы', array['Проверка проекта', 'Шоп-чертежи', 'Сдача'])
returning id as dep \gset
insert into public.staff_departments (name, parent_id, is_assistant) values ('Координатор', :'dep', true) returning id as asst \gset
insert into public.staff_departments (name, outsourced_to) values ('Legal', 'BLC') returning id as legal \gset
select is((select cardinality(steps) from public.staff_departments where id = :'dep'), 3, 'порядок работ хранится по шагам');
select is((select is_assistant from public.staff_departments where id = :'asst'), true, 'подотдел можно поставить «при руководителе»');
select throws_ok(format($$update public.staff_departments set steps = array['шаг', ''] where id = %L$$, :'dep'), '23514', null,
                 'пустой шаг не сохраняется');

-- позиции: сотрудник, человек без учётной записи (группа), вакансия
insert into public.staff_positions (department_id, role_id, user_id) values (:'dep', :'r_foreman', :'pm');
insert into public.staff_positions (department_id, role_id, person_name, headcount) values (:'dep', :'r_master', 'Бригада Лаши', 12);
insert into public.staff_positions (department_id, role_id) values (:'dep', :'r_foreman') returning id as vacancy \gset
select is((select count(*)::int from public.staff_positions where department_id = :'dep'), 3, 'в отдел добавляются позиции и вакансии');
select throws_ok(format($$insert into public.staff_positions (department_id, role_id, user_id, person_name) values (%L, %L, %L, 'Имя')$$, :'dep', :'r_foreman', :'pm'),
                 '23514', null, 'позиция занята либо сотрудником, либо человеком без учётной записи');
select throws_ok(format($$insert into public.staff_positions (department_id, role_id, user_id) values (%L, %L, %L)$$, :'dep', :'r_foreman', :'sub'),
                 '42501', null, 'внешнего участника нельзя поставить на позицию');
select pg_temp.back();

-- обычный сотрудник видит, но не правит
select pg_temp.act_as('master@demo.test');
select is((select count(*)::int from public.staff_positions where department_id = :'dep'), 3, 'штат видят все сотрудники');
select is((select description from public.staff_departments where id = :'dep'), 'Отделочные и фасадные работы', 'описание отдела видно сотрудникам');
update public.staff_positions set title = 'Взлом' where id = :'vacancy';
select is((select title from public.staff_positions where id = :'vacancy'), (select name from public.roles where id = :'r_foreman'), 'обычный сотрудник штат не правит');
select throws_ok(format($$insert into public.staff_positions (department_id, role_id) values (%L, %L)$$, :'dep', :'r_master'), '42501', null,
                 'обычный сотрудник позиции не добавляет');
select pg_temp.back();

-- внешний участник штат не видит
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.staff_positions), 0, 'внешний участник штат не видит');
select pg_temp.back();

-- удаление отдела убирает его позиции
select pg_temp.act_as('admin@demo.test');
delete from public.staff_departments where id = :'dep';
select is((select count(*)::int from public.staff_positions where department_id = :'dep'), 0, 'позиции удаляются вместе с отделом');
select pg_temp.back();

select * from finish();
rollback;
