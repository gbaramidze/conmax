-- Требует сид-данных. Личное пространство: заметки и события видны и правятся только владельцем, ограничения полей.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- тест идёт в откатываемой транзакции: убираем настоящие личные записи из локальной базы, чтобы счётчики были точными
delete from public.personal_items;

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
insert into public.personal_items (kind, title, body, pinned) values ('note', 'Купить рулетку', 'Лазерную, 50 м', true);
insert into public.personal_items (kind, title, event_date, start_time, end_time, place) values ('event', 'Стоматолог', '2026-11-03', '10:00', '11:00', 'Клиника');
select is((select count(*)::int from public.personal_items), 2, 'владелец видит свои записи');
select lives_ok($$update public.personal_items set pinned = false, title = 'Купить лазерную рулетку' where kind = 'note'$$, 'владелец правит свою заметку');
select throws_ok($$insert into public.personal_items (kind, title) values ('event', 'Без даты')$$, '23514', null, 'у события должна быть дата');
select throws_ok($$insert into public.personal_items (kind, title, event_date, start_time, end_time) values ('event', 'Наоборот', '2026-11-03', '12:00', '11:00')$$, '23514', null, 'окончание не раньше начала');
select throws_ok($$insert into public.personal_items (kind, title, start_time) values ('note', 'Заметка со временем', '10:00')$$, '23514', null, 'у заметки времени нет');
select throws_ok($$insert into public.personal_items (kind, title, user_id) values ('note', 'Чужая', gen_random_uuid())$$, '42501', null, 'нельзя создать запись от чужого имени');
select pg_temp.back();

-- другие, в том числе администратор и руководитель из другого проекта, ничего не видят и не меняют
select pg_temp.act_as('admin@demo.test');
select is((select count(*)::int from public.personal_items), 0, 'администратор чужие личные записи не видит');
select lives_ok($$update public.personal_items set title = 'взлом'$$, 'попытка изменить чужое проходит вхолостую');
select lives_ok($$delete from public.personal_items$$, 'и удалить тоже');
select pg_temp.back();

select pg_temp.act_as('pm1@demo.test');
select is((select title from public.personal_items where kind = 'note'), 'Купить лазерную рулетку', 'заметка осталась прежней');
select is((select count(*)::int from public.personal_items), 2, 'и обе записи на месте');
select lives_ok($$delete from public.personal_items where kind = 'event'$$, 'владелец удаляет своё событие');
select is((select count(*)::int from public.personal_items), 1, 'остаётся заметка');
select pg_temp.back();

select * from finish();
rollback;
