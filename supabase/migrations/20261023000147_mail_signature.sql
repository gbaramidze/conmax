-- Почта: подпись и права подключения на сайте.
--
-- Outlook не отдаёт подпись через Microsoft Graph, поэтому храним свою: HTML из редактора (tiptap) в mail_accounts.signature.
-- signature_on_reply — добавлять ли её к ответам и пересылке (к новым письмам — всегда).
-- Сайт теперь видит scopes (какие права человек выдал: чтение, изменение, отправка), чтобы заранее предложить
-- переподключение, а не ждать ошибки. Токены по-прежнему недоступны.

alter table public.mail_accounts
  add column signature          text check (signature is null or char_length(signature) <= 20000),
  add column signature_on_reply boolean not null default true;

create policy mail_accounts_update on public.mail_accounts for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()))
  with check (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));

grant select (scopes, signature, signature_on_reply) on public.mail_accounts to authenticated;
grant update (signature, signature_on_reply) on public.mail_accounts to authenticated;
