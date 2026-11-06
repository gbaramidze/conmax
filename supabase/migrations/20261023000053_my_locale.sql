-- Язык интерфейса пользователя (русский, грузинский, английский): хранится в профиле, чтобы совпадать на всех устройствах.
-- См. docs: 04-modules/ (интерфейс на трёх языках).

create or replace function public.set_my_locale(p_locale text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_locale is null or p_locale not in ('ru', 'ka', 'en') then raise exception 'invalid locale' using errcode = '22023'; end if;
  update public.users set locale = p_locale where id = auth.uid() and tenant_id = private.tenant_id();
end;
$$;
revoke execute on function public.set_my_locale(text) from public, anon;
grant  execute on function public.set_my_locale(text) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
