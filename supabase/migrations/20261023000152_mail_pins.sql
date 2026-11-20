-- Закреплённые письма («Расположить в верхней части», как в Outlook). Microsoft Graph закрепление не отдаёт и не принимает,
-- поэтому оно хранится у нас: письмо остаётся вверху своей папки в приложении. В самом Outlook закрепление не видно.
-- Видит и меняет только владелец. Письмо, перемещённое в другую папку, получает в Outlook новый id — закрепление снимается.

create table public.mail_pins (
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  message_id text not null check (char_length(message_id) between 1 and 400),
  /** папка списка, где закреплено (как в адресе страницы: inbox или id папки) */
  folder     text not null check (char_length(folder) between 1 and 400),
  pinned_at  timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.mail_pins enable row level security;
alter table public.mail_pins force row level security;
create policy mail_pins_owner on public.mail_pins for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));

revoke all on public.mail_pins from anon, authenticated;
grant select, delete on public.mail_pins to authenticated;
grant insert (message_id, folder) on public.mail_pins to authenticated;

-- не больше 20 закреплённых: список закреплённых подтягивается из Outlook по одному письму
create or replace function private.mail_pins_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.mail_pins where user_id = new.user_id) >= 20 then
    raise exception 'too many pins' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger mail_pins_limit before insert on public.mail_pins for each row execute function private.mail_pins_limit();
