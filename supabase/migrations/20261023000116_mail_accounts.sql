-- Личная почта Outlook (Microsoft 365): подключение пользователя и право на него.
--
-- Каждый сотрудник сам подключает свой ящик (OAuth Microsoft, права только на чтение писем). Письма в базу не копируются:
-- Edge-функция `mail` ходит в Microsoft Graph «вживую» от имени пользователя. Здесь хранится только подключение.
-- Токены лежат зашифрованными (AES-GCM, ключ MAIL_TOKEN_KEY в секретах функций): в браузер и в API они не отдаются,
-- у `authenticated` нет права читать эти столбцы. Читает и меняет их только функция под service_role.
-- Видит подключение и может его удалить только владелец; администратор компании чужую почту не видит.
-- Право `mail.connect` выдаётся роли «Сотрудник» и администраторам; внешним пользователям (субподрядчик, заказчик) функция его не засчитывает.
-- См. docs: 04-modules/16-integrations.md.

create table public.mail_accounts (
  user_id            uuid primary key references public.users(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id),
  provider           text not null default 'microsoft' check (provider = 'microsoft'),
  email              text not null check (char_length(email) <= 320),
  display_name       text check (char_length(display_name) <= 200),
  ms_tenant_id       text,
  scopes             text not null default '',
  refresh_token_enc  text not null,
  access_token_enc   text,
  access_expires_at  timestamptz,
  connected_at       timestamptz not null default now(),
  last_ok_at         timestamptz,
  last_error         text check (char_length(last_error) <= 500),
  updated_at         timestamptz not null default now()
);
create index on public.mail_accounts (tenant_id);

alter table public.mail_accounts enable row level security;
alter table public.mail_accounts force row level security;
create policy mail_accounts_select on public.mail_accounts for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));
create policy mail_accounts_delete on public.mail_accounts for delete to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));

-- Столбцы с токенами недоступны ни на чтение, ни на запись: только service_role (функция `mail`)
revoke all on public.mail_accounts from anon, authenticated;
grant select (user_id, tenant_id, provider, email, display_name, connected_at, last_ok_at, last_error) on public.mail_accounts to authenticated;
grant delete on public.mail_accounts to authenticated;

-- Право: каталог, затем роли (см. roles_admin)
insert into public.permissions (code, module, sort, label, tenant_only, external_ok) values
  ('mail.connect', 'Администрирование', 108, 'Подключать свою почту Outlook', true, false)
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'mail.connect'
  from public.roles r
 where r.scope = 'tenant' and r.is_system and r.deleted_at is null and r.code in ('member', 'tenant_admin', 'director')
on conflict do nothing;

create or replace function private.roles_mail_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'tenant' and new.is_system and new.code in ('member', 'tenant_admin', 'director') then
    insert into public.role_permissions (tenant_id, role_id, permission)
    values (new.tenant_id, new.id, 'mail.connect')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger roles_mail_defaults after insert on public.roles for each row execute function private.roles_mail_defaults();
