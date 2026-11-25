-- Закупки: фото у позиции заявки — инициатор показывает, какую именно модель купить.
--
-- material_request_lines.photo_file_id: фото загружается в файлы проекта ещё в форме заявки и передаётся в позиции ("photo": id файла).
-- Чтобы фото видели закупщик и согласующие (в том числе без доступа к проекту), оно же записывается вложением заявки
-- с подписью 'line' (скачивание — политика files_storage_procurement); в списке «Файлы» карточки такие вложения не показываются.

alter table public.material_request_lines add column photo_file_id uuid references public.files(id) on delete set null;

create or replace function public.material_request_save(
  p_project uuid, p_title text, p_id uuid default null, p_cbs_item uuid default null, p_needed_by date default null,
  p_note text default '', p_lines jsonb default '[]', p_urgent boolean default false
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
begin
  perform private.week_guard(p_project, array['procurement.request']);
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
    insert into public.material_requests (tenant_id, project_id, number, key, title, cbs_item_id, needed_by, note, urgent)
    values (v_tenant, p_project, v_number, v_project.code || '-PR-' || v_number, v_title, p_cbs_item, p_needed_by, coalesce(p_note, ''), coalesce(p_urgent, false))
    returning id into v_id;
    perform private.record_event(v_tenant, p_project, 'project', p_project, 'request_status',
                                 jsonb_build_object('key', v_project.code || '-PR-' || v_number, 'title', v_title, 'from', null, 'to', 'draft', 'note', '', 'request_id', v_id));
  else
    select * into v_old from public.material_requests where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
    if v_old.status <> 'draft' then raise exception 'request_locked' using errcode = '22023'; end if;
    update public.material_requests set title = v_title, cbs_item_id = p_cbs_item, needed_by = p_needed_by, note = coalesce(p_note, ''),
           urgent = coalesce(p_urgent, false), updated_at = now() where id = p_id;
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

create or replace function public.procurement_request(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
                                                          'est_price', l.est_price, 'note', l.note, 'received_qty', l.received_qty,
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
                                                             'terms', q.terms, 'note', q.note, 'status', q.status,
                                                             'prices', coalesce((select jsonb_agg(jsonb_build_object('line_id', ql.line_id, 'unit_price', ql.unit_price))
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
                        where a.entity_type = 'material_request' and a.entity_id = r.id and a.caption is distinct from 'line'), '[]'::jsonb),
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
$$;

notify pgrst, 'reload schema';
