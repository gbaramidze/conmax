-- Демо-данные для локальной разработки: тенант «Демо Строй», 15 пользователей, 3 проекта.
-- Все пользователи: пароль demo-pass-2026 (ТОЛЬКО для локальной БД; seed не применяется в облаке).

do $$
declare
  v_tenant  uuid := public.uuidv7();
  v_own     uuid;
  v_sub     uuid;
  v_client  uuid;
  u         record;
  v_uid     uuid;
  v_role    uuid;
  p         record;
  v_project uuid;
begin
  insert into public.tenants (id, name, slug) values (v_tenant, 'Демо Строй', 'demo-stroy');

  insert into public.organizations (tenant_id, name, kind) values (v_tenant, 'Демо Строй', 'own')            returning id into v_own;
  insert into public.organizations (tenant_id, name, kind) values (v_tenant, 'МонолитСтрой', 'subcontractor') returning id into v_sub;
  insert into public.organizations (tenant_id, name, kind) values (v_tenant, 'ГК Заказчик', 'client')         returning id into v_client;
  -- вторая подрядная организация: на ней проверяется, что подрядчики не видят друг друга (тест 48)
  insert into public.organizations (tenant_id, name, kind) values (v_tenant, 'ЭлектроМонтаж', 'subcontractor');

  perform private.seed_tenant_defaults(v_tenant);

  -- email, имя, организация, внешний?, роль тенанта
  for u in
    select * from (values
      ('admin',     'Анна Администраторова', v_own,    false, 'tenant_admin'),
      ('director',  'Дмитрий Директоров',    v_own,    false, 'director'),
      ('pm1',       'Павел Руководов',       v_own,    false, 'member'),
      ('pm2',       'Полина Проектова',      v_own,    false, 'member'),
      ('gip',       'Георгий Главный',       v_own,    false, 'member'),
      ('pto',       'Пётр Техотделов',       v_own,    false, 'member'),
      ('foreman1',  'Фёдор Прорабов',        v_own,    false, 'member'),
      ('foreman2',  'Фаина Участкова',       v_own,    false, 'member'),
      ('master',    'Михаил Мастеров',       v_own,    false, 'member'),
      ('designer',  'Дарья Чертёжкина',      v_own,    false, 'member'),
      ('economist', 'Эмма Сметова',          v_own,    false, 'member'),
      ('safety',    'Сергей Охранов',        v_own,    false, 'member'),
      ('observer',  'Олег Наблюдателев',     v_own,    false, 'member'),
      ('sub1',      'Семён Монолитов',       v_sub,    true,  'member'),
      ('client',    'Клавдия Заказчикова',   v_client, true,  'member')
    ) as x(handle, full_name, org, ext, tenant_role)
  loop
    v_uid := public.uuidv7();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      u.handle || '@demo.test', extensions.crypt('demo-pass-2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, 'email',
            jsonb_build_object('sub', v_uid::text, 'email', u.handle || '@demo.test', 'email_verified', true),
            now(), now(), now());

    insert into public.users (id, tenant_id, email, full_name, organization_id, is_external, status)
    values (v_uid, v_tenant, u.handle || '@demo.test', u.full_name, u.org, u.ext, 'active');

    insert into public.user_tenant_roles (tenant_id, user_id, role_id)
    select v_tenant, v_uid, id from public.roles
    where tenant_id = v_tenant and scope = 'tenant' and code = u.tenant_role;
  end loop;

  -- Проекты
  insert into public.projects (tenant_id, code, name, kind, status, address, planned_start, planned_finish, manager_user_id) values
    (v_tenant, 'ZK7', 'ЖК «Заречный-7»',     'residential', 'active', 'г. Казань, ул. Заречная, 7',   '2026-03-01', '2028-06-30', (select id from public.users where email = 'pm1@demo.test')),
    (v_tenant, 'BC2', 'Бизнес-центр «Олимп»', 'commercial',  'active', 'г. Казань, пр. Победы, 120',   '2026-05-15', '2027-12-20', (select id from public.users where email = 'pm2@demo.test')),
    (v_tenant, 'SK3', 'Склад «Север»',        'industrial',  'draft',  'Республика Татарстан, Алабуга', '2026-11-01', '2027-08-31', (select id from public.users where email = 'pm2@demo.test'));

  -- Участники: проект, email, роль проекта
  for p in
    select * from (values
      ('ZK7','pm1','project_manager'),   ('ZK7','gip','chief_engineer'),  ('ZK7','pto','pto'),
      ('ZK7','foreman1','foreman'),      ('ZK7','master','master'),       ('ZK7','designer','designer'),
      ('ZK7','economist','economist'),   ('ZK7','safety','safety_officer'), ('ZK7','observer','observer'),
      ('ZK7','sub1','subcontractor'),    ('ZK7','client','client'),
      ('BC2','pm2','project_manager'),   ('BC2','foreman2','foreman'),    ('BC2','pto','pto'),
      ('BC2','economist','economist'),
      ('SK3','pm2','project_manager'),   ('SK3','foreman2','foreman')
    ) as x(project_code, handle, role_code)
  loop
    select id into v_project from public.projects where tenant_id = v_tenant and code = p.project_code;
    select id into v_role    from public.roles    where tenant_id = v_tenant and scope = 'project' and code = p.role_code;
    insert into public.project_members (tenant_id, project_id, user_id, role_id, organization_id)
    select v_tenant, v_project, id, v_role, organization_id from public.users where email = p.handle || '@demo.test';
  end loop;
end $$;

-- Демо-задачи: создаются теми же функциями, что и в приложении, от имени руководителей проектов
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-stroy');
  v_zk7    uuid := (select id from public.projects where code = 'ZK7');
  v_bc2    uuid := (select id from public.projects where code = 'BC2');
  v_t      public.tasks;
  v_blocked uuid; v_progress uuid; v_review uuid;

  function_user uuid;
begin
  -- от имени pm1
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm1@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);

  select id into v_progress from public.workflow_statuses where tenant_id = v_tenant and code = 'in_progress';
  select id into v_blocked  from public.workflow_statuses where tenant_id = v_tenant and code = 'blocked';
  select id into v_review   from public.workflow_statuses where tenant_id = v_tenant and code = 'review';

  v_t := public.create_task(v_zk7, 'Залить фундаментную плиту корпуса 2', 'task',
          (select id from public.users where email = 'foreman1@demo.test'), current_date + 7, 'high');
  perform public.transition_task(v_t.id, v_progress);

  v_t := public.create_task(v_zk7, 'Согласовать армирование колонн с проектировщиком', 'task',
          (select id from public.users where email = 'designer@demo.test'), current_date + 3, 'critical');
  perform public.transition_task(v_t.id, v_progress);
  perform public.transition_task(v_t.id, v_blocked, 'rfi', 'Ждём ответ на RFI по сечению колонн');

  v_t := public.create_task(v_zk7, 'Проверить леса на 5 этаже', 'task',
          (select id from public.users where email = 'master@demo.test'), current_date - 2, 'normal');
  perform public.transition_task(v_t.id, v_progress);

  v_t := public.create_task(v_zk7, 'Монтаж опалубки перекрытия', 'task',
          (select id from public.users where email = 'sub1@demo.test'), current_date + 10, 'normal');

  v_t := public.create_task(v_zk7, 'Подготовить акт скрытых работ', 'task', null, current_date + 5, 'low');

  -- от имени pm2
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm2@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);
  v_t := public.create_task(v_bc2, 'Утвердить раскладку фасадных панелей', 'task',
          (select id from public.users where email = 'foreman2@demo.test'), current_date + 14, 'normal');
  v_t := public.create_task(v_bc2, 'Заказать лифтовое оборудование', 'task', null, current_date + 30, 'high');
end $$;

-- Локации: корпуса создаются тем же генератором, что и в приложении
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-stroy');
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm1@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);
  perform public.generate_building((select id from public.projects where code = 'ZK7'), 'K1', 'Корпус 1', 2, -1, 9);
  perform public.generate_building((select id from public.projects where code = 'ZK7'), 'K2', 'Корпус 2', 0, 1, 16);
  perform public.generate_rooms((select id from public.projects where code = 'ZK7'),
                                (select id from public.locations where path::text = 'K2' and project_id = (select id from public.projects where code = 'ZK7')), 4);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm2@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);
  perform public.generate_building((select id from public.projects where code = 'BC2'), 'A', 'Башня А', 1, -2, 24);
end $$;

update public.tasks t set location_id = l.id
from public.locations l
join (values
  ('Залить фундаментную плиту корпуса 2',              'K2.F01'),
  ('Проверить леса на 5 этаже',                        'K1.S1.F05'),
  ('Монтаж опалубки перекрытия',                       'K1.S2.F03'),
  ('Согласовать армирование колонн с проектировщиком', 'K1'),
  ('Утвердить раскладку фасадных панелей',             'A.S1.F12')
) as x(title, path) on true
where t.title = x.title and l.project_id = t.project_id and l.path::text = x.path;

-- Направления проекта: руководители и поднаправление «Монолит» внутри КР (как в приложении, от имени РП)
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-stroy');
  v_zk7    uuid := (select id from public.projects where code = 'ZK7');
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm1@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);

  update public.disciplines set lead_user_id = (select id from public.users where email = 'gip@demo.test')
   where project_id = v_zk7 and code = 'KR';
  update public.disciplines set lead_user_id = (select id from public.users where email = 'designer@demo.test')
   where project_id = v_zk7 and code = 'AR';
  insert into public.disciplines (project_id, parent_id, code, name, color, lead_user_id, sort)
  select v_zk7, d.id, 'MON', 'Монолит', 'amber', (select id from public.users where email = 'foreman1@demo.test'), 1
    from public.disciplines d where d.project_id = v_zk7 and d.code = 'KR';
  insert into public.disciplines (project_id, parent_id, code, name, color, sort)
  select v_zk7, d.id, 'KLD', 'Кладка', 'amber', 2
    from public.disciplines d where d.project_id = v_zk7 and d.code = 'KR';
end $$;

-- Дисциплины и теги демо-задач
update public.tasks t set
  discipline_id = (select d.id from public.disciplines d
                    where d.project_id = t.project_id and d.code = x.disc and d.deleted_at is null),
  tags = x.tags
from (values
  ('Залить фундаментную плиту корпуса 2',              'MON', array['бетон','фундамент']),
  ('Согласовать армирование колонн с проектировщиком', 'KR',  array['rfi','армирование']),
  ('Проверить леса на 5 этаже',                        'AR',  array['безопасность']),
  ('Монтаж опалубки перекрытия',                       'KR',  array['бетон']),
  ('Подготовить акт скрытых работ',                    'AR',  array['исполнительная']),
  ('Утвердить раскладку фасадных панелей',             'AR',  array['фасад']),
  ('Заказать лифтовое оборудование',                   'EOM', array['закупки'])
) as x(title, disc, tags)
where t.title = x.title;

-- Демо-план объёмов: «подрядчик × место × работа × объём» и частичный факт
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-stroy');
  v_zk7    uuid := (select id from public.projects where code = 'ZK7');
  v_sub    uuid := (select id from public.organizations where name = 'МонолитСтрой');
  v_fm     uuid := (select id from public.users where email = 'foreman1@demo.test');
  v_item   uuid;
  i        record;
begin
  for i in select * from (values
      ('K1.S1.F05', 'KR',  'Монтаж стеклопакетов', 'м²', 150, true),
      ('K1.S1.F05', 'AR',  'Штукатурка стен',      'м²', 400, false),
      ('K1.S1.F05', 'KR',  'Армирование перекрытия','т',  12, true),
      ('K1.S1.F04', 'AR',  'Штукатурка стен',      'м²', 400, false),
      ('K1.S1.F04', 'KR',  'Монтаж стеклопакетов', 'м²', 150, true)
    ) as x(path, disc, name, unit, qty, sub)
  loop
    insert into public.work_items (tenant_id, project_id, location_id, discipline_id, contractor_org_id, name, unit, planned_qty)
    select v_tenant, v_zk7, l.id,
           (select d.id from public.disciplines d where d.project_id = v_zk7 and d.code = i.disc),
           case when i.sub then v_sub end, i.name, i.unit, i.qty
      from public.locations l where l.project_id = v_zk7 and l.path::text = i.path
    returning id into v_item;
    -- частичный подтверждённый факт на 4 этаже: «сделано 30 из 150»
    if i.path = 'K1.S1.F04' and i.name = 'Монтаж стеклопакетов' then
      insert into public.work_progress (tenant_id, project_id, work_item_id, qty, reported_by, approved_by, approved_at)
      values (v_tenant, v_zk7, v_item, 30, v_fm, v_fm, now());
    end if;
  end loop;
end $$;

-- Демо хода строительства: Корпус 1, секция 1 — монолит, кладка, вентиляция по этажам со сроками и весами;
-- факт набирался последние недели; обходы разной давности; одна независимая проверка совпала, одна разошлась
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-stroy');
  v_zk7    uuid := (select id from public.projects where code = 'ZK7');
  v_sub    uuid := (select id from public.organizations where name = 'МонолитСтрой');
  v_fm     uuid := (select id from public.users where email = 'foreman1@demo.test');
  v_sb     uuid := (select id from public.users where email = 'sub1@demo.test');
  v_pto    uuid := (select id from public.users where email = 'pto@demo.test');
  v_item   uuid;
  v_walk   uuid;
  v_loc    uuid;
  f        record;
  w        record;
  w_idx    integer;
  v_total  numeric;
begin
  for f in select * from (values
      ('B1', 0), ('F01', 1), ('F02', 2), ('F03', 3), ('F04', 4), ('F05', 5), ('F06', 6), ('F07', 7), ('F08', 8), ('F09', 9)
    ) as x(fl, idx)
  loop
    for w in select * from (values
        ('MON', 'Монолитное перекрытие', 'м³', 120, 900, true,  0,
           case f.idx when 0 then 1.0 when 1 then 1.0 when 2 then 1.0 when 3 then 0.85 when 4 then 0.6 when 5 then 0.35 when 6 then 0.1 else 0 end),
        ('KLD', 'Кладка стен',          'м²', 600, 500, true,  10,
           case f.idx when 0 then 1.0 when 1 then 0.9 when 2 then 0.7 when 3 then 0.4 when 4 then 0.15 else 0 end),
        ('OV',  'Монтаж вентиляции',    'м',  180, 250, false, 30,
           case f.idx when 1 then 0.4 when 2 then 0.25 else 0 end)
      ) as y(disc, name, unit, qty, weight, sub, offs, frac)
    loop
      insert into public.work_items (tenant_id, project_id, location_id, discipline_id, contractor_org_id, name, unit, planned_qty, weight, planned_start, planned_finish)
      select v_tenant, v_zk7, l.id,
             (select d.id from public.disciplines d where d.project_id = v_zk7 and d.code = w.disc),
             case when w.sub then v_sub end, w.name, w.unit, w.qty, w.weight,
             date '2026-05-01' + 21 * f.idx + w.offs, date '2026-05-01' + 21 * f.idx + w.offs + 14
        from public.locations l where l.project_id = v_zk7 and l.path::text = 'K1.S1.' || f.fl
      returning id into v_item;

      v_total := w.qty * w.frac;
      if v_total > 0 then
        -- три записи за последние недели, подрядчик вносит свои работы сам
        insert into public.work_progress (tenant_id, project_id, work_item_id, qty, entry_date, reported_by, approved_by, approved_at)
        select v_tenant, v_zk7, v_item, round(v_total * s.share, 2), current_date - s.days,
               case when w.sub then v_sb else v_fm end, v_fm, now()
          from (values (0.4, 40), (0.35, 20), (0.25, 3)) as s(share, days);
      end if;
    end loop;
  end loop;

  -- обходы: этажи 1–3 пройдены позавчера, этаж 6 — 12 дней назад, остальные не обходились
  for w in select * from (values ('F01', 2), ('F02', 2), ('F03', 2), ('F06', 12)) as x(fl, days_ago) loop
    select id into v_loc from public.locations where project_id = v_zk7 and path::text = 'K1.S1.' || w.fl;
    insert into public.site_walks (tenant_id, project_id, location_id, location_path, author_id, status, started_at, submitted_at, approved_by, approved_at)
    values (v_tenant, v_zk7, v_loc, 'K1.S1.' || w.fl, v_fm, 'approved',
            now() - make_interval(days => w.days_ago), now() - make_interval(days => w.days_ago), v_fm, now() - make_interval(days => w.days_ago));
  end loop;

  -- независимые проверки ПТО: этаж 1 совпал (заявлено 120, на месте 120); этаж 3 разошёлся (заявлено 102, на месте 80)
  for w in select * from (values ('F01', 120::numeric), ('F03', 80::numeric)) as x(fl, obs) loop
    select id into v_loc from public.locations where project_id = v_zk7 and path::text = 'K1.S1.' || w.fl;
    insert into public.site_walks (tenant_id, project_id, location_id, location_path, author_id, kind, status, started_at, submitted_at, approved_by, approved_at)
    values (v_tenant, v_zk7, v_loc, 'K1.S1.' || w.fl, v_pto, 'check', 'approved', now() - interval '1 day', now() - interval '1 day', v_pto, now() - interval '1 day')
    returning id into v_walk;

    select wi.id into v_item from public.work_items wi
     where wi.project_id = v_zk7 and wi.location_id = v_loc and wi.name = 'Монолитное перекрытие';
    select coalesce(sum(qty), 0) into v_total from public.work_progress where work_item_id = v_item;

    insert into public.site_walk_results (walk_id, work_item_id, tenant_id, result, qty) values (v_walk, v_item, v_tenant, 'observed', w.obs);
    insert into public.work_checks (tenant_id, project_id, work_item_id, walk_id, checked_by, checked_at, observed_qty, reported_qty, verdict, independent)
    values (v_tenant, v_zk7, v_item, v_walk, v_pto, now() - interval '1 day', w.obs, v_total,
            private.check_verdict(v_zk7, 120, v_total, w.obs), true);
  end loop;
end $$;

-- Демо-документы и бюджет ZK7: на них опираются тесты (план этажа, миниатюры, масштабы, заявки на материалы, валюты).
-- Создаются теми же функциями, что и в приложении: документы — от имени pm1, бюджет — от имени администратора.
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-stroy');
  v_zk7    uuid := (select id from public.projects where code = 'ZK7');
  v_file   uuid;
  v_grp    uuid;
  v_work   uuid;
  v_draft  uuid;
  i        integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm1@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);

  for i in 1..2 loop
    insert into public.files (tenant_id, project_id, storage_key, name, mime, size_bytes)
    values (v_tenant, v_zk7, v_tenant || '/' || v_zk7 || '/demo-plan-' || i || '.pdf', 'План этажа ' || i || '.pdf', 'application/pdf', 1024)
    returning id into v_file;
    perform public.create_document(v_zk7, 'План этажа ' || i, 'АР-' || i, 'plan', null, 'internal', false, v_file, 'A', null,
                                   '{}'::uuid[], '{}'::uuid[], true);
  end loop;

  -- статьи и черновик ведёт экономист, утверждает руководитель проекта
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'economist@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);

  v_grp  := public.budget_upsert_item(v_zk7, null, null, 'С-1', 'Строительные работы');
  v_work := public.budget_upsert_item(v_zk7, null, v_grp, 'С-1.1', 'Монолитные работы', 'subcontract');
  v_draft := public.create_budget_draft(v_zk7);
  perform public.set_budget_amount(v_draft, v_work, 1000000);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.users where email = 'pm1@demo.test'), 'role', 'authenticated',
    'tenant_id', v_tenant, 'is_external', false)::text, true);
  perform public.approve_budget_version(v_draft, 'Исходный бюджет');
end $$;

-- Почтовый воркер (Edge Function send-emails) — только для локальной разработки.
-- Адрес — внутри сети Docker: БД обращается к шлюзу Supabase. Секрет совпадает с EMAIL_WORKER_SECRET в supabase/functions/.env.
insert into private.app_config (key, value) values
  ('email_worker_url',    'http://supabase_kong_buildos:8000/functions/v1/send-emails'),
  ('email_worker_secret', 'dev-worker-secret'),
  ('functions_apikey',    'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH')
on conflict (key) do update set value = excluded.value;

-- Воркер чтения документов (Edge Function extract-texts)
insert into private.app_config (key, value) values
  ('text_worker_url', 'http://supabase_kong_buildos:8000/functions/v1/extract-texts')
on conflict (key) do update set value = excluded.value;
