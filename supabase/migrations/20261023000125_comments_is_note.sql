-- Заметка с площадки пишется как комментарий к месту, а значит наблюдатели этого места получали ещё и обычное
-- уведомление «комментарий к этажу», которое открывало этаж. Заметка шлёт собственные уведомления (адресату — личное,
-- остальным — push «Новая заметка»), поэтому такие комментарии помечаем и наблюдателям места не дублируем.

alter table public.comments add column is_note boolean not null default false;
grant insert (is_note) on public.comments to authenticated;

create or replace function private.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_author  text := (select full_name from public.users where id = new.author_id);
  v_snippet text := left(regexp_replace(new.body_text, '\s+', ' ', 'g'), 140);
  m         record;
  w         record;
  v_internal boolean := new.visibility = 'internal';
begin
  perform private.add_watcher(new.entity_type, new.entity_id, new.author_id, 'participant');

  for m in select (e ->> 'id')::uuid as user_id from jsonb_array_elements(new.mentions) e loop
    perform private.add_watcher(new.entity_type, new.entity_id, m.user_id, 'mention');
    perform private.notify(m.user_id, new.entity_type, new.entity_id, 'mentioned', 'high', 'mentioned',
                           'Упоминание от ' || v_author || ': «' || v_snippet || '»', v_internal);
  end loop;

  -- заметка с площадки: наблюдателям места отдельного «комментария» не шлём
  if new.is_note then
    return new;
  end if;

  for w in select user_id from public.watchers
            where entity_type = new.entity_type and entity_id = new.entity_id and not muted
              and user_id <> new.author_id
              and not (new.mentions @> jsonb_build_array(jsonb_build_object('type', 'user', 'id', user_id))) loop
    perform private.notify(w.user_id, new.entity_type, new.entity_id, 'watching', 'low', 'commented',
                           v_author || ': «' || v_snippet || '»', v_internal);
  end loop;
  return new;
end;
$$;

notify pgrst, 'reload schema';
