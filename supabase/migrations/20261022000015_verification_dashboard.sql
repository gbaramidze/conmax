-- S3.5 (часть 3) · Независимая проверка факта, расхождения, вес позиций, сводка прогресса.
-- См. docs: ADR-014, 04-modules/26-field-work.md §6.5–6.6.

-- ---------------------------------------------------------------------------
-- Права: walk.verify (независимая проверка) — внутренним ролям; подрядчики и безопасники не проверяют
-- ---------------------------------------------------------------------------
create or replace function private.field_permissions_for(p_scope text, p_code text) returns text[]
language sql immutable as $$
  select case
    when p_scope = 'project' and p_code = 'project_manager' then array['workitem.manage','walk.create','walk.approve','walk.verify']
    when p_scope = 'project' and p_code = 'chief_engineer'  then array['workitem.manage','walk.create','walk.verify']
    when p_scope = 'project' and p_code = 'pto'             then array['workitem.manage','walk.create','walk.approve','walk.verify']
    when p_scope = 'project' and p_code = 'economist'       then array['workitem.manage']
    when p_scope = 'project' and p_code in ('foreman','master') then array['walk.create','walk.verify']
    when p_scope = 'project' and p_code in ('safety_officer','subcontractor') then array['walk.create']
    when p_scope = 'tenant'  and p_code = 'tenant_admin'    then array['workitem.manage','walk.approve']
    else array[]::text[]
  end;
$$;

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, p
  from public.roles r, lateral unnest(private.field_permissions_for(r.scope, r.code)) p
 where r.is_system
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Колонки и ограничения
-- ---------------------------------------------------------------------------
alter table public.work_items add column weight numeric(18,2) check (weight is null or weight > 0);
grant insert (weight) on public.work_items to authenticated;
grant update (weight) on public.work_items to authenticated;

alter table public.site_walks add column kind text not null default 'report' check (kind in ('report','check'));

alter table public.site_walk_results
  drop constraint site_walk_results_result_check,
  drop constraint site_walk_results_qty_check,
  drop constraint site_walk_results_check;
alter table public.site_walk_results
  add constraint site_walk_results_result_check check (result in ('progress','no_work','blocked','observed')),
  add constraint site_walk_results_qty_check check (
    (result = 'progress' and qty > 0)
    or (result = 'observed' and qty >= 0)
    or (result in ('no_work','blocked') and qty is null));

-- Факт: заявки (kind = report) и корректировки по итогам проверки (kind = correction, может быть < 0)
alter table public.work_progress drop constraint work_progress_qty_check;
alter table public.work_progress
  add column kind text not null default 'report' check (kind in ('report','correction')),
  add column check_id uuid;
alter table public.work_progress add constraint work_progress_qty_check
  check ((kind = 'report' and qty > 0) or (kind = 'correction' and qty <> 0));

-- ---------------------------------------------------------------------------
-- Проверки (второй, независимый источник того же факта)
-- ---------------------------------------------------------------------------
create table public.work_checks (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null references public.tenants(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  work_item_id    uuid not null references public.work_items(id) on delete cascade,
  walk_id         uuid not null references public.site_walks(id) on delete cascade,
  checked_by      uuid not null references public.users(id),
  checked_at      timestamptz not null default now(),
  observed_qty    numeric(18,4) not null check (observed_qty >= 0),        -- накопленный итог на месте
  reported_qty    numeric(18,4) not null,                                  -- заявленное (принято + ожидает) на момент проверки
  delta           numeric(18,4) generated always as (observed_qty - reported_qty) stored,
  verdict         text not null check (verdict in ('match','minor','major')),
  independent     boolean not null,                                        -- проверяющий сам не вносил факт по позиции
  resolution      text check (resolution in ('accept_reported','accept_observed','superseded')),
  resolved_by     uuid references public.users(id),
  resolved_at     timestamptz,
  resolution_note text,
  check ((resolution is null) = (resolved_at is null)),
  check (verdict <> 'match' or resolution is null)
);
create index on public.work_checks (work_item_id, checked_at desc);
create index on public.work_checks (project_id) where verdict <> 'match' and resolution is null;
create unique index work_checks_one_open on public.work_checks (work_item_id) where verdict <> 'match' and resolution is null;

alter table public.work_progress
  add constraint work_progress_check_fk foreign key (check_id) references public.work_checks(id);

alter table public.work_checks enable row level security;
alter table public.work_checks force row level security;
-- Проверки и расхождения — только внутренним участникам проекта; запись — функциями
create policy work_checks_select on public.work_checks for select to authenticated
  using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id) and private.can_see_internal(project_id));

alter publication supabase_realtime add table public.work_checks;

-- ---------------------------------------------------------------------------
-- Вердикт сверки: относительно значения (а не плана), с порогом шума 0,5 % плана
-- ---------------------------------------------------------------------------
create or replace function private.check_verdict(p_project uuid, p_planned numeric, p_reported numeric, p_observed numeric)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ok    numeric;
  v_major numeric;
  v_delta numeric := abs(p_observed - p_reported);
  v_rel   numeric;
begin
  select coalesce((settings -> 'check_tolerance' ->> 'ok')::numeric, 10),
         coalesce((settings -> 'check_tolerance' ->> 'major')::numeric, 25)
    into v_ok, v_major from public.projects where id = p_project;

  if v_delta = 0 or v_delta <= p_planned * 0.005 then return 'match'; end if;
  v_rel := v_delta / greatest(p_reported, p_observed) * 100;
  return case when v_rel <= v_ok then 'match' when v_rel <= v_major then 'minor' else 'major' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Позиции плана: заявленное, принятое, состояние проверки
-- ---------------------------------------------------------------------------
drop view public.work_items_progress;
create view public.work_items_progress with (security_invoker = true) as
select wi.*,
       p.done_qty,
       p.pending_qty,
       ck.id                as check_id,
       ck.checked_at        as checked_at,
       ck.observed_qty      as observed_qty,
       ck.reported_qty      as check_reported_qty,
       ck.verdict           as check_verdict,
       ck.independent       as check_independent,
       ck.resolution        as check_resolution,
       case
         when ck.id is null then 'unchecked'
         when (ck.verdict = 'match' and ck.independent) or ck.resolution = 'accept_observed' then 'verified'
         when ck.verdict = 'match' then 'unchecked'                       -- совпало, но проверял тот, кто и вносил факт
         when ck.resolution is not null then 'accepted'                   -- расхождение закрыто в пользу заявленного
         else 'disputed'
       end                  as verification,
       case when ck.id is not null and ((ck.verdict = 'match' and ck.independent) or ck.resolution = 'accept_observed')
            then greatest(least(p.done_qty + p.pending_qty, ck.observed_qty), 0) else 0 end as verified_qty
  from public.work_items wi
 cross join lateral (
   select coalesce(sum(wp.qty) filter (where wp.approved_at is not null), 0) as done_qty,
          coalesce(sum(wp.qty) filter (where wp.approved_at is null), 0)     as pending_qty
     from public.work_progress wp where wp.work_item_id = wi.id) p
  left join lateral (
   select c.* from public.work_checks c where c.work_item_id = wi.id
    order by c.checked_at desc, c.id desc limit 1) ck on true
 where wi.deleted_at is null;
grant select on public.work_items_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Ожидаемые позиции: для отчёта — незавершённые; для проверки — всё, что уже заявлено (в том числе на 100 %)
-- ---------------------------------------------------------------------------
create or replace function private.walk_expected_items(p_walk public.site_walks)
returns setof public.work_items
language sql stable security definer set search_path = '' as $$
  select wi.*
    from public.work_items wi
   where wi.project_id = p_walk.project_id and wi.status = 'active' and wi.deleted_at is null
     and private.path_in_subtree(wi.location_path, p_walk.location_path)
     and case
           when p_walk.kind = 'check' then
             private.can_see_internal(wi.project_id)
             and (select coalesce(sum(wp.qty), 0) from public.work_progress wp where wp.work_item_id = wi.id) > 0
           else
             (private.can_see_internal(wi.project_id) or wi.contractor_org_id = private.my_org_id())
             and (select coalesce(sum(wp.qty), 0) from public.work_progress wp where wp.work_item_id = wi.id) < wi.planned_qty
         end;
$$;

-- ---------------------------------------------------------------------------
-- Начать обход: отчёт (walk.create) или проверку (walk.verify)
-- ---------------------------------------------------------------------------
drop function public.start_walk(uuid, uuid);
create function public.start_walk(p_project uuid, p_location uuid, p_kind text default 'report') returns public.site_walks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := private.tenant_id();
  v_loc    public.locations;
  v_walk   public.site_walks;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_kind not in ('report', 'check') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.can_see_project(p_project)
     or not private.has_project_permission(p_project, case when p_kind = 'check' then 'walk.verify' else 'walk.create' end)
     or (p_kind = 'check' and not private.can_see_internal(p_project)) then
    raise exception 'permission denied: walk.%', case when p_kind = 'check' then 'verify' else 'create' end using errcode = '42501';
  end if;
  select * into v_loc from public.locations
   where id = p_location and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
  if not found then
    raise exception 'location not found' using errcode = '23503';
  end if;

  select * into v_walk from public.site_walks
   where author_id = v_uid and location_id = p_location and status = 'draft' and kind = p_kind limit 1;
  if found then return v_walk; end if;

  insert into public.site_walks (tenant_id, project_id, location_id, location_path, author_id, kind)
  values (v_tenant, p_project, p_location, v_loc.path::text, v_uid, p_kind)
  returning * into v_walk;
  return v_walk;
end;
$$;

-- ---------------------------------------------------------------------------
-- Исход по позиции (черновик). Для проверки: observed (итог на месте) или blocked («не удалось проверить»)
-- ---------------------------------------------------------------------------
create or replace function public.save_walk_result(
  p_walk        uuid,
  p_item        uuid,
  p_result      text,
  p_qty         numeric default null,
  p_reason_code text default null,
  p_comment     text default null
) returns public.site_walk_results
language plpgsql security definer set search_path = '' as $$
declare
  v_walk    public.site_walks;
  v_res     public.site_walk_results;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_walk from public.site_walks where id = p_walk and author_id = auth.uid() and tenant_id = private.tenant_id();
  if not found then raise exception 'walk_not_found' using errcode = 'P0002'; end if;
  if v_walk.status <> 'draft' then raise exception 'walk_closed' using errcode = '22023'; end if;

  if not exists (select 1 from private.walk_expected_items(v_walk) e where e.id = p_item) then
    raise exception 'item_not_expected' using errcode = '22023';
  end if;
  if (v_walk.kind = 'report' and p_result not in ('progress', 'no_work', 'blocked'))
     or (v_walk.kind = 'check' and p_result not in ('observed', 'blocked')) then
    raise exception 'invalid_result' using errcode = '22023';
  end if;
  if p_result = 'progress' and (p_qty is null or p_qty <= 0) then
    raise exception 'qty_required' using errcode = '22023';
  end if;
  if p_result = 'observed' and (p_qty is null or p_qty < 0) then
    raise exception 'qty_required' using errcode = '22023';
  end if;
  if p_result = 'blocked' then
    if p_reason_code is null or not exists (
      select 1 from public.reason_codes rc where rc.tenant_id = v_walk.tenant_id and rc.code = p_reason_code and rc.is_active) then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    if p_reason_code = 'other' and v_comment is null then
      raise exception 'comment_required' using errcode = '22023';
    end if;
  end if;

  insert into public.site_walk_results (walk_id, work_item_id, tenant_id, result, qty, reason_code, comment)
  values (p_walk, p_item, v_walk.tenant_id, p_result,
          case when p_result in ('progress', 'observed') then p_qty end,
          case when p_result = 'blocked' then p_reason_code end,
          v_comment)
  on conflict (walk_id, work_item_id) do update set
    result = excluded.result, qty = excluded.qty, reason_code = excluded.reason_code,
    comment = excluded.comment, updated_at = now()
  returning * into v_res;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Принять ожидающий факт позиции; обходы, у которых не осталось неподтверждённых записей, закрываются
-- ---------------------------------------------------------------------------
create or replace function private.approve_item_progress(p_item uuid, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_walks uuid[];
begin
  with upd as (
    update public.work_progress set approved_by = p_by, approved_at = now()
     where work_item_id = p_item and approved_at is null
     returning walk_id)
  select array_agg(distinct walk_id) filter (where walk_id is not null) into v_walks from upd;

  if v_walks is not null then
    update public.site_walks w set status = 'approved', approved_by = p_by, approved_at = now()
     where w.id = any (v_walks) and w.status = 'submitted'
       and not exists (select 1 from public.work_progress x where x.walk_id = w.id and x.approved_at is null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Уведомление о расхождении: держатели walk.approve проекта и руководители направления позиции (с предками)
-- ---------------------------------------------------------------------------
create or replace function private.notify_discrepancy(
  p_project uuid, p_discipline uuid, p_verdict text, p_text text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  for v_user in
    select pm.user_id
      from public.project_members pm
      join public.role_permissions rp on rp.role_id = pm.role_id and rp.permission = 'walk.approve'
     where pm.project_id = p_project and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
    union
    select d.lead_user_id
      from (with recursive r(id, parent_id, lead_user_id) as (
              select d0.id, d0.parent_id, d0.lead_user_id from public.disciplines d0 where d0.id = p_discipline
              union all
              select d1.id, d1.parent_id, d1.lead_user_id from public.disciplines d1 join r on d1.id = r.parent_id)
            select * from r) d
     where d.lead_user_id is not null
  loop
    perform private.notify(v_user, 'project', p_project, 'escalation',
                           case when p_verdict = 'major' then 'high' else 'normal' end,
                           'discrepancy', p_text, true);
  end loop;
end;
$$;

create or replace function private.notification_body(p_counts jsonb, p_last_text text) returns text
language plpgsql immutable as $$
declare
  v_total integer := 0;
  v_parts text[] := '{}';
  v_n     integer;
  k       text;
begin
  for k in select jsonb_object_keys(p_counts) loop v_total := v_total + (p_counts ->> k)::integer; end loop;
  if v_total <= 1 then return p_last_text; end if;

  v_n := coalesce((p_counts ->> 'assigned')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'вас назначили исполнителем'); end if;
  v_n := coalesce((p_counts ->> 'mentioned')::integer, 0);
  if v_n = 1 then v_parts := array_append(v_parts, 'вас упомянули');
  elsif v_n > 1 then v_parts := array_append(v_parts, 'упоминаний: ' || v_n); end if;
  v_n := coalesce((p_counts ->> 'status_changed')::integer, 0);
  if v_n = 1 then v_parts := array_append(v_parts, 'статус изменён');
  elsif v_n > 1 then v_parts := array_append(v_parts, 'статус менялся ' || v_n || ' ' || private.ru_plural(v_n, 'раз', 'раза', 'раз')); end if;
  v_n := coalesce((p_counts ->> 'due_changed')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'срок изменён'); end if;
  v_n := coalesce((p_counts ->> 'commented')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, v_n || ' ' || private.ru_plural(v_n, 'комментарий', 'комментария', 'комментариев')); end if;
  v_n := coalesce((p_counts ->> 'discrepancy')::integer, 0);
  if v_n > 0 then v_parts := array_append(v_parts, 'расхождений: ' || v_n); end if;

  return array_to_string(v_parts, ', ');
end;
$$;

-- ---------------------------------------------------------------------------
-- Завершить обход. Отчёт: факт записывается приращениями. Проверка: сверка с заявленным.
-- ---------------------------------------------------------------------------
create or replace function public.submit_walk(p_walk uuid) returns public.site_walks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_walk     public.site_walks;
  v_missing  integer;
  v_auto     boolean;
  v_counts   jsonb;
  r          record;
  v_reported numeric;
  v_verdict  text;
  v_indep    boolean;
  v_check    uuid;
  v_tally    jsonb := jsonb_build_object('match', 0, 'minor', 0, 'major', 0);
begin
  select * into v_walk from public.site_walks where id = p_walk and author_id = v_uid and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'walk_not_found' using errcode = 'P0002'; end if;
  if v_walk.status <> 'draft' then raise exception 'walk_closed' using errcode = '22023'; end if;

  select count(*) into v_missing
    from private.walk_expected_items(v_walk) e
   where not exists (select 1 from public.site_walk_results x where x.walk_id = p_walk and x.work_item_id = e.id);
  if v_missing > 0 then
    raise exception 'walk_incomplete' using errcode = '22023', hint = v_missing::text;
  end if;

  if v_walk.kind = 'check' then
    for r in
      select res.work_item_id, res.qty, wi.planned_qty, wi.name, wi.unit, wi.location_path, wi.discipline_id
        from public.site_walk_results res
        join public.work_items wi on wi.id = res.work_item_id
       where res.walk_id = p_walk and res.result = 'observed'
    loop
      select coalesce(sum(wp.qty), 0) into v_reported from public.work_progress wp where wp.work_item_id = r.work_item_id;
      v_verdict := private.check_verdict(v_walk.project_id, r.planned_qty, v_reported, r.qty);
      v_indep := not exists (
        select 1 from public.work_progress wp where wp.work_item_id = r.work_item_id and wp.reported_by = v_uid and wp.kind = 'report');

      -- актуально одно открытое расхождение на позицию: новая проверка заменяет прежнее
      update public.work_checks set resolution = 'superseded', resolved_by = v_uid, resolved_at = now(),
             resolution_note = 'Заменено новой проверкой'
       where work_item_id = r.work_item_id and verdict <> 'match' and resolution is null;

      insert into public.work_checks (tenant_id, project_id, work_item_id, walk_id, checked_by, observed_qty, reported_qty, verdict, independent)
      values (v_walk.tenant_id, v_walk.project_id, r.work_item_id, p_walk, v_uid, r.qty, v_reported, v_verdict, v_indep)
      returning id into v_check;

      v_tally := jsonb_set(v_tally, array[v_verdict], to_jsonb((v_tally ->> v_verdict)::integer + 1));

      if v_verdict = 'match' and v_indep then
        perform private.approve_item_progress(r.work_item_id, v_uid);   -- два источника сошлись
      elsif v_verdict <> 'match' then
        perform private.notify_discrepancy(
          v_walk.project_id, r.discipline_id, v_verdict,
          format('Расхождение: %s (%s) — заявлено %s, на месте %s %s',
                 r.name, r.location_path, trim_scale(round(v_reported, 2))::text, trim_scale(round(r.qty, 2))::text, r.unit));
      end if;
    end loop;

    update public.site_walks set status = 'approved', submitted_at = now(), approved_by = v_uid, approved_at = now()
     where id = p_walk returning * into v_walk;

    v_counts := v_tally || jsonb_build_object(
      'walk_id', p_walk,
      'blocked', (select count(*) from public.site_walk_results where walk_id = p_walk and result = 'blocked'));
    perform private.record_event(v_walk.tenant_id, v_walk.project_id, 'location', v_walk.location_id, 'check_submitted', v_counts, 'internal');
    return v_walk;
  end if;

  -- отчёт: без подтверждения факт принимается сразу
  select coalesce((p.settings ->> 'progress_approval')::boolean, false) = false into v_auto
    from public.projects p where p.id = v_walk.project_id;

  insert into public.work_progress (tenant_id, project_id, work_item_id, walk_id, qty, reported_by, approved_by, approved_at)
  select v_walk.tenant_id, v_walk.project_id, res.work_item_id, p_walk, res.qty, v_uid,
         case when v_auto then v_uid end, case when v_auto then now() end
    from public.site_walk_results res
   where res.walk_id = p_walk and res.result = 'progress';

  update public.site_walks set
    status = case when v_auto then 'approved' else 'submitted' end,
    submitted_at = now(),
    approved_by = case when v_auto then v_uid end,
    approved_at = case when v_auto then now() end
  where id = p_walk returning * into v_walk;

  select jsonb_build_object(
           'walk_id', p_walk,
           'progress', count(*) filter (where result = 'progress'),
           'no_work',  count(*) filter (where result = 'no_work'),
           'blocked',  count(*) filter (where result = 'blocked'))
    into v_counts from public.site_walk_results where walk_id = p_walk;
  perform private.record_event(v_walk.tenant_id, v_walk.project_id, 'location', v_walk.location_id, 'walk_submitted', v_counts, 'internal');

  return v_walk;
end;
$$;

-- ---------------------------------------------------------------------------
-- Решение по расхождению (walk.approve)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_discrepancy(p_check uuid, p_resolution text, p_note text default null)
returns public.work_checks
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  c      public.work_checks;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into c from public.work_checks where id = p_check and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'check_not_found' using errcode = 'P0002'; end if;
  if not private.has_project_permission(c.project_id, 'walk.approve') then
    raise exception 'permission denied: walk.approve' using errcode = '42501';
  end if;
  if c.verdict = 'match' or c.resolution is not null then
    raise exception 'already_resolved' using errcode = '22023';
  end if;
  if p_resolution not in ('accept_reported', 'accept_observed') then
    raise exception 'invalid_resolution' using errcode = '22023';
  end if;
  if p_resolution = 'accept_reported' and v_note is null then
    raise exception 'comment_required' using errcode = '22023';
  end if;

  if p_resolution = 'accept_observed' then
    -- сначала принимаем ожидавшее подтверждения, затем корректируем на разницу, найденную проверкой
    perform private.approve_item_progress(c.work_item_id, v_uid);
    insert into public.work_progress (tenant_id, project_id, work_item_id, qty, kind, check_id, reported_by, approved_by, approved_at)
    values (c.tenant_id, c.project_id, c.work_item_id, c.delta, 'correction', c.id, v_uid, v_uid, now());
  end if;

  update public.work_checks set resolution = p_resolution, resolved_by = v_uid, resolved_at = now(), resolution_note = v_note
   where id = c.id returning * into c;

  perform private.record_event(c.tenant_id, c.project_id, 'work_item', c.work_item_id, 'discrepancy_resolved',
                               jsonb_build_object('check_id', c.id, 'resolution', p_resolution, 'delta', c.delta), 'internal');
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Позиции с весами и долями выполнения (с правами вызывающего: подрядчик видит только своё)
-- p — принято, pr — заявлено (с ожидающим), pv — проверено независимо; всё как доля позиции 0..1
-- ---------------------------------------------------------------------------
create or replace function private.progress_items(p_project uuid)
returns table (
  id uuid, location_id uuid, location_path text, discipline_id uuid, contractor_org_id uuid,
  planned_start date, planned_finish date, planned_qty numeric,
  w numeric, p numeric, pr numeric, pv numeric, verification text)
language sql stable set search_path = '' as $$
  with base as (
    select v.id, v.location_id, v.location_path, v.discipline_id, v.contractor_org_id, v.planned_start, v.planned_finish,
           v.planned_qty, v.weight, v.done_qty, v.pending_qty, v.verified_qty, v.verification
      from public.work_items_progress v
     where v.project_id = p_project and v.status = 'active' and v.planned_qty > 0
  ), avgw as (select avg(weight) as a from base where weight is not null)
  select b.id, b.location_id, b.location_path, b.discipline_id, b.contractor_org_id, b.planned_start, b.planned_finish, b.planned_qty,
         coalesce(b.weight, (select a from avgw), 1),
         least(1, greatest(0, b.done_qty / b.planned_qty)),
         least(1, greatest(0, (b.done_qty + b.pending_qty) / b.planned_qty)),
         least(1, greatest(0, b.verified_qty / b.planned_qty)),
         b.verification
    from base b;
$$;

-- ---------------------------------------------------------------------------
-- Сводка для главной проекта
-- ---------------------------------------------------------------------------
create or replace function public.project_dashboard(p_project uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_internal   boolean;
  v_stale_days integer;
  v_totals     jsonb;
  v_plan       jsonb;
  v_loc        jsonb;
  v_disc       jsonb;
  v_con        jsonb;
  v_series     jsonb;
  v_attn       jsonb;
  v_forecast   jsonb := 'null';
  v_now        numeric;
  v_before     numeric;
  v_rate       numeric;
  v_cover      numeric;
begin
  if auth.uid() is null or not private.can_see_project(p_project) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_internal := private.can_see_internal(p_project);
  select coalesce((settings ->> 'walk_stale_days')::integer, 7) into v_stale_days from public.projects where id = p_project;

  -- итоги
  select jsonb_build_object(
           'items',        count(*),
           'items_done',   count(*) filter (where p >= 1),
           'percent',      round(100 * sum(w * p) / nullif(sum(w), 0), 1),
           'reported',     round(100 * sum(w * pr) / nullif(sum(w), 0), 1),
           'verified',     round(100 * sum(w * pv) / nullif(sum(w), 0), 1),
           'verified_share', round(100 * sum(w * pv) / nullif(sum(w * pr), 0), 1),
           'weights_set',  (select count(*) > 0 from public.work_items x
                             where x.project_id = p_project and x.weight is not null and x.status = 'active' and x.deleted_at is null),
           'states', jsonb_build_object(
              'verified',  count(*) filter (where pr > 0 and verification = 'verified'),
              'accepted',  count(*) filter (where pr > 0 and verification = 'accepted'),
              'disputed',  count(*) filter (where pr > 0 and verification = 'disputed'),
              'unchecked', count(*) filter (where pr > 0 and verification = 'unchecked')))
    into v_totals
    from private.progress_items(p_project);

  -- план на сегодня по позициям со сроками
  select jsonb_build_object(
           'coverage', round(100 * coalesce(sum(w) filter (where dated), 0) / nullif(sum(w), 0), 0),
           'plan',     round(100 * sum(w * share) filter (where dated) / nullif(sum(w) filter (where dated), 0), 1),
           'fact',     round(100 * sum(w * p)     filter (where dated) / nullif(sum(w) filter (where dated), 0), 1))
    into v_plan
    from (select i.w, i.p,
                 (i.planned_start is not null and i.planned_finish is not null and i.planned_finish >= i.planned_start) as dated,
                 case when i.planned_start is null or i.planned_finish is null then 0
                      when current_date <= i.planned_start then 0
                      when current_date >= i.planned_finish then 1
                      else (current_date - i.planned_start)::numeric / (i.planned_finish - i.planned_start) end as share
            from private.progress_items(p_project) i) s;
  v_cover := coalesce((v_plan ->> 'coverage')::numeric, 0);

  -- динамика: 12 точек раз в неделю, последняя — сегодня
  select coalesce(jsonb_agg(jsonb_build_object('date', s.d, 'fact', s.fact, 'plan', s.plan) order by s.d), '[]') into v_series
    from (
      select g.d,
             round(100 * sum(i.w * least(1, greatest(0, coalesce(c.q, 0) / i.planned_qty))) / nullif(sum(i.w), 0), 1) as fact,
             case when v_cover >= 50 then
               round(100 * sum(i.w * case when i.planned_start is null or i.planned_finish is null or i.planned_finish < i.planned_start then 0
                                          when g.d <= i.planned_start then 0
                                          when g.d >= i.planned_finish then 1
                                          else (g.d - i.planned_start)::numeric / (i.planned_finish - i.planned_start) end)
                           filter (where i.planned_start is not null and i.planned_finish is not null and i.planned_finish >= i.planned_start)
                     / nullif(sum(i.w) filter (where i.planned_start is not null and i.planned_finish is not null and i.planned_finish >= i.planned_start), 0), 1)
             end as plan
        from (select (current_date - 7 * s)::date as d from generate_series(0, 11) s) g
       cross join private.progress_items(p_project) i
        left join lateral (
          select sum(wp.qty) as q from public.work_progress wp
           where wp.work_item_id = i.id and wp.approved_at is not null and wp.entry_date <= g.d) c on true
       group by g.d) s;

  -- прогноз по скорости последних 4 недель
  if jsonb_array_length(v_series) = 12 then
    v_now    := (v_series -> 11 ->> 'fact')::numeric;
    v_before := (v_series -> 7 ->> 'fact')::numeric;
    if v_now is not null and v_before is not null then
      v_rate := (v_now - v_before) / 4;
      v_forecast := jsonb_build_object(
        'rate_per_week', round(v_rate, 2),
        'finish_date', case when v_now >= 100 then to_jsonb(current_date)
                            when v_rate > 0 and (100 - v_now) / v_rate * 7 < 1825
                              then to_jsonb((current_date + ceil((100 - v_now) / v_rate * 7)::integer))
                            else 'null'::jsonb end);
    end if;
  end if;

  -- по месту: корпуса, секции, этажи (помещения не раскрываем)
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', l.path::text, 'name', l.name, 'kind', l.kind, 'depth', array_length(string_to_array(l.path::text, '.'), 1),
           'items', b.items, 'percent', b.pct, 'reported', b.pct_rep) order by l.path), '[]')
    into v_loc
    from (
      select a.apath, count(*) as items,
             round(100 * sum(a.w * a.p) / nullif(sum(a.w), 0), 1) as pct,
             round(100 * sum(a.w * a.pr) / nullif(sum(a.w), 0), 1) as pct_rep
        from (select i.w, i.p, i.pr,
                     array_to_string((string_to_array(i.location_path, '.'))[1:n], '.') as apath
                from private.progress_items(p_project) i
               cross join lateral generate_series(1, array_length(string_to_array(i.location_path, '.'), 1)) n) a
       group by a.apath) b
    join public.locations l on l.project_id = p_project and l.path::text = b.apath and l.deleted_at is null and l.kind <> 'room';

  -- по направлениям (с поднаправлениями), «без направления» — отдельной строкой
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sort_key), '[]') into v_disc
    from (
      select d.id as discipline_id, d.parent_id, d.code, d.name, d.color, d.sort as sort_key,
             t.items, t.pct as percent
        from (
          with recursive r(id, anc) as (
            select d0.id, d0.id from public.disciplines d0 where d0.project_id = p_project and d0.deleted_at is null
            union all
            select r.id, d1.parent_id from r join public.disciplines d1 on d1.id = r.anc where d1.parent_id is not null)
          select r.anc as discipline_id, count(*) as items,
                 round(100 * sum(i.w * i.p) / nullif(sum(i.w), 0), 1) as pct
            from private.progress_items(p_project) i join r on r.id = i.discipline_id
           group by r.anc) t
        join public.disciplines d on d.id = t.discipline_id) x;

  -- по подрядчикам
  select coalesce(jsonb_agg(jsonb_build_object(
           'org_id', t.contractor_org_id, 'name', coalesce(o.name, 'Без подрядчика'), 'items', t.items, 'percent', t.pct)
           order by t.pct nulls last), '[]')
    into v_con
    from (select i.contractor_org_id, count(*) as items,
                 round(100 * sum(i.w * i.p) / nullif(sum(i.w), 0), 1) as pct
            from private.progress_items(p_project) i group by i.contractor_org_id) t
    left join public.organizations o on o.id = t.contractor_org_id;

  -- внимание — только внутренним участникам
  if v_internal then
    select jsonb_build_object(
      'discrepancies', jsonb_build_object(
         'minor', (select count(*) from public.work_checks c where c.project_id = p_project and c.verdict = 'minor' and c.resolution is null),
         'major', (select count(*) from public.work_checks c where c.project_id = p_project and c.verdict = 'major' and c.resolution is null)),
      'walks_pending', (select count(*) from public.site_walks w where w.project_id = p_project and w.status = 'submitted'),
      'last_walk_at',  (select max(w.submitted_at) from public.site_walks w where w.project_id = p_project and w.status <> 'draft'),
      'stale_days',    v_stale_days,
      'stale', coalesce((
        select jsonb_agg(jsonb_build_object('path', s.path, 'name', s.name, 'kind', s.kind, 'last_walk', s.last_walk,
                                            'days', case when s.last_walk is null then null
                                                         else floor(extract(epoch from now() - s.last_walk) / 86400) end)
                         order by s.last_walk nulls first, s.path)
        from (
          select * from (
            select l.path::text as path, l.name, l.kind,
                   (select max(w.submitted_at) from public.site_walks w
                     where w.project_id = p_project and w.status <> 'draft'
                       and private.path_in_subtree(l.path::text, w.location_path)) as last_walk
              from public.locations l
             where l.project_id = p_project and l.deleted_at is null
               and exists (select 1 from private.progress_items(p_project) i where i.location_id = l.id and i.p < 1)) q
           where q.last_walk is null or q.last_walk < now() - make_interval(days => v_stale_days)
           order by q.last_walk nulls first, q.path limit 8) s), '[]'),
      'blocked', coalesce((
        select jsonb_agg(jsonb_build_object('code', z.reason_code, 'name', coalesce(rc.name, z.reason_code), 'count', z.n) order by z.n desc)
          from (
            select l.reason_code, count(*) as n
              from (select distinct on (r.work_item_id) r.work_item_id, r.result, r.reason_code
                      from public.site_walk_results r
                      join public.site_walks w on w.id = r.walk_id
                     where w.project_id = p_project and w.status <> 'draft' and w.kind = 'report'
                     order by r.work_item_id, w.submitted_at desc) l
              join private.progress_items(p_project) i on i.id = l.work_item_id
             where l.result = 'blocked'
             group by l.reason_code) z
          left join public.reason_codes rc on rc.code = z.reason_code and rc.tenant_id = private.tenant_id()), '[]'))
    into v_attn;
  end if;

  return jsonb_build_object(
    'totals', v_totals, 'plan', v_plan, 'series', v_series, 'forecast', v_forecast,
    'by_location', v_loc, 'by_discipline', v_disc, 'by_contractor', v_con,
    'attention', v_attn);
end;
$$;

-- Готовность и открытые расхождения по всем доступным проектам (для списка проектов)
create or replace function public.projects_progress()
returns table (project_id uuid, items integer, percent numeric, reported numeric, open_discrepancies integer)
language sql stable set search_path = '' as $$
  select p.id,
         count(i.id)::integer,
         round(100 * sum(i.w * i.p) / nullif(sum(i.w), 0), 1),
         round(100 * sum(i.w * i.pr) / nullif(sum(i.w), 0), 1),
         (select count(*)::integer from public.work_checks c
           where c.project_id = p.id and c.verdict <> 'match' and c.resolution is null)
    from public.projects p
    left join lateral private.progress_items(p.id) i on true
   where p.deleted_at is null
   group by p.id;
$$;

-- ---------------------------------------------------------------------------
-- Импорт плана: добавлен необязательный столбец weight («вес»)
-- ---------------------------------------------------------------------------
create or replace function public.import_work_items(p_project uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_id();
  v_errors jsonb := '[]';
  v_valid  integer := 0;
  r        record;
  v_loc    uuid;
  v_disc   uuid;
  v_org    uuid;
  v_qty    numeric;
  v_weight numeric;
  n        integer := 0;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant)
     or not private.has_project_permission(p_project, 'workitem.manage') then
    raise exception 'permission denied: workitem.manage' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;

  for r in select value as row, ordinality as idx from jsonb_array_elements(p_rows) with ordinality loop
    n := n + 1;
    v_loc := null; v_disc := null; v_org := null; v_qty := null; v_weight := null;

    select id into v_loc from public.locations
     where project_id = p_project and deleted_at is null and path::text = upper(btrim(coalesce(r.row ->> 'location', '')));
    if v_loc is null then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Место «' || coalesce(r.row ->> 'location', '') || '» не найдено в структуре проекта');
      continue;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'discipline', '')), '') is not null then
      select id into v_disc from public.disciplines
       where project_id = p_project and deleted_at is null and upper(code) = upper(btrim(r.row ->> 'discipline')) limit 1;
      if v_disc is null then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Направление «' || (r.row ->> 'discipline') || '» не найдено');
        continue;
      end if;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'contractor', '')), '') is not null then
      select id into v_org from public.organizations
       where tenant_id = v_tenant and deleted_at is null and lower(name) = lower(btrim(r.row ->> 'contractor')) limit 1;
      if v_org is null then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Организация «' || (r.row ->> 'contractor') || '» не найдена');
        continue;
      end if;
    end if;

    begin
      v_qty := replace(btrim(coalesce(r.row ->> 'qty', '')), ',', '.')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty < 0 then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Объём «' || coalesce(r.row ->> 'qty', '') || '» — не число');
      continue;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'weight', '')), '') is not null then
      begin
        v_weight := replace(btrim(r.row ->> 'weight'), ',', '.')::numeric;
      exception when others then
        v_weight := null;
      end;
      if v_weight is null or v_weight <= 0 then
        v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Вес «' || (r.row ->> 'weight') || '» — должно быть число больше нуля');
        continue;
      end if;
    end if;

    if nullif(btrim(coalesce(r.row ->> 'name', '')), '') is null or nullif(btrim(coalesce(r.row ->> 'unit', '')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', r.idx, 'message', 'Не заполнено название работы или единица измерения');
      continue;
    end if;

    v_valid := v_valid + 1;
    if not p_dry_run and jsonb_array_length(v_errors) = 0 then
      insert into public.work_items (project_id, location_id, discipline_id, contractor_org_id, name, unit, planned_qty, weight)
      values (p_project, v_loc, v_disc, v_org, btrim(r.row ->> 'name'), btrim(r.row ->> 'unit'), v_qty, v_weight);
    end if;
  end loop;

  if not p_dry_run and jsonb_array_length(v_errors) > 0 then
    raise exception 'import_has_errors' using errcode = '22023', detail = v_errors::text;
  end if;

  return jsonb_build_object('total', n, 'valid', v_valid, 'errors', v_errors, 'created', case when p_dry_run then 0 else v_valid end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Права на выполнение
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['start_walk(uuid,uuid,text)','resolve_discrepancy(uuid,text,text)',
                           'project_dashboard(uuid)','projects_progress()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
