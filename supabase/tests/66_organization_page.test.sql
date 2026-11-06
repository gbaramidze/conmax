-- Требует сид-данных. Страница организации: права на правку реквизитов, проверка полей, видимость организаций.
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

select id as org from public.organizations where kind = 'subcontractor' and deleted_at is null order by name limit 1 \gset
select name as org_name from public.organizations where id = :'org' \gset

select pg_temp.act_as('admin@demo.test');
select ok('admin.reference_data' = any (public.my_tenant_permissions()), 'администратор видит у себя право на справочники');
select lives_ok(format($$select public.organization_update(%L, %L, 'МС', '1234567890', 'subcontractor', '{"phone":"+995 555 11 22 33","email":" office@example.com ","website":"example.com","address":"Батуми","note":""}'::jsonb, true)$$, :'org', :'org_name' || ' (тест)'), 'администратор правит реквизиты');
select is((select contacts ->> 'email' from public.organizations where id = :'org'), 'office@example.com', 'значения контактов обрезаются по краям');
select is((select contacts ? 'note' from public.organizations where id = :'org'), false, 'пустые контакты не хранятся');
select is((select short_name || '/' || tax_id from public.organizations where id = :'org'), 'МС/1234567890', 'краткое название и номер сохранены');
select throws_ok(format($$select public.organization_update(%L, 'X', null, null, 'wrong', '{}'::jsonb, true)$$, :'org'), '22023', 'organization_invalid', 'неизвестный вид отвергается');
select throws_ok(format($$select public.organization_update(%L, 'X', null, null, 'other', '{"fax":"1"}'::jsonb, true)$$, :'org'), '22023', 'organization_invalid', 'чужой ключ контактов отвергается');
select throws_ok(format($$select public.organization_update(%L, '   ', null, null, 'other', '{}'::jsonb, true)$$, :'org'), '22023', 'organization_invalid', 'пустое название отвергается');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select ok(not ('admin.reference_data' = any (public.my_tenant_permissions())), 'руководитель проекта права на справочники не имеет');
select throws_ok(format($$select public.organization_update(%L, 'Взлом', null, null, 'other', '{}'::jsonb, true)$$, :'org'), '42501', null, 'и править реквизиты не может');
select pg_temp.back();

select pg_temp.act_as('sub1@demo.test');
select ok((select count(*) from public.organizations) <= 3, 'внешний видит только свою организацию и «нашу»');
select pg_temp.back();

select * from finish();
rollback;
