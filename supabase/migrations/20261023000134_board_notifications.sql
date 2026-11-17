-- Уведомления досок (Trello): упоминания, добавление в карточку и на доску, комментарии и изменения карточки.
--
-- Всё идёт через общий конвейер уведомлений (`private.notify` / `private.notify_direct`): колокольчик, push и письмо —
-- по настройкам получателя, на его языке; уведомления по одной карточке за 3 минуты группируются.
--  • @Имя Фамилия в комментарии или описании карточки → «упоминание» (категория mentioned) тому, кто видит доску;
--    при правке — только новым упомянутым;
--  • человека добавили участником карточки → «назначено» (assigned);
--  • человека добавили участником общей доски → «назначено» с переходом на доску;
--  • участники карточки узнают (категория «наблюдаю») о новых комментариях, переносе в другую колонку, сроке,
--    отметке «выполнено», архиве. Себе о своих действиях не уведомляем.
-- Ссылка ведёт прямо в карточку: /projects/<код>/boards?kind=…&board=…&card=….
-- См. docs: 04-modules/28-boards.md.

-- ---------------------------------------------------------------------------
-- Карточка как объект уведомлений
-- ---------------------------------------------------------------------------
insert into public.entity_types (code, module, features) values ('board_card', 'boards', '{}')
on conflict (code) do nothing;

create or replace function private.entity_project_id_any(p_type text, p_id uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case p_type
    when 'project'    then (select id from public.projects where id = p_id)
    when 'task'       then (select project_id from public.tasks where id = p_id)
    when 'location'   then (select project_id from public.locations where id = p_id)
    when 'document'   then (select project_id from public.documents where id = p_id)
    when 'meeting'    then (select project_id from public.meetings where id = p_id)
    when 'ffe_item'   then (select project_id from public.ffe_items where id = p_id)
    when 'signal'     then (select project_id from public.signals where id = p_id)
    when 'room_type'  then (select project_id from public.room_types where id = p_id)
    when 'field_note' then (select project_id from public.field_notes where comment_id = p_id)
    when 'board_card' then (select b.project_id from public.board_cards c join public.boards b on b.id = c.board_id where c.id = p_id)
  end;
$function$;

create or replace function private.user_can_view_entity(p_user uuid, p_type text, p_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case p_type
    when 'project' then private.user_can_see_project(p_user, p_id)
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and private.user_task_visible(p_user, t.project_id, t.assignee_id, t.reporter_id, t.organization_id, t.visibility))
    when 'location' then exists (
      select 1 from public.locations l
      where l.id = p_id and private.user_can_see_project(p_user, l.project_id))
    when 'document' then private.user_can_view_document(p_user, p_id)
    when 'meeting' then private.user_can_view_meeting(p_user, p_id)
    when 'signal' then exists (
      select 1 from public.signals s
      where s.id = p_id and private.user_can_see_project(p_user, s.project_id)
        and private.user_has_project_permission(p_user, s.project_id, 'signal.view')
        and private.user_has_project_permission(p_user, s.project_id, 'comment.internal.view'))
    when 'field_note' then exists (
      select 1 from public.field_notes f join public.comments c on c.id = f.comment_id
      where f.comment_id = p_id and c.deleted_at is null
        and private.user_can_see_project(p_user, f.project_id)
        and (c.visibility = 'external' or private.user_has_project_permission(p_user, f.project_id, 'comment.internal.view')))
    when 'board_card' then exists (
      select 1 from public.board_cards c
      where c.id = p_id and private.board_user_can_view(c.board_id, p_user))
    else false
  end;
$function$;

create or replace function private.entity_display(p_type text, p_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case p_type
    when 'task' then (
      select jsonb_build_object('key', t.key, 'title', t.title, 'project_code', p.code)
        from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_id)
    when 'project' then (
      select jsonb_build_object('key', p.code, 'title', p.name, 'project_code', p.code)
        from public.projects p where p.id = p_id)
    when 'location' then (
      select jsonb_build_object('key', l.path::text, 'title', l.name, 'project_code', p.code)
        from public.locations l join public.projects p on p.id = l.project_id where l.id = p_id)
    when 'document' then (
      select jsonb_build_object('key', coalesce(d.code, 'Документ'), 'title', d.title, 'project_code', p.code)
        from public.documents d join public.projects p on p.id = d.project_id where d.id = p_id)
    when 'meeting' then (
      select jsonb_build_object('key', m.key, 'title', m.title, 'project_code', p.code)
        from public.meetings m join public.projects p on p.id = m.project_id where m.id = p_id)
    when 'signal' then (
      select jsonb_build_object('key', 'Сигнал', 'title', s.title, 'project_code', p.code)
        from public.signals s join public.projects p on p.id = s.project_id where s.id = p_id)
    when 'field_note' then (
      select jsonb_build_object('key', 'Заметка', 'title', coalesce(nullif(left(c.body_text, 60), ''), l.name), 'project_code', p.code)
        from public.field_notes f
        join public.comments c on c.id = f.comment_id
        join public.locations l on l.id = f.location_id
        join public.projects p on p.id = f.project_id
       where f.comment_id = p_id)
    when 'board_card' then (
      select jsonb_build_object('key', 'Карточка', 'title', c.title, 'project_code', p.code, 'board_title', b.title,
                                'link', '/projects/' || p.code || '/boards?kind=' || b.kind || '&board=' || b.id || '&card=' || c.id)
        from public.board_cards c
        join public.boards b on b.id = c.board_id
        join public.projects p on p.id = b.project_id
       where c.id = p_id)
  end;
$function$;

-- Общая функция уведомления: без изменений, кроме одного — ссылка объекта (если она есть в entity_display) попадает в payload.link,
-- откуда её берут колокольчик, push и письмо.
create or replace function private.notify(p_user uuid, p_entity_type text, p_entity_id uuid, p_category text, p_priority text, p_event text, p_text text, p_internal_only boolean default false, p_comment uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor    uuid := auth.uid();
  v_project  uuid;
  v_tenant   uuid;
  v_display  jsonb;
  v_pref     text;
  v_group    text := p_entity_type || ':' || p_entity_id;
  v_existing public.notifications;
  v_counts   jsonb;
  v_actor_name text;
begin
  if p_user is null or p_user = v_actor then return; end if;              -- себе не уведомляем

  v_project := private.entity_project_id_any(p_entity_type, p_entity_id);
  if v_project is null then return; end if;
  select tenant_id into v_tenant from public.projects where id = v_project;

  if not exists (select 1 from public.users u where u.id = p_user and u.tenant_id = v_tenant and u.status <> 'blocked') then
    return;
  end if;
  -- фильтр прав: видит ли получатель объект (и внутренние данные, если событие внутреннее)
  if not private.user_can_view_entity(p_user, p_entity_type, p_entity_id) then return; end if;
  if p_internal_only and not private.user_has_project_permission(p_user, v_project, 'comment.internal.view') then return; end if;

  -- настройки получателя: «выкл» уважаем, кроме критичных
  select mode into v_pref from public.notification_preferences
   where user_id = p_user and category = p_category and channel = 'in_app';
  if v_pref = 'off' and p_priority <> 'critical' then return; end if;

  v_display := private.entity_display(p_entity_type, p_entity_id);
  select full_name into v_actor_name from public.users where id = v_actor;

  -- группировка: непрочитанное по тому же объекту за последние 3 минуты дополняем, а не дублируем
  select * into v_existing from public.notifications n
   where n.user_id = p_user and n.group_key = v_group and n.read_at is null and n.archived_at is null
     and n.updated_at > now() - interval '3 minutes'
   order by n.updated_at desc limit 1
   for update;

  if found then
    v_counts := jsonb_set(coalesce(v_existing.payload -> 'counts', '{}'),
                          array[p_event], to_jsonb(coalesce((v_existing.payload -> 'counts' ->> p_event)::integer, 0) + 1));
    update public.notifications set
      priority = private.max_priority(v_existing.priority, p_priority),
      category = case when array_position(array['watching','assigned','mentioned'], p_category)
                         > array_position(array['watching','assigned','mentioned'], v_existing.category)
                      then p_category else v_existing.category end,
      body     = private.notification_body(v_counts, p_text),
      payload  = v_existing.payload || jsonb_build_object('counts', v_counts, 'last_text', p_text)
                 || case when p_comment is not null then jsonb_build_object('comment_id', p_comment) else '{}'::jsonb end,
      updated_at = now()
    where id = v_existing.id;
  else
    insert into public.notifications (tenant_id, user_id, project_id, event_type, entity_type, entity_id, actor_id,
                                      priority, category, title, body, group_key, payload)
    values (v_tenant, p_user, v_project, p_entity_type || '.' || p_event, p_entity_type, p_entity_id, v_actor,
            p_priority, p_category,
            (v_display ->> 'key') || ' «' || (v_display ->> 'title') || '»',
            p_text, v_group,
            jsonb_build_object('entity_key', v_display ->> 'key', 'entity_title', v_display ->> 'title',
                               'project_code', v_display ->> 'project_code', 'actor_name', v_actor_name,
                               'counts', jsonb_build_object(p_event, 1), 'last_text', p_text)
                 || case when p_comment is not null then jsonb_build_object('comment_id', p_comment) else '{}'::jsonb end
                 || case when v_display ? 'link' then jsonb_build_object('link', v_display ->> 'link') else '{}'::jsonb end);
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Упоминания: «@Имя Фамилия» в тексте (как его вставляет подсказка в карточке)
-- ---------------------------------------------------------------------------
-- Люди компании, чьё полное имя стоит в тексте после «@» и не продолжается буквой («@Иван Петров» не задевает «Иван Петровский»).
-- Видит ли упомянутый доску — проверяет уже `private.notify`.
create or replace function private.board_mentions(p_tenant uuid, p_text text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select u.id
    from public.users u
   where p_text like '%@%'
     and u.tenant_id = p_tenant and u.deleted_at is null and u.status <> 'blocked'
     and btrim(u.full_name) <> ''
     and strpos(p_text, '@' || u.full_name) > 0
     and p_text ~ ('@' || regexp_replace(u.full_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^[:alnum:]_])');
$$;
revoke execute on function private.board_mentions(uuid, text) from public, anon, authenticated;

create or replace function private.board_actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select full_name from public.users where id = auth.uid()), 'BuildOS');
$$;
revoke execute on function private.board_actor_name() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Комментарий к карточке: упомянутым — «упоминание», остальным участникам карточки — «новый комментарий»
-- ---------------------------------------------------------------------------
create or replace function private.board_comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_author  text := coalesce((select full_name from public.users where id = new.author_id), 'BuildOS');
  v_snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 140);
  v_ment    uuid[];
  r         record;
begin
  if tg_op = 'UPDATE' then
    -- правка: только тем, кого упомянули впервые
    select coalesce(array_agg(x), '{}') into v_ment
      from private.board_mentions(new.tenant_id, new.body) x
     where x not in (select private.board_mentions(old.tenant_id, old.body));
  else
    select coalesce(array_agg(x), '{}') into v_ment from private.board_mentions(new.tenant_id, new.body) x;
  end if;

  for r in select unnest(v_ment) as user_id loop
    perform private.notify(r.user_id, 'board_card', new.card_id, 'mentioned', 'high', 'mentioned',
                           'Упоминание от ' || v_author || ': «' || v_snippet || '»');
  end loop;

  if tg_op = 'INSERT' then
    for r in select m.user_id from public.board_card_members m
              where m.card_id = new.card_id and m.user_id is distinct from new.author_id and m.user_id <> all (v_ment) loop
      perform private.notify(r.user_id, 'board_card', new.card_id, 'watching', 'low', 'commented',
                             v_author || ': «' || v_snippet || '»');
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function private.board_comments_notify() from public, anon, authenticated;

create trigger board_comments_notify after insert or update of body on public.board_comments
  for each row execute function private.board_comments_notify();

-- ---------------------------------------------------------------------------
-- Участник карточки: «Вас добавили в карточку»
-- ---------------------------------------------------------------------------
create or replace function private.board_card_members_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.user_id, 'board_card', new.card_id, 'assigned', 'high', 'assigned',
                         'Вас добавили в карточку (' || private.board_actor_name() || ')');
  return null;
end;
$$;
revoke execute on function private.board_card_members_notify() from public, anon, authenticated;

create trigger board_card_members_notify after insert on public.board_card_members
  for each row execute function private.board_card_members_notify();

-- ---------------------------------------------------------------------------
-- Карточка: упоминания в описании; участникам — перенос, срок, «выполнено», архив
-- ---------------------------------------------------------------------------
create or replace function private.board_cards_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_who  text := private.board_actor_name();
  v_tz   text;
  v_text text;
  r      record;
begin
  -- упоминания в описании (у новой карточки — все, при правке — только новые)
  for r in
    select x as user_id from private.board_mentions(new.tenant_id, new.description) x
     where tg_op = 'INSERT' or x not in (select private.board_mentions(old.tenant_id, old.description))
  loop
    perform private.notify(r.user_id, 'board_card', new.id, 'mentioned', 'high', 'mentioned',
                           'Упоминание от ' || v_who || ': «' || left(regexp_replace(btrim(new.description), '\s+', ' ', 'g'), 140) || '»');
  end loop;

  if tg_op = 'INSERT' then return null; end if;

  if new.list_id is distinct from old.list_id then
    v_text := 'Карточка перемещена: «' || coalesce((select l.title from public.board_lists l where l.id = old.list_id), '—')
              || '» → «' || coalesce((select l.title from public.board_lists l where l.id = new.list_id), '—') || '» (' || v_who || ')';
    for r in select m.user_id from public.board_card_members m where m.card_id = new.id loop
      perform private.notify(r.user_id, 'board_card', new.id, 'watching', 'normal', 'changed', v_text);
    end loop;
  end if;

  if new.due_at is distinct from old.due_at then
    select coalesce(p.timezone, 'Asia/Tbilisi') into v_tz
      from public.boards b join public.projects p on p.id = b.project_id where b.id = new.board_id;
    v_text := 'Срок: ' || coalesce(to_char(old.due_at at time zone v_tz, 'DD.MM.YYYY HH24:MI'), '—')
              || ' → ' || coalesce(to_char(new.due_at at time zone v_tz, 'DD.MM.YYYY HH24:MI'), '—') || ' (' || v_who || ')';
    for r in select m.user_id from public.board_card_members m where m.card_id = new.id loop
      perform private.notify(r.user_id, 'board_card', new.id, 'watching', 'normal', 'due_changed', v_text);
    end loop;
  end if;

  if new.due_done and not old.due_done then
    for r in select m.user_id from public.board_card_members m where m.card_id = new.id loop
      perform private.notify(r.user_id, 'board_card', new.id, 'watching', 'normal', 'changed',
                             'Срок отмечен выполненным (' || v_who || ')');
    end loop;
  end if;

  if (new.archived_at is null) <> (old.archived_at is null) then
    v_text := case when new.archived_at is null then 'Карточка возвращена из архива (' else 'Карточка перенесена в архив (' end || v_who || ')';
    for r in select m.user_id from public.board_card_members m where m.card_id = new.id loop
      perform private.notify(r.user_id, 'board_card', new.id, 'watching', 'low', 'changed', v_text);
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function private.board_cards_notify() from public, anon, authenticated;

create trigger board_cards_notify after insert or update of list_id, due_at, due_done, archived_at, description on public.board_cards
  for each row execute function private.board_cards_notify();

-- ---------------------------------------------------------------------------
-- Участник общей доски: «Вас добавили на доску» со ссылкой на доску
-- ---------------------------------------------------------------------------
create or replace function private.board_members_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b record;
begin
  select bo.id, bo.title, bo.kind, bo.project_id, p.code into b
    from public.boards bo join public.projects p on p.id = bo.project_id where bo.id = new.board_id;
  if not found then return null; end if;
  perform private.notify_direct(new.user_id, b.project_id, 'assigned', 'normal', 'board.member_added', 'project', b.project_id,
                                'Доска «' || b.title || '»', 'Вас добавили на доску (' || private.board_actor_name() || ')',
                                '/projects/' || b.code || '/boards?kind=' || b.kind || '&board=' || b.id);
  return null;
end;
$$;
revoke execute on function private.board_members_notify() from public, anon, authenticated;

create trigger board_members_notify after insert on public.board_members
  for each row execute function private.board_members_notify();
