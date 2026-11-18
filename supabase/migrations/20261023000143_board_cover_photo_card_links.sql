-- Доски: фото-обложка карточки, вложение «другая карточка», переименование вложений.
--
--  • `board_cards.cover_attachment_id` — обложка-фото: картинка из вложений этой карточки. Первое загруженное фото
--    становится обложкой само (если фото-обложки ещё нет). Обложка — либо цвет (`cover`), либо фото: выбор одного
--    снимает другое. Убрали вложение — обложка-фото снимается сама (on delete set null).
--  • `board_card_attachments.linked_card_id` — вложение-ссылка на другую карточку проекта (любой доски). Прикрепить
--    можно только карточку, которую видишь сам. Название ссылки не хранится (`name` = «Карточка»): заголовок
--    показывается из самой карточки по правам смотрящего, поэтому тот, кто связанную карточку не видит, видит только
--    «нет доступа», а не её название. В истории — «прикреплена карточка» без названия.
--  • Название вложения-файла можно изменить (автор вложения или тот, кто управляет доской).
-- См. docs: 04-modules/28-boards.md.

-- ---------------------------------------------------------------------------
-- Вложение-карточка
-- ---------------------------------------------------------------------------
alter table public.board_card_attachments add column linked_card_id uuid references public.board_cards(id) on delete cascade;
alter table public.board_card_attachments drop constraint board_card_attachments_check;
alter table public.board_card_attachments add constraint board_card_attachments_one_source
  check (num_nonnulls(file_id, document_id, linked_card_id) = 1);
alter table public.board_card_attachments add constraint board_card_attachments_card_link_unique unique (card_id, linked_card_id);
alter table public.board_card_attachments add constraint board_card_attachments_not_self check (linked_card_id is distinct from card_id);
create index on public.board_card_attachments (linked_card_id) where linked_card_id is not null;
grant insert (linked_card_id) on public.board_card_attachments to authenticated;

create or replace function private.board_card_attachments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_name    text;
begin
  select b.project_id into v_project from public.boards b where b.id = new.board_id and b.tenant_id = new.tenant_id;
  if v_project is null then raise exception 'board_not_found' using errcode = 'P0001'; end if;
  new.created_by := auth.uid();
  if new.file_id is not null then
    -- любой файл этого проекта (видимость файла добавляющему проверяет политика вставки, миграция 140)
    select f.name into v_name from public.files f
     where f.id = new.file_id and f.tenant_id = new.tenant_id and f.project_id = v_project;
    if v_name is null then raise exception 'file_not_allowed' using errcode = '42501'; end if;
  elsif new.document_id is not null then
    select coalesce(nullif(d.code, '') || ' — ', '') || d.title into v_name from public.documents d
     where d.id = new.document_id and d.project_id = v_project and d.deleted_at is null
       and private.user_can_view_document(auth.uid(), d.id);
    if v_name is null then raise exception 'document_not_allowed' using errcode = '42501'; end if;
  else
    -- карточка того же проекта, которую добавляющий видит сам
    if not exists (
      select 1 from public.board_cards c join public.boards b on b.id = c.board_id
       where c.id = new.linked_card_id and b.tenant_id = new.tenant_id and b.project_id = v_project
         and private.board_user_can_view(c.board_id, auth.uid())
         and private.board_card_user_visible(c.board_id, c.id, c.created_by, auth.uid())
    ) then
      raise exception 'card_not_allowed' using errcode = '42501';
    end if;
    v_name := 'Карточка';
  end if;
  new.name := left(v_name, 300);
  return new;
end;
$$;

-- История: у ссылки на карточку — без названия (его видят не все)
create or replace function private.board_card_attachments_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
  values (new.tenant_id, new.board_id, new.card_id, auth.uid(), 'attached',
          case when new.linked_card_id is not null then jsonb_build_object('card', true)
               else jsonb_build_object('name', new.name, 'document', new.document_id is not null) end);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Переименование вложения-файла
-- ---------------------------------------------------------------------------
create or replace function private.board_card_attachments_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.file_id is null then raise exception 'rename_files_only' using errcode = 'P0001'; end if;
  new.name := left(btrim(new.name), 300);
  return new;
end;
$$;
create trigger board_card_attachments_rename before update of name on public.board_card_attachments
  for each row when (new.name is distinct from old.name) execute function private.board_card_attachments_rename();

create policy board_card_attachments_update on public.board_card_attachments for update to authenticated
  using (private.board_can_view(board_id) and private.board_card_visible(card_id)
         and (created_by = (select auth.uid()) or private.board_can_manage(board_id)))
  with check (private.board_can_view(board_id) and private.board_card_visible(card_id));
grant update (name) on public.board_card_attachments to authenticated;

-- ---------------------------------------------------------------------------
-- Фото-обложка
-- ---------------------------------------------------------------------------
alter table public.board_cards add column cover_attachment_id uuid references public.board_card_attachments(id) on delete set null;
grant update (cover_attachment_id) on public.board_cards to authenticated;

-- Обложка — картинка из вложений этой же карточки; цвет и фото взаимоисключают друг друга
create or replace function private.board_cards_cover_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cover_attachment_id is not null and new.cover_attachment_id is distinct from old.cover_attachment_id then
    if not exists (select 1 from public.board_card_attachments a join public.files f on f.id = a.file_id
                    where a.id = new.cover_attachment_id and a.card_id = new.id and f.mime like 'image/%') then
      raise exception 'cover_not_image' using errcode = 'P0001';
    end if;
    new.cover := null;
  elsif new.cover is not null and new.cover is distinct from old.cover then
    new.cover_attachment_id := null;
  end if;
  return new;
end;
$$;
create trigger board_cards_cover_check before update of cover, cover_attachment_id on public.board_cards
  for each row execute function private.board_cards_cover_check();

-- Первое фото карточки становится обложкой само
create or replace function private.board_card_attachments_auto_cover() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.file_id is null or not exists (select 1 from public.files f where f.id = new.file_id and f.mime like 'image/%') then
    return null;
  end if;
  update public.board_cards c set cover_attachment_id = new.id
   where c.id = new.card_id and c.cover_attachment_id is null
     and not exists (select 1 from public.board_card_attachments a join public.files f on f.id = a.file_id
                      where a.card_id = new.card_id and a.id <> new.id and f.mime like 'image/%');
  return null;
end;
$$;
create trigger board_card_attachments_auto_cover after insert on public.board_card_attachments
  for each row execute function private.board_card_attachments_auto_cover();

notify pgrst, 'reload schema';
