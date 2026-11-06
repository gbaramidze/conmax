-- 1) «Разрез здания»: сводка по этажам для тепловой карты (готовность, задачи, замечания, расхождения, давность обхода).
-- 2) Фото проекта: обложка для списка проектов и обзора.

-- ---------------------------------------------------------------------------
-- 1. Разрез здания
-- ---------------------------------------------------------------------------
-- По каждому этажу проекта: готовность работ, открытые и просроченные задачи, замечания, заблокированные, открытые
-- расхождения проверок и дата последнего обхода. Считается с правами вызывающего (RLS): внешний видит только свои задачи,
-- а расхождения и обходы (внутренние сведения) ему не отдаются.
create or replace function public.building_section(p_project uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_internal boolean;
  v_result   jsonb;
begin
  if auth.uid() is null or not private.can_see_project(p_project) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_internal := private.can_see_internal(p_project);

  with pi as (select * from private.progress_items(p_project)),
       tk as (
         select t.type, t.status_category, t.due_date, l.path::text as path
           from public.tasks t
           join public.locations l on l.id = t.location_id
          where t.project_id = p_project and t.deleted_at is null and l.deleted_at is null),
       ck as (
         select wi.location_path as path
           from public.work_checks c
           join public.work_items wi on wi.id = c.work_item_id
          where v_internal and c.project_id = p_project and c.verdict <> 'match' and c.resolution is null),
       wk as (
         select w.location_path as path, w.submitted_at
           from public.site_walks w
          where v_internal and w.project_id = p_project and w.status <> 'draft')
  select coalesce(jsonb_agg(jsonb_build_object(
           'path',       f.path,
           'code',       f.code,
           'name',       f.name,
           'sort',       f.sort,
           'building',   f.building,
           'section',    f.section,
           'items',      coalesce(g.items, 0),
           'percent',    g.pct,
           'reported',   g.rep,
           'open_tasks', coalesce(t.open_tasks, 0),
           'overdue',    coalesce(t.overdue, 0),
           'punch',      coalesce(t.punch, 0),
           'blocked',    coalesce(t.blocked, 0),
           'discrepancies', case when v_internal then coalesce(c.n, 0) end,
           'last_walk',  case when v_internal then w.last_walk end
         ) order by f.building, f.section nulls first, f.sort, f.path), '[]')
    into v_result
    from (
      select l.path::text as path, l.code, l.name, l.sort,
             (string_to_array(l.path::text, '.'))[1] as building,
             case when array_length(string_to_array(l.path::text, '.'), 1) >= 3 then (string_to_array(l.path::text, '.'))[2] end as section
        from public.locations l
       where l.project_id = p_project and l.deleted_at is null and l.kind = 'floor') f
    left join lateral (
      select count(*)::integer as items,
             round(100 * sum(i.w * i.p) / nullif(sum(i.w), 0), 1) as pct,
             round(100 * sum(i.w * i.pr) / nullif(sum(i.w), 0), 1) as rep
        from pi i where private.path_in_subtree(i.location_path, f.path)) g on true
    left join lateral (
      select count(*) filter (where x.status_category not in ('done', 'cancelled'))::integer as open_tasks,
             count(*) filter (where x.status_category not in ('done', 'cancelled') and x.due_date < current_date)::integer as overdue,
             count(*) filter (where x.status_category not in ('done', 'cancelled') and x.type = 'punch')::integer as punch,
             count(*) filter (where x.status_category = 'blocked')::integer as blocked
        from tk x where private.path_in_subtree(x.path, f.path)) t on true
    left join lateral (
      select count(*)::integer as n from ck y where private.path_in_subtree(y.path, f.path)) c on true
    left join lateral (
      select max(z.submitted_at) as last_walk from wk z where private.path_in_subtree(z.path, f.path)) w on true;

  return v_result;
end;
$$;
revoke execute on function public.building_section(uuid) from public, anon;
grant  execute on function public.building_section(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Фото проекта
-- ---------------------------------------------------------------------------
alter table public.projects add column cover_file_id uuid references public.files(id) on delete set null;

-- Обложку видят все, кто видит сам проект (включая внешних участников)
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), files.id)
         or exists (select 1 from public.projects p
                     where p.cover_file_id = files.id and p.deleted_at is null and private.can_see_project(p.id)))
  );

create or replace function public.set_project_cover(p_project uuid, p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
begin
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project) or not private.has_project_permission(p_project, 'project.edit') then
    raise exception 'permission denied: project.edit' using errcode = '42501';
  end if;
  if p_file is not null and not exists (
    select 1 from public.files f
     where f.id = p_file and f.project_id = p_project and f.tenant_id = v_tenant and f.created_by = auth.uid() and f.mime like 'image/%') then
    raise exception 'file_not_found' using errcode = '23503';
  end if;
  update public.projects set cover_file_id = p_file where id = p_project;
  perform private.record_event(v_tenant, p_project, 'project', p_project, 'cover_changed',
                               jsonb_build_object('removed', p_file is null), 'internal');
end;
$$;
revoke execute on function public.set_project_cover(uuid, uuid) from public, anon;
grant  execute on function public.set_project_cover(uuid, uuid) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
