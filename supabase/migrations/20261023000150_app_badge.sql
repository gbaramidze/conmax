-- Число на значке иконки приложения (установленное приложение на телефоне и компьютере): непрочитанные сообщения чата
-- плюс непрочитанные во «Входящих» Outlook. Включает сам человек в профиле (по умолчанию выключено).
-- Пока приложение открыто или свёрнуто, значок ставит страница (navigator.setAppBadge); когда закрыто — каждый push
-- приносит свежее число (`public.app_badge_counts`), и его ставит service worker.

alter table public.user_notification_settings add column app_badge boolean not null default false;
grant insert (app_badge) on public.user_notification_settings to authenticated;
grant update (app_badge) on public.user_notification_settings to authenticated;

-- Непрочитанные во «Входящих» по последнему опросу ящика (раз в минуту) — серверу, чтобы push знал число без Microsoft Graph
alter table public.mail_accounts add column inbox_unread integer check (inbox_unread is null or inbox_unread >= 0);

/**
 * Число для значка у тех из p_users, кто его включил. Непрочитанное в чате считается той же функцией, что и в приложении
 * (`chat_unread_count` с видимостью каналов), — для этого на время подсчёта подставляется сессия получателя.
 */
create or replace function public.app_badge_counts(p_users uuid[]) returns table (user_id uuid, badge integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  r        record;
begin
  for r in
    select u.id, u.tenant_id, u.is_external
      from public.users u join public.user_notification_settings s on s.user_id = u.id
     where u.id = any(p_users) and s.app_badge and u.status <> 'blocked'
  loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', r.id, 'role', 'authenticated', 'tenant_id', r.tenant_id, 'is_external', r.is_external, 'aal', 'aal2')::text, true);
    perform set_config('request.jwt.claim.sub', r.id::text, true);
    user_id := r.id;
    badge := public.chat_unread_count() + coalesce((select a.inbox_unread from public.mail_accounts a where a.user_id = r.id), 0);
    return next;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
end;
$$;
revoke execute on function public.app_badge_counts(uuid[]) from public, anon, authenticated;
grant  execute on function public.app_badge_counts(uuid[]) to service_role;
