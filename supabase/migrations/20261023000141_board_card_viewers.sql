-- Доски: видимость карточки выбирает её автор.
--
--  • `board_cards.visibility = 'all'` (по умолчанию) — карточку общей доски видят все, кто видит доску.
--  • `'selected'` — только автор, участники карточки и выбранные автором люди (`board_card_viewers`).
--    Остальные, в том числе управляющие доской (`board.manage`), такую карточку не видят вовсе — вместе с метками,
--    чек-листами, комментариями, вложениями и историей.
--
-- Менять видимость и список «кто видит» может только автор карточки. Скрытую карточку другим не «раскрыть» обходом:
-- в участники такой карточки (в том числе через @упоминание) человека, который её не видит, может добавить только автор.
-- На личной доске видимость не нужна: её видит только владелец.
-- Заменяет правило миграции 135 (там карточку общей доски видели только участники карточки, автор и board.manage).
-- См. docs: 04-modules/28-boards.md.

alter table public.board_cards add column visibility text not null default 'all' check (visibility in ('all', 'selected'));
grant insert (visibility), update (visibility) on public.board_cards to authenticated;

create table public.board_card_viewers (
  card_id   uuid not null,
  user_id   uuid not null references public.users(id) on delete cascade,
  board_id  uuid not null,
  tenant_id uuid not null default private.tenant_id() references public.tenants(id),
  primary key (card_id, user_id),
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_card_viewers (board_id);
create index on public.board_card_viewers (user_id);

-- Видит ли человек карточку (без проверки доступа к самой доске — её делает board_can_view / board_user_can_view)
create or replace function private.board_card_user_visible(p_board uuid, p_card uuid, p_created_by uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_created_by = p_user
      or exists (select 1 from public.boards b where b.id = p_board and b.kind = 'personal')
      or exists (select 1 from public.board_cards c where c.id = p_card and c.visibility = 'all')
      or exists (select 1 from public.board_card_members m where m.card_id = p_card and m.user_id = p_user)
      or exists (select 1 from public.board_card_viewers v where v.card_id = p_card and v.user_id = p_user);
$$;

-- Видимость меняет только автор
create or replace function private.board_cards_visibility_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility is distinct from old.visibility and auth.uid() is distinct from old.created_by then
    raise exception 'only_author_sets_visibility' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger board_cards_visibility_guard before update of visibility on public.board_cards
  for each row execute function private.board_cards_visibility_guard();

-- Выбранным может быть только тот, кто видит доску
create or replace function private.board_card_viewers_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.board_user_can_view(new.board_id, new.user_id) then
    raise exception 'user_cannot_view_board' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger board_card_viewers_check before insert on public.board_card_viewers
  for each row execute function private.board_card_viewers_check();

-- Участником карточки можно сделать только того, кто видит доску; в скрытую карточку постороннего зовёт только автор
create or replace function private.board_card_members_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if not private.board_user_can_view(new.board_id, new.user_id) then
    raise exception 'user_cannot_view_board' using errcode = 'P0001';
  end if;
  select id, visibility, created_by into c from public.board_cards where id = new.card_id;
  if c.visibility = 'selected' and auth.uid() is not null and auth.uid() is distinct from c.created_by
     and not private.board_card_user_visible(new.board_id, c.id, c.created_by, new.user_id) then
    raise exception 'card_hidden_from_user' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- @упоминание зовёт в карточку только тех, кому её можно показать
create or replace function private.board_mention_join(p_card uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  u uuid;
begin
  select id, board_id, tenant_id, created_by, visibility into c from public.board_cards where id = p_card;
  if not found then return; end if;
  -- скрытую карточку расширяет только её автор
  if c.visibility = 'selected' and auth.uid() is distinct from c.created_by then return; end if;
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

-- RLS: список «кто видит» читают те, кто видит карточку; меняет только автор
alter table public.board_card_viewers enable row level security;
alter table public.board_card_viewers force row level security;
create policy board_card_viewers_select on public.board_card_viewers for select to authenticated
  using (private.board_can_view(board_id) and private.board_card_visible(card_id));
create policy board_card_viewers_insert on public.board_card_viewers for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_can_view(board_id)
              and exists (select 1 from public.board_cards c where c.id = card_id and c.created_by = (select auth.uid())));
create policy board_card_viewers_delete on public.board_card_viewers for delete to authenticated
  using (private.board_can_view(board_id)
         and exists (select 1 from public.board_cards c where c.id = card_id and c.created_by = (select auth.uid())));
revoke all on public.board_card_viewers from anon, authenticated;
grant select, delete on public.board_card_viewers to authenticated;
grant insert (card_id, user_id, board_id) on public.board_card_viewers to authenticated;

-- История карточки: смена видимости
alter table public.board_activity drop constraint board_activity_kind_check;
alter table public.board_activity add constraint board_activity_kind_check
  check (kind in ('created', 'moved', 'archived', 'restored', 'due_done', 'due_undone', 'attached', 'visibility'));

create or replace function private.board_cards_visibility_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
  values (new.tenant_id, new.board_id, new.id, auth.uid(), 'visibility', jsonb_build_object('visibility', new.visibility));
  return null;
end;
$$;
create trigger board_cards_visibility_activity after update of visibility on public.board_cards
  for each row when (new.visibility is distinct from old.visibility) execute function private.board_cards_visibility_activity();

-- Копия карточки сохраняет её видимость и список «кто видит» (автор копии — тот, кто копирует)
create or replace function public.board_card_copy(p_card uuid, p_list uuid, p_title text, p_position double precision,
                                                  p_keep_checklists boolean default true, p_keep_labels boolean default true,
                                                  p_keep_members boolean default true)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  c public.board_cards;
  v_id uuid;
  cl record;
  v_cl uuid;
begin
  select * into c from public.board_cards where id = p_card;
  if not found then raise exception 'card_not_found' using errcode = 'P0001'; end if;

  insert into public.board_cards (board_id, list_id, title, description, position, start_date, due_at, due_done, cover, completed, visibility)
  values (c.board_id, p_list, coalesce(nullif(btrim(p_title), ''), c.title), c.description, p_position, c.start_date, c.due_at, c.due_done, c.cover, c.completed, c.visibility)
  returning id into v_id;

  if c.visibility = 'selected' then
    insert into public.board_card_viewers (card_id, user_id, board_id)
    select v_id, user_id, board_id from public.board_card_viewers where card_id = p_card and user_id is distinct from auth.uid();
    -- прежний автор тоже видит копию
    if c.created_by is not null and c.created_by is distinct from auth.uid() then
      insert into public.board_card_viewers (card_id, user_id, board_id) values (v_id, c.created_by, c.board_id) on conflict do nothing;
    end if;
  end if;
  if p_keep_labels then
    insert into public.board_card_labels (card_id, label_id, board_id)
    select v_id, label_id, board_id from public.board_card_labels where card_id = p_card;
  end if;
  if p_keep_members then
    insert into public.board_card_members (card_id, user_id, board_id)
    select v_id, user_id, board_id from public.board_card_members where card_id = p_card;
  end if;
  if p_keep_checklists then
    for cl in select * from public.board_checklists where card_id = p_card order by position loop
      insert into public.board_checklists (board_id, card_id, title, position) values (c.board_id, v_id, cl.title, cl.position)
      returning id into v_cl;
      insert into public.board_checklist_items (board_id, card_id, checklist_id, title, done, position)
      select c.board_id, v_id, v_cl, title, done, position from public.board_checklist_items where checklist_id = cl.id;
    end loop;
  end if;
  return v_id;
end;
$$;

alter publication supabase_realtime add table public.board_card_viewers;

notify pgrst, 'reload schema';
