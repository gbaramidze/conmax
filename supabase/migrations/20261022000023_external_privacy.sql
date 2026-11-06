-- Приватность внешних участников: подрядчик не видит сотрудников и названия других внешних организаций
-- (конкурирующих подрядчиков, заказчика); внутреннюю команду и коллег по своей организации видит.

-- Можно ли показать профиль/участие пользователя текущему: внутренним — всех; внешним — себя, коллег по организации
-- и внутреннюю команду общих проектов.
create or replace function private.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.is_external()
      or p_user = auth.uid()
      or exists (
        select 1 from public.users u
         where u.id = p_user
           and (u.organization_id is not distinct from private.my_org_id() and u.organization_id is not null
                or (not u.is_external and private.shares_project_with(u.id))));
$$;

drop policy users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_user(id));

drop policy project_members_select on public.project_members;
create policy project_members_select on public.project_members for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_user(user_id));

-- Организации: внешний видит свою и собственную компанию
drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (not (select private.is_external()) or id = (select private.my_org_id()) or kind = 'own')
  );

-- Ответственный от подрядчика убирает из проекта сотрудников своей организации (роль «Субподрядчик»)
create or replace function public.remove_org_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m        public.project_members;
  v_target public.users;
  v_role   text;
begin
  select * into m from public.project_members where id = p_member and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if not private.has_project_permission(m.project_id, 'project.members.invite_org') then
    raise exception 'permission denied: project.members.invite_org' using errcode = '42501';
  end if;
  select * into v_target from public.users where id = m.user_id;
  select code into v_role from public.roles where id = m.role_id;
  if v_target.organization_id is distinct from private.my_org_id() or v_role <> 'subcontractor' or m.user_id = auth.uid() then
    raise exception 'permission denied: only own subcontractor staff' using errcode = '42501';
  end if;
  update public.project_members set left_at = current_date where id = m.id;
end;
$$;
revoke execute on function public.remove_org_member(uuid) from public, anon;
grant  execute on function public.remove_org_member(uuid) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
