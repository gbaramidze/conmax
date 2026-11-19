-- Доски: строгая видимость общей доски и «гости» карточек.
--
-- Участник общей доски (видит все её колонки и открытые карточки) — только:
--  • её создатель;
--  • явно добавленные участники (`board_members`);
--  • все внутренние сотрудники проекта, если включено «Весь проект» (`all_staff`).
-- Право `board.manage` само по себе доску больше не открывает: руководитель проекта, ГИП, администратор видят общую доску,
-- только если они её создали, их добавили или включено «Весь проект». Управляет доской участник с правом `board.manage`.
--
-- Гость — человек проекта, которого добавили в карточку, но не в доску. Он видит доску, но только колонки, где есть
-- карточки с его участием, и только эти карточки (со всем их содержимым). Создавать карточки, метки и колонки гость не может.
-- Позвать гостя в карточку может только участник доски — интерфейс перед этим предупреждает, что доска станет видна.
-- Удалили из всех карточек — доска пропадает.
-- Заменяет правила миграций 132, 135, 138, 141 (видимость доски, карточки, проверки участников карточки).
-- См. docs: 04-modules/28-boards.md.

-- ---------------------------------------------------------------------------
-- Участник доски (полный доступ). В фоновом задании нет пользователя в сессии — компанию берём у человека (как в 138).
-- ---------------------------------------------------------------------------
create or replace function private.board_user_member(p_board uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.boards b
      join public.users u on u.id = p_user and u.tenant_id = b.tenant_id and u.deleted_at is null and u.status <> 'blocked'
     where b.id = p_board
       and b.tenant_id = coalesce(private.tenant_id(), case when auth.uid() is null then u.tenant_id end)
       and private.user_can_see_project(p_user, b.project_id)
       and (
         (b.kind = 'personal' and b.owner_id = p_user)
         or (b.kind = 'shared' and (
               b.created_by = p_user
               or (b.all_staff and not u.is_external)
               or exists (select 1 from public.board_members m where m.board_id = b.id and m.user_id = p_user)
             ))
       )
  );
$$;

-- Видит ли человек доску вообще: участник или гость (участник хотя бы одной карточки общей доски)
create or replace function private.board_user_can_view(p_board uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.board_user_member(p_board, p_user)
      or exists (
        select 1
          from public.boards b
          join public.users u on u.id = p_user and u.tenant_id = b.tenant_id and u.deleted_at is null and u.status <> 'blocked'
         where b.id = p_board
           and b.kind = 'shared'
           and b.tenant_id = coalesce(private.tenant_id(), case when auth.uid() is null then u.tenant_id end)
           and private.user_can_see_project(p_user, b.project_id)
           and exists (select 1 from public.board_card_members cm where cm.board_id = b.id and cm.user_id = p_user)
      );
$$;

-- Может ли человек менять устройство доски: только участник доски с правом board.manage (личную — владелец)
create or replace function private.board_can_manage(p_board uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
     where b.id = p_board
       and b.tenant_id = private.tenant_id()
       and private.board_user_member(b.id, auth.uid())
       and (b.kind = 'personal' or private.has_project_permission(b.project_id, 'board.manage'))
  );
$$;

-- Видит ли человек карточку (доступ к самой доске проверяет board_can_view / board_user_can_view).
-- Гость видит только карточки, где он участник; участник доски — как раньше (открытые, свои, выбран автором).
create or replace function private.board_card_user_visible(p_board uuid, p_card uuid, p_created_by uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boards b where b.id = p_board and b.kind = 'personal')
      or exists (select 1 from public.board_card_members m where m.card_id = p_card and m.user_id = p_user)
      or (private.board_user_member(p_board, p_user)
          and (p_created_by = p_user
               or exists (select 1 from public.board_cards c where c.id = p_card and c.visibility = 'all')
               or exists (select 1 from public.board_card_viewers v where v.card_id = p_card and v.user_id = p_user)));
$$;

-- Видна ли колонка текущему пользователю: участнику доски — все, гостю — где есть карточки с его участием
create or replace function private.board_list_visible(p_board uuid, p_list uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.board_user_member(p_board, auth.uid())
      or (private.board_user_can_view(p_board, auth.uid())
          and exists (select 1 from public.board_cards c
                        join public.board_card_members m on m.card_id = c.id and m.user_id = auth.uid()
                       where c.list_id = p_list and c.board_id = p_board));
$$;

-- Общая доска в списке досок (по столбцам строки: при insert … returning функции ещё не видят новую доску)
create or replace function private.board_shared_visible(p_board uuid, p_project uuid, p_all_staff boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_all_staff and not coalesce((select u.is_external from public.users u where u.id = auth.uid()), true))
      or exists (select 1 from public.board_members m where m.board_id = p_board and m.user_id = auth.uid())
      or exists (select 1 from public.board_card_members cm where cm.board_id = p_board and cm.user_id = auth.uid());
$$;

grant execute on function private.board_user_member(uuid, uuid), private.board_list_visible(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.can_see_project(project_id)
         and ((kind = 'personal' and owner_id = (select auth.uid()))
              or (kind = 'shared' and (created_by = (select auth.uid()) or private.board_shared_visible(id, project_id, all_staff)))));

-- Колонки: участник доски — все, гость — только свои
drop policy board_lists_select on public.board_lists;
create policy board_lists_select on public.board_lists for select to authenticated
  using (private.board_list_visible(board_id, id));

-- Метки доски: читают все, кто видит доску (нужны для карточек гостя), меняют только участники доски
drop policy board_labels_member on public.board_labels;
create policy board_labels_select on public.board_labels for select to authenticated
  using (private.board_can_view(board_id));
create policy board_labels_insert on public.board_labels for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_user_member(board_id, (select auth.uid())));
create policy board_labels_update on public.board_labels for update to authenticated
  using (private.board_user_member(board_id, (select auth.uid())))
  with check (private.board_user_member(board_id, (select auth.uid())));
create policy board_labels_delete on public.board_labels for delete to authenticated
  using (private.board_user_member(board_id, (select auth.uid())));

-- Карточки. Своя только что созданная карточка проверяется по строке (при insert … returning функция её ещё не видит),
-- но лишь для участника доски. Создавать карточки может только участник доски.
drop policy board_cards_select on public.board_cards;
drop policy board_cards_insert on public.board_cards;
drop policy board_cards_update on public.board_cards;
drop policy board_cards_delete on public.board_cards;
create policy board_cards_select on public.board_cards for select to authenticated
  using (private.board_can_view(board_id)
         and ((created_by = (select auth.uid()) and private.board_user_member(board_id, (select auth.uid())))
              or private.board_card_user_visible(board_id, id, created_by, (select auth.uid()))));
create policy board_cards_insert on public.board_cards for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_user_member(board_id, (select auth.uid())));
create policy board_cards_update on public.board_cards for update to authenticated
  using (private.board_can_view(board_id) and private.board_card_user_visible(board_id, id, created_by, (select auth.uid())))
  with check (private.board_can_view(board_id));
create policy board_cards_delete on public.board_cards for delete to authenticated
  using (private.board_can_view(board_id) and private.board_card_user_visible(board_id, id, created_by, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Участник карточки: человек проекта. Если он не участник доски, он станет гостем — звать гостей может только
-- участник доски. В скрытую карточку постороннего зовёт только автор (как в 141).
-- ---------------------------------------------------------------------------
create or replace function private.board_card_members_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  c record;
begin
  select id, kind, project_id into b from public.boards where id = new.board_id and tenant_id = new.tenant_id;
  if not found
     or not exists (select 1 from public.users u
                     where u.id = new.user_id and u.tenant_id = new.tenant_id and u.deleted_at is null and u.status <> 'blocked')
     or not private.user_can_see_project(new.user_id, b.project_id)
     or (b.kind = 'personal' and not private.board_user_member(b.id, new.user_id)) then
    raise exception 'user_cannot_view_board' using errcode = 'P0001';
  end if;
  if not private.board_user_member(b.id, new.user_id) and auth.uid() is not null
     and not private.board_user_member(b.id, auth.uid()) then
    raise exception 'only_board_member_invites_guests' using errcode = 'P0001';
  end if;
  select id, visibility, created_by into c from public.board_cards where id = new.card_id;
  if c.visibility = 'selected' and auth.uid() is not null and auth.uid() is distinct from c.created_by
     and not private.board_card_user_visible(new.board_id, c.id, c.created_by, new.user_id) then
    raise exception 'card_hidden_from_user' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- «Кто видит» скрытую карточку выбирают только из участников доски
create or replace function private.board_card_viewers_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.board_user_member(new.board_id, new.user_id) then
    raise exception 'user_cannot_view_board' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- @упоминание зовёт в карточку только участников доски: гостем человека делают явно, с предупреждением
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
    if private.board_user_member(c.board_id, u)
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
