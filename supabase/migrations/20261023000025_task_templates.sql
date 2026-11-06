-- Шаблоны задач: набор типовых задач с относительными сроками, применяется к одному или нескольким местам
-- (например, «Приёмка этажа» — на 12 этажей сразу). См. docs: 04-modules/04-tasks.md («Создание»).

create table public.task_templates (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  name       text not null check (length(btrim(name)) between 1 and 120),
  description text,
  -- [{"title": "Проверка геометрии — {место}", "offset_days": 0, "priority": "normal", "discipline": "KR"}]
  items      jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60),
  deleted_at timestamptz
);
create index on public.task_templates (tenant_id) where deleted_at is null;

alter table public.task_templates enable row level security;
alter table public.task_templates force row level security;
create policy task_templates_select on public.task_templates for select to authenticated
  using (tenant_id = (select private.tenant_id()) and deleted_at is null);
create policy task_templates_write on public.task_templates for all to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.templates')))
  with check (tenant_id = (select private.tenant_id()) and (select private.has_tenant_permission('admin.templates')));

create or replace function private.task_templates_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id := coalesce(private.tenant_id(), new.tenant_id);
  -- при создании тенанта автор-пользователь ещё не заведён: ссылку ставим, только если он есть
  new.created_by := (select u.id from public.users u where u.id = auth.uid());
  return new;
end;
$$;
create trigger task_templates_before_insert before insert on public.task_templates
  for each row execute function private.task_templates_before_insert();

-- Типовые шаблоны для тенанта
create or replace function private.seed_task_templates(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_templates (tenant_id, name, description, items)
  select p_tenant, x.name, x.descr, x.items::jsonb
    from (values
      ('Приёмка этажа', 'Проверки перед закрытием конструкций и сдачей этажа',
       '[{"title":"Проверка геометрии и отметок — {место}","offset_days":0,"priority":"normal"},
         {"title":"Проверка инженерных закладных — {место}","offset_days":1,"priority":"normal"},
         {"title":"Уборка и подготовка к скрытым работам — {место}","offset_days":2,"priority":"normal"},
         {"title":"Фотофиксация перед закрытием — {место}","offset_days":3,"priority":"normal"},
         {"title":"Акт освидетельствования скрытых работ — {место}","offset_days":3,"priority":"high"},
         {"title":"Устранение замечаний — {место}","offset_days":5,"priority":"normal"}]'),
      ('Подготовка к бетонированию', 'Что проверить и заказать до заливки',
       '[{"title":"Проверка опалубки — {место}","offset_days":0,"priority":"high"},
         {"title":"Проверка армирования — {место}","offset_days":0,"priority":"high"},
         {"title":"Согласование и заказ бетона — {место}","offset_days":1,"priority":"normal"},
         {"title":"Допуск к бетонированию — {место}","offset_days":2,"priority":"high"}]')
    ) as x(name, descr, items)
   where not exists (select 1 from public.task_templates t where t.tenant_id = p_tenant and t.name = x.name);
end;
$$;

select private.seed_task_templates(id) from public.tenants;

create or replace function private.tenants_seed_task_templates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_task_templates(new.id);
  return new;
end;
$$;
create trigger tenants_seed_task_templates after insert on public.tenants
  for each row execute function private.tenants_seed_task_templates();

-- Применить шаблон: по задаче на каждый пункт для каждого места. Сроки — от даты старта.
create or replace function public.apply_task_template(p_project uuid, p_template uuid, p_locations uuid[], p_start date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t       public.task_templates;
  v_loc   record;
  it      jsonb;
  v_disc  uuid;
  v_count integer := 0;
  v_start date := coalesce(p_start, current_date);
begin
  select * into t from public.task_templates where id = p_template and tenant_id = private.tenant_id() and deleted_at is null;
  if not found then raise exception 'template_not_found' using errcode = 'P0002'; end if;
  if coalesce(array_length(p_locations, 1), 0) = 0 then raise exception 'location_required' using errcode = '22023'; end if;
  if array_length(p_locations, 1) > 60 then raise exception 'too_many_locations' using errcode = '22023'; end if;

  for v_loc in
    select l.id, l.code, l.name from public.locations l
     where l.id = any (p_locations) and l.project_id = p_project and l.deleted_at is null
     order by l.path
  loop
    for it in select * from jsonb_array_elements(t.items) loop
      v_disc := null;
      if nullif(it ->> 'discipline', '') is not null then
        select d.id into v_disc from public.disciplines d
         where d.project_id = p_project and d.deleted_at is null and upper(d.code) = upper(it ->> 'discipline') limit 1;
      end if;
      -- права проверяет create_task: без права создавать задачи функция выбросит 42501
      perform public.create_task(
        p_project,
        replace(it ->> 'title', '{место}', v_loc.code || ' ' || v_loc.name),
        'task', null,
        v_start + coalesce((it ->> 'offset_days')::integer, 0),
        coalesce(nullif(it ->> 'priority', ''), 'normal'),
        null, v_disc, v_loc.id, null);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.apply_task_template(uuid, uuid, uuid[], date) from public, anon;
grant  execute on function public.apply_task_template(uuid, uuid, uuid[], date) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
