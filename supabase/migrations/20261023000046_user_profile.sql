-- Личный профиль: должность, фото (аватар), почта из Supabase Auth, правка профиля только через функции.
-- См. docs: 04-modules/02-identity-org.md, раздел «Личный профиль».

-- ---------------------------------------------------------------------------
-- 1. Колонки
-- ---------------------------------------------------------------------------
-- avatar_file_id нигде не использовался (аватар не ведёт на проект, а таблица files привязана к проекту) — заменяем путём в Storage
alter table public.users drop column avatar_file_id;
alter table public.users add column job_title   text check (job_title is null or length(job_title) <= 120);
alter table public.users add column avatar_path text check (avatar_path is null or length(avatar_path) <= 300);

-- Колонки профиля меняются только функциями ниже (с проверкой значений); прямых UPDATE у клиента больше нет
revoke update on public.users from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Бакет avatars: <tenant_id>/<user_id>/<uuid>.<ext>, приватный, до 1 МБ
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Читать: кто вправе видеть самого пользователя (внешний не видит чужих сотрудников и конкурентов)
create policy avatars_select on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and private.can_see_user(((storage.foldername(name))[2])::uuid)
  );
-- Загружать и удалять: только в свою папку
create policy avatars_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
create policy avatars_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 3. Функции
-- ---------------------------------------------------------------------------
-- Фото: путь уже загруженного объекта в своей папке (null — убрать фото)
create or replace function public.set_my_avatar(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
begin
  if auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_path is not null then
    if p_path not like v_tenant::text || '/' || auth.uid()::text || '/%' then
      raise exception 'invalid avatar path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
      raise exception 'file_not_found' using errcode = '23503';
    end if;
  end if;
  update public.users set avatar_path = p_path where id = auth.uid() and tenant_id = v_tenant;
end;
$$;
revoke execute on function public.set_my_avatar(text) from public, anon;
grant  execute on function public.set_my_avatar(text) to authenticated;

-- Профиль: имя, телефон, должность, язык, часовой пояс. Почту и пароль меняет Supabase Auth, а не эта функция.
create or replace function public.update_my_profile(
  p_full_name text, p_phone text default null, p_job_title text default null,
  p_locale text default null, p_timezone text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name  text := nullif(btrim(p_full_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_job   text := nullif(btrim(p_job_title), '');
begin
  if auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_name is null or length(v_name) > 120 then raise exception 'invalid full_name' using errcode = '22023'; end if;
  if v_phone is not null and (length(v_phone) > 32 or v_phone !~ '^[0-9+()\-\s.]+$') then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if v_job is not null and length(v_job) > 120 then raise exception 'invalid job_title' using errcode = '22023'; end if;
  if p_locale is not null and p_locale not in ('ru', 'en') then raise exception 'invalid locale' using errcode = '22023'; end if;
  if p_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;

  update public.users
     set full_name = v_name,
         phone     = v_phone,
         job_title = v_job,
         locale    = coalesce(p_locale, locale),
         timezone  = coalesce(p_timezone, timezone)
   where id = auth.uid() and tenant_id = private.tenant_id();

  -- часовой пояс один на пользователя: тот же, что в настройках уведомлений
  if p_timezone is not null then
    insert into public.user_notification_settings (user_id, tenant_id, timezone)
    values (auth.uid(), private.tenant_id(), p_timezone)
    on conflict (user_id) do update set timezone = excluded.timezone;
  end if;
end;
$$;
revoke execute on function public.update_my_profile(text, text, text, text, text) from public, anon;
grant  execute on function public.update_my_profile(text, text, text, text, text) to authenticated;

-- Смена часового пояса на экране уведомлений отражается и в профиле
create or replace function private.sync_user_timezone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.users set timezone = new.timezone where id = new.user_id and timezone is distinct from new.timezone;
  return null;
end;
$$;
create trigger sync_user_timezone after insert or update of timezone on public.user_notification_settings
  for each row execute function private.sync_user_timezone();

-- После подтверждения смены почты письмом Supabase Auth адрес в профиле обновляется сам
create or replace function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.users set email = new.email where id = new.id;
  end if;
  return null;
end;
$$;
create trigger sync_user_email after update of email on auth.users
  for each row execute function private.sync_user_email();

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
