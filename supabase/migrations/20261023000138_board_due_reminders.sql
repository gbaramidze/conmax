-- Напоминания о сроке карточек досок: «срок скоро» (за сутки) и «карточка просрочена».
--
-- Раз в 5 минут `private.board_due_reminders()` находит карточки с ещё не выполненным сроком и шлёт напоминание
-- через общий конвейер (колокольчик, push, письмо — по настройкам получателя, категория «Назначено»):
--  • «Срок скоро» — когда до срока осталось меньше суток;
--  • «Карточка просрочена» — когда срок прошёл (не старше 7 дней: давно забытые карточки не будят).
-- Получатели — участники карточки; если участников нет — автор карточки. Каждое напоминание по одному сроку —
-- один раз (`private.board_due_sent`); новый срок — новые напоминания. Не напоминаем о карточках в архиве,
-- в архивной колонке, на закрытой доске и с отметкой «выполнено».
-- См. docs: 04-modules/28-boards.md.

-- ---------------------------------------------------------------------------
-- Видимость доски в фоновом задании: там нет пользователя в сессии, и компанию берём у получателя.
-- Для запросов из приложения (есть auth.uid()) проверка прежняя — по компании из сессии.
-- ---------------------------------------------------------------------------
create or replace function private.board_user_can_view(p_board uuid, p_user uuid) returns boolean
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
               (b.all_staff and not u.is_external)
               or exists (select 1 from public.board_members m where m.board_id = b.id and m.user_id = p_user)
               or private.user_has_project_permission(p_user, b.project_id, 'board.manage')
             ))
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- Отправленные напоминания
-- ---------------------------------------------------------------------------
create table private.board_due_sent (
  card_id uuid not null references public.board_cards(id) on delete cascade,
  kind    text not null check (kind in ('soon', 'overdue')),
  due_at  timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (card_id, kind, due_at)
);

create or replace function private.board_due_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c       record;
  r       record;
  v_kind  text;
  v_rows  integer;
  v_fired integer := 0;
  v_when  text;
begin
  for c in
    select bc.id, bc.due_at, bc.created_by, coalesce(p.timezone, 'Asia/Tbilisi') as tz
      from public.board_cards bc
      join public.boards b on b.id = bc.board_id
      join public.board_lists l on l.id = bc.list_id
      join public.projects p on p.id = b.project_id
     where bc.due_at is not null and not bc.due_done
       and bc.archived_at is null and l.archived_at is null and b.closed_at is null
       and bc.due_at > now() - interval '7 days' and bc.due_at <= now() + interval '24 hours'
  loop
    v_kind := case when c.due_at <= now() then 'overdue' else 'soon' end;
    insert into private.board_due_sent (card_id, kind, due_at) values (c.id, v_kind, c.due_at) on conflict do nothing;
    get diagnostics v_rows = row_count;
    continue when v_rows = 0;

    v_when := to_char(c.due_at at time zone c.tz, 'DD.MM.YYYY HH24:MI');
    for r in
      select m.user_id from public.board_card_members m where m.card_id = c.id
      union
      select c.created_by where c.created_by is not null
                            and not exists (select 1 from public.board_card_members m where m.card_id = c.id)
    loop
      if v_kind = 'soon' then
        perform private.notify(r.user_id, 'board_card', c.id, 'assigned', 'normal', 'due_soon', 'Срок скоро: ' || v_when);
      else
        perform private.notify(r.user_id, 'board_card', c.id, 'assigned', 'high', 'overdue', 'Карточка просрочена: срок был ' || v_when);
      end if;
      v_fired := v_fired + 1;
    end loop;
  end loop;
  return v_fired;
end;
$$;
revoke execute on function private.board_due_reminders() from public, anon, authenticated;

select cron.schedule('buildos-board-due', '*/5 * * * *', $$select private.board_due_reminders()$$);
