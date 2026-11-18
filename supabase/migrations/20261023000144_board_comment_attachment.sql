-- Доски: комментарий к вложению. «Комментировать» в меню вложения привязывает комментарий к нему
-- (`board_comments.attachment_id`): над текстом комментария видно, о каком файле, документе или карточке речь,
-- и по плашке он открывается. Привязать можно только вложение этой же карточки; убрали вложение — ссылка снимается,
-- комментарий остаётся.
-- См. docs: 04-modules/28-boards.md.

alter table public.board_comments add column attachment_id uuid references public.board_card_attachments(id) on delete set null;
create index on public.board_comments (attachment_id) where attachment_id is not null;
grant insert (attachment_id) on public.board_comments to authenticated;

create or replace function private.board_comments_attachment_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.attachment_id is not null and not exists (
    select 1 from public.board_card_attachments a where a.id = new.attachment_id and a.card_id = new.card_id) then
    raise exception 'attachment_not_on_card' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger board_comments_attachment_check before insert on public.board_comments
  for each row execute function private.board_comments_attachment_check();

notify pgrst, 'reload schema';
