-- Должность сотрудника меняет руководство, а не только сам человек.
-- Колонка users.job_title закрыта для прямой записи из приложения (сам человек меняет её через update_my_profile),
-- поэтому чужую должность пишет эта функция: право staff.manage (отдел кадров) или admin.users, та же компания,
-- только внутренний сотрудник.

create or replace function public.staff_set_job_title(p_user uuid, p_job_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_job text := nullif(btrim(p_job_title), '');
begin
  if p_user is null then raise exception 'user_not_found' using errcode = '22023'; end if;
  if v_job is not null and length(v_job) > 120 then raise exception 'invalid job_title' using errcode = '22023'; end if;
  if p_user <> auth.uid()
     and not (private.staff_insider()
              and (private.has_tenant_permission('staff.manage') or private.has_tenant_permission('admin.users'))
              and private.staff_same_tenant_user(p_user)) then
    raise exception 'permission denied: job_title' using errcode = '42501';
  end if;

  update public.users
     set job_title = v_job
   where id = p_user
     and tenant_id = private.tenant_id()
     and not is_external
     and deleted_at is null;
  if not found then raise exception 'user_not_found' using errcode = '22023'; end if;
end;
$$;
revoke execute on function public.staff_set_job_title(uuid, text) from public, anon;
grant execute on function public.staff_set_job_title(uuid, text) to authenticated;
