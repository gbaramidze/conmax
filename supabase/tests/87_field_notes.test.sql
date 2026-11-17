-- Требует сид-данных. Заметки с площадки как раздел: адресат (сотрудник либо подрядчик), закрытие, видимость, чужие вызовы.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as pm1 from public.users where email = 'pm1@demo.test' \gset
select id as gip from public.users where email = 'gip@demo.test' \gset
select id as sub1 from public.users where email = 'sub1@demo.test' \gset
select organization_id as sub1_org from public.users where email = 'sub1@demo.test' \gset
select id as zk7 from public.projects where code = 'ZK7' \gset
select id as floor1 from public.locations where project_id = :'zk7' and kind = 'floor' and deleted_at is null order by path limit 1 \gset

-- внутренняя заметка pm1 к этажу, адресована гип
select pg_temp.act_as('pm1@demo.test');
insert into public.comments (entity_type, entity_id, body, visibility)
values ('location', :'floor1', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Трещина у окна"}]}]}'::jsonb, 'internal');
select pg_temp.back();
select id as note from public.comments where entity_type = 'location' and entity_id = :'floor1' and author_id = :'pm1' order by created_at desc limit 1 \gset

select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($q$select public.register_field_note(%L, %L, null, null)$q$, :'note', :'gip'), 'автор делает комментарий заметкой с адресатом-сотрудником');
select is((select addressee_user_id from public.field_notes where comment_id = :'note'), :'gip'::uuid, 'адресат записан');
select is((select status from public.field_notes where comment_id = :'note'), 'open', 'новая заметка открыта');

-- адресат один: и сотрудник, и организация — нельзя
select throws_ok(format($q$select public.register_field_note(%L, %L, %L, null)$q$, :'note', :'gip', :'sub1_org'), '22023', null, 'сотрудник и подрядчик одновременно — отказ');
-- внутреннюю заметку нельзя адресовать тому, кто не видит внутреннее
select throws_ok(format($q$select public.register_field_note(%L, %L, null, null)$q$, :'note', :'sub1'), '23514', null, 'внутреннюю заметку нельзя адресовать подрядчику');
-- чужой комментарий заметкой не сделать
select pg_temp.back();
select pg_temp.act_as('gip@demo.test');
select throws_ok(format($q$select public.register_field_note(%L, null, null, null)$q$, :'note'), '42501', null, 'чужую заметку регистрировать нельзя');
select pg_temp.back();

-- подрядчик внутренней заметки не видит
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.field_notes where comment_id = :'note'), 0, 'подрядчик не видит внутреннюю заметку');
select throws_ok(format($q$select public.set_field_note_status(%L, true)$q$, :'note'), '42501', null, 'и закрыть её не может');
select pg_temp.back();

-- адресат (гип) видит и закрывает
select pg_temp.act_as('gip@demo.test');
select is((select count(*)::int from public.field_notes where comment_id = :'note'), 1, 'адресат видит заметку');
select lives_ok(format($q$select public.set_field_note_status(%L, true)$q$, :'note'), 'адресат закрывает заметку');
select is((select status from public.field_notes where comment_id = :'note'), 'done', 'заметка закрыта');
select pg_temp.back();

-- автор возвращает в работу, resolved_at сбрасывается
select pg_temp.act_as('pm1@demo.test');
select lives_ok(format($q$select public.set_field_note_status(%L, false)$q$, :'note'), 'автор возвращает заметку в работу');
select is((select resolved_at is null from public.field_notes where comment_id = :'note'), true, 'отметка о закрытии снята');
select pg_temp.back();

-- напрямую в таблицу писать нельзя
select pg_temp.act_as('pm1@demo.test');
select throws_ok(format($q$update public.field_notes set status = 'done', resolved_at = now() where comment_id = %L$q$, :'note'), '42501', null, 'прямая запись в таблицу закрыта');
select pg_temp.back();

-- комментарии к заметке: адресат пишет, автор видит и получает уведомление, подрядчик не может
select pg_temp.act_as('gip@demo.test');
select lives_ok(format($q$insert into public.comments (entity_type, entity_id, body, visibility) values ('field_note', %L, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Смотрю"}]}]}'::jsonb, 'internal')$q$, :'note'), 'адресат комментирует заметку');
select pg_temp.back();
select pg_temp.act_as('pm1@demo.test');
select is((select count(*)::int from public.comments where entity_type = 'field_note' and entity_id = :'note'), 1, 'автор видит комментарий к своей заметке');
select pg_temp.back();
select is((select count(*)::int from public.notifications where user_id = :'pm1' and entity_type = 'field_note' and entity_id = :'note'), 1, 'автору пришло уведомление о комментарии');
select pg_temp.act_as('sub1@demo.test');
select throws_ok(format($q$insert into public.comments (entity_type, entity_id, body, visibility) values ('field_note', %L, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, 'external')$q$, :'note'), '42501', null, 'подрядчик не может комментировать внутреннюю заметку');
select pg_temp.back();

select * from finish();
rollback;
