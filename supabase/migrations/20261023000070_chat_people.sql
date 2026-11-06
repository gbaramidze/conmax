-- Список людей, которым я могу написать: внутренние сотрудники — все внутренние; внешний — своя организация и внутренняя команда с общим проектом.
-- Нужен окну «Новая переписка / группа», чтобы не предлагать тех, кого нельзя позвать. Видимость пользователей, как всегда, ограничена RLS.
-- См. docs: 05-roadmap/05-backlog.md, раздел «17. Чат между сотрудниками».

create or replace function public.chat_people() returns table (id uuid, full_name text, email text, avatar_path text, job_title text, is_external boolean, organization_name text)
language sql stable set search_path = '' as $$
  select u.id, u.full_name, u.email::text, u.avatar_path, u.job_title, u.is_external, o.name
    from public.users u
    left join public.organizations o on o.id = u.organization_id
   where private.chat_peer_ok(u.id)
   order by u.full_name;
$$;

revoke execute on function public.chat_people() from public, anon;
grant execute on function public.chat_people() to authenticated;
notify pgrst, 'reload schema';
