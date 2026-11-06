-- Исправление: shares_project_with не учитывал дату выхода (left_at), и бывшие участники
-- проекта по-прежнему считались «коллегами» (внешний пользователь видел профили тех, кто ушёл).

create or replace function private.shares_project_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
      and mine.tenant_id = private.tenant_id()
      and mine.deleted_at is null and theirs.deleted_at is null
      and (mine.left_at is null   or mine.left_at   > current_date)
      and (theirs.left_at is null or theirs.left_at > current_date)
  );
$$;
