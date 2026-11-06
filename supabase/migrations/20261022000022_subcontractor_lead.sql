-- Ответственный от подрядчика: приглашает людей своей организации и назначает им задачи.
-- Обычный субподрядчик по-прежнему ведёт только свои задачи.

create or replace function private.seed_subcontractor_lead(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  select id into v_role from public.roles where tenant_id = p_tenant and scope = 'project' and code = 'subcontractor_lead';
  if v_role is null then
    insert into public.roles (tenant_id, scope, code, name, is_system)
    values (p_tenant, 'project', 'subcontractor_lead', 'Ответственный от подрядчика (внешний)', true)
    returning id into v_role;
  end if;
  insert into public.role_permissions (tenant_id, role_id, permission)
  select p_tenant, v_role, p
    from unnest(array['project.view','task.view','task.create','task.edit.own','task.transition.own','comment.create',
                      'progress.report','walk.create','task.assign','project.members.invite_org']) p
  on conflict do nothing;
end;
$$;

select private.seed_subcontractor_lead(id) from public.tenants;

create or replace function private.tenants_seed_subcontractor_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_subcontractor_lead(new.id);
  return new;
end;
$$;
create trigger tenants_seed_subcontractor_lead after insert on public.tenants
  for each row execute function private.tenants_seed_subcontractor_lead();

-- Внешний участник назначает задачи только людям своей организации (и себе)
create or replace function private.tasks_assign_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and private.is_external()
     and new.assignee_id <> auth.uid()
     and not exists (select 1 from public.users u where u.id = new.assignee_id and u.organization_id = private.my_org_id()) then
    raise exception 'external users can assign only within their organization' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tasks_assign_scope before insert or update of assignee_id on public.tasks
  for each row execute function private.tasks_assign_scope();

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
