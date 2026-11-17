-- Упоминание зовёт в карточку. Карточку общей доски видят только её участники, автор и board.manage (миграция 135),
-- поэтому «@Имя» участника доски, который этой карточки не видит, раньше не доходило. Теперь такой человек
-- становится участником карточки и получает уведомление об упоминании (одно, без отдельного «Вас добавили в карточку»).
-- Тот, кто не видит саму доску, по-прежнему ничего не получает и в карточку не добавляется.
-- См. docs: 04-modules/28-boards.md.

-- Упомянутых, кто видит доску, но не карточку, делаем участниками карточки
create or replace function private.board_mention_join(p_card uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  u uuid;
begin
  select id, board_id, tenant_id, created_by into c from public.board_cards where id = p_card;
  if not found then return; end if;
  foreach u in array coalesce(p_users, '{}') loop
    if private.board_user_can_view(c.board_id, u)
       and not private.board_card_user_visible(c.board_id, c.id, c.created_by, u) then
      perform set_config('buildos.board_quiet_join', 'on', true);
      insert into public.board_card_members (card_id, user_id, board_id, tenant_id)
      values (c.id, u, c.board_id, c.tenant_id)
      on conflict do nothing;
      perform set_config('buildos.board_quiet_join', '', true);
    end if;
  end loop;
end;
$$;
revoke execute on function private.board_mention_join(uuid, uuid[]) from public, anon, authenticated;

-- «Вас добавили в карточку» — кроме добавления через упоминание (там придёт само упоминание)
create or replace function private.board_card_members_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('buildos.board_quiet_join', true), '') = 'on' then return null; end if;
  perform private.notify(new.user_id, 'board_card', new.card_id, 'assigned', 'high', 'assigned',
                         'Вас добавили в карточку (' || private.board_actor_name() || ')');
  return null;
end;
$$;

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

  perform private.board_mention_join(new.card_id, v_ment);
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

create or replace function private.board_cards_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_who  text := private.board_actor_name();
  v_tz   text;
  v_text text;
  v_ment uuid[];
  r      record;
begin
  -- упоминания в описании (у новой карточки — все, при правке — только новые)
  select coalesce(array_agg(x), '{}') into v_ment
    from private.board_mentions(new.tenant_id, new.description) x
   where tg_op = 'INSERT' or x not in (select private.board_mentions(old.tenant_id, old.description));
  perform private.board_mention_join(new.id, v_ment);
  for r in select unnest(v_ment) as user_id loop
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
