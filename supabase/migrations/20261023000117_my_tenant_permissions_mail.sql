-- `my_tenant_permissions` отдавала только административные права (`admin.%`). Интерфейсу нужно знать и про `mail.connect`:
-- по нему показываются раздел «Почта» и кнопка «Подключить Outlook». Остальные права по-прежнему не раскрываются.
create or replace function public.my_tenant_permissions() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), '{}')
    from public.user_tenant_roles utr
    join public.role_permissions rp on rp.role_id = utr.role_id
   where utr.user_id = auth.uid() and utr.tenant_id = private.tenant_id()
     and (rp.permission like 'admin.%' or rp.permission = 'mail.connect');
$$;
