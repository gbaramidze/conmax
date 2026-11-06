-- Чат проекта: правка своего сообщения. Меняется только текст; у сообщения остаётся пометка «изменено».
-- Сообщение, состоящее только из вложений, можно подписать; текст нельзя стереть целиком, если нет вложений.
-- См. docs: 05-roadmap/05-backlog.md, раздел «17. Чат между сотрудниками».

alter table public.chat_messages add column edited_at timestamptz;

create or replace function public.chat_edit(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m      public.chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into m from public.chat_messages where id = p_message and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or m.author_id is distinct from auth.uid() or not private.chat_visible(m.channel_id) then
    raise exception 'permission denied: chat' using errcode = '42501';
  end if;
  if char_length(v_body) > 4000
     or (v_body = '' and not exists (select 1 from public.chat_attachments a where a.message_id = m.id)) then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if v_body is distinct from m.body then
    update public.chat_messages set body = v_body, edited_at = now() where id = m.id;
  end if;
end;
$$;

revoke execute on function public.chat_edit(uuid, text) from public, anon;
grant execute on function public.chat_edit(uuid, text) to authenticated;
notify pgrst, 'reload schema';
