-- Push о заметке с площадки (შენიშვნა): человек снимает место с телефона → всем, кто видит проект, приходит уведомление
-- «Новая заметка · код проекта», ниже этаж/помещение, автор и текст, а если есть фото — первое фото в самом уведомлении.
-- Заметка — это комментарий к месту (entity_type = 'location'), фото прикрепляются к нему ПОСЛЕ создания комментария,
-- поэтому триггер на insert не годится: сайт сам вызывает field_note_notify, когда всё загружено.
-- Рассылает та же Edge Function send-push (по comment_id вместо message_id), подписки — те же push_subscriptions.

-- Заметки, о которых уже разослан push: повторный вызов (двойной тап, повтор запроса) второго push не даёт
create table private.field_note_pushes (
  comment_id uuid primary key references public.comments(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.field_note_pushes from public, anon, authenticated;

-- Вызывает сайт после загрузки фото. Разослать можно только свою свежую заметку к месту.
create or replace function public.field_note_notify(p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := auth.uid();
  v_tenant uuid;
  v_new    integer;
  v_url    text;
  v_secret text;
  v_key    text;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select c.tenant_id into v_tenant
    from public.comments c
   where c.id = p_comment and c.author_id = v_me and c.entity_type = 'location'
     and c.deleted_at is null and c.created_at > now() - interval '30 minutes';
  if v_tenant is null then return; end if;

  insert into private.field_note_pushes (comment_id) values (p_comment) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return; end if;

  -- пока никто в организации не подписался на push, ничего не вызываем
  if not exists (select 1 from public.push_subscriptions s where s.tenant_id = v_tenant) then return; end if;
  select value into v_url    from private.app_config where key = 'push_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key    from private.app_config where key = 'functions_apikey';
  if v_url is null then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
      body := jsonb_build_object('comment_id', p_comment),
      timeout_milliseconds := 20000);
  exception when others then
    null;
  end;
end;
$$;

revoke execute on function public.field_note_notify(uuid) from public, anon;
grant  execute on function public.field_note_notify(uuid) to authenticated;

-- Подписки, на которые нужно отправить push о заметке: все, кто видит проект, кроме автора. Внутренняя заметка — только тем,
-- кто видит внутренние комментарии (подрядчики и заказчик её не увидят). Тихие часы и блокировка — как в чате. Вызывает только воркер.
create or replace function public.field_note_push_targets(p_comment uuid)
returns table (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text, locale text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.locale
    from public.comments c
    join public.push_subscriptions s on s.tenant_id = c.tenant_id and s.user_id <> c.author_id
    join public.users u on u.id = s.user_id and u.status <> 'blocked'
    left join public.user_notification_settings qs on qs.user_id = u.id
   where c.id = p_comment and c.entity_type = 'location' and c.deleted_at is null
     and private.user_can_see_project(u.id, c.project_id)
     and (c.visibility = 'external' or private.user_has_project_permission(u.id, c.project_id, 'comment.internal.view'))
     and not coalesce(qs.quiet_enabled and (
           case when qs.quiet_start <= qs.quiet_end
                then (now() at time zone qs.timezone)::time >= qs.quiet_start and (now() at time zone qs.timezone)::time < qs.quiet_end
                else (now() at time zone qs.timezone)::time >= qs.quiet_start or (now() at time zone qs.timezone)::time < qs.quiet_end
           end), false);
$$;

-- Что показать в уведомлении: проект, место («Корпус 2 › Этаж 5 › Комната 12»), автор, текст, число фото и ключ первого фото в Storage.
create or replace function public.field_note_push_info(p_comment uuid)
returns table (project_code text, location_path text, location_label text, author_name text, body_text text, photo_count integer, photo_key text)
language sql stable security definer set search_path = '' as $$
  select p.code,
         l.path::text,
         (with recursive chain as (
              select x.id, x.parent_id, x.kind, x.name, 0 as depth from public.locations x where x.id = c.entity_id
              union all
              select y.id, y.parent_id, y.kind, y.name, ch.depth + 1 from public.locations y join chain ch on y.id = ch.parent_id)
            select string_agg(name, ' › ' order by depth desc) from chain where kind <> 'site'),
         u.full_name,
         c.body_text,
         (select count(*)::int from public.attachments a join public.files f on f.id = a.file_id
           where a.comment_id = c.id and f.mime like 'image/%' and f.status = 'ready'),
         (select f.storage_key from public.attachments a join public.files f on f.id = a.file_id
           where a.comment_id = c.id and f.mime like 'image/%' and f.status = 'ready'
           order by a.created_at, a.id limit 1)
    from public.comments c
    join public.projects p on p.id = c.project_id
    join public.locations l on l.id = c.entity_id
    left join public.users u on u.id = c.author_id
   where c.id = p_comment and c.entity_type = 'location' and c.deleted_at is null;
$$;

revoke execute on function public.field_note_push_targets(uuid), public.field_note_push_info(uuid) from public, anon, authenticated;
grant  execute on function public.field_note_push_targets(uuid), public.field_note_push_info(uuid) to service_role;

notify pgrst, 'reload schema';
