-- Личное пространство: заметки и личные события. Видны и правятся только владельцем — ни руководитель проекта, ни администратор их не видят.
-- Личные события показываются в календаре под типом «Личное» (по умолчанию он выключен, чтобы личное не мелькало в рабочих календарях) и в «личном календаре».
-- Время события — «как на часах» у владельца, без часового пояса проекта.
-- См. docs: 05-roadmap/05-backlog.md, пункт 3.

create table public.personal_items (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  kind       text not null check (kind in ('note', 'event')),
  title      text not null check (char_length(btrim(title)) between 1 and 200),
  body       text not null default '' check (char_length(body) <= 10000),
  event_date date,
  start_time time,
  end_time   time,
  place      text check (place is null or char_length(place) <= 200),
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'event' or event_date is not null),
  check (kind = 'event' or (start_time is null and end_time is null and place is null)),
  check (start_time is not null or end_time is null),
  check (end_time is null or end_time > start_time)
);
create index on public.personal_items (user_id, kind, event_date);
create index on public.personal_items (user_id, pinned desc, updated_at desc);

create or replace function private.personal_items_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger personal_items_touch before update on public.personal_items
  for each row execute function private.personal_items_touch();

alter table public.personal_items enable row level security;
alter table public.personal_items force row level security;

create policy personal_items_owner on public.personal_items for all to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()))
  with check (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));

revoke all on public.personal_items from authenticated;
grant select, delete on public.personal_items to authenticated;
grant insert (kind, title, body, event_date, start_time, end_time, place, pinned) on public.personal_items to authenticated;
grant update (title, body, event_date, start_time, end_time, place, pinned) on public.personal_items to authenticated;
