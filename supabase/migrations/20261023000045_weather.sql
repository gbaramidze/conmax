-- Погода на объекте: координаты проекта и прогноз по дням из Open-Meteo (без ключа).
-- Воркер (edge function `weather`) вызывается по расписанию из БД и кладёт прошлую неделю и две недели прогноза в `project_weather`.
-- Сигнал `weather_risk` предупреждает о ветре, осадках и заморозках на ближайшие три дня.

create table public.project_geo (
  project_id uuid primary key references public.projects(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  lat        numeric(9,6) not null check (lat between -90 and 90),
  lon        numeric(9,6) not null check (lon between -180 and 180),
  place      text check (place is null or length(place) <= 200),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.users(id)
);

create table public.project_weather (
  project_id uuid not null references public.projects(id) on delete cascade,
  day        date not null,
  tenant_id  uuid not null references public.tenants(id),
  code       integer,            -- код погоды WMO
  tmax       numeric(5,1),
  tmin       numeric(5,1),
  precip     numeric(6,1),       -- осадки за сутки, мм
  wind       numeric(5,1),       -- максимальный ветер, м/с
  gust       numeric(5,1),       -- максимальные порывы, м/с
  fetched_at timestamptz not null default now(),
  primary key (project_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['project_geo', 'project_weather'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = (select private.tenant_id()) and private.can_see_project(project_id))$p$, t || '_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Права на настройки проекта (без требования «видеть внутреннее»: администратор организации не обязан быть участником проекта)
create or replace function private.settings_guard(p_project uuid, p_perms text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_perm text;
begin
  if exists (select 1 from public.projects where id = p_project and tenant_id = private.tenant_id()) and private.can_see_project(p_project) then
    foreach v_perm in array p_perms loop
      if private.has_project_permission(p_project, v_perm) then return; end if;
    end loop;
  end if;
  raise exception 'permission denied: %', p_perms[1] using errcode = '42501';
end;
$$;

-- Указать место объекта (право настраивать проект)
create or replace function public.set_project_geo(p_project uuid, p_lat numeric, p_lon numeric, p_place text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.settings_guard(p_project, array['project.settings.manage', 'project.edit']);
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then raise exception 'bad_coords' using errcode = '22023'; end if;
  insert into public.project_geo (project_id, tenant_id, lat, lon, place, updated_by)
  select p_project, pr.tenant_id, round(p_lat, 6), round(p_lon, 6), nullif(btrim(coalesce(p_place, '')), ''), auth.uid() from public.projects pr where pr.id = p_project
  on conflict (project_id) do update set lat = excluded.lat, lon = excluded.lon, place = excluded.place, updated_at = now(), updated_by = auth.uid();
  delete from public.project_weather where project_id = p_project;   -- место сменилось: старая погода не подходит
end;
$$;

create or replace function public.clear_project_geo(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.settings_guard(p_project, array['project.settings.manage', 'project.edit']);
  delete from public.project_geo where project_id = p_project;
  delete from public.project_weather where project_id = p_project;
end;
$$;

-- Для воркера: проекты с координатами (вызывает service_role)
create or replace function public.weather_places() returns table (project_id uuid, lat numeric, lon numeric)
language sql security definer set search_path = '' as $$
  select g.project_id, g.lat, g.lon from public.project_geo g join public.projects p on p.id = g.project_id
   where p.deleted_at is null and p.status in ('active', 'on_hold', 'draft');
$$;
revoke execute on function public.weather_places() from public, anon, authenticated;

create or replace function public.weather_store(p_project uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'bad_rows' using errcode = '22023'; end if;
  insert into public.project_weather (project_id, day, tenant_id, code, tmax, tmin, precip, wind, gust, fetched_at)
  select p_project, (r ->> 'day')::date, pr.tenant_id, (r ->> 'code')::integer, (r ->> 'tmax')::numeric, (r ->> 'tmin')::numeric,
         (r ->> 'precip')::numeric, (r ->> 'wind')::numeric, (r ->> 'gust')::numeric, now()
    from jsonb_array_elements(p_rows) r join public.projects pr on pr.id = p_project
  on conflict (project_id, day) do update set code = excluded.code, tmax = excluded.tmax, tmin = excluded.tmin, precip = excluded.precip,
         wind = excluded.wind, gust = excluded.gust, fetched_at = now();
end;
$$;
revoke execute on function public.weather_store(uuid, jsonb) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['set_project_geo(uuid,numeric,numeric,text)', 'clear_project_geo(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Расписание: каждые три часа БД будит воркер (если есть проекты с координатами)
insert into private.app_config (key, value)
select 'weather_worker_url', replace(value, 'extract-texts', 'weather') from private.app_config where key = 'text_worker_url'
on conflict (key) do nothing;

create or replace function private.kick_weather_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_secret text; v_key text;
begin
  if not exists (select 1 from public.project_geo) then return; end if;
  select value into v_url from private.app_config where key = 'weather_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key from private.app_config where key = 'functions_apikey';
  if v_url is null then return; end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
end;
$$;

do $$
begin
  perform cron.schedule('buildos-weather', '25 */3 * * *', 'select private.kick_weather_worker()');
exception when others then
  raise notice 'pg_cron недоступен, расписание погоды не создано: %', sqlerrm;
end $$;

-- Правило сигналов: опасная погода на ближайшие три дня (если на объекте идут работы)
create or replace function private.evaluate_extra(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := current_date;
  n_gust integer; n_rain integer; n_frost integer; n_heat integer;
  w_gust numeric; w_rain numeric; w_frost numeric; w_hot numeric;
begin
  select count(*) filter (where gust >= 15), count(*) filter (where precip >= 15), count(*) filter (where tmin <= -5), count(*) filter (where tmax >= 35),
         coalesce(max(gust), 0), coalesce(max(precip), 0), coalesce(min(tmin), 0), coalesce(max(tmax), 0)
    into n_gust, n_rain, n_frost, n_heat, w_gust, w_rain, w_frost, w_hot
    from public.project_weather where project_id = p_project and day between today and today + 3;
  if (n_gust + n_rain + n_frost + n_heat) > 0 and exists (
       select 1 from public.schedule_activities where project_id = p_project and deleted_at is null and kind = 'task'
          and percent_complete < 100 and start_date <= today + 3 and finish_date >= today) then
    perform private.emit_signal(p_project, 'weather_risk', 'weather_risk', case when w_gust >= 20 or w_rain >= 30 then 'high' else 'warning' end,
      'Опасная погода в ближайшие дни: ' || concat_ws(', ',
        case when n_gust > 0 then format('порывы ветра до %s м/с', w_gust) end, case when n_rain > 0 then format('осадки до %s мм', w_rain) end,
        case when n_frost > 0 then format('мороз до %s °C', w_frost) end, case when n_heat > 0 then format('жара до %s °C', w_hot) end),
      jsonb_build_array(jsonb_build_object('label', 'Порывы ветра, м/с (макс.)', 'value', w_gust), jsonb_build_object('label', 'Осадки за сутки, мм (макс.)', 'value', w_rain),
                        jsonb_build_object('label', 'Минимальная температура, °C', 'value', w_frost), jsonb_build_object('label', 'Максимальная температура, °C', 'value', w_hot)), '[]',
      'В прогнозе на три дня: порывы ≥ 15 м/с (краны), осадки ≥ 15 мм (бетон, кровля), мороз ≤ −5 °C (бетон) или жара ≥ 35 °C',
      '[{"type":"create_task","title":"Скорректировать работы с учётом погоды"},{"type":"add_to_agenda"},{"type":"assign"}]');
  end if;
end;
$$;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
