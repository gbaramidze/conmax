-- Окно карточки как в Trello: вложения (свой файл или документ проекта) и отметка «карточка выполнена».
--
--  • `board_card_attachments` — вложение карточки: либо загруженный файл (`file_id`, общий бакет `files`, путь
--    <tenant>/<project>/<uuid>.<ext>), либо ссылка на документ из реестра документов проекта (`document_id`).
--    Видят те, кто видит карточку (участники, автор, board.manage); добавляет любой из них; удаляет автор вложения
--    или тот, кто управляет доской. Документ можно прикрепить только тот, который сам видишь, и только своего проекта;
--    открывается он по своим правам — кто документ не видит, увидит только название.
--  • Загруженный файл карточки видят все, кто видит вложение (условие добавлено в `files_select`).
--  • История карточки: «прикрепил(а) …».
--  • `board_cards.completed` — кружок «выполнено» у названия карточки.
-- См. docs: 04-modules/28-boards.md.

alter table public.board_cards add column completed boolean not null default false;
grant insert (completed), update (completed) on public.board_cards to authenticated;

create table public.board_card_attachments (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null default private.tenant_id() references public.tenants(id),
  board_id    uuid not null,
  card_id     uuid not null,
  file_id     uuid references public.files(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 300),
  created_by  uuid default auth.uid() references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((file_id is null) <> (document_id is null)),
  unique (card_id, document_id),
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_card_attachments (card_id, created_at);
create index on public.board_card_attachments (board_id);
create index on public.board_card_attachments (file_id) where file_id is not null;
create index on public.board_card_attachments (document_id) where document_id is not null;

-- Проверка и название: файл — свой и этого проекта; документ — этого проекта и видимый добавляющему.
-- Название берём из файла или документа (клиенту не доверяем).
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
    select f.name into v_name from public.files f
     where f.id = new.file_id and f.tenant_id = new.tenant_id and f.project_id = v_project and f.created_by = auth.uid();
    if v_name is null then raise exception 'file_not_allowed' using errcode = '42501'; end if;
  else
    select coalesce(nullif(d.code, '') || ' — ', '') || d.title into v_name from public.documents d
     where d.id = new.document_id and d.project_id = v_project and d.deleted_at is null
       and private.user_can_view_document(auth.uid(), d.id);
    if v_name is null then raise exception 'document_not_allowed' using errcode = '42501'; end if;
  end if;
  new.name := left(v_name, 300);
  return new;
end;
$$;
create trigger board_card_attachments_check before insert on public.board_card_attachments
  for each row execute function private.board_card_attachments_check();

-- История карточки
alter table public.board_activity drop constraint board_activity_kind_check;
alter table public.board_activity add constraint board_activity_kind_check
  check (kind in ('created', 'moved', 'archived', 'restored', 'due_done', 'due_undone', 'attached'));

create or replace function private.board_card_attachments_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
  values (new.tenant_id, new.board_id, new.card_id, auth.uid(), 'attached',
          jsonb_build_object('name', new.name, 'document', new.document_id is not null));
  return null;
end;
$$;
create trigger board_card_attachments_activity after insert on public.board_card_attachments
  for each row execute function private.board_card_attachments_activity();

-- RLS: как у остального содержимого карточки
alter table public.board_card_attachments enable row level security;
alter table public.board_card_attachments force row level security;

create policy board_card_attachments_select on public.board_card_attachments for select to authenticated
  using (private.board_can_view(board_id) and private.board_card_visible(card_id));
create policy board_card_attachments_insert on public.board_card_attachments for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_can_view(board_id) and private.board_card_visible(card_id));
create policy board_card_attachments_delete on public.board_card_attachments for delete to authenticated
  using (private.board_can_view(board_id) and private.board_card_visible(card_id)
         and (created_by = (select auth.uid()) or private.board_can_manage(board_id)));

revoke all on public.board_card_attachments from anon, authenticated;
grant select, delete on public.board_card_attachments to authenticated;
grant insert (board_id, card_id, file_id, document_id, name) on public.board_card_attachments to authenticated;

alter publication supabase_realtime add table public.board_card_attachments;

-- Файл вложения карточки видят все, кто видит само вложение (подзапрос идёт под RLS вложений)
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id or v.preview_file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), id)
         or exists (select 1 from public.projects p where p.cover_file_id = files.id and p.deleted_at is null and private.can_see_project(p.id))
         or exists (select 1 from public.entity_images i where i.file_id = files.id)
         or exists (select 1 from public.entity_image_versions v where v.file_id = files.id)
         or exists (select 1 from public.inspection_photos ph where ph.file_id = files.id)
         or exists (select 1 from public.inspection_reports r
                     where files.id in (r.scheme_file_id, r.client_sign_file_id, r.contractor_sign_file_id))
         or exists (select 1 from public.board_card_attachments ba where ba.file_id = files.id))
  );

-- Копия карточки переносит и её отметку «выполнено»
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

  insert into public.board_cards (board_id, list_id, title, description, position, start_date, due_at, due_done, cover, completed)
  values (c.board_id, p_list, coalesce(nullif(btrim(p_title), ''), c.title), c.description, p_position, c.start_date, c.due_at, c.due_done, c.cover, c.completed)
  returning id into v_id;

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

notify pgrst, 'reload schema';
