-- Доски проекта (канбан в духе Trello): колонки, карточки, метки, участники, сроки, чек-листы, комментарии, архив.
--
-- Каждая доска принадлежит проекту и видна только тем, кто видит проект. Два вида досок:
--  • личная (`personal`) — видит и правит только владелец; колонки задаёт он сам. Ни руководитель, ни администратор её не видят;
--  • общая (`shared`) — создаёт и настраивает человек с правом проекта `board.manage` (руководитель проекта, ГИП; на уровне
--    компании — администратор и директор): он задаёт колонки, участников и оформление. Участники доски работают с карточками:
--    создают, двигают между колонками, правят, комментируют. Участники — отмеченные люди проекта и, если включено
--    «весь проект» (`all_staff`), все внутренние сотрудники, которые видят проект (внешних — только если добавить явно).
-- Порядок колонок и карточек — дробная позиция (`position`): перенос карточки меняет одну строку, соседей не трогает.
-- История карточки (создана, перенесена, в архиве, срок выполнен) пишется триггерами в `board_activity`.
-- См. docs: 04-modules/28-boards.md.

-- ---------------------------------------------------------------------------
-- Право (каталог, затем роли; см. roles_admin)
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, sort, label, tenant_only, external_ok) values
  ('board.manage', 'Задачи', 310, 'Создавать общие доски проекта и настраивать их колонки', false, false)
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'board.manage'
  from public.roles r
 where r.is_system and r.deleted_at is null
   and ((r.scope = 'project' and r.code in ('project_manager', 'chief_engineer'))
        or (r.scope = 'tenant' and r.code in ('tenant_admin', 'director')))
on conflict do nothing;

create or replace function private.roles_boards_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_system and ((new.scope = 'project' and new.code in ('project_manager', 'chief_engineer'))
                        or (new.scope = 'tenant' and new.code in ('tenant_admin', 'director'))) then
    insert into public.role_permissions (tenant_id, role_id, permission)
    values (new.tenant_id, new.id, 'board.manage')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger roles_boards_defaults after insert on public.roles for each row execute function private.roles_boards_defaults();

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------
create table public.boards (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null default private.tenant_id() references public.tenants(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null check (kind in ('personal', 'shared')),
  owner_id    uuid references public.users(id) on delete cascade,
  created_by  uuid default auth.uid() references public.users(id) on delete set null,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  background  text not null default 'blue' check (background ~ '^[a-z0-9_-]{1,32}$'),
  all_staff   boolean not null default false,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((kind = 'personal') = (owner_id is not null)),
  check (kind = 'shared' or not all_staff)
);
create index on public.boards (project_id, kind);
create index on public.boards (owner_id) where owner_id is not null;

create table public.board_members (
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  added_by   uuid default auth.uid() references public.users(id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index on public.board_members (user_id);

create table public.board_stars (
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table public.board_lists (
  id          uuid primary key default public.uuidv7(),
  tenant_id   uuid not null default private.tenant_id() references public.tenants(id),
  board_id    uuid not null references public.boards(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  position    double precision not null default 65536,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (board_id, id)
);
create index on public.board_lists (board_id, position);

create table public.board_labels (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  board_id   uuid not null references public.boards(id) on delete cascade,
  name       text not null default '' check (char_length(name) <= 60),
  color      text not null check (color in ('green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black')),
  position   double precision not null default 65536,
  created_at timestamptz not null default now(),
  unique (board_id, id)
);
create index on public.board_labels (board_id);

create table public.board_cards (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null default private.tenant_id() references public.tenants(id),
  board_id        uuid not null references public.boards(id) on delete cascade,
  list_id         uuid not null,
  title           text not null check (char_length(btrim(title)) between 1 and 500),
  description     text not null default '' check (char_length(description) <= 20000),
  has_description boolean generated always as (btrim(description) <> '') stored,
  position        double precision not null default 65536,
  start_date      date,
  due_at          timestamptz,
  due_done        boolean not null default false,
  cover           text check (cover is null or cover in ('green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black')),
  archived_at     timestamptz,
  created_by      uuid default auth.uid() references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (board_id, id),
  foreign key (board_id, list_id) references public.board_lists(board_id, id) on delete cascade
);
create index on public.board_cards (list_id, position);
create index on public.board_cards (board_id);

create table public.board_card_labels (
  card_id   uuid not null,
  label_id  uuid not null,
  board_id  uuid not null,
  tenant_id uuid not null default private.tenant_id() references public.tenants(id),
  primary key (card_id, label_id),
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade,
  foreign key (board_id, label_id) references public.board_labels(board_id, id) on delete cascade
);
create index on public.board_card_labels (board_id);
create index on public.board_card_labels (label_id);

create table public.board_card_members (
  card_id   uuid not null,
  user_id   uuid not null references public.users(id) on delete cascade,
  board_id  uuid not null,
  tenant_id uuid not null default private.tenant_id() references public.tenants(id),
  primary key (card_id, user_id),
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_card_members (board_id);
create index on public.board_card_members (user_id);

create table public.board_checklists (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  board_id   uuid not null,
  card_id    uuid not null,
  title      text not null check (char_length(btrim(title)) between 1 and 200),
  position   double precision not null default 65536,
  created_at timestamptz not null default now(),
  unique (card_id, id),
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_checklists (card_id);
create index on public.board_checklists (board_id);

create table public.board_checklist_items (
  id           uuid primary key default public.uuidv7(),
  tenant_id    uuid not null default private.tenant_id() references public.tenants(id),
  board_id     uuid not null,
  card_id      uuid not null,
  checklist_id uuid not null,
  title        text not null check (char_length(btrim(title)) between 1 and 500),
  done         boolean not null default false,
  position     double precision not null default 65536,
  created_at   timestamptz not null default now(),
  foreign key (card_id, checklist_id) references public.board_checklists(card_id, id) on delete cascade,
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_checklist_items (checklist_id, position);
create index on public.board_checklist_items (card_id);
create index on public.board_checklist_items (board_id);

create table public.board_comments (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  board_id   uuid not null,
  card_id    uuid not null,
  author_id  uuid default auth.uid() references public.users(id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_comments (card_id, created_at);
create index on public.board_comments (board_id);

create table public.board_activity (
  id         uuid primary key default public.uuidv7(),
  tenant_id  uuid not null references public.tenants(id),
  board_id   uuid not null,
  card_id    uuid not null,
  actor_id   uuid references public.users(id) on delete set null,
  kind       text not null check (kind in ('created', 'moved', 'archived', 'restored', 'due_done', 'due_undone')),
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (board_id, card_id) references public.board_cards(board_id, id) on delete cascade
);
create index on public.board_activity (card_id, created_at);
create index on public.board_activity (board_id);

-- ---------------------------------------------------------------------------
-- Доступ
-- ---------------------------------------------------------------------------
-- Видит ли человек доску: сначала он должен видеть сам проект. Отдельный параметр пользователя — чтобы проверять
-- и участников карточек, а не только себя.
create or replace function private.board_user_can_view(p_board uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.boards b
      join public.users u on u.id = p_user and u.tenant_id = b.tenant_id and u.deleted_at is null and u.status <> 'blocked'
     where b.id = p_board
       and b.tenant_id = private.tenant_id()
       and private.user_can_see_project(p_user, b.project_id)
       and (
         (b.kind = 'personal' and b.owner_id = p_user)
         or (b.kind = 'shared' and (
               (b.all_staff and not u.is_external)
               or exists (select 1 from public.board_members m where m.board_id = b.id and m.user_id = p_user)
               or private.user_has_project_permission(p_user, b.project_id, 'board.manage')
             ))
       )
  );
$$;

create or replace function private.board_can_view(p_board uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.board_user_can_view(p_board, auth.uid());
$$;

-- Может ли человек менять устройство доски: колонки, участников, название, оформление, закрытие и удаление.
create or replace function private.board_can_manage(p_board uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
     where b.id = p_board
       and b.tenant_id = private.tenant_id()
       and private.can_see_project(b.project_id)
       and ((b.kind = 'personal' and b.owner_id = auth.uid())
            or (b.kind = 'shared' and private.has_project_permission(b.project_id, 'board.manage')))
  );
$$;

grant execute on function private.board_can_view(uuid), private.board_can_manage(uuid), private.board_user_can_view(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Триггеры
-- ---------------------------------------------------------------------------
create or replace function private.boards_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch before update on public.boards for each row execute function private.boards_touch();
create trigger touch before update on public.board_lists for each row execute function private.boards_touch();
create trigger touch before update on public.board_cards for each row execute function private.boards_touch();

-- Владелец личной доски — всегда тот, кто её создаёт; у общей владельца нет.
create or replace function private.boards_before_insert() returns trigger
language plpgsql as $$
begin
  new.owner_id := case when new.kind = 'personal' then auth.uid() end;
  new.created_by := auth.uid();
  if new.kind = 'personal' then new.all_staff := false; end if;
  return new;
end;
$$;
create trigger boards_before_insert before insert on public.boards for each row execute function private.boards_before_insert();

-- Участник общей доски — человек, который видит проект доски; у личной доски участников нет.
create or replace function private.board_members_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.boards b where b.id = new.board_id and b.kind = 'shared' and b.tenant_id = new.tenant_id) then
    raise exception 'board_not_shared' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users u where u.id = new.user_id and u.tenant_id = new.tenant_id and u.deleted_at is null)
     or not private.user_can_see_project(new.user_id, (select b.project_id from public.boards b where b.id = new.board_id)) then
    raise exception 'user_not_in_project' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger board_members_check before insert or update on public.board_members for each row execute function private.board_members_check();

-- Участником карточки можно сделать только того, кто видит доску.
create or replace function private.board_card_members_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.board_user_can_view(new.board_id, new.user_id) then
    raise exception 'user_cannot_view_board' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger board_card_members_check before insert or update on public.board_card_members for each row execute function private.board_card_members_check();

-- Карточку нельзя увести на другую доску (между досками — только «копировать»).
create or replace function private.board_cards_keep_board() returns trigger
language plpgsql as $$
begin
  if new.board_id <> old.board_id then
    raise exception 'board_change_forbidden' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger board_cards_keep_board before update of board_id on public.board_cards for each row execute function private.board_cards_keep_board();

-- История карточки
create or replace function private.board_cards_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), 'created',
            jsonb_build_object('list', (select l.title from public.board_lists l where l.id = new.list_id)));
    return null;
  end if;
  if new.list_id is distinct from old.list_id then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), 'moved',
            jsonb_build_object('from', (select l.title from public.board_lists l where l.id = old.list_id),
                               'to',   (select l.title from public.board_lists l where l.id = new.list_id)));
  end if;
  if (new.archived_at is null) <> (old.archived_at is null) then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), case when new.archived_at is null then 'restored' else 'archived' end);
  end if;
  if new.due_done <> old.due_done then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), case when new.due_done then 'due_done' else 'due_undone' end);
  end if;
  return null;
end;
$$;
create trigger board_cards_activity after insert or update on public.board_cards for each row execute function private.board_cards_activity();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.boards                enable row level security;
alter table public.board_members         enable row level security;
alter table public.board_stars           enable row level security;
alter table public.board_lists           enable row level security;
alter table public.board_labels          enable row level security;
alter table public.board_cards           enable row level security;
alter table public.board_card_labels     enable row level security;
alter table public.board_card_members    enable row level security;
alter table public.board_checklists      enable row level security;
alter table public.board_checklist_items enable row level security;
alter table public.board_comments        enable row level security;
alter table public.board_activity        enable row level security;
alter table public.boards                force row level security;
alter table public.board_members         force row level security;
alter table public.board_stars           force row level security;
alter table public.board_lists           force row level security;
alter table public.board_labels          force row level security;
alter table public.board_cards           force row level security;
alter table public.board_card_labels     force row level security;
alter table public.board_card_members    force row level security;
alter table public.board_checklists      force row level security;
alter table public.board_checklist_items force row level security;
alter table public.board_comments        force row level security;
alter table public.board_activity        force row level security;

-- Доски. Условие видимости здесь по столбцам самой строки, а не через `board_can_view(id)`: при `insert … returning`
-- функция ещё не видит только что вставленную доску.
create or replace function private.board_shared_visible(p_board uuid, p_project uuid, p_all_staff boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_project_permission(p_project, 'board.manage')
      or (p_all_staff and not coalesce((select u.is_external from public.users u where u.id = auth.uid()), true))
      or exists (select 1 from public.board_members m where m.board_id = p_board and m.user_id = auth.uid());
$$;
grant execute on function private.board_shared_visible(uuid, uuid, boolean) to authenticated;

create policy boards_select on public.boards for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and private.can_see_project(project_id)
         and ((kind = 'personal' and owner_id = (select auth.uid()))
              or (kind = 'shared' and private.board_shared_visible(id, project_id, all_staff))));
create policy boards_insert on public.boards for insert to authenticated
  with check (tenant_id = (select private.tenant_id())
              and private.can_see_project(project_id)
              and ((kind = 'personal' and owner_id = (select auth.uid()))
                   or (kind = 'shared' and private.has_project_permission(project_id, 'board.manage'))));
create policy boards_update on public.boards for update to authenticated
  using (private.board_can_manage(id)) with check (private.board_can_manage(id));
create policy boards_delete on public.boards for delete to authenticated
  using (private.board_can_manage(id));

-- Участники общей доски: видят все, кто видит доску; меняет тот, кто управляет
create policy board_members_select on public.board_members for select to authenticated
  using (private.board_can_view(board_id));
create policy board_members_insert on public.board_members for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_can_manage(board_id));
create policy board_members_delete on public.board_members for delete to authenticated
  using (private.board_can_manage(board_id));

-- Отметки «звёздочкой» — свои
create policy board_stars_own on public.board_stars for all to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()))
  with check (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()) and private.board_can_view(board_id));

-- Колонки: видят участники, меняет только тот, кто управляет доской
create policy board_lists_select on public.board_lists for select to authenticated
  using (private.board_can_view(board_id));
create policy board_lists_insert on public.board_lists for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and private.board_can_manage(board_id));
create policy board_lists_update on public.board_lists for update to authenticated
  using (private.board_can_manage(board_id)) with check (private.board_can_manage(board_id));
create policy board_lists_delete on public.board_lists for delete to authenticated
  using (private.board_can_manage(board_id));

-- Всё внутри доски — участникам доски
do $$
declare t text;
begin
  foreach t in array array['board_labels', 'board_cards', 'board_card_labels', 'board_card_members', 'board_checklists', 'board_checklist_items'] loop
    execute format('create policy %I on public.%I for all to authenticated using (private.board_can_view(board_id)) with check (tenant_id = (select private.tenant_id()) and private.board_can_view(board_id))', t || '_member', t);
  end loop;
end $$;

-- Комментарии: читают участники, пишут участники от своего имени, правят и удаляют свои
create policy board_comments_select on public.board_comments for select to authenticated
  using (private.board_can_view(board_id));
create policy board_comments_insert on public.board_comments for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and author_id = (select auth.uid()) and private.board_can_view(board_id));
create policy board_comments_update on public.board_comments for update to authenticated
  using (author_id = (select auth.uid()) and private.board_can_view(board_id))
  with check (author_id = (select auth.uid()) and private.board_can_view(board_id));
create policy board_comments_delete on public.board_comments for delete to authenticated
  using (author_id = (select auth.uid()) and private.board_can_view(board_id));

create policy board_activity_select on public.board_activity for select to authenticated
  using (private.board_can_view(board_id));

-- ---------------------------------------------------------------------------
-- Права на столбцы
-- ---------------------------------------------------------------------------
revoke all on public.boards, public.board_members, public.board_stars, public.board_lists, public.board_labels, public.board_cards,
              public.board_card_labels, public.board_card_members, public.board_checklists, public.board_checklist_items,
              public.board_comments, public.board_activity from anon, authenticated;

grant select, delete on public.boards to authenticated;
grant insert (project_id, kind, title, description, background, all_staff) on public.boards to authenticated;
grant update (title, description, background, all_staff, closed_at) on public.boards to authenticated;

grant select, delete on public.board_members to authenticated;
grant insert (board_id, user_id) on public.board_members to authenticated;

grant select, insert (board_id), delete on public.board_stars to authenticated;

grant select, delete on public.board_lists to authenticated;
grant insert (board_id, title, position) on public.board_lists to authenticated;
grant update (title, position, archived_at) on public.board_lists to authenticated;

grant select, delete on public.board_labels to authenticated;
grant insert (board_id, name, color, position) on public.board_labels to authenticated;
grant update (name, color, position) on public.board_labels to authenticated;

grant select, delete on public.board_cards to authenticated;
grant insert (board_id, list_id, title, description, position, start_date, due_at, due_done, cover) on public.board_cards to authenticated;
grant update (list_id, title, description, position, start_date, due_at, due_done, cover, archived_at) on public.board_cards to authenticated;

grant select, delete on public.board_card_labels to authenticated;
grant insert (card_id, label_id, board_id) on public.board_card_labels to authenticated;

grant select, delete on public.board_card_members to authenticated;
grant insert (card_id, user_id, board_id) on public.board_card_members to authenticated;

grant select, delete on public.board_checklists to authenticated;
grant insert (board_id, card_id, title, position) on public.board_checklists to authenticated;
grant update (title, position) on public.board_checklists to authenticated;

grant select, delete on public.board_checklist_items to authenticated;
grant insert (board_id, card_id, checklist_id, title, done, position) on public.board_checklist_items to authenticated;
grant update (title, done, position) on public.board_checklist_items to authenticated;

grant select, delete on public.board_comments to authenticated;
grant insert (board_id, card_id, body) on public.board_comments to authenticated;
grant update (body, edited_at) on public.board_comments to authenticated;

grant select on public.board_activity to authenticated;

-- ---------------------------------------------------------------------------
-- Создание доски одним вызовом: доска, стартовые колонки и шесть цветных меток без названий (как в Trello)
-- ---------------------------------------------------------------------------
create or replace function public.board_create(p_project uuid, p_kind text, p_title text, p_background text default 'blue',
                                               p_all_staff boolean default false, p_lists text[] default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_title text;
  i int := 0;
begin
  insert into public.boards (project_id, kind, title, background, all_staff)
  values (p_project, p_kind, btrim(p_title), coalesce(p_background, 'blue'), coalesce(p_all_staff, false) and p_kind = 'shared')
  returning id into v_id;

  foreach v_title in array coalesce(p_lists, array[]::text[]) loop
    if btrim(v_title) <> '' then
      i := i + 1;
      insert into public.board_lists (board_id, title, position) values (v_id, btrim(v_title), i * 65536);
    end if;
  end loop;

  insert into public.board_labels (board_id, name, color, position)
  select v_id, '', c, n * 65536
    from unnest(array['green', 'yellow', 'orange', 'red', 'purple', 'blue']) with ordinality as x(c, n);

  return v_id;
end;
$$;
revoke all on function public.board_create(uuid, text, text, text, boolean, text[]) from public, anon;
grant execute on function public.board_create(uuid, text, text, text, boolean, text[]) to authenticated;

-- Копия карточки (в ту же или другую колонку этой доски): метки, участники, чек-листы по желанию.
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

  insert into public.board_cards (board_id, list_id, title, description, position, start_date, due_at, due_done, cover)
  values (c.board_id, p_list, coalesce(nullif(btrim(p_title), ''), c.title), c.description, p_position, c.start_date, c.due_at, c.due_done, c.cover)
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
revoke all on function public.board_card_copy(uuid, uuid, text, double precision, boolean, boolean, boolean) from public, anon;
grant execute on function public.board_card_copy(uuid, uuid, text, double precision, boolean, boolean, boolean) to authenticated;

-- Живое обновление доски у всех, кто на неё смотрит
alter publication supabase_realtime add table public.board_lists, public.board_cards, public.board_labels, public.board_card_labels,
  public.board_card_members, public.board_checklists, public.board_checklist_items, public.board_comments;
