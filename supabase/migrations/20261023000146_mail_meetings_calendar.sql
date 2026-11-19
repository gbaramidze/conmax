-- Приглашения на встречи из Outlook → личный календарь (раздел «Личное», тип «Личное» в календарях).
--
-- Функция `mail` узнаёт приглашение по классу письма (IPM.Schedule.Meeting.Request / .Canceled) — при опросе новых писем
-- и при открытии письма — и передаёт сюда время (UTC), место и iCalUId встречи. Приглашение и его обновления
-- создают или сдвигают одну и ту же запись (ключ — iCalUId), отмена удаляет её. Время переводится в часовой пояс
-- пользователя (users.timezone): личные события хранятся «как на часах». Напоминание за 10 минут работает как у всех
-- личных событий (private.send_event_reminders).

alter table public.personal_items
  add column source     text check (source is null or source = 'outlook'),
  add column source_uid text check (source_uid is null or char_length(source_uid) <= 300);
create unique index personal_items_source_uid on public.personal_items (user_id, source, source_uid) where source is not null;

alter table public.mail_accounts
  add column calendar_synced_at timestamptz;  -- когда разобраны приглашения, пришедшие до подключения уведомлений

-- p_items: [{kind: 'request'|'cancel', uid, subject, start, end, all_day, location, organizer}]
-- uid — «идентификатор встречи#дата» (серию функция `mail` разворачивает на полгода вперёд); у отмены серии — «…#*».
-- Возвращает [{uid, item_id, event_date}] — сайт показывает у письма ссылку на событие.
create or replace function public.mail_calendar_apply(p_user uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tz     text;
  r        jsonb;
  v_start  timestamp;
  v_end    timestamp;
  v_id     uuid;
  v_out    jsonb := '[]'::jsonb;
  v_body   text;
begin
  select u.tenant_id, coalesce(nullif(u.timezone, ''), 'UTC') into v_tenant, v_tz
    from public.users u
   where u.id = p_user and u.status <> 'blocked'
     and exists (select 1 from public.mail_accounts a where a.user_id = u.id);
  if v_tenant is null then return v_out; end if;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    continue when coalesce(r->>'uid', '') = '' or coalesce(r->>'start', '') = '';

    if r->>'kind' = 'cancel' then
      -- «встреча#*» — отменена вся серия, «встреча#дата» — одна встреча
      delete from public.personal_items
       where user_id = p_user and source = 'outlook'
         and (source_uid = r->>'uid'
              or (right(r->>'uid', 2) = '#*' and left(source_uid, length(r->>'uid') - 1) = left(r->>'uid', length(r->>'uid') - 1)));
      continue;
    end if;
    continue when r->>'kind' is distinct from 'request';

    v_start := ((r->>'start')::timestamptz) at time zone v_tz;
    v_end   := case when coalesce(r->>'end', '') <> '' then ((r->>'end')::timestamptz) at time zone v_tz end;
    -- прошедшие встречи не добавляем
    continue when coalesce(v_end, v_start) < (now() at time zone v_tz) - interval '1 day';

    v_body := concat_ws(E'\n',
      'Приглашение из Outlook',
      case when coalesce(r->>'organizer', '') <> '' then 'Организатор: ' || left(r->>'organizer', 120) end);

    insert into public.personal_items (tenant_id, user_id, kind, title, body, event_date, start_time, end_time, place, source, source_uid)
    values (v_tenant, p_user, 'event',
            left(coalesce(nullif(btrim(r->>'subject'), ''), 'Встреча'), 200),
            v_body,
            v_start::date,
            case when coalesce((r->>'all_day')::boolean, false) then null else v_start::time end,
            -- конец в тот же день и позже начала; иначе (многодневная, весь день) — без конца
            case when coalesce((r->>'all_day')::boolean, false) or v_end is null or v_end::date <> v_start::date or v_end::time <= v_start::time
                 then null else v_end::time end,
            nullif(left(btrim(coalesce(r->>'location', '')), 200), ''),
            'outlook', r->>'uid')
    on conflict (user_id, source, source_uid) where source is not null do update
       set title = excluded.title, body = excluded.body, event_date = excluded.event_date,
           start_time = excluded.start_time, end_time = excluded.end_time, place = excluded.place
    returning id into v_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object('uid', r->>'uid', 'item_id', v_id, 'event_date', v_start::date));
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.mail_calendar_apply(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.mail_calendar_apply(uuid, jsonb) to service_role;
