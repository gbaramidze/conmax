-- Требует сид-данных. Создатель проекта становится его руководителем.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select pg_temp.act_as('admin@demo.test');
insert into public.projects (tenant_id, code, name, kind, status)
  values (private.tenant_id(), 'NEW1', 'Новый объект', 'hotel', 'active');
select id as np from public.projects where code = 'NEW1' \gset
select is((select count(*)::int from public.project_members where project_id = :'np' and user_id = (select id from public.users where email = 'admin@demo.test')), 1, 'создатель добавлен в участники');
select is((select r.code from public.project_members m join public.roles r on r.id = m.role_id where m.project_id = :'np'), 'project_manager', 'с ролью руководителя проекта');
select is((select manager_user_id from public.projects where id = :'np'), (select id from public.users where email = 'admin@demo.test'), 'и указан руководителем проекта');
select ok(private.has_project_permission(:'np', 'meeting.create') and private.has_project_permission(:'np', 'document.upload'), 'теперь он может создавать совещания и загружать документы');
select pg_temp.back();

select * from finish();
rollback;
