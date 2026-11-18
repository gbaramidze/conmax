-- Доски: автоматизация «условие → действия» (как Butler в Trello). Пока — только на личных досках, настраивает владелец.
--
-- Условия (`trigger`):
--   • completed        — карточку отметили выполненной;
--   • moved_to_list    — карточку перенесли в колонку X;
--   • created_in_list  — карточку создали в колонке X (или в любой);
--   • stale            — карточку не обновляли N дней (правка, перенос, комментарий человека);
--   • in_list_for      — карточка лежит в колонке X уже N дней;
--   • overdue          — срок прошёл, а «срок выполнен» не отмечен.
-- Первые три срабатывают сразу (триггер на `board_cards`), остальные — раз в 5 минут (cron `buildos-board-automations`),
-- по одному разу на состояние карточки (`board_automation_runs`): новое обновление, новый перенос, новый срок — новый раз.
--
-- Действия (`actions` — массив, выполняются по порядку): move (в колонку, в конец), archive, complete,
-- add_label / remove_label, comment (комментарий от «Автоматизации»), notify (уведомление участникам карточки, а без них —
-- автору; себе за своё же действие не приходит), create_card (в колонку, название и описание по шаблону: {{title}} —
-- название исходной карточки, {{list}} — её колонка).
--
-- Цепочки: действие правила может запустить другое правило, но не глубже 3 шагов, и одно правило на одну карточку —
-- один раз за цепочку (без зацикливания). Ошибка правила не отменяет действие человека — правило просто пропускается.
-- В истории карточки такие изменения помечены `data.auto`, комментарии — `board_comments.is_system`.
-- См. docs: 04-modules/28-boards.md.

-- ---------------------------------------------------------------------------
-- Правила
-- ---------------------------------------------------------------------------
create table public.board_automations (
  id              uuid primary key default public.uuidv7(),
  tenant_id       uuid not null default private.tenant_id() references public.tenants(id),
  board_id        uuid not null references public.boards(id) on delete cascade,
  title           text not null default '' check (char_length(title) <= 200),
  enabled         boolean not null default true,
  position        double precision not null default 65536,
  trigger         text not null check (trigger in ('completed', 'moved_to_list', 'created_in_list', 'stale', 'in_list_for', 'overdue')),
  trigger_list_id uuid,
  trigger_days    integer check (trigger_days between 1 and 365),
  actions         jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 10),
  created_by      uuid default auth.uid() references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (board_id, trigger_list_id) references public.board_lists(board_id, id) on delete cascade,
  check (trigger not in ('moved_to_list', 'in_list_for') or trigger_list_id is not null),
  check ((trigger in ('stale', 'in_list_for')) = (trigger_days is not null))
);
create index on public.board_automations (board_id);
create trigger touch before update on public.board_automations for each row execute function private.boards_touch();

-- Какие срабатывания по времени уже были (ключ — состояние карточки: последнее обновление, вход в колонку, срок)
create table public.board_automation_runs (
  automation_id uuid not null references public.board_automations(id) on delete cascade,
  card_id       uuid not null references public.board_cards(id) on delete cascade,
  key           text not null,
  fired_at      timestamptz not null default now(),
  primary key (automation_id, card_id, key)
);
create index on public.board_automation_runs (card_id);

-- Комментарий от автоматизации
alter table public.board_comments add column is_system boolean not null default false;

-- Проверка правила: пока только личные доски; колонки и метки — этой доски; тексты не пустые
create or replace function private.board_automations_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a jsonb;
  t text;
begin
  if not exists (select 1 from public.boards b where b.id = new.board_id and b.kind = 'personal') then
    raise exception 'automation_personal_only' using errcode = 'P0001';
  end if;
  for a in select * from jsonb_array_elements(new.actions) loop
    t := a ->> 'type';
    if t not in ('move', 'archive', 'complete', 'add_label', 'remove_label', 'comment', 'notify', 'create_card') then
      raise exception 'automation_bad_action' using errcode = 'P0001';
    end if;
    if t in ('move', 'create_card') and not exists (
      select 1 from public.board_lists l where l.board_id = new.board_id and l.id::text = a ->> 'list_id') then
      raise exception 'automation_bad_list' using errcode = 'P0001';
    end if;
    if t in ('add_label', 'remove_label') and not exists (
      select 1 from public.board_labels l where l.board_id = new.board_id and l.id::text = a ->> 'label_id') then
      raise exception 'automation_bad_label' using errcode = 'P0001';
    end if;
    if t in ('comment', 'notify') and char_length(btrim(coalesce(a ->> 'text', ''))) not between 1 and 2000 then
      raise exception 'automation_bad_text' using errcode = 'P0001';
    end if;
    if t = 'create_card' and (char_length(btrim(coalesce(a ->> 'title', ''))) not between 1 and 500
                              or char_length(coalesce(a ->> 'description', '')) > 20000) then
      raise exception 'automation_bad_text' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;
create trigger board_automations_check before insert or update on public.board_automations
  for each row execute function private.board_automations_check();

-- ---------------------------------------------------------------------------
-- Выполнение правила для карточки
-- ---------------------------------------------------------------------------
create or replace function private.board_automation_run(p_rule public.board_automations, p_card uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_depth integer := coalesce(nullif(current_setting('buildos.board_auto_depth', true), '')::integer, 0);
  v_fired text;
  v_key   text := p_rule.id::text || ':' || p_card::text || ';';
  a       jsonb;
  c       public.board_cards;
  v_list  uuid;
  v_text  text;
  v_title text;
  r       record;
begin
  if v_depth >= 3 then return; end if;
  v_fired := case when v_depth = 0 then '' else coalesce(current_setting('buildos.board_auto_fired', true), '') end;
  if strpos(v_fired, v_key) > 0 then return; end if;

  begin
    perform set_config('buildos.board_auto_fired', v_fired || v_key, true);
    perform set_config('buildos.board_auto_depth', (v_depth + 1)::text, true);
    perform set_config('buildos.board_auto', 'on', true);

    for a in select * from jsonb_array_elements(p_rule.actions) loop
      select * into c from public.board_cards where id = p_card;
      exit when not found;

      case a ->> 'type'
        when 'move' then
          select l.id into v_list from public.board_lists l
           where l.board_id = c.board_id and l.id::text = a ->> 'list_id' and l.archived_at is null;
          if v_list is not null and v_list <> c.list_id then
            update public.board_cards
               set list_id = v_list,
                   position = coalesce((select max(x.position) from public.board_cards x where x.list_id = v_list and x.id <> c.id), 0) + 65536
             where id = c.id;
          end if;
        when 'archive' then
          update public.board_cards set archived_at = now() where id = c.id and archived_at is null;
        when 'complete' then
          update public.board_cards set completed = true where id = c.id and not completed;
        when 'add_label' then
          insert into public.board_card_labels (card_id, label_id, board_id, tenant_id)
          select c.id, l.id, c.board_id, c.tenant_id from public.board_labels l
           where l.board_id = c.board_id and l.id::text = a ->> 'label_id'
          on conflict do nothing;
        when 'remove_label' then
          delete from public.board_card_labels where card_id = c.id and label_id::text = a ->> 'label_id';
        when 'comment' then
          insert into public.board_comments (tenant_id, board_id, card_id, author_id, body, is_system)
          values (c.tenant_id, c.board_id, c.id, null, btrim(a ->> 'text'), true);
        when 'notify' then
          v_text := 'Автоматизация: ' || btrim(a ->> 'text');
          for r in
            select m.user_id from public.board_card_members m where m.card_id = c.id
            union
            select c.created_by where c.created_by is not null
                                  and not exists (select 1 from public.board_card_members m where m.card_id = c.id)
          loop
            perform private.notify(r.user_id, 'board_card', c.id, 'watching', 'normal', 'changed', v_text);
          end loop;
        when 'create_card' then
          select l.id into v_list from public.board_lists l
           where l.board_id = c.board_id and l.id::text = a ->> 'list_id' and l.archived_at is null;
          if v_list is not null then
            v_title := (select l.title from public.board_lists l where l.id = c.list_id);
            insert into public.board_cards (tenant_id, board_id, list_id, title, description, position, created_by)
            values (c.tenant_id, c.board_id, v_list,
                    left(btrim(replace(replace(a ->> 'title', '{{title}}', c.title), '{{list}}', coalesce(v_title, ''))), 500),
                    left(replace(replace(coalesce(a ->> 'description', ''), '{{title}}', c.title), '{{list}}', coalesce(v_title, '')), 20000),
                    coalesce((select max(x.position) from public.board_cards x where x.list_id = v_list), 0) + 65536,
                    coalesce(p_rule.created_by, c.created_by));
          end if;
        else
          null;
      end case;
    end loop;

    perform set_config('buildos.board_auto_depth', v_depth::text, true);
    if v_depth = 0 then perform set_config('buildos.board_auto', '', true); end if;
  exception when others then
    -- правило с ошибкой пропускаем (изменения правила откатываются вместе с подтранзакцией), действие человека остаётся
    raise warning 'board automation % failed: %', p_rule.id, sqlerrm;
  end;
end;
$$;
revoke execute on function private.board_automation_run(public.board_automations, uuid) from public, anon, authenticated;

-- Условия-события: выполнена, перенесена в колонку, создана в колонке
create or replace function private.board_cards_automation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.board_automations;
begin
  if new.archived_at is not null then return null; end if;
  if not exists (select 1 from public.board_automations a where a.board_id = new.board_id and a.enabled) then return null; end if;
  if exists (select 1 from public.boards b where b.id = new.board_id and b.closed_at is not null) then return null; end if;
  for r in
    select * from public.board_automations a
     where a.board_id = new.board_id and a.enabled
       and (   (tg_op = 'INSERT' and a.trigger = 'created_in_list' and (a.trigger_list_id is null or a.trigger_list_id = new.list_id))
            or (tg_op = 'UPDATE' and a.trigger = 'completed' and new.completed and not old.completed)
            or (tg_op = 'UPDATE' and a.trigger = 'moved_to_list' and new.list_id is distinct from old.list_id and a.trigger_list_id = new.list_id))
     order by a.position, a.created_at
  loop
    perform private.board_automation_run(r, new.id);
  end loop;
  return null;
end;
$$;
create trigger board_cards_automation after insert or update on public.board_cards
  for each row execute function private.board_cards_automation();

-- Последнее «человеческое» обновление карточки: правка, перенос, комментарий (без действий автоматизации)
create or replace function private.board_card_last_touch(p_card uuid, p_updated timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    p_updated,
    (select max(coalesce(m.edited_at, m.created_at)) from public.board_comments m where m.card_id = p_card and not m.is_system),
    (select max(a.created_at) from public.board_activity a where a.card_id = p_card and not coalesce((a.data ->> 'auto')::boolean, false))
  );
$$;

-- Когда карточка попала в свою нынешнюю колонку: последний перенос или создание
create or replace function private.board_card_entered_list(p_card uuid, p_created timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(a.created_at) from public.board_activity a where a.card_id = p_card and a.kind = 'moved'), p_created);
$$;

-- Условия по времени: раз в 5 минут
create or replace function private.board_automations_tick() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r       public.board_automations;
  c       record;
  v_fired integer := 0;
begin
  for r in
    select a.* from public.board_automations a join public.boards b on b.id = a.board_id
     where a.enabled and b.closed_at is null and a.trigger in ('stale', 'in_list_for', 'overdue')
     order by a.board_id, a.position, a.created_at
  loop
    for c in
      select bc.id, k.at, coalesce(k.at::text, '') as key
        from public.board_cards bc
        join public.board_lists l on l.id = bc.list_id
        cross join lateral (select case r.trigger
                                     when 'stale' then private.board_card_last_touch(bc.id, bc.updated_at)
                                     when 'in_list_for' then private.board_card_entered_list(bc.id, bc.created_at)
                                     else bc.due_at end as at) k
       where bc.board_id = r.board_id and bc.archived_at is null and l.archived_at is null
         and case r.trigger
               when 'stale'       then not bc.completed and k.at < now() - make_interval(days => r.trigger_days)
               when 'in_list_for' then bc.list_id = r.trigger_list_id and k.at < now() - make_interval(days => r.trigger_days)
               else bc.due_at < now() and not bc.due_done
             end
         and not exists (select 1 from public.board_automation_runs x
                          where x.automation_id = r.id and x.card_id = bc.id and x.key = coalesce(k.at::text, ''))
    loop
      insert into public.board_automation_runs (automation_id, card_id, key) values (r.id, c.id, c.key) on conflict do nothing;
      perform set_config('buildos.board_auto_depth', '0', true);
      perform private.board_automation_run(r, c.id);
      v_fired := v_fired + 1;
    end loop;
  end loop;
  return v_fired;
end;
$$;
revoke execute on function private.board_automations_tick() from public, anon, authenticated;
select cron.schedule('buildos-board-automations', '*/5 * * * *', $$select private.board_automations_tick()$$);

-- ---------------------------------------------------------------------------
-- История карточки: изменения автоматизации помечены data.auto
-- ---------------------------------------------------------------------------
create or replace function private.board_cards_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tag jsonb := case when coalesce(current_setting('buildos.board_auto', true), '') = 'on' then '{"auto": true}'::jsonb else '{}'::jsonb end;
begin
  if tg_op = 'INSERT' then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), 'created',
            jsonb_build_object('list', (select l.title from public.board_lists l where l.id = new.list_id)) || v_tag);
    return null;
  end if;
  if new.list_id is distinct from old.list_id then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), 'moved',
            jsonb_build_object('from', (select l.title from public.board_lists l where l.id = old.list_id),
                               'to',   (select l.title from public.board_lists l where l.id = new.list_id)) || v_tag);
  end if;
  if (new.archived_at is null) <> (old.archived_at is null) then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), case when new.archived_at is null then 'restored' else 'archived' end, v_tag);
  end if;
  if new.due_done <> old.due_done then
    insert into public.board_activity (tenant_id, board_id, card_id, actor_id, kind, data)
    values (new.tenant_id, new.board_id, new.id, auth.uid(), case when new.due_done then 'due_done' else 'due_undone' end, v_tag);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: правила видит и меняет тот, кто управляет доской (на личной — владелец); журнал срабатываний — служебный
-- ---------------------------------------------------------------------------
alter table public.board_automations enable row level security;
alter table public.board_automations force row level security;
create policy board_automations_manage on public.board_automations for all to authenticated
  using (private.board_can_manage(board_id))
  with check (tenant_id = (select private.tenant_id()) and private.board_can_manage(board_id));
revoke all on public.board_automations from anon, authenticated;
grant select, delete on public.board_automations to authenticated;
grant insert (board_id, title, enabled, position, trigger, trigger_list_id, trigger_days, actions) on public.board_automations to authenticated;
grant update (title, enabled, position, trigger, trigger_list_id, trigger_days, actions) on public.board_automations to authenticated;

alter table public.board_automation_runs enable row level security;
alter table public.board_automation_runs force row level security;
revoke all on public.board_automation_runs from anon, authenticated;

notify pgrst, 'reload schema';
