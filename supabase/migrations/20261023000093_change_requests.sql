-- Запросы на изменение (S10, вторая часть): кто-то предлагает изменить объём, срок или бюджет — оценивают влияние — согласуют — внедряют.
--
-- Запрос: название, описание, причина (инициатива заказчика, ошибка проекта, условия площадки, требования надзора, оптимизация, другое),
-- влияние на стоимость (в валюте проекта) и на срок (в днях), заметка оценки, заметка решения. Номер и ключ (`RTG1-CR-2`) — по счётчику проекта.
-- Маршрут: черновик → оценка → согласование → утверждён / отклонён → внедрён; на любом шаге до решения запрос можно отменить.
--   • создаёт и отправляет на оценку `change.create` (автор или руководитель);
--   • оценивает и передаёт на согласование `change.assess` (ПТО, экономист): стоимость и срок должны быть заполнены (0 тоже ответ);
--   • утверждает, отклоняет (нужна причина отказа), возвращает на доработку и отмечает внедрение `change.approve` (руководитель проекта);
-- Каждый переход пишется в ленту проекта (`change_status`) с заметкой. Запросы внутренние: внешние участники их не видят.
-- Не вошло: маршрут по порогам (до 1% бюджета — один, выше — другой), симуляция влияния на прогноз бюджета и вехи, автоматическое
-- создание новой версии бюджета и базового плана при утверждении, привязка к статьям бюджета и работам, вложения. См. docs: 05-roadmap/05-backlog.md.

create table public.change_requests (
  id                   uuid primary key default public.uuidv7(),
  tenant_id            uuid not null references public.tenants(id),
  project_id           uuid not null references public.projects(id) on delete cascade,
  number               integer not null,
  key                  text not null,
  title                text not null check (char_length(btrim(title)) between 1 and 200),
  description          text not null default '' check (char_length(description) <= 6000),
  reason               text not null default 'other' check (reason in ('client_request', 'design_error', 'site_condition', 'regulatory', 'optimization', 'other')),
  initiator_id         uuid default auth.uid() references public.users(id),
  cost_impact          numeric(18, 2),
  schedule_impact_days integer check (schedule_impact_days is null or schedule_impact_days between -3650 and 3650),
  assessment_note      text not null default '' check (char_length(assessment_note) <= 4000),
  decision_note        text not null default '' check (char_length(decision_note) <= 4000),
  status               text not null default 'draft' check (status in ('draft', 'assessment', 'approval', 'approved', 'rejected', 'implemented', 'cancelled')),
  decided_by           uuid references public.users(id),
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (project_id, number)
);
create index on public.change_requests (project_id, status) where deleted_at is null;

alter table public.change_requests enable row level security;
alter table public.change_requests force row level security;
revoke insert, update, delete on public.change_requests from authenticated;
create policy change_requests_select on public.change_requests for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and (private.has_project_permission(project_id, 'change.create') or private.has_project_permission(project_id, 'change.assess')
              or private.has_project_permission(project_id, 'change.approve') or private.has_project_permission(project_id, 'budget.view')));

-- Создать запрос (p_id пусто) или изменить содержание черновика
create or replace function public.change_save(
  p_project uuid, p_title text, p_id uuid default null, p_description text default '', p_reason text default 'other'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_old     public.change_requests;
  v_id      uuid;
  v_number  integer;
  v_title   text := btrim(coalesce(p_title, ''));
begin
  perform private.week_guard(p_project, array['change.create']);
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
  if p_reason not in ('client_request', 'design_error', 'site_condition', 'regulatory', 'optimization', 'other') then
    raise exception 'change_invalid' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'CR', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_number;
    insert into public.change_requests (tenant_id, project_id, number, key, title, description, reason)
    values (v_tenant, p_project, v_number, v_project.code || '-CR-' || v_number, v_title, coalesce(p_description, ''), p_reason)
    returning id into v_id;
    perform private.record_event(v_tenant, p_project, 'project', p_project, 'change_status',
                                 jsonb_build_object('key', v_project.code || '-CR-' || v_number, 'title', v_title, 'from', null, 'to', 'draft', 'note', ''));
  else
    select * into v_old from public.change_requests where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'change_not_found' using errcode = 'P0002'; end if;
    if v_old.status <> 'draft' then raise exception 'change_locked' using errcode = '22023'; end if;
    update public.change_requests set title = v_title, description = coalesce(p_description, ''), reason = p_reason, updated_at = now() where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

-- Оценка влияния: стоимость, срок, заметка. Пока запрос на оценке (и в черновике — для автора, который знает цифры)
create or replace function public.change_assess(p_change uuid, p_cost numeric, p_days integer, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.change_requests;
begin
  select * into c from public.change_requests where id = p_change and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'change_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(c.project_id, array['change.assess']);
  if c.status not in ('draft', 'assessment') then raise exception 'change_locked' using errcode = '22023'; end if;
  if p_days is not null and p_days not between -3650 and 3650 then raise exception 'change_invalid' using errcode = '22023'; end if;
  update public.change_requests set cost_impact = p_cost, schedule_impact_days = p_days, assessment_note = coalesce(p_note, ''), updated_at = now() where id = c.id;
end;
$$;

-- Переход по маршруту; p_note — пояснение (при отклонении обязательно)
create or replace function public.change_transition(p_change uuid, p_to text, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  c    public.change_requests;
  v_ok boolean := false;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into c from public.change_requests where id = p_change and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'change_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(c.project_id, array['change.create', 'change.assess', 'change.approve']);

  if c.status = 'draft' and p_to = 'assessment' then
    v_ok := private.has_project_permission(c.project_id, 'change.create');
  elsif c.status = 'draft' and p_to = 'cancelled' then
    v_ok := private.has_project_permission(c.project_id, 'change.create') or private.has_project_permission(c.project_id, 'change.approve');
  elsif c.status = 'assessment' and p_to = 'approval' then
    v_ok := private.has_project_permission(c.project_id, 'change.assess');
    if v_ok and (c.cost_impact is null or c.schedule_impact_days is null) then raise exception 'assessment_required' using errcode = '22023'; end if;
  elsif c.status = 'assessment' and p_to = 'draft' then
    v_ok := private.has_project_permission(c.project_id, 'change.assess');
  elsif c.status = 'assessment' and p_to = 'cancelled' then
    v_ok := private.has_project_permission(c.project_id, 'change.create') or private.has_project_permission(c.project_id, 'change.approve');
  elsif c.status = 'approval' and p_to in ('approved', 'rejected', 'assessment', 'cancelled') then
    v_ok := private.has_project_permission(c.project_id, 'change.approve');
    if v_ok and p_to = 'rejected' and v_note = '' then raise exception 'note_required' using errcode = '22023'; end if;
  elsif c.status = 'approved' and p_to = 'implemented' then
    v_ok := private.has_project_permission(c.project_id, 'change.approve');
  else
    raise exception 'transition_invalid' using errcode = '22023';
  end if;
  if not v_ok then raise exception 'permission denied: change' using errcode = '42501'; end if;

  update public.change_requests
     set status = p_to, updated_at = now(),
         decision_note = case when p_to in ('approved', 'rejected', 'implemented', 'assessment') and v_note <> '' then v_note else decision_note end,
         decided_by = case when p_to in ('approved', 'rejected') then auth.uid() else decided_by end,
         decided_at = case when p_to in ('approved', 'rejected') then now() else decided_at end
   where id = c.id;
  perform private.record_event(c.tenant_id, c.project_id, 'project', c.project_id, 'change_status',
                               jsonb_build_object('key', c.key, 'title', c.title, 'from', c.status, 'to', p_to, 'note', v_note));
end;
$$;

revoke execute on function public.change_save(uuid, text, uuid, text, text), public.change_assess(uuid, numeric, integer, text), public.change_transition(uuid, text, text) from public, anon;
grant execute on function public.change_save(uuid, text, uuid, text, text), public.change_assess(uuid, numeric, integer, text), public.change_transition(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
