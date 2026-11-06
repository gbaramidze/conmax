-- Двухфакторная защита (одноразовые коды из приложения-аутентификатора): серверная часть.
--
-- Пользователь включает защиту сам в профиле (Supabase Auth: TOTP). Но если проверять второй фактор только на экране входа,
-- его можно обойти: взять токен после ввода пароля и обратиться к базе напрямую. Поэтому защита проверяется в базе.
-- Если у пользователя есть подтверждённый второй фактор, а токен получен только по паролю (уровень `aal1`), `private.tenant_id()`
-- возвращает пустое значение, и почти все правила доступа (RLS, функции, хранилище завязаны на неё) перестают отдавать данные
-- и принимать записи, пока не введён код (токен уровня `aal2`).
-- У тех, кто защиту не включал, ничего не меняется. Включить второй фактор всем администраторам — отдельное решение (требование на уровне компании).
-- См. docs: 05-roadmap/05-backlog.md, раздел «Двухфакторная защита».

create or replace function private.mfa_pending() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     and exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;

create or replace function private.tenant_id() returns uuid
language sql stable as $$
  select case when private.mfa_pending() then null else nullif(auth.jwt() ->> 'tenant_id', '')::uuid end;
$$;

grant execute on function private.mfa_pending() to authenticated, supabase_auth_admin;
