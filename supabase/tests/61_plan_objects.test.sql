-- Требует сид-данных. Слои объектов на планах: точки и трассы, проверка геометрии, правка, права, сводка реестра.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
select id as doc from public.documents where project_id = :'zk7' and deleted_at is null limit 1 \gset
delete from public.plan_objects where project_id = :'zk7';

select pg_temp.act_as('pm1@demo.test');
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, 'К-1') as cam \gset
select public.plan_object_set(:'zk7', :'doc', 1, 'pipe_water', 'line', '[[0.1,0.1],[0.5,0.1],[0.5,0.6]]'::jsonb, 'ХВС стояк') as pipe \gset
select is((select count(*)::int from public.plan_objects where document_id = :'doc'), 2, 'точка и трасса поставлены');
select is((select status from public.plan_objects where id = :'cam'), 'installed', 'состояние по умолчанию — установлено');

select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3],[0.4,0.4]]'::jsonb)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'у точки ровно одна координата');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'pipe_water', 'line', '[[0.2,0.3]]'::jsonb)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'у линии не меньше двух точек');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[1.2,0.3]]'::jsonb)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'точка вне листа отвергается');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'Bad Type', 'point', '[[0.2,0.3]]'::jsonb)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'код типа проверяется');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'broken')$$, :'zk7', :'doc'), '22023', 'status_invalid', 'неизвестное состояние отвергается');

-- правка: переносим камеру, ставим состояние и заметку
select is(public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.25,0.35]]'::jsonb, 'К-1 вход', 'defect', 'не пишет', :'cam'), :'cam'::uuid, 'правка возвращает тот же объект');
select is((select status || '/' || label from public.plan_objects where id = :'cam'), 'defect/К-1 вход', 'подпись и состояние обновлены');
select is((select count(*)::int from public.plan_objects where document_id = :'doc'), 2, 'правка не плодит объекты');
select pg_temp.back();

-- подтип, направление, размер
select pg_temp.act_as('pm1@demo.test');
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.25,0.35]]'::jsonb, 'К-1 вход', 'defect', 'не пишет', :'cam', 'dome', 370, 1.5);
select is((select variant || '/' || rotation::text || '/' || size::text from public.plan_objects where id = :'cam'), 'dome/10.00/1.50', 'подтип, направление (370 → 10) и размер сохранены');
select public.plan_object_set(:'zk7', :'doc', 1, 'camera', 'point', '[[0.25,0.35]]'::jsonb, 'К-1 вход', 'defect', 'не пишет', :'cam', 'dome', -10, 1.5);
select is((select rotation from public.plan_objects where id = :'cam'), 350.00::numeric, 'отрицательное направление приводится к 0…360');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'installed', '', null, 'dome', 0, 5)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'размер вне 0,5…3 отвергается');
select throws_ok(format($$select public.plan_object_set(%L, %L, 1, 'camera', 'point', '[[0.2,0.3]]'::jsonb, '', 'installed', '', null, 'Bad Variant', 0, 1)$$, :'zk7', :'doc'), '22023', 'position_invalid', 'код подтипа проверяется');
select is((select variant from public.plan_objects where id = :'pipe'), null, 'у трассы подтипа нет');
select pg_temp.back();

-- права
select pg_temp.act_as('foreman1@demo.test');
select is((select count(*)::int from public.plan_objects where document_id = :'doc'), 2, 'смотреть объекты можно');
select throws_ok(format($$select public.plan_object_delete(%L)$$, :'cam'), '42501', null, 'без права удалить нельзя');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select total || '/' || defect from public.plan_objects_summary(:'zk7') where type_code = 'camera'), '1/1', 'сводка реестра считает по типам и состояниям');
select lives_ok(format($$select public.plan_object_delete(%L)$$, :'pipe'), 'удаление трассы');
select pg_temp.back();

select * from finish();
rollback;
