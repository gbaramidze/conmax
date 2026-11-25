-- Одна должность вместо четырёх.
--
-- Раньше должность жила в четырёх местах, и все четыре вводились по-разному:
--   users.job_title            — свободный текст (профиль, карточка сотрудника, «Добавить сотрудника»);
--   staff_positions.title      — свободный текст (позиция отдела в оргструктуре);
--   project_members.title      — свободный текст (участник проекта, приглашение, панель подрядчика);
--   project_members.role_id    — роль проекта с правами.
--
-- Теперь должность — это роль проекта (roles.scope = 'project'): справочник «Должности» на странице «Роли и права»,
-- у каждой должности свои права. Отсюда:
--   * участник проекта: только должность (role_id), колонка project_members.title удалена;
--   * позиция в оргструктуре выбирает должность из справочника (staff_positions.role_id), title копируется из названия;
--   * users.job_title никто не пишет руками: это подпись под именем, она считается сама —
--     позиция в оргструктуре, иначе должность в последнем проекте, иначе остаётся прежней (например, выбранной при регистрации).
-- Старые позиции оргструктуры, у которых в справочнике нет должности с тем же названием, заводят новую должность без прав.

-- ---------------------------------------------------------------------------
-- Оргструктура: позиция ссылается на должность из справочника
-- ---------------------------------------------------------------------------
alter table public.staff_positions add column role_id uuid references public.roles (id) on delete restrict;

-- недостающие должности заводятся без прав (название роли — не длиннее 80 знаков)
insert into public.roles (tenant_id, scope, code, name, is_system)
select x.tenant_id, 'project', 'custom_' || substr(md5(x.tenant_id::text || x.name), 1, 8), x.name, false
  from (select distinct on (sp.tenant_id, lower(left(btrim(sp.title), 80))) sp.tenant_id, left(btrim(sp.title), 80) as name
          from public.staff_positions sp
         where not exists (select 1 from public.roles r
                            where r.tenant_id = sp.tenant_id and r.scope = 'project' and r.deleted_at is null
                              and lower(r.name) = lower(left(btrim(sp.title), 80)))
         order by sp.tenant_id, lower(left(btrim(sp.title), 80)), sp.created_at) x
on conflict (tenant_id, scope, code) do nothing;

update public.staff_positions sp
   set role_id = r.id
  from public.roles r
 where r.tenant_id = sp.tenant_id and r.scope = 'project' and r.deleted_at is null
   and lower(r.name) = lower(left(btrim(sp.title), 80));

alter table public.staff_positions alter column role_id set not null;
create index on public.staff_positions (role_id);
alter table public.staff_positions alter column title set default '';  -- название заполняет триггер из должности

-- Название позиции = название должности. Должность — только роль проекта своей компании.
create or replace function private.staff_position_title() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select r.name into v_name from public.roles r
   where r.id = new.role_id and r.tenant_id = new.tenant_id and r.scope = 'project' and r.deleted_at is null;
  if v_name is null then raise exception 'invalid_position' using errcode = '22023'; end if;
  new.title := v_name;
  return new;
end;
$$;
create trigger staff_position_title before insert or update of role_id, title on public.staff_positions
  for each row execute function private.staff_position_title();

-- ---------------------------------------------------------------------------
-- Подпись под именем (users.job_title) считается сама
-- ---------------------------------------------------------------------------
-- Должность человека в конкретном проекте (если ролей несколько — последняя назначенная)
create or replace function private.member_position(p_user uuid, p_project uuid) returns text
language sql stable security definer set search_path = '' as $$
  select r.name
    from public.project_members pm join public.roles r on r.id = pm.role_id
   where pm.user_id = p_user and pm.project_id = p_project and pm.deleted_at is null
     and (pm.left_at is null or pm.left_at > current_date)
   order by pm.created_at desc
   limit 1
$$;

-- Должность человека вообще: позиция в оргструктуре, иначе последний проект
create or replace function private.user_position(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select sp.title from public.staff_positions sp where sp.user_id = p_user order by sp.updated_at desc limit 1),
    (select r.name
       from public.project_members pm join public.roles r on r.id = pm.role_id
      where pm.user_id = p_user and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
      order by pm.created_at desc
      limit 1))
$$;

create or replace function private.refresh_job_title(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  if p_user is null then return; end if;
  v_title := private.user_position(p_user);
  if v_title is null then return; end if;        -- нигде не числится: подпись остаётся прежней
  update public.users set job_title = v_title where id = p_user and job_title is distinct from v_title;
end;
$$;

create or replace function private.job_title_from_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.refresh_job_title(old.user_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    perform private.refresh_job_title(new.user_id);
  end if;
  return null;
end;
$$;
create trigger job_title_from_member after insert or delete or update of role_id, user_id, deleted_at, left_at
  on public.project_members for each row execute function private.job_title_from_member();
create trigger job_title_from_position after insert or delete or update of role_id, user_id
  on public.staff_positions for each row execute function private.job_title_from_member();

-- Переименовали должность — меняются позиции оргструктуры и подписи людей
create or replace function private.position_renamed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope <> 'project' or new.name = old.name then return null; end if;
  update public.staff_positions set title = new.name where role_id = new.id;
  update public.users set job_title = new.name where tenant_id = new.tenant_id and job_title = old.name;
  return null;
end;
$$;
create trigger position_renamed after update of name on public.roles
  for each row execute function private.position_renamed();

-- Должность, занятую в оргструктуре, удалить нельзя (как и роль, выданную в проекте)
create or replace function public.role_delete(p_role uuid)
 returns void language plpgsql security definer set search_path = '' as $$
declare r public.roles;
begin
  perform private.require_roles_admin();
  select * into r from public.roles where id = p_role and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if r.is_system then raise exception 'role_system' using errcode = '42501'; end if;
  if exists (select 1 from public.user_tenant_roles where role_id = p_role)
     or exists (select 1 from public.project_members where role_id = p_role)
     or exists (select 1 from public.staff_positions where role_id = p_role) then
    raise exception 'role_in_use' using errcode = '23503';
  end if;
  delete from public.roles where id = p_role;
  perform private.assert_roles_admin_remains();
end;
$$;

-- Пересчитать подписи у всех, кто где-то числится
select private.refresh_job_title(u.id) from public.users u where u.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Ручной ввод должности убран
-- ---------------------------------------------------------------------------
drop function public.staff_set_job_title(uuid, text);

drop function public.update_my_profile(text, text, text, text, text);
create function public.update_my_profile(
  p_full_name text, p_phone text default null, p_locale text default null, p_timezone text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name  text := nullif(btrim(p_full_name), '');
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_name is null or length(v_name) > 120 then raise exception 'invalid full_name' using errcode = '22023'; end if;
  if v_phone is not null and (length(v_phone) > 32 or v_phone !~ '^[0-9+()\-\s.]+$') then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('ru', 'en') then raise exception 'invalid locale' using errcode = '22023'; end if;
  if p_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;

  update public.users
     set full_name = v_name,
         phone     = v_phone,
         locale    = coalesce(p_locale, locale),
         timezone  = coalesce(p_timezone, timezone)
   where id = auth.uid() and tenant_id = private.tenant_id();

  -- часовой пояс один на пользователя: тот же, что в настройках уведомлений
  if p_timezone is not null then
    insert into public.user_notification_settings (user_id, tenant_id, timezone)
    values (auth.uid(), private.tenant_id(), p_timezone)
    on conflict (user_id) do update set timezone = excluded.timezone;
  end if;
end;
$$;
revoke execute on function public.update_my_profile(text, text, text, text) from public, anon;
grant  execute on function public.update_my_profile(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Участник проекта: только должность (роль), без отдельного текста
-- ---------------------------------------------------------------------------
create or replace function private.projects_add_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  if auth.uid() is null then return null; end if;      -- сид и служебные вставки без пользователя
  select id into v_role from public.roles where tenant_id = new.tenant_id and scope = 'project' and code = 'project_manager' limit 1;
  if v_role is null then return null; end if;
  insert into public.project_members (tenant_id, project_id, user_id, role_id, organization_id)
  select new.tenant_id, new.id, u.id, v_role, u.organization_id
    from public.users u where u.id = auth.uid() and u.tenant_id = new.tenant_id
  on conflict do nothing;
  update public.projects set manager_user_id = coalesce(manager_user_id, auth.uid()) where id = new.id;
  return null;
end;
$$;

-- Сотрудник подрядчика: правится только направление (должность — это роль, её назначает РП)
drop function public.org_member_update(uuid, text, uuid);
create function public.org_member_update(p_member uuid, p_discipline uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.project_members;
  v_org uuid;
begin
  select * into m from public.project_members where id = p_member and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  select organization_id into v_org from public.users where id = m.user_id;
  if not private.can_see_project(m.project_id) then raise exception 'permission denied: project' using errcode = '42501'; end if;
  if not (private.has_project_permission(m.project_id, 'project.members.manage')
          or (private.has_project_permission(m.project_id, 'project.members.invite_org') and v_org is not null and v_org = private.my_org_id())) then
    raise exception 'permission denied: member' using errcode = '42501';
  end if;
  if p_discipline is not null and not exists (
       select 1 from public.disciplines d where d.id = p_discipline and d.project_id = m.project_id and d.deleted_at is null) then
    raise exception 'discipline_not_in_project' using errcode = '22023';
  end if;
  update public.project_members set discipline_id = p_discipline where id = m.id;
end;
$$;
revoke execute on function public.org_member_update(uuid, uuid) from public, anon;
grant  execute on function public.org_member_update(uuid, uuid) to authenticated;

create or replace function public.people_directory()
 returns table (id uuid, full_name text, email text, phone text, avatar_path text, job_title text, is_external boolean, status text,
                organization_id uuid, organization_name text, organization_kind text, projects jsonb)
 language sql stable set search_path = '' as $$
  select u.id, u.full_name, u.email::text, u.phone, u.avatar_path, u.job_title, u.is_external, u.status,
         o.id, o.name, o.kind,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'project_id', p.id, 'code', p.code, 'name', p.name, 'role', r.name, 'discipline', d.code)
                  order by p.code)
             from public.project_members pm
             join public.projects p on p.id = pm.project_id
             join public.roles r on r.id = pm.role_id
             left join public.disciplines d on d.id = pm.discipline_id
            where pm.user_id = u.id and pm.deleted_at is null and (pm.left_at is null or pm.left_at > current_date)
         ), '[]'::jsonb)
    from public.users u
    left join public.organizations o on o.id = u.organization_id
   where u.status <> 'blocked' or (select private.has_tenant_permission('admin.users'))
   order by u.full_name;
$$;

alter table public.project_members drop column title;

-- ---------------------------------------------------------------------------
-- Закупки: у согласующего подпись — должность в проекте заявки
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_request(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r      public.material_requests;
  p      public.projects;
  v_me   uuid := auth.uid();
  v_rfq  public.rfqs;
  v_out  jsonb;
begin
  select * into r from public.material_requests where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_see_request(v_me, p_id) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  select * into p from public.projects where id = r.project_id;
  select * into v_rfq from public.rfqs where request_id = r.id and deleted_at is null order by (status = 'cancelled'), created_at desc limit 1;

  v_out := to_jsonb(r) - 'tenant_id' - 'deleted_at' || jsonb_build_object(
    'company', (select name from public.tenants where id = r.tenant_id),
    'project', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'currency', p.currency, 'fx_rate', p.fx_rate),
    'requester_name', (select full_name from public.users where id = r.requested_by),
    'buyer_name', (select full_name from public.users where id = r.buyer_id),
    'decided_by_name', (select full_name from public.users where id = r.decided_by),
    'received_by_name', (select full_name from public.users where id = r.received_by),
    'due_at', private.request_due(r),
    'amount_gel', private.request_amount_gel(r),
    'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = r.cbs_item_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty,
                                                          'est_price', l.est_price, 'note', l.note, 'received_qty', l.received_qty) order by l.position)
                         from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb),
    'rfq', case when v_rfq.id is null then null else jsonb_build_object(
      'id', v_rfq.id, 'key', v_rfq.key, 'status', v_rfq.status,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty) order by l.position)
                           from public.rfq_lines l where l.rfq_id = v_rfq.id), '[]'::jsonb),
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'supplier', q.supplier, 'supplier_id', q.supplier_id,
                                                             'supplier_status', (select s.status from public.suppliers s where s.id = q.supplier_id),
                                                             'currency', q.currency, 'delivery_days', q.delivery_days,
                                                             'terms', q.terms, 'note', q.note, 'status', q.status,
                                                             'prices', coalesce((select jsonb_agg(jsonb_build_object('line_id', ql.line_id, 'unit_price', ql.unit_price))
                                                                                   from public.rfq_quote_lines ql where ql.quote_id = q.id), '[]'::jsonb))
                                            order by q.created_at)
                            from public.rfq_quotes q where q.rfq_id = v_rfq.id), '[]'::jsonb)) end,
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', u.full_name, 'job_title', coalesce(private.member_position(a.user_id, r.project_id), u.job_title), 'round', a.round,
                                                              'status', a.status, 'note', a.note, 'decided_at', a.decided_at) order by a.round desc, a.created_at)
                             from public.material_request_approvals a join public.users u on u.id = a.user_id where a.request_id = r.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('result', x.result, 'lines', x.lines, 'note', x.note, 'at', x.created_at,
                                                             'by', (select full_name from public.users where id = x.created_by)) order by x.created_at)
                            from public.material_request_receipts x where x.request_id = r.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes,
                                                          'storage_key', f.storage_key, 'quote_id', case when a.caption like 'quote:%' then substr(a.caption, 7)::uuid end,
                                                          'created_at', a.created_at, 'by', (select full_name from public.users where id = a.created_by),
                                                          'can_delete', a.created_by = v_me or private.user_is_buyer(v_me, r.project_id)) order by a.created_at)
                         from public.attachments a join public.files f on f.id = a.file_id
                        where a.entity_type = 'material_request' and a.entity_id = r.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event_type, 'actor', u.full_name, 'changes', e.changes) order by e.occurred_at)
                           from public.entity_events e left join public.users u on u.id = e.actor_id
                          where e.entity_id = r.project_id and e.event_type in ('request_status', 'request_eta', 'request_receipt')
                            and (e.changes ->> 'request_id' = r.id::text or (e.changes ->> 'request_id' is null and e.changes ->> 'key' = r.key))), '[]'::jsonb),
    'me', jsonb_build_object(
      'is_buyer', private.user_is_buyer(v_me, r.project_id),
      'is_initiator', private.user_is_initiator(v_me, r),
      'is_owner', r.requested_by = v_me,
      'can_request', private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'),
      'can_budget', (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
                     and (private.has_project_permission(r.project_id, 'budget.view') or private.has_project_permission(r.project_id, 'procurement.approve')))
                    or private.user_is_buyer(v_me, r.project_id),
      'can_pick_item', private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
                       and private.has_project_permission(r.project_id, 'budget.view'),
      'can_attach', r.status not in ('rejected', 'cancelled')
                    and (private.user_is_buyer(v_me, r.project_id) or r.requested_by = v_me
                         or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'))),
      'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                               and a.user_id = v_me and a.status = 'pending' and r.status = 'approval'))
  );
  return v_out;
end;
$function$

;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
