-- Требует сид-данных. Просмотр DWG через APS: таблица состояния видна тем, кто видит файл, и никому не доступна на запись.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

select id as zk7 from public.projects where code = 'ZK7' \gset
select tenant_id as ten from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset

-- DWG, загруженный руководителем проекта, и строка о его переводе
select set_config('request.jwt.claims', json_build_object('tenant_id', :'ten', 'sub', :'pm1')::text, true);
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes, created_by)
  values (:'ten', :'zk7', :'ten' || '/' || :'zk7' || '/t65-plan.dwg', 'План.dwg', 'application/octet-stream', 9000, :'pm1') returning id as fid \gset
insert into public.dwg_views (file_id, tenant_id, project_id, status, urn, requested_by) values (:'fid', :'ten', :'zk7', 'ready', 'dXJuLXRlc3Q', :'pm1');
select set_config('request.jwt.claims', '', true);

select pg_temp.act_as('pm1@demo.test');
select is((select status from public.dwg_views where file_id = :'fid'), 'ready', 'автор файла видит состояние просмотра');
select throws_ok(format($$update public.dwg_views set status = 'failed' where file_id = %L$$, :'fid'), '42501', null, 'менять состояние из браузера нельзя');
select throws_ok(format($$insert into public.dwg_views (file_id, tenant_id, project_id) values (%L, %L, %L)$$, :'fid', :'ten', :'zk7'), '42501', null, 'и добавлять строки тоже');
select pg_temp.back();

-- тот, кому файл не виден (чужая организация, без привязки к документам), состояния не видит
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.dwg_views where file_id = :'fid'), 0, 'субподрядчик без доступа к файлу состояния не видит');
select pg_temp.back();

-- удаление файла уносит строку
delete from public.files where id = :'fid';
select is((select count(*)::int from public.dwg_views where file_id = :'fid'), 0, 'удаление файла убирает строку состояния');

select * from finish();
rollback;
