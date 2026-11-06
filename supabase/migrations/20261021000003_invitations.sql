-- S0 · Приглашения: активация профиля после установки пароля.
-- Сам приём приглашения делает Edge Function `invite-user` (service role): создаёт auth-пользователя,
-- профиль (status='invited'), роль тенанта и, при необходимости, участие в проекте.

create or replace function public.activate_me() returns void
language sql security definer set search_path = '' as $$
  update public.users
     set status = 'active', last_login_at = now()
   where id = auth.uid() and status = 'invited';
$$;

revoke execute on function public.activate_me from public, anon;
grant  execute on function public.activate_me to authenticated;
