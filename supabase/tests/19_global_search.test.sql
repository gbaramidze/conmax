-- Требует сид-данных. Глобальный поиск находит задачи, места, документы и учитывает права.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select pg_temp.act_as('pm1@demo.test');
select ok(exists (select 1 from public.global_search('ZK7-T-1') where kind = 'task' and ref = 'ZK7-T-1'), 'задача находится по ключу');
select ok(exists (select 1 from public.global_search('фундаментн') where kind = 'task'), 'задача находится по части названия');
select ok(exists (select 1 from public.global_search('Этаж 5') where kind = 'location' and ref = 'K1.S1.F05'), 'место находится по названию');
select ok(exists (select 1 from public.global_search('Заречн') where kind = 'project'), 'проект находится по названию');
select is((select count(*)::int from public.global_search('x')), 0, 'слишком короткий запрос ничего не возвращает');
select is((select count(*)::int from public.global_search('%')), 0, 'символы шаблона не превращаются в «найти всё»');
select pg_temp.back();

-- подрядчик не находит чужие задачи
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.global_search('ZK7-T-1') where kind = 'task'), 0, 'подрядчик не находит чужую внутреннюю задачу');
select pg_temp.back();

select * from finish();
rollback;
