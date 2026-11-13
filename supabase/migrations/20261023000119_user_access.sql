-- Отключение и возврат доступа сотрудника администратором (право admin.users).
-- Человека не удаляем: он остаётся автором задач, замечаний, документов и сообщений. Отключённый (status = 'blocked') не получает токен
-- с tenant_id (custom_access_token_hook), поэтому RLS не пускает его ни к чему; из справочника и подборок исполнителей он пропадает.
--  • `set_user_blocked` — только для service_role: её вызывает Edge Function `set-user-access` после проверки права и компании.
--    Меняет статус и закрывает все сессии, чтобы отключение подействовало сразу, а не когда истечёт токен.
--  • `people_directory` теперь показывает отключённых только администраторам, чтобы им можно было вернуть доступ.

create or replace function public.set_user_blocked(p_user uuid, p_blocked boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  -- вернули доступ: тот, кто уже входил, снова «активен», кто так и не вошёл — снова «приглашён»
  select case when p_blocked then 'blocked' when u.last_login_at is null then 'invited' else 'active' end
    into v_status from public.users u where u.id = p_user;
  if v_status is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.users set status = v_status where id = p_user;
  if p_blocked then
    delete from auth.sessions where user_id = p_user;
  end if;
  return v_status;
end;
$$;

revoke execute on function public.set_user_blocked(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_user_blocked(uuid, boolean) to service_role;

create or replace function public.people_directory() returns table (
  id uuid, full_name text, email text, phone text, avatar_path text, job_title text, is_external boolean, status text,
  organization_id uuid, organization_name text, organization_kind text, projects jsonb
)
language sql stable set search_path = '' as $$
  select u.id, u.full_name, u.email::text, u.phone, u.avatar_path, u.job_title, u.is_external, u.status,
         o.id, o.name, o.kind,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'project_id', p.id, 'code', p.code, 'name', p.name, 'role', r.name, 'title', pm.title, 'discipline', d.code)
                  order by p.code)
             from public.project_members pm
             join public.projects p on p.id = pm.project_id
             join public.roles r on r.id = pm.role_id
             left join public.disciplines d on d.id = pm.discipline_id
            where pm.user_id = u.id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
         ), '[]'::jsonb)
    from public.users u
    left join public.organizations o on o.id = u.organization_id
   where u.status <> 'blocked' or (select private.has_tenant_permission('admin.users'))
   order by u.full_name;
$$;

revoke execute on function public.people_directory() from public, anon;
grant execute on function public.people_directory() to authenticated;
notify pgrst, 'reload schema';
