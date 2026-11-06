-- Реестр рисков проекта (S10, первая часть): что может пойти не так, насколько вероятно и серьёзно, кто отвечает и что делаем.
--
-- Риск: название, описание, категория, вероятность (1–5) и влияние (1–5), оценка = вероятность × влияние (считается базой),
-- влияние в деньгах и днях (необязательно), владелец (участник проекта), стратегия (избежать / снизить / передать / принять),
-- меры и триггер (по каким признакам понять, что риск наступает), статус (открыт / наблюдаем / наступил / закрыт), дата пересмотра.
-- Номер и ключ (`RTG1-R-3`) выдаются по счётчику проекта. Матрица 5×5 на странице строится из вероятности и влияния.
-- Права: смотрят `risk.view` и `risk.manage`, ведут (создают, меняют, убирают) только `risk.manage` (руководитель проекта).
-- Внешние участники реестр не видят: он внутренний (`can_see_internal`).
-- Создание и смена статуса пишутся в ленту проекта (события `risk_created`, `risk_status` у сущности «проект», видимость внутренняя).
-- Не вошло в эту часть: попадание рисков с оценкой ≥ 12 в повестку, сравнение ожидаемой стоимости рисков с резервом, предложение
-- риска из сигнала. См. docs: 05-roadmap/05-backlog.md, раздел «Реестр рисков».

create table public.risks (
  id                   uuid primary key default public.uuidv7(),
  tenant_id            uuid not null references public.tenants(id),
  project_id           uuid not null references public.projects(id) on delete cascade,
  number               integer not null,
  key                  text not null,
  title                text not null check (char_length(btrim(title)) between 1 and 200),
  description          text not null default '' check (char_length(description) <= 4000),
  category             text not null default 'other'
                       check (category in ('design', 'procurement', 'contractor', 'site', 'regulatory', 'financial', 'safety', 'weather', 'other')),
  probability          smallint not null check (probability between 1 and 5),
  impact               smallint not null check (impact between 1 and 5),
  score                smallint generated always as (probability * impact) stored,
  cost_impact          numeric(18, 2) check (cost_impact is null or cost_impact >= 0),
  schedule_impact_days integer check (schedule_impact_days is null or schedule_impact_days between 0 and 3650),
  owner_id             uuid references public.users(id),
  response             text check (response is null or response in ('avoid', 'mitigate', 'transfer', 'accept')),
  mitigation           text not null default '' check (char_length(mitigation) <= 4000),
  trigger_text         text not null default '' check (char_length(trigger_text) <= 1000),
  status               text not null default 'open' check (status in ('open', 'monitoring', 'occurred', 'closed')),
  review_date          date,
  created_by           uuid default auth.uid() references public.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (project_id, number)
);
create index on public.risks (project_id, status) where deleted_at is null;

alter table public.risks enable row level security;
alter table public.risks force row level security;
revoke insert, update, delete on public.risks from authenticated;
create policy risks_select on public.risks for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null
         and private.can_see_project(project_id) and private.can_see_internal(project_id)
         and (private.has_project_permission(project_id, 'risk.view') or private.has_project_permission(project_id, 'risk.manage')));

-- Создать (p_id пусто) или изменить риск
create or replace function public.risk_save(
  p_project uuid, p_title text, p_id uuid default null, p_description text default '', p_category text default 'other',
  p_probability integer default 3, p_impact integer default 3, p_cost_impact numeric default null, p_schedule_days integer default null,
  p_owner uuid default null, p_response text default null, p_mitigation text default '', p_trigger text default '',
  p_status text default 'open', p_review_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_project public.projects;
  v_old     public.risks;
  v_id      uuid;
  v_number  integer;
  v_title   text := btrim(coalesce(p_title, ''));
begin
  perform private.week_guard(p_project, array['risk.manage']);
  select * into v_project from public.projects where id = p_project and tenant_id = v_tenant;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'title_required' using errcode = '22023'; end if;
  if p_probability not between 1 and 5 or p_impact not between 1 and 5 then raise exception 'scale_invalid' using errcode = '22023'; end if;
  if p_category not in ('design', 'procurement', 'contractor', 'site', 'regulatory', 'financial', 'safety', 'weather', 'other')
     or p_status not in ('open', 'monitoring', 'occurred', 'closed')
     or (p_response is not null and p_response not in ('avoid', 'mitigate', 'transfer', 'accept'))
     or coalesce(p_cost_impact, 0) < 0 or coalesce(p_schedule_days, 0) not between 0 and 3650 then
    raise exception 'risk_invalid' using errcode = '22023';
  end if;
  if p_owner is not null and not private.user_is_project_member(p_owner, p_project) then
    raise exception 'owner_not_member' using errcode = '23514';
  end if;

  if p_id is null then
    insert into public.project_counters as pc (project_id, kind, last_number) values (p_project, 'R', 1)
    on conflict (project_id, kind) do update set last_number = pc.last_number + 1
    returning last_number into v_number;
    insert into public.risks (tenant_id, project_id, number, key, title, description, category, probability, impact, cost_impact, schedule_impact_days,
                              owner_id, response, mitigation, trigger_text, status, review_date)
    values (v_tenant, p_project, v_number, v_project.code || '-R-' || v_number, v_title, coalesce(p_description, ''), p_category, p_probability, p_impact,
            p_cost_impact, p_schedule_days, p_owner, p_response, coalesce(p_mitigation, ''), coalesce(p_trigger, ''), p_status, p_review_date)
    returning id into v_id;
    perform private.record_event(v_tenant, p_project, 'project', p_project, 'risk_created',
                                 jsonb_build_object('key', v_project.code || '-R-' || v_number, 'title', v_title, 'score', p_probability * p_impact));
  else
    select * into v_old from public.risks where id = p_id and project_id = p_project and tenant_id = v_tenant and deleted_at is null;
    if not found then raise exception 'risk_not_found' using errcode = 'P0002'; end if;
    update public.risks
       set title = v_title, description = coalesce(p_description, ''), category = p_category, probability = p_probability, impact = p_impact,
           cost_impact = p_cost_impact, schedule_impact_days = p_schedule_days, owner_id = p_owner, response = p_response,
           mitigation = coalesce(p_mitigation, ''), trigger_text = coalesce(p_trigger, ''), status = p_status, review_date = p_review_date, updated_at = now()
     where id = p_id;
    v_id := p_id;
    if v_old.status <> p_status then
      perform private.record_event(v_tenant, p_project, 'project', p_project, 'risk_status',
                                   jsonb_build_object('key', v_old.key, 'title', v_old.title, 'from', v_old.status, 'to', p_status));
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.risk_delete(p_risk uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.risks;
begin
  select * into r from public.risks where id = p_risk and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'risk_not_found' using errcode = 'P0002'; end if;
  perform private.week_guard(r.project_id, array['risk.manage']);
  update public.risks set deleted_at = now() where id = r.id;
end;
$$;

revoke execute on function public.risk_save(uuid, text, uuid, text, text, integer, integer, numeric, integer, uuid, text, text, text, text, date), public.risk_delete(uuid) from public, anon;
grant execute on function public.risk_save(uuid, text, uuid, text, text, integer, integer, numeric, integer, uuid, text, text, text, text, date), public.risk_delete(uuid) to authenticated;
notify pgrst, 'reload schema';
