-- Доски: на общей доске карточку видят не все участники доски, а только те, кого касается.
--
-- Видят карточку общей доски: её участники (`board_card_members`), её автор и те, кто управляет доской (`board.manage`
-- в проекте). Остальные участники доски видят колонки, но не эту карточку — пока их не добавят в участники карточки.
-- Вместе с карточкой скрыто всё её содержимое: метки, участники, чек-листы, комментарии, история.
-- На личной доске всё видит владелец, как и раньше.
-- См. docs: 04-modules/28-boards.md.

-- Видит ли человек карточку (без проверки доступа к самой доске — её делает board_can_view)
create or replace function private.board_card_user_visible(p_board uuid, p_card uuid, p_created_by uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_created_by = p_user
      or exists (select 1 from public.boards b
                  where b.id = p_board
                    and (b.kind = 'personal' or private.user_has_project_permission(p_user, b.project_id, 'board.manage')))
      or exists (select 1 from public.board_card_members m where m.card_id = p_card and m.user_id = p_user);
$$;

-- Видна ли карточка текущему пользователю (для строк внутри карточки)
create or replace function private.board_card_visible(p_card uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.board_cards c
     where c.id = p_card
       and private.board_can_view(c.board_id)
       and private.board_card_user_visible(c.board_id, c.id, c.created_by, auth.uid())
  );
$$;
grant execute on function private.board_card_user_visible(uuid, uuid, uuid, uuid), private.board_card_visible(uuid) to authenticated;

-- Карточки. Автор проверяется прямо по строке: при `insert … returning` функция ещё не видит новую карточку.
drop policy board_cards_member on public.board_cards;
create policy board_cards_select on public.board_cards for select to authenticated
  using (private.board_can_view(board_id)
         and (created_by = (select auth.uid()) or private.board_card_user_visible(board_id, id, created_by, (select auth.uid()))));
create policy board_cards_insert on public.board_cards for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_can_view(board_id));
create policy board_cards_update on public.board_cards for update to authenticated
  using (private.board_can_view(board_id)
         and (created_by = (select auth.uid()) or private.board_card_user_visible(board_id, id, created_by, (select auth.uid()))))
  with check (private.board_can_view(board_id));
create policy board_cards_delete on public.board_cards for delete to authenticated
  using (private.board_can_view(board_id)
         and (created_by = (select auth.uid()) or private.board_card_user_visible(board_id, id, created_by, (select auth.uid()))));

-- Всё внутри карточки — только тем, кто видит карточку
do $$
declare t text;
begin
  foreach t in array array['board_card_labels', 'board_card_members', 'board_checklists', 'board_checklist_items'] loop
    execute format('drop policy %I on public.%I', t || '_member', t);
    execute format('create policy %I on public.%I for all to authenticated using (private.board_can_view(board_id) and private.board_card_visible(card_id)) with check (tenant_id = (select private.tenant_id()) and private.board_can_view(board_id) and private.board_card_visible(card_id))', t || '_member', t);
  end loop;
end $$;

drop policy board_comments_select on public.board_comments;
drop policy board_comments_insert on public.board_comments;
drop policy board_comments_update on public.board_comments;
drop policy board_comments_delete on public.board_comments;
create policy board_comments_select on public.board_comments for select to authenticated
  using (private.board_can_view(board_id) and private.board_card_visible(card_id));
create policy board_comments_insert on public.board_comments for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and author_id = (select auth.uid())
              and private.board_can_view(board_id) and private.board_card_visible(card_id));
create policy board_comments_update on public.board_comments for update to authenticated
  using (author_id = (select auth.uid()) and private.board_can_view(board_id) and private.board_card_visible(card_id))
  with check (author_id = (select auth.uid()) and private.board_can_view(board_id) and private.board_card_visible(card_id));
create policy board_comments_delete on public.board_comments for delete to authenticated
  using (author_id = (select auth.uid()) and private.board_can_view(board_id) and private.board_card_visible(card_id));

drop policy board_activity_select on public.board_activity;
create policy board_activity_select on public.board_activity for select to authenticated
  using (private.board_can_view(board_id) and private.board_card_visible(card_id));
