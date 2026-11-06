-- Добавить организацию (подрядчика, поставщика…) прямо из проекта.
-- Права: администратор справочников или тот, кто планирует/управляет местами проекта.
create or replace function public.organization_create(p_project uuid, p_name text, p_kind text default 'subcontractor', p_tax_id text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if not (private.has_tenant_permission('admin.reference_data')
          or private.has_project_permission(p_project, 'schedule.edit')
          or private.has_project_permission(p_project, 'location.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'name required' using errcode = '22023'; end if;
  if p_kind not in ('subcontractor', 'supplier', 'designer', 'supervision', 'client', 'own', 'other') then
    raise exception 'bad kind' using errcode = '22023';
  end if;
  -- одинаковое название не дублируем: возвращаем существующую организацию
  select id into v_id from public.organizations
   where tenant_id = v_tenant and deleted_at is null and lower(name) = lower(v_name) limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.organizations (tenant_id, name, kind, tax_id)
  values (v_tenant, v_name, p_kind, nullif(btrim(coalesce(p_tax_id, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.organization_create(uuid, text, text, text) from public, anon;
grant execute on function public.organization_create(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
