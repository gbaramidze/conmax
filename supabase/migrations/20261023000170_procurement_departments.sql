-- Закупки, часть 3.3 — заявки отделов без проекта (IT, офис, бухгалтерия…).
--
-- У каждой компании есть служебный «проект» (projects.is_internal, код OFFICE или свободный похожий): в нём живут заявки
-- отделов, поэтому файлы, фото позиций, запросы цен, нумерация, уведомления и оплаты работают так же, как у проектов.
-- В списках проектов служебный проект не показывается (фильтр в интерфейсе), участников у него нет.
-- Заявку отдела заводит любой сотрудник компании (не внешний), обязательно указав отдел из оргструктуры. Подтверждает её
-- руководитель сотрудника (из оргструктуры), иначе руководитель выбранного отдела. Дальше — общий маршрут закупок.
-- Страница — общий раздел «Закупки» (/procurement).

alter table public.projects add column is_internal boolean not null default false;
create unique index projects_internal_uq on public.projects (tenant_id) where is_internal and deleted_at is null;
alter table public.material_requests add column department_id uuid references public.staff_departments(id) on delete set null;

create or replace function private.project_is_internal(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_internal from public.projects where id = p_project), false);
$$;

-- Служебный проект компании: найти или завести
create or replace function private.internal_project(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_code text;
begin
  select id into v_id from public.projects where tenant_id = p_tenant and is_internal and deleted_at is null;
  if v_id is not null then return v_id; end if;
  select c into v_code from unnest(array['OFFICE', 'COMPANY', 'HQ', 'INTERNAL', 'OFFICE2']) c
   where not exists (select 1 from public.projects p where p.tenant_id = p_tenant and p.code = c) limit 1;
  insert into public.projects (tenant_id, code, name, kind, status, modules, is_internal)
  values (p_tenant, v_code, 'Компания (заявки отделов)', 'office', 'active', array['procurement'], true)
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare t record;
begin
  for t in select id from public.tenants loop perform private.internal_project(t.id); end loop;
end $$;

-- новым компаниям — вместе с должностями закупок
create or replace function private.roles_procurement_dept() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'tenant' and new.code = 'tenant_admin' then
    perform private.seed_procurement_role(new.tenant_id);
    perform private.seed_procurement_positions(new.tenant_id);
    perform private.internal_project(new.tenant_id);
  end if;
  return null;
end;
$$;

-- файлы заявок отделов (фото позиций, BOQ, КП) загружает любой сотрудник компании
create or replace function private.can_upload_file(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_project_permission(p_project, 'comment.create')
      or private.has_project_permission(p_project, 'document.upload')
      or private.has_project_permission(p_project, 'project.edit')
      or private.has_project_permission(p_project, 'procurement.request')
      or private.has_project_permission(p_project, 'procurement.manage')
      or (private.project_is_internal(p_project) and private.staff_insider());
$$;
drop policy files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check ((private.can_see_project(project_id) or private.project_is_internal(project_id)) and private.can_upload_file(project_id));

-- Для страницы «Закупки»: служебный проект, отделы оргструктуры, мой отдел, веду ли я закупки
create or replace function public.procurement_company() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'project_id', p.id, 'project_code', p.code,
           'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
                                      from public.staff_departments d where d.tenant_id = p.tenant_id), '[]'::jsonb),
           'my_department', (select department_id from public.staff_profiles where user_id = auth.uid()),
           'is_buyer', private.has_tenant_permission('procurement.manage') or private.user_holds(auth.uid(), array['buyer', 'procurement_head']),
           'can_request', private.staff_insider())
    from public.projects p
   where p.tenant_id = private.tenant_id() and p.is_internal and p.deleted_at is null
     and private.staff_insider();
$$;

drop function public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb, boolean);
create or replace function public.material_request_save(
  p_project uuid, p_title text, p_id uuid default null, p_cbs_item uuid default null, p_needed_by date default null,
  p_note text default '', p_lines jsonb default '[]', p_urgent boolean default false, p_department uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_old     public.material_requests;
  v_id      uuid;
  v_number  integer;
  v_title   text := btrim(coalesce(p_title, ''));
  l         jsonb;
  i         integer := 0;
  v_photo   uuid;
  v_internal boolean;
begin
  v_internal := exists (select 1 from public.projects where id = p_project and tenant_id = v_tenant and is_internal and deleted_at is null);
  if v_internal then
    -- заявка отдела: любой сотрудник компании, отдел обязателен
    if not private.staff_insider() then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
    if p_department is null or not exists (select 1 from public.staff_departments where id = p_department and tenant_id = v_tenant) then
      raise exception 'department_required' using errcode = '22023';
    end if;
  else
    perform private.week_guard(p_project, array['procurement.request']);
  end if;
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'lines_invalid' using errcode = '22023'; end if;
  if p_cbs_item is not null and not exists (select 1 from public.cbs_items where id = p_cbs_item and project_id = p_project and deleted_at is null) then
    raise exception 'budget_item_invalid' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'PR', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_number;
    insert into public.material_requests (tenant_id, project_id, number, key, title, cbs_item_id, needed_by, note, urgent, department_id)
    values (v_tenant, p_project, v_number, v_project.code || '-PR-' || v_number, v_title, p_cbs_item, p_needed_by, coalesce(p_note, ''), coalesce(p_urgent, false), p_department)
    returning id into v_id;
    perform private.record_event(v_tenant, p_project, 'project', p_project, 'request_status',
                                 jsonb_build_object('key', v_project.code || '-PR-' || v_number, 'title', v_title, 'from', null, 'to', 'draft', 'note', '', 'request_id', v_id));
  else
    select * into v_old from public.material_requests where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
    if v_old.status <> 'draft' then raise exception 'request_locked' using errcode = '22023'; end if;
    if v_internal and v_old.requested_by is distinct from auth.uid() then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
    update public.material_requests set title = v_title, cbs_item_id = p_cbs_item, needed_by = p_needed_by, note = coalesce(p_note, ''),
           urgent = coalesce(p_urgent, false), department_id = coalesce(p_department, department_id), updated_at = now() where id = p_id;
    v_id := p_id;
    delete from public.material_request_lines where request_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    i := i + 1;
    if btrim(coalesce(l ->> 'name', '')) = '' or coalesce((l ->> 'qty')::numeric, 0) <= 0 then raise exception 'line_invalid' using errcode = '22023'; end if;
    -- фото позиции: свой загруженный файл этого проекта или уже прикреплённое к этой заявке фото
    v_photo := nullif(l ->> 'photo', '')::uuid;
    if v_photo is not null and not exists (
         select 1 from public.files f
          where f.id = v_photo and f.project_id = p_project and f.mime like 'image/%'
            and (f.created_by = auth.uid()
                 or exists (select 1 from public.attachments a where a.file_id = f.id and a.entity_type = 'material_request' and a.entity_id = v_id))) then
      raise exception 'photo_invalid' using errcode = '22023';
    end if;
    insert into public.material_request_lines (tenant_id, request_id, position, name, unit, qty, est_price, note, photo_file_id)
    values (v_tenant, v_id, i, btrim(l ->> 'name'), coalesce(l ->> 'unit', ''), (l ->> 'qty')::numeric, nullif(l ->> 'price', '')::numeric, coalesce(l ->> 'note', ''), v_photo);
  end loop;

  -- фото позиций — вложения заявки (caption 'line'): их видят все, кто видит заявку, в том числе согласующие без доступа к проекту
  delete from public.attachments a
   where a.entity_type = 'material_request' and a.entity_id = v_id and a.caption = 'line'
     and not exists (select 1 from public.material_request_lines l2 where l2.request_id = v_id and l2.photo_file_id = a.file_id);
  insert into public.attachments (tenant_id, project_id, entity_type, entity_id, file_id, caption)
  select distinct v_tenant, p_project, 'material_request', v_id, l2.photo_file_id, 'line'
    from public.material_request_lines l2
   where l2.request_id = v_id and l2.photo_file_id is not null
     and not exists (select 1 from public.attachments a where a.entity_type = 'material_request' and a.entity_id = v_id and a.file_id = l2.photo_file_id);
  return v_id;
end;
$$;


create or replace function public.material_request_transition(p_request uuid, p_to text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  r       public.material_requests;
  v_me    uuid := auth.uid();
  v_note  text := btrim(coalesce(p_note, ''));
  v_buyer boolean;
  v_req   boolean;
  v_mgr   boolean;
  v_ok    boolean := false;
  v_num   integer;
  v_code  text;
  v_rfq   uuid;
  v_from  text;
  v_to    text := p_to;
  v_manager uuid;
  u       uuid;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(v_me, p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  v_from := r.status;
  v_buyer := private.user_is_buyer(v_me, r.project_id);
  v_req := (private.project_is_internal(r.project_id) and r.requested_by = v_me)
           or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'));
  v_mgr := r.manager_id = v_me;

  if r.status = 'draft' and p_to = 'submitted' then
    v_ok := v_req;
    if v_ok and not exists (select 1 from public.material_request_lines where request_id = r.id) then raise exception 'lines_required' using errcode = '22023'; end if;
    -- сначала руководитель сотрудника подтверждает, что это действительно нужно
    v_manager := coalesce(private.request_manager_for(coalesce(r.requested_by, v_me), r.project_id),
                          (select d.head_user_id from public.staff_departments d
                            where d.id = r.department_id and d.head_user_id is distinct from coalesce(r.requested_by, v_me)));
    if v_manager is not null then v_to := 'review'; end if;
  elsif r.status = 'review' and p_to = 'submitted' then
    v_ok := v_mgr;
  elsif r.status = 'review' and p_to in ('draft', 'rejected') then
    v_ok := v_mgr;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'sourcing' then
    v_ok := v_buyer;
    if v_ok and r.status = 'sourcing' and r.buyer_id = v_me then raise exception 'transition_invalid' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'stock_check' then
    v_ok := v_buyer;
  elsif r.status in ('submitted', 'sourcing') and p_to in ('draft', 'rejected') then
    v_ok := v_buyer;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif r.status in ('submitted', 'sourcing') and p_to = 'delivered' then
    v_ok := v_buyer;
    if v_ok and r.stock_status <> 'available' then raise exception 'stock_not_available' using errcode = '22023'; end if;
  elsif r.status = 'approval' and p_to = 'sourcing' then
    v_ok := v_buyer;
  elsif r.status = 'confirming' and p_to = 'confirmed' then
    v_ok := private.user_is_initiator(v_me, r);
  elsif r.status = 'confirming' and p_to = 'sourcing' then
    v_ok := private.user_is_initiator(v_me, r);
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif p_to = 'cancelled' and r.status in ('draft', 'review', 'submitted', 'sourcing', 'stock_check', 'approval', 'confirming', 'confirmed') then
    v_ok := v_req or v_buyer or r.requested_by = v_me;
  elsif p_to = 'cancelled' and r.status in ('ordered', 'shipped') then
    v_ok := v_buyer;
    if v_ok and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  else
    raise exception 'transition_invalid' using errcode = '22023';
  end if;
  if not v_ok then raise exception 'permission denied: procurement' using errcode = '42501'; end if;

  if v_to = 'sourcing' and r.status in ('submitted', 'sourcing')
     and not exists (select 1 from public.rfqs where request_id = r.id and status = 'open' and deleted_at is null) then
    select code into v_code from public.projects where id = r.project_id;
    insert into public.project_counters as pc (project_id, kind, last_number) values (r.project_id, 'RQ', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_num;
    insert into public.rfqs (tenant_id, project_id, number, key, title, request_id, note, created_by)
    values (r.tenant_id, r.project_id, v_num, v_code || '-RQ-' || v_num, r.title, r.id, 'По заявке ' || r.key, v_me)
    returning id into v_rfq;
    insert into public.rfq_lines (tenant_id, rfq_id, position, name, unit, qty)
    select r.tenant_id, v_rfq, position, name, unit, qty from public.material_request_lines where request_id = r.id order by position;
  end if;

  if r.status = 'approval' or v_to in ('cancelled', 'rejected') then
    update public.material_request_approvals set status = 'cancelled' where request_id = r.id and round = r.approval_round and status = 'pending';
  end if;
  if v_to in ('cancelled', 'rejected') then
    update public.rfqs set status = 'cancelled', updated_at = now() where request_id = r.id and status = 'open';
  end if;

  update public.material_requests
     set status = v_to, updated_at = now(),
         manager_id = case when v_to = 'review' then v_manager else manager_id end,
         reviewed_by = case when v_from = 'review' and v_to = 'submitted' then v_me else reviewed_by end,
         reviewed_at = case when v_from = 'review' and v_to = 'submitted' then now() else reviewed_at end,
         stock_return = case when v_to = 'stock_check' then v_from else stock_return end,
         stock_status = case when v_to = 'stock_check' then 'unchecked' else stock_status end,
         buyer_id = case when v_to in ('sourcing', 'stock_check') and r.status in ('submitted', 'sourcing') then v_me else buyer_id end,
         decision_note = case when v_note <> '' and v_to in ('draft', 'rejected', 'cancelled', 'sourcing') then v_note else decision_note end,
         decided_by = case when v_to in ('rejected', 'confirmed') then v_me else decided_by end,
         decided_at = case when v_to in ('rejected', 'confirmed') then now() else decided_at end,
         delivered_at = case when v_to = 'delivered' then now() else delivered_at end,
         receipt = case when v_to = 'delivered' then 'full' else receipt end,
         receipt_note = case when v_to = 'delivered' then coalesce(nullif(v_note, ''), 'Выдано со склада') else receipt_note end,
         received_by = case when v_to = 'delivered' then v_me else received_by end
   where id = r.id
  returning * into r;
  perform private.request_event(r, v_from, v_to, v_note);

  if v_to = 'review' then
    perform private.request_notify(r.manager_id, r.id, 'assigned', 'high', 'procurement.review',
                                   format('Подтвердите заявку сотрудника «%s»: действительно ли это нужно', r.title));
  elsif v_to = 'submitted' then
    for u in select private.request_buyers(r.id) loop
      perform private.request_notify(u, r.id, 'assigned', case when r.urgent then 'high' else 'normal' end, 'procurement.submitted',
                                     format(case when r.urgent then 'Срочная заявка на закупку «%s»' else 'Новая заявка на закупку «%s»' end, r.title));
    end loop;
    if v_from = 'review' then
      perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.reviewed', format('Руководитель подтвердил заявку «%s» — она у закупщиков', r.title));
    end if;
  elsif v_to = 'stock_check' then
    for u in select private.request_storekeepers(r.id) loop
      perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.stock_check', format('Проверьте на складе позиции заявки «%s»', r.title));
    end loop;
  elsif v_to = 'sourcing' and v_from = 'submitted' then
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.taken', format('Заявка «%s» взята в работу — ищем цены', r.title));
  elsif v_to = 'sourcing' and v_from = 'approval' then
    for u in select a.user_id from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'cancelled' loop
      perform private.request_notify(u, r.id, 'watching', 'normal', 'procurement.recalled', format('Согласование закупки «%s» отозвано', r.title));
    end loop;
  elsif v_to = 'sourcing' and v_from = 'confirming' then
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.returned', format('Инициатор вернул закупку «%s»: %s', r.title, v_note));
  elsif v_to = 'draft' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.returned', format('Заявку «%s» вернули на доработку: %s', r.title, v_note));
  elsif v_to = 'rejected' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.rejected', format('Заявка «%s» отклонена: %s', r.title, v_note));
  elsif v_to = 'confirmed' then
    perform private.request_notify(r.buyer_id, r.id, 'assigned', 'high', 'procurement.confirmed', format('Инициатор подтвердил закупку «%s» — можно заказывать', r.title));
  elsif v_to = 'delivered' then
    perform private.request_notify(r.requested_by, r.id, 'assigned', 'high', 'procurement.delivered', format('Есть на складе: «%s» — можно забирать', r.title));
  elsif v_to = 'cancelled' then
    perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.cancelled', format('Заявка «%s» отменена', r.title));
    perform private.request_notify(r.buyer_id, r.id, 'watching', 'normal', 'procurement.cancelled', format('Заявка «%s» отменена', r.title));
  end if;
end;
$$;


create or replace function public.procurement_requests(p_project uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.urgent desc, x.created_at desc), '[]'::jsonb)
    from (
      select r.created_at, r.urgent and r.status in ('submitted', 'sourcing') as urgent,
             jsonb_build_object(
               'id', r.id, 'key', r.key, 'title', r.title, 'status', r.status, 'urgent', r.urgent, 'needed_by', r.needed_by,
               'created_at', r.created_at, 'updated_at', r.updated_at,
               'project_id', p.id, 'project_code', p.code, 'project_name', p.name, 'project_internal', p.is_internal,
               'department_name', (select d.name from public.staff_departments d where d.id = r.department_id),
               'requested_by', r.requested_by, 'requester_name', rq.full_name, 'buyer_id', r.buyer_id, 'buyer_name', b.full_name,
               'supplier', r.supplier,
               'amount', case when x2.prices then r.amount end, 'currency', case when x2.prices then r.currency end,
               'estimate', case when x2.prices then (select sum(l.qty * coalesce(l.est_price, 0)) from public.material_request_lines l where l.request_id = r.id) end,
               'can_see_prices', x2.prices, 'manager_id', r.manager_id, 'manager_name', (select full_name from public.users where id = r.manager_id),
               'my_stock', r.status = 'stock_check' and private.user_holds(auth.uid(), array['storekeeper']),
               'my_payment', x2.prices and exists (select 1 from public.material_request_payments pp join public.material_request_payment_steps ps on ps.payment_id = pp.id
                                                    where pp.request_id = r.id and pp.status = 'approval' and ps.status = 'pending' and private.user_has_pay_role(auth.uid(), ps.role_code))
                             or (x2.prices and private.user_holds(auth.uid(), array['accountant', 'finance_director'])
                                 and exists (select 1 from public.material_request_payments pp where pp.request_id = r.id and pp.status = 'approved')),
               'paid', case when x2.prices then (select coalesce(sum(pp.amount), 0) from public.material_request_payments pp where pp.request_id = r.id and pp.status = 'paid') end,
               'lines_count', (select count(*) from public.material_request_lines l where l.request_id = r.id),
               'expected_at', r.expected_at, 'over_budget', x2.prices and r.over_budget, 'stock_status', r.stock_status, 'tier', r.tier,
               'due_at', private.request_due(r), 'receipt', r.receipt,
               'approvals_total', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round),
               'approvals_done', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round and a.status = 'approved'),
               'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                                         and a.user_id = auth.uid() and a.status = 'pending' and r.status = 'approval')
             ) as row
        from public.material_requests r
        join public.projects p on p.id = r.project_id
        left join public.users rq on rq.id = r.requested_by
        left join public.users b on b.id = r.buyer_id
        cross join lateral (select private.user_can_see_prices(auth.uid(), r.id) as prices) x2
       where r.tenant_id = private.tenant_id() and r.deleted_at is null
         and (p_project is null or r.project_id = p_project)
         and private.user_can_see_request(auth.uid(), r.id)
    ) x;
$$;

create or replace function public.procurement_request(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r      public.material_requests;
  p      public.projects;
  v_me   uuid := auth.uid();
  v_rfq  public.rfqs;
  v_out  jsonb;
  v_prices boolean;
begin
  select * into r from public.material_requests where id = p_id and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_see_request(v_me, p_id) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  select * into p from public.projects where id = r.project_id;
  v_prices := private.user_can_see_prices(v_me, r.id);
  select * into v_rfq from public.rfqs where request_id = r.id and deleted_at is null order by (status = 'cancelled'), created_at desc limit 1;

  v_out := to_jsonb(r) - 'tenant_id' - 'deleted_at' || jsonb_build_object(
    'company', (select name from public.tenants where id = r.tenant_id),
    'project', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'currency', p.currency, 'fx_rate', p.fx_rate, 'internal', p.is_internal),
    'department', (select jsonb_build_object('id', d.id, 'name', d.name) from public.staff_departments d where d.id = r.department_id),
    'requester_name', (select full_name from public.users where id = r.requested_by),
    'manager_name', (select full_name from public.users where id = r.manager_id),
    'reviewed_by_name', (select full_name from public.users where id = r.reviewed_by),
    'buyer_name', (select full_name from public.users where id = r.buyer_id),
    'decided_by_name', (select full_name from public.users where id = r.decided_by),
    'received_by_name', (select full_name from public.users where id = r.received_by),
    'due_at', private.request_due(r),
    'amount_gel', case when v_prices then private.request_amount_gel(r) end,
    'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = r.cbs_item_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty,
                                                          'est_price', case when v_prices then l.est_price end, 'note', l.note, 'cbs_item_id', l.cbs_item_id,
                                                          'item', (select jsonb_build_object('code', c.code, 'name', c.name) from public.cbs_items c where c.id = coalesce(l.cbs_item_id, r.cbs_item_id)), 'received_qty', l.received_qty,
                                                          'photo', (select jsonb_build_object('file_id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'storage_key', f.storage_key)
                                                                      from public.files f where f.id = l.photo_file_id)) order by l.position)
                         from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb),
    'rfq', case when v_rfq.id is null then null else jsonb_build_object(
      'id', v_rfq.id, 'key', v_rfq.key, 'status', v_rfq.status,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'name', l.name, 'unit', l.unit, 'qty', l.qty) order by l.position)
                           from public.rfq_lines l where l.rfq_id = v_rfq.id), '[]'::jsonb),
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'supplier', q.supplier, 'supplier_id', q.supplier_id,
                                                             'supplier_status', (select s.status from public.suppliers s where s.id = q.supplier_id),
                                                             'currency', q.currency, 'delivery_days', q.delivery_days,
                                                             'terms', case when v_prices then q.terms else '' end, 'note', case when v_prices then q.note else '' end, 'status', q.status,
                                                             'prices', coalesce((select jsonb_agg(jsonb_build_object('line_id', ql.line_id, 'unit_price', case when v_prices then ql.unit_price end, 'model', ql.model))
                                                                                   from public.rfq_quote_lines ql where ql.quote_id = q.id), '[]'::jsonb))
                                            order by q.created_at)
                            from public.rfq_quotes q where q.rfq_id = v_rfq.id), '[]'::jsonb)) end,
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', u.full_name, 'job_title', u.job_title, 'round', a.round,
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
                        where a.entity_type = 'material_request' and a.entity_id = r.id and a.caption is distinct from 'line'
                          and (v_prices or a.caption not like 'quote:%')
                          and a.caption not like 'pay:%'), '[]'::jsonb),
    'payments', private.request_payments_json(r.id, v_me),
    'pay_summary', case when v_prices then (
      select jsonb_build_object(
               'paid', coalesce(sum(pp.amount) filter (where pp.status = 'paid'), 0),
               'advance', coalesce(sum(pp.amount) filter (where pp.status = 'paid' and pp.kind = 'advance'), 0),
               'in_approval', coalesce(sum(pp.amount) filter (where pp.status in ('approval', 'approved')), 0),
               'remaining', coalesce(r.amount, 0) - coalesce(sum(pp.amount) filter (where pp.status = 'paid'), 0))
        from public.material_request_payments pp where pp.request_id = r.id) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event_type, 'actor', u.full_name, 'changes', e.changes) order by e.occurred_at)
                           from public.entity_events e left join public.users u on u.id = e.actor_id
                          where e.entity_id = r.project_id and e.event_type in ('request_status', 'request_eta', 'request_receipt')
                            and (e.changes ->> 'request_id' = r.id::text or (e.changes ->> 'request_id' is null and e.changes ->> 'key' = r.key))), '[]'::jsonb),
    'me', jsonb_build_object(
      'is_buyer', private.user_is_buyer(v_me, r.project_id),
      'is_initiator', private.user_is_initiator(v_me, r),
      'is_owner', r.requested_by = v_me,
      'can_request', (p.is_internal and r.requested_by = v_me)
                     or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request')),
      'can_budget', (private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
                     and (private.has_project_permission(r.project_id, 'budget.view') or private.has_project_permission(r.project_id, 'procurement.approve')))
                    or private.user_is_buyer(v_me, r.project_id),
      'can_pick_item', private.can_see_project(r.project_id) and private.can_see_internal(r.project_id)
                       and private.has_project_permission(r.project_id, 'budget.view'),
      'can_attach', r.status not in ('rejected', 'cancelled')
                    and (private.user_is_buyer(v_me, r.project_id) or r.requested_by = v_me
                         or (private.can_see_project(r.project_id) and private.has_project_permission(r.project_id, 'procurement.request'))),
      'can_see_prices', v_prices,
      'can_pay_create', v_prices and r.status in ('confirmed', 'ordered', 'shipped', 'delivered')
                        and (private.user_is_buyer(v_me, r.project_id) or private.user_holds(v_me, array['accountant'])),
      'is_manager', r.manager_id = v_me and r.status = 'review',
      'is_storekeeper', private.user_holds(v_me, array['storekeeper']),
      'my_approval', exists (select 1 from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round
                               and a.user_id = v_me and a.status = 'pending' and r.status = 'approval'))
  );
  if not v_prices then
    v_out := v_out - 'amount' - 'amount_base' - 'over_budget' - 'commitment_id' || jsonb_build_object('amount', null, 'amount_base', null, 'over_budget', false);
  end if;
  return v_out;
end;
$$;

revoke execute on function public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb, boolean, uuid), public.procurement_company() from public, anon;
grant execute on function public.material_request_save(uuid, text, uuid, uuid, date, text, jsonb, boolean, uuid), public.procurement_company() to authenticated;
notify pgrst, 'reload schema';
