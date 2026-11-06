-- Справочник «кто есть кто»: люди, которых я вправе видеть, с организацией, должностью, контактами и участием в проектах.
-- Видимость целиком на RLS: внутренний сотрудник видит всех в компании, внешний — свою организацию и внутреннюю команду с общим проектом
-- (users_select / project_members_select из external_privacy). Заблокированные не показываются; приглашённые, но ещё не вошедшие — показываются с пометкой.
-- См. docs: 05-roadmap/05-backlog.md, пункт 2.

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
   where u.status <> 'blocked'
   order by u.full_name;
$$;

revoke execute on function public.people_directory() from public, anon;
grant execute on function public.people_directory() to authenticated;
notify pgrst, 'reload schema';
