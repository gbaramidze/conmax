-- Создатель проекта становится его руководителем: добавляется в участники с ролью «Руководитель проекта»
-- и указывается руководителем проекта. Раньше администратор организации, создав проект, не мог ни вести обходы,
-- ни создавать совещания и документы: права на работу внутри проекта дают роли участников, а не роль организации.

create or replace function private.projects_add_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  if auth.uid() is null then return null; end if;      -- сид и служебные вставки без пользователя
  select id into v_role from public.roles where tenant_id = new.tenant_id and scope = 'project' and code = 'project_manager' limit 1;
  if v_role is null then return null; end if;
  insert into public.project_members (tenant_id, project_id, user_id, role_id, organization_id, title)
  select new.tenant_id, new.id, u.id, v_role, u.organization_id, coalesce(u.job_title, 'Руководитель проекта')
    from public.users u where u.id = auth.uid() and u.tenant_id = new.tenant_id
  on conflict do nothing;
  update public.projects set manager_user_id = coalesce(manager_user_id, auth.uid()) where id = new.id;
  return null;
end;
$$;

create trigger projects_add_creator after insert on public.projects
  for each row execute function private.projects_add_creator();

-- Уже созданные проекты без участников: создатель получает роль руководителя
insert into public.project_members (tenant_id, project_id, user_id, role_id, organization_id, title)
select p.tenant_id, p.id, p.created_by, r.id, u.organization_id, coalesce(u.job_title, 'Руководитель проекта')
  from public.projects p
  join public.users u on u.id = p.created_by and u.tenant_id = p.tenant_id
  join public.roles r on r.tenant_id = p.tenant_id and r.scope = 'project' and r.code = 'project_manager'
 where p.deleted_at is null and p.created_by is not null
   and not exists (select 1 from public.project_members m where m.project_id = p.id and m.deleted_at is null)
on conflict do nothing;
update public.projects p set manager_user_id = p.created_by
 where p.manager_user_id is null and p.created_by is not null and exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = p.created_by and m.deleted_at is null);

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
