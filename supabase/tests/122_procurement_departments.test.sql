-- Требует сид-данных. Заявки отделов без проекта: служебный проект компании, отдел обязателен, подтверждает руководитель
-- (или глава отдела), закупщик ведёт как обычно, сотрудник может загружать фото и файлы.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as office from public.projects where tenant_id = :'ten' and is_internal \gset
select id as head from public.users where email = 'pto@demo.test' \gset
select id as pm2 from public.users where email = 'pm2@demo.test' \gset
select ok(:'office' is not null, 'у компании есть служебный проект для заявок отделов');
insert into public.staff_departments (tenant_id, name, head_user_id) values (:'ten', 'IT (тест)', :'head') returning id as it \gset
insert into public.staff_departments (tenant_id, name) values (:'ten', 'Закупки (тест)') returning id as pdep \gset
insert into public.staff_positions (tenant_id, department_id, role_id, user_id)
select :'ten', :'pdep', id, :'pm2' from public.roles where tenant_id = :'ten' and scope = 'project' and code = 'buyer';

-- сотрудник без участия в проектах (специалист по ОТ) заводит заявку отдела
select pg_temp.act_as('safety@demo.test');
select is((public.procurement_company() ->> 'project_id')::uuid, :'office'::uuid, 'страница закупок знает служебный проект');
select throws_ok(format($$select public.material_request_save(%L, 'Мышь', null, null, null, '', '[{"name":"Мышь","qty":1}]')$$, :'office'), '22023', 'department_required', 'без отдела нельзя');
select public.material_request_save(:'office', 'Ноутбук для отдела', null, null, null, '', '[{"name":"Ноутбук","unit":"шт","qty":1}]', false, :'it') as r1 \gset
select is((public.procurement_request(:'r1') ->> 'key') like (public.procurement_company() ->> 'project_code') || '-PR-%', true, 'ключ — по служебному проекту');
insert into public.files (project_id, storage_key, name, mime, size_bytes) values (:'office', :'ten' || '/' || :'office' || '/t-model.png', 'model.png', 'image/png', 10) returning id as photo \gset
select ok(:'photo' is not null, 'сотрудник загружает файл в заявку отдела');
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select is((select status || '/' || (manager_id = :'head')::text from public.material_requests where id = :'r1'), 'review/true', 'без руководителя в оргструктуре подтверждает глава отдела');

-- глава отдела подтверждает, закупщик берёт в работу
select pg_temp.act_as('pto@demo.test');
select public.material_request_transition(:'r1', 'submitted');
select pg_temp.back();
select pg_temp.act_as('pm2@demo.test');
select is(jsonb_array_length(public.procurement_requests(:'office')), 1, 'закупщик видит заявки отделов');
select public.material_request_transition(:'r1', 'sourcing');
select is((select count(*)::int from public.rfqs where request_id = :'r1' and project_id = :'office'), 1, 'запрос цен заведён');
select pg_temp.back();

-- другой сотрудник чужую заявку отдела не видит и не правит
select pg_temp.act_as('master@demo.test');
select is(jsonb_array_length(public.procurement_requests(:'office')), 0, 'чужие заявки отдела не видны');
select throws_ok(format($$select public.material_request_save(%L, 'Чужая', %L, null, null, '', '[{"name":"X","qty":1}]', false, %L)$$, :'office', :'r1', :'it'), '22023', 'request_locked', 'отправленную заявку не поправить');
select pg_temp.back();
select pg_temp.act_as('client@demo.test');
select throws_ok(format($$select public.material_request_save(%L, 'Внешний', null, null, null, '', '[{"name":"X","qty":1}]', false, %L)$$, :'office', :'it'), '42501', null, 'внешний участник заявку отдела не заводит');
select pg_temp.back();

select * from finish();
rollback;
