-- Доски: свой фон-фотография вместо цвета (как в Trello).
--
-- Бакет `board-backgrounds`, приватный, до 5 МБ: <tenant_id>/<board_id>/<uuid>.<ext>. Браузер перед загрузкой сжимает фото
-- до 2560 px по длинной стороне. Видят фото все, кто видит доску; загружают и удаляют — те, кто управляет доской
-- (владелец личной, `board.manage` для общей). Путь к фото — `boards.background_image`; цвет `background` остаётся
-- запасным (пока фото грузится, и на плитках, если фото убрали).
-- См. docs: 04-modules/28-boards.md.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-backgrounds', 'board-backgrounds', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy board_backgrounds_select on storage.objects for select to authenticated
  using (
    bucket_id = 'board-backgrounds'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and private.board_can_view(((storage.foldername(name))[2])::uuid)
  );
create policy board_backgrounds_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'board-backgrounds'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and private.board_can_manage(((storage.foldername(name))[2])::uuid)
  );
create policy board_backgrounds_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'board-backgrounds'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and private.board_can_manage(((storage.foldername(name))[2])::uuid)
  );

alter table public.boards add column background_image text check (background_image is null or char_length(background_image) <= 300);
grant update (background_image) on public.boards to authenticated;

-- Фото доски — только из её собственной папки и только уже загруженное
create or replace function private.boards_background_image_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.background_image is not null and new.background_image is distinct from old.background_image then
    if new.background_image !~ ('^' || new.tenant_id::text || '/' || new.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
      raise exception 'invalid_background_path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'board-backgrounds' and o.name = new.background_image) then
      raise exception 'file_not_found' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
create trigger boards_background_image_check before update of background_image on public.boards
  for each row execute function private.boards_background_image_check();
