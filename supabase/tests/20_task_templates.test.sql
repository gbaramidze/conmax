-- Требует сид-данных. Шаблоны задач применяются к местам; права как при обычном создании.
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

select id as zk7 from public.projects where code = 'ZK7' \gset
select id as f4 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F04' \gset
select id as f5 from public.locations where project_id = :'zk7' and path::text = 'K1.S1.F05' \gset
select id as tpl from public.task_templates where name = 'Приёмка этажа' \gset
select count(*)::int as tpl_items from public.task_templates t, jsonb_array_elements(t.items) where t.id = :'tpl' \gset

select is((select count(*)::int from public.task_templates where name in ('Приёмка этажа', 'Подготовка к бетонированию')), 2, 'типовые шаблоны заведены');

select pg_temp.act_as('pm1@demo.test');
select is(public.apply_task_template(:'zk7', :'tpl', array[:'f4', :'f5']::uuid[], date '2026-11-02'), :tpl_items * 2, 'шаблон создаёт задачи на каждое место');
select is((select count(*)::int from public.tasks where project_id = :'zk7' and title like 'Проверка геометрии и отметок — K1.S1.F0%'), 0,
          'в названии место подставлено (не осталось «{место}» и путь в виде кода этажа)') ;
select ok(exists (select 1 from public.tasks where project_id = :'zk7' and title like 'Проверка геометрии и отметок — F04 %' and location_id = :'f4'), 'название содержит место, задача привязана к нему');
select is((select due_date from public.tasks where title like 'Акт освидетельствования скрытых работ — F05 %' limit 1), date '2026-11-05', 'срок = дата старта + смещение пункта');
select throws_ok(format($$select public.apply_task_template(%L, %L, '{}'::uuid[], null)$$, :'zk7', :'tpl'), '22023', 'location_required', 'без мест применять нельзя');
select pg_temp.back();

-- наблюдатель создавать задачи не может — и шаблон ему не поможет
select pg_temp.act_as('observer@demo.test');
select throws_ok(format($$select public.apply_task_template(%L, %L, array[%L]::uuid[], null)$$, :'zk7', :'tpl', :'f4'), '42501', null, 'без права создавать задачи шаблон недоступен');
select pg_temp.back();

select * from finish();
rollback;
