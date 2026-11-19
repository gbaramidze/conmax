-- Требует сид-данных. Участники личного события (приглашения письмом): владелец сохраняет список и версию приглашения,
-- чужое событие не видно, список ограничен.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
insert into public.personal_items (kind, title, event_date, start_time, end_time, attendees)
values ('event', 'Планёрка', '2026-12-01', '10:00', '10:30', '[{"name":"Иван","address":"ivan@x.test"}]')
returning id as ev \gset

select is((select jsonb_array_length(attendees) from public.personal_items where id = :'ev'), 1, 'участники сохранены');
select is((select invite_seq from public.personal_items where id = :'ev'), 0, 'первая версия приглашения — 0');

update public.personal_items set invite_seq = 1, invited_at = now(), attendees = attendees || '[{"name":"","address":"b@x.test"}]' where id = :'ev';
select is((select invite_seq from public.personal_items where id = :'ev'), 1, 'владелец меняет версию и список');

select throws_ok(format($$update public.personal_items set attendees = '{"a":1}' where id = %L$$, :'ev'), '23514', null, 'участники — только список');
select throws_ok(format($$update public.personal_items set invite_seq = -1 where id = %L$$, :'ev'), '23514', null, 'версия не бывает отрицательной');
select pg_temp.back();

select pg_temp.act_as('pm2@demo.test');
select is((select count(*)::int from public.personal_items where id = :'ev'), 0, 'чужое событие с участниками не видно');
select pg_temp.back();

select * from finish();
rollback;
