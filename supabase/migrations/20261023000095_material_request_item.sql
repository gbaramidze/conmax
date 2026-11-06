-- Заявки на материалы: привязка к статье бюджета руководителем и закрытие цифр бюджета от тех, кому их видеть не положено.
-- Прораб заявку заводит без статьи бюджета (статьи читают только роли с `budget.view`), статью проставляет тот, кто согласует.
-- Остаток статьи (бюджет, обязательства, резерв) отдаётся только с `budget.view` или `procurement.approve`.

create or replace function public.material_request_set_item(p_request uuid, p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['procurement.approve']);
  if r.status not in ('draft', 'submitted', 'approved') then raise exception 'request_locked' using errcode = '22023'; end if;
  if p_item is not null and not exists (select 1 from public.cbs_items where id = p_item and project_id = r.project_id and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;
  update public.material_requests set cbs_item_id = p_item, updated_at = now() where id = r.id;
end;
$$;

create or replace function public.material_request_budget(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.material_requests;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
          and (private.has_project_permission(r.project_id, 'budget.view') or private.has_project_permission(r.project_id, 'procurement.approve'))) then
    raise exception 'permission denied: budget' using errcode = '42501';
  end if;
  return private.request_budget_check(p_request);
end;
$$;

revoke execute on function public.material_request_set_item(uuid, uuid) from public, anon;
grant execute on function public.material_request_set_item(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
