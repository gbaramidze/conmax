-- Требует сид-данных. Очередь push: событие → задание и вызов воркера, без дублей, повтор недоставленного, отказ после попыток, сторож.
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

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset

delete from private.push_jobs;
delete from net.http_request_queue;
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
values (:'tenant', :'gip', 'https://push.example/gip-q1', 'k', 'a'), (:'tenant', :'gip', 'https://push.example/gip-q2', 'k', 'a');
select id as s1 from public.push_subscriptions where endpoint = 'https://push.example/gip-q1' \gset
select id as s2 from public.push_subscriptions where endpoint = 'https://push.example/gip-q2' \gset

-- 1. Назначение задачи → уведомление → задание в очереди и вызов воркера
select pg_temp.act_as('pm1@demo.test');
select id as t1 from public.create_task(:'zk7', 'Задача для очереди push', 'task', :'gip') \gset
select pg_temp.back();
select id as n1 from public.notifications where user_id = :'gip' and entity_id = :'t1' order by created_at desc limit 1 \gset

select is((select count(*)::int from private.push_jobs where kind = 'notification' and ref_id = :'n1'), 1, 'уведомление поставлено в очередь push');
select ok(exists (select 1 from net.http_request_queue where url like '%send-push%'), 'воркер push разбужен сразу');

-- то же событие, ещё не забранное воркером, второй раз не ставится
select private.queue_push('notification', :'n1');
select is((select count(*)::int from private.push_jobs where ref_id = :'n1'), 1, 'незабранное задание не дублируется');

-- 2. Воркер забирает задание; второй воркер то же не получит
select id as j1 from public.claim_push_jobs(50) where ref_id = :'n1' \gset
select is((select status from private.push_jobs where id = :j1), 'sending', 'задание забрано воркером');
select is((select count(*)::int from public.claim_push_jobs(50) where ref_id = :'n1'), 0, 'забранное задание другой воркер не берёт');

-- 3. На одно устройство ушло, на второе — временный отказ: повтор только на него
select public.finish_push_job(:j1, 1, array[:'s2']::uuid[]);
select is((select status from private.push_jobs where id = :j1), 'pending', 'недоставленное ждёт повтора');
select is((select only_subs from private.push_jobs where id = :j1), array[:'s2']::uuid[], 'повтор — только на устройство, куда не ушло');
select ok((select sent_at is not null and sent = 1 and next_at > now() from private.push_jobs where id = :j1), 'время отправки и пауза перед повтором записаны');

-- пока задание ждёт повтора, новое событие ставится отдельно (не ждёт паузы)
select private.queue_push('notification', :'n1');
select is((select count(*)::int from private.push_jobs where ref_id = :'n1'), 2, 'новое событие не ждёт паузы повтора');

-- 4. Повтор удался → готово
update private.push_jobs set next_at = now() where id = :j1;
select is((select count(*)::int from public.claim_push_jobs(50) where id = :j1), 1, 'подошёл срок — задание снова забрано');
select public.finish_push_job(:j1, 1);
select is((select status from private.push_jobs where id = :j1), 'done', 'доставлено — задание закрыто');

-- 5. После 8 попыток — отказ
update private.push_jobs set status = 'sending', attempts = 8, locked_at = now() where id = :j1;
select public.finish_push_job(:j1, 0, null, 'boom');
select is((select status from private.push_jobs where id = :j1), 'failed', 'после 8 попыток задание закрывается с ошибкой');

-- 6. Сторож: воркер не отчитался за минуту — задание снова в работе, воркер будится
delete from net.http_request_queue;
update private.push_jobs set status = 'sending', locked_at = now() - interval '2 minutes', attempts = 1 where id = :j1;
select private.push_sweep();
select ok(exists (select 1 from net.http_request_queue where url like '%send-push%'), 'сторож будит воркер для зависшего задания');
select ok(exists (select 1 from public.claim_push_jobs(50) where id = :j1), 'зависшее задание снова забирается');

select * from finish();
rollback;
