-- Уведомления досок с учётом видимости карточки (миграция 135): карточку общей доски видят её участники, автор
-- и держатели board.manage. Упоминание в комментарии или описании не уходит тому, кто видит доску, но не эту карточку —
-- иначе название карточки попало бы к нему в уведомление.
-- См. docs: 04-modules/28-boards.md.

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
      where c.id = p_id and private.board_user_can_view(c.board_id, p_user)
        and private.board_card_user_visible(c.board_id, c.id, c.created_by, p_user))
    else false
  end;
$function$;
