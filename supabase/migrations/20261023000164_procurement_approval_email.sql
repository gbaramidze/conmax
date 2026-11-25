-- Закупки: письмо о том, что нужно согласование (и что инициатору нужно подтвердить выбор).
--
-- • Просьба согласовать закупку (procurement.approval) и просьба инициатору подтвердить выбор (procurement.confirm) приходят
--   в приложение и письмом всегда и сразу — даже если человек выключил такие уведомления или собирает их в сводку;
--   тихие часы соблюдаются. Остальные письма — как раньше (через 3 минуты, по настройкам).
-- • Инициатору «заявка на согласовании» — отдельное событие procurement.in_approval (обычное, отключаемое).
-- • В письмо по заявке воркер send-emails кладёт подробности: проект, поставщик, сумма, нужно до, инициатор, закупщик,
--   позиции, «почему этот поставщик», «почему меньше трёх предложений»; кнопка «Открыть и согласовать».

create or replace function private.request_notify(p_user uuid, p_request uuid, p_category text, p_priority text, p_event text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r            record;
  v_pref       text;
  v_actor_name text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  select mr.id, mr.tenant_id, mr.project_id, mr.key, p.code into r
    from public.material_requests mr join public.projects p on p.id = mr.project_id where mr.id = p_request;
  if r.id is null or not private.user_can_see_request(p_user, p_request) then return; end if;
  select mode into v_pref from public.notification_preferences where user_id = p_user and category = p_category and channel = 'in_app';
  -- просьбу согласовать и подтвердить выбор не глушим: без ответа закупка встанет (письмо тоже уходит всегда — см. ниже)
  if v_pref = 'off' and p_priority <> 'critical' and p_event not in ('procurement.approval', 'procurement.confirm') then return; end if;
  select full_name into v_actor_name from public.users where id = auth.uid();
  insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, actor_id, priority, category, title, body, payload)
  values (r.tenant_id, p_user, r.project_id, p_event, 'material_request', r.id, auth.uid(), p_priority, p_category,
          'Закупка · ' || r.key, p_body,
          jsonb_build_object('project_code', r.code, 'actor_name', v_actor_name, 'link', '/procurement?r=' || r.id, 'last_text', p_body));
end;
$$;
create or replace function public.material_request_send_approval(
  p_request uuid, p_quote uuid, p_approvers uuid[], p_reason text default '', p_note text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r        public.material_requests;
  q        public.rfq_quotes;
  v_rfq    uuid;
  v_total  numeric;
  v_count  integer;
  v_base   numeric;
  v_users  uuid[];
  v_chk    jsonb;
  v_over   boolean;
  u        uuid;
  m        record;
begin
  select * into r from public.material_requests where id = p_request and tenant_id = private.tenant_id() and deleted_at is null for update;
  if not found or not private.user_can_see_request(auth.uid(), p_request) then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if not private.user_is_buyer(auth.uid(), r.project_id) then raise exception 'permission denied: procurement' using errcode = '42501'; end if;
  if r.status <> 'sourcing' then raise exception 'transition_invalid' using errcode = '22023'; end if;

  select id into v_rfq from public.rfqs where request_id = r.id and status = 'open' and deleted_at is null order by created_at desc limit 1;
  select * into q from public.rfq_quotes where id = p_quote and rfq_id = v_rfq;
  if v_rfq is null or q.id is null then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.rfq_lines l where l.rfq_id = v_rfq
              and not exists (select 1 from public.rfq_quote_lines ql where ql.quote_id = q.id and ql.line_id = l.id)) then
    raise exception 'quote_incomplete' using errcode = '22023';
  end if;
  select sum(l.qty * ql.unit_price) into v_total from public.rfq_lines l join public.rfq_quote_lines ql on ql.line_id = l.id and ql.quote_id = q.id where l.rfq_id = v_rfq;
  select count(*) into v_count from public.rfq_quotes where rfq_id = v_rfq;
  if v_count < 3 and btrim(coalesce(p_reason, '')) = '' then raise exception 'reason_required' using errcode = '22023'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_users from unnest(coalesce(p_approvers, '{}')) x where x is not null;
  if cardinality(v_users) = 0 then raise exception 'approvers_required' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_users) x
              where not exists (select 1 from public.users uu where uu.id = x and uu.tenant_id = r.tenant_id and not uu.is_external and uu.status <> 'blocked')) then
    raise exception 'approver_invalid' using errcode = '22023';
  end if;

  begin
    select * into m from private.money_to_base(r.project_id, v_total, q.currency);
    v_base := m.base;
  exception when sqlstate '22023' then
    v_base := null;   -- нет курса: остаток бюджета считается по оценке позиций
  end;

  update public.material_requests
     set status = 'approval', quote_id = q.id, supplier = q.supplier, amount = v_total, currency = q.currency, amount_base = v_base,
         single_source_reason = case when v_count < 3 then left(btrim(p_reason), 2000) else '' end,
         approval_note = left(btrim(coalesce(p_note, '')), 2000), approval_round = r.approval_round + 1,
         buyer_id = coalesce(buyer_id, auth.uid()), updated_at = now()
   where id = r.id
  returning * into r;
  insert into public.material_request_approvals (tenant_id, request_id, round, user_id)
  select r.tenant_id, r.id, r.approval_round, x from unnest(v_users) x;

  v_chk := private.request_budget_check(r.id);
  v_over := v_chk is not null and (v_chk ->> 'estimate')::numeric > (v_chk ->> 'remaining')::numeric + 0.005;
  update public.material_requests set over_budget = v_over where id = r.id returning * into r;
  perform private.request_event(r, 'sourcing', 'approval', q.supplier);

  foreach u in array v_users loop
    perform private.request_notify(u, r.id, 'assigned', 'high', 'procurement.approval',
                                   format('Просят согласовать закупку «%s» у поставщика %s', r.title, q.supplier));
  end loop;
  perform private.request_notify(r.requested_by, r.id, 'watching', 'normal', 'procurement.in_approval', format('Заявка «%s» на согласовании', r.title));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Письма. Просьба согласовать закупку и просьба инициатору подтвердить выбор уходят письмом всегда и сразу
-- (даже если письма о назначениях выключены или собраны в сводку): без ответа закупка встанет. Тихие часы соблюдаются.
-- В письмо по заявке воркер кладёт подробности: проект, поставщик, сумма, позиции, обоснование (claim_emails → request).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.notifications_enqueue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_mode  text;
  v_must  boolean := new.event_type in ('procurement.approval', 'procurement.confirm');
begin
  if new.event_type like '%.reminder' then return new; end if;
  if new.category in ('mail', 'birthday') then return new; end if;
  select u.email into v_email from public.users u where u.id = new.user_id and u.status <> 'blocked';
  if v_email is null then return new; end if;

  v_mode := private.channel_mode(new.user_id, new.category, 'email');
  if (new.priority = 'critical' or v_must) and v_mode <> 'instant' then v_mode := 'instant'; end if;   -- критичное и просьбу о решении отключить нельзя

  if v_mode = 'instant' then
    insert into public.email_outbox (tenant_id, user_id, to_email, kind, notification_id, send_after)
    values (new.tenant_id, new.user_id, v_email, 'instant', new.id,
            private.next_send_time(new.user_id, new.priority, now() + case when v_must then interval '0' else interval '3 minutes' end))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Подробности заявки для письма
create or replace function private.request_email_info(p_request uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'key', r.key, 'title', r.title, 'status', r.status, 'urgent', r.urgent, 'needed_by', r.needed_by,
           'project', p.code || ' · ' || p.name, 'supplier', r.supplier, 'amount', r.amount, 'currency', r.currency,
           'over_budget', r.over_budget, 'approval_note', r.approval_note, 'single_source_reason', r.single_source_reason,
           'requester', (select full_name from public.users where id = r.requested_by),
           'buyer', (select full_name from public.users where id = r.buyer_id),
           'approvers', (select count(*) from public.material_request_approvals a where a.request_id = r.id and a.round = r.approval_round),
           'lines', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'qty', l.qty, 'unit', l.unit) order by l.position)
                                from public.material_request_lines l where l.request_id = r.id), '[]'::jsonb))
    from public.material_requests r join public.projects p on p.id = r.project_id
   where r.id = p_request;
$$;

create or replace function public.claim_emails(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o        public.email_outbox;
  n        public.notifications;
  v_out    jsonb := '[]';
  v_item   jsonb;
  v_items  jsonb;
  v_name   text;
  v_locale text;
  v_email  text;
  v_task   jsonb;
  v_comment uuid;
  v_files  jsonb;
begin
  -- письма, которые «зависли» в отправке, возвращаем в очередь
  update public.email_outbox set status = 'pending'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  for o in
    select * from public.email_outbox
     where status = 'pending' and send_after <= now()
     order by send_after
     limit p_limit
     for update skip locked
  loop
    select u.full_name, u.locale, u.email into v_name, v_locale, v_email from public.users u where u.id = o.user_id and u.status <> 'blocked';
    if not found or coalesce(v_email, o.to_email) is null then
      update public.email_outbox set status = 'skipped' where id = o.id;
      continue;
    end if;

    if o.kind = 'instant' then
      select * into n from public.notifications where id = o.notification_id;
      -- уведомления нет; наблюдателю письмо уже не нужно, если он прочитал или убрал; назначение, упоминание, эскалацию отправляем всегда
      if not found or (n.category = 'watching' and (n.read_at is not null or n.archived_at is not null)) then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_task := null;
      if n.entity_type = 'task' then
        select jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title, 'due_date', t.due_date)
          into v_task from public.tasks t where t.id = n.entity_id;
      end if;
      -- файлы комментария, из-за которого пришло уведомление (упоминание, комментарий, заметка), — воркер приложит их к письму
      v_comment := coalesce((n.payload ->> 'comment_id')::uuid, case when n.entity_type = 'field_note' then n.entity_id end);
      v_files := '[]';
      if v_comment is not null then
        select coalesce(jsonb_agg(jsonb_build_object('name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'storage_key', f.storage_key) order by a.created_at, a.id), '[]')
          into v_files
          from public.attachments a join public.files f on f.id = a.file_id
         where a.comment_id = v_comment and f.status = 'ready';
      end if;
      v_item := jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale, 'attachments', v_files,
        'notification', jsonb_build_object(
          'title', n.title, 'body', n.body, 'priority', n.priority, 'category', n.category, 'event_type', n.event_type,
          'entity_type', n.entity_type, 'entity_id', n.entity_id, 'entity_key', n.payload ->> 'entity_key',
          'project_code', n.payload ->> 'project_code', 'actor_name', n.payload ->> 'actor_name',
          'link', n.payload ->> 'link'),
        'task', v_task,
        'request', case when n.entity_type = 'material_request' then private.request_email_info(n.entity_id) end);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', x.title, 'body', x.body, 'category', x.category, 'priority', x.priority,
               'entity_key', x.payload ->> 'entity_key', 'project_code', x.payload ->> 'project_code',
               'entity_type', x.entity_type, 'entity_id', x.entity_id, 'link', x.payload ->> 'link') order by x.created_at), '[]')
        into v_items
        from public.notifications x
       where x.id in (select (jsonb_array_elements_text(o.payload -> 'ids'))::uuid)
         and x.read_at is null and x.archived_at is null;
      if jsonb_array_length(v_items) = 0 then
        update public.email_outbox set status = 'skipped' where id = o.id;
        continue;
      end if;
      v_item := jsonb_build_object('id', o.id, 'kind', o.kind, 'to', coalesce(v_email, o.to_email), 'name', v_name, 'locale', v_locale, 'items', v_items);
    end if;

    update public.email_outbox set status = 'sending', attempts = attempts + 1, claimed_at = now() where id = o.id;
    v_out := v_out || jsonb_build_array(v_item || jsonb_build_object('attempts', o.attempts + 1));
  end loop;
  return v_out;
end;
$$;

revoke execute on function private.request_email_info(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
