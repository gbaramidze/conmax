-- Оргструктура в виде схемы (как функциональная оргсхема проекта): у отдела появляются описание, порядок работ,
-- отметка «аутсорс», отметка «при руководителе» (рисуется сбоку, как помощник), и штатные позиции —
-- должности внутри отдела, в том числе вакансии и группы без учётной записи («Охранники, 8 чел.», «Site Supervisor — вакансия»).
--
-- Видимость та же, что у отделов (миграция 157): читают все сотрудники компании, правит право staff.manage.

-- ---------------------------------------------------------------------------
-- Отдел: описание, порядок работ, аутсорс, помощник руководителя
-- ---------------------------------------------------------------------------
alter table public.staff_departments
  add column description   text not null default '' check (char_length(description) <= 8000),
  -- шаги «как работает отдел» по порядку: от проверки проекта до сдачи
  add column steps         text[] not null default '{}'
                           check (cardinality(steps) <= 30 and char_length(array_to_string(steps, '')) <= 6000
                                  and array_position(steps, '') is null and array_position(steps, null) is null),
  -- кому отдан на аутсорс (например, юридическая фирма); null — свои сотрудники
  add column outsourced_to text check (outsourced_to is null or char_length(btrim(outsourced_to)) between 1 and 120),
  -- подчиняется руководителю вышестоящего отдела напрямую и рисуется сбоку (координатор, помощник)
  add column is_assistant  boolean not null default false;

-- ---------------------------------------------------------------------------
-- Штатные позиции отдела
-- ---------------------------------------------------------------------------
-- Позиция — должность внутри отдела. Занята сотрудником (user_id), человеком без учётной записи (person_name)
-- или пустая — тогда это вакансия. headcount > 1 — группа одинаковых должностей («Охранники, 8 чел.»).
create table public.staff_positions (
  id            uuid primary key default uuidv7(),
  tenant_id     uuid not null default private.tenant_id() references public.tenants (id),
  department_id uuid not null references public.staff_departments (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  user_id       uuid references public.users (id) on delete set null,
  person_name   text not null default '' check (char_length(person_name) <= 120),
  headcount     integer not null default 1 check (headcount between 1 and 9999),
  position      double precision not null default 65536,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (user_id is null or person_name = '')
);
create index on public.staff_positions (tenant_id, department_id);
create index on public.staff_positions (user_id) where user_id is not null;

create trigger touch before update on public.staff_positions for each row execute function private.staff_touch();

-- Отдел той же компании (RLS отделов тут не помогает: функция видит всё)
create or replace function private.staff_same_tenant_department(p_department uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_departments d where d.id = p_department and d.tenant_id = private.tenant_id())
$$;

alter table public.staff_positions enable row level security;

create policy staff_positions_select on public.staff_positions for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.staff_insider()));
create policy staff_positions_write on public.staff_positions for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('staff.manage'))
              and private.staff_same_tenant_department(department_id)
              and (user_id is null or private.staff_same_tenant_user(user_id)));

grant select, insert, update, delete on public.staff_positions to authenticated;

-- ---------------------------------------------------------------------------
-- Права компании для интерфейса: добавлены staff.* (раньше функция отдавала только admin.* и mail.connect, и кнопки
-- «Отдел», «Изменить», «Позиция» в разделе «Персонал» не показывались даже тем, у кого есть staff.manage)
-- ---------------------------------------------------------------------------
create or replace function public.my_tenant_permissions() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), '{}')
    from public.user_tenant_roles utr
    join public.role_permissions rp on rp.role_id = utr.role_id
   where utr.user_id = auth.uid() and utr.tenant_id = private.tenant_id()
     and (rp.permission like 'admin.%' or rp.permission like 'staff.%' or rp.permission = 'mail.connect');
$$;
