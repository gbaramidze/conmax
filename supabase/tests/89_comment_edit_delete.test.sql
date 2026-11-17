-- Требует сид-данных. Правка и удаление комментариев, упоминания при правке, язык получателя в очереди писем.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.doc(p_text text, p_mention1 uuid default null, p_mention2 uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
    'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text))
      || case when p_mention1 is null then '[]'::jsonb
         else jsonb_build_array(jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('id', p_mention1, 'label', 'X'))) end
      || case when p_mention2 is null then '[]'::jsonb
         else jsonb_build_array(jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('id', p_mention2, 'label', 'Y'))) end)));
$$;
-- правка/удаление «как клиент»: число изменённых строк или denied, если база отказала
create function pg_temp.try_update(p_id uuid, p_set text) returns text language plpgsql as $$
declare n integer;
begin
  execute format('update public.comments set %s where id = $1', p_set) using p_id;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return 'denied';
end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip, email as gip_email from public.users where email = 'gip@demo.test' \gset
select id as foreman1 from public.users where email = 'foreman1@demo.test' \gset

delete from public.notifications;
delete from public.email_outbox;

-- 1. Комментарий с упоминанием: адресат получает уведомление и письмо
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('project', :'zk7', pg_temp.doc('Проверьте, пожалуйста', :'gip'), 'internal');
select id as c1 from public.comments where author_id = :'pm1' and entity_id = :'zk7' order by created_at desc limit 1 \gset
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = :'gip' and category = 'mentioned'), 1, 'упомянутый получает уведомление');
select ok(exists (select 1 from public.email_outbox o join public.notifications n on n.id = o.notification_id
                   where o.user_id = :'gip' and o.kind = 'instant' and n.category = 'mentioned'), 'и письмо в очереди');

-- 2. Правка: добавили ещё одного — уведомляем только его
select pg_temp.act_as('pm1@demo.test');
update public.comments set body = pg_temp.doc('Проверьте, пожалуйста (уточнил)', :'gip', :'foreman1') where id = :'c1';
select pg_temp.back();

select is((select count(*)::int from public.notifications where user_id = :'foreman1' and category = 'mentioned'), 1, 'добавленный при правке получает уведомление');
select is((select (payload -> 'counts' ->> 'mentioned')::int from public.notifications where user_id = :'gip' and category = 'mentioned'), 1,
          'уже упомянутого повторно не уведомляем');
select ok((select edited_at from public.comments where id = :'c1') is not null, 'комментарий помечен как изменённый');

-- 3. Чужой текст править нельзя
select pg_temp.act_as('foreman1@demo.test');
select ok(pg_temp.try_update(:'c1', $$body = '{"type":"doc","content":[]}'::jsonb$$) in ('0', 'denied'), 'не автор не меняет текст');
select pg_temp.back();

-- 4. Удаление: файлы комментария уходят из списка файлов, правка и «оживление» запрещены
select :'tenant' || '/' || :'zk7' || '/' || gen_random_uuid() || '.png' as skey \gset
insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes)
values (:'tenant', :'zk7', :'skey', 'photo.png', 'image/png', 10);
insert into public.attachments (tenant_id, project_id, entity_type, entity_id, file_id, comment_id)
select :'tenant', :'zk7', 'project', :'zk7', f.id, :'c1' from public.files f where f.storage_key = :'skey';
select is((select count(*)::int from public.attachments where comment_id = :'c1'), 1, 'у комментария есть файл');

select pg_temp.act_as('pm1@demo.test');
select is(pg_temp.try_update(:'c1', 'deleted_at = now()'), '1', 'автор удаляет свой комментарий');
select pg_temp.back();
select is((select count(*)::int from public.attachments where comment_id = :'c1'), 0, 'файлы удалённого комментария убраны');

select pg_temp.act_as('pm1@demo.test');
select is(pg_temp.try_update(:'c1', $$body = '{"type":"doc","content":[]}'::jsonb$$), 'denied', 'удалённый комментарий не правится');
select is(pg_temp.try_update(:'c1', 'deleted_at = null'), 'denied', 'удалённый комментарий не возвращается');
select pg_temp.back();

-- 5. Язык получателя доходит до воркера писем
update public.users set locale = 'ka' where id = :'gip';
update public.email_outbox set send_after = now();
select ok(exists (select 1 from jsonb_array_elements(public.claim_emails(1000)) e where e ->> 'to' = :'gip_email' and e ->> 'locale' = 'ka'),
          'письмо получателю уходит с его языком (ka)');

select * from finish();
rollback;
