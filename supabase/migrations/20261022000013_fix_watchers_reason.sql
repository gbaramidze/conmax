-- Исправление: триггер наблюдателей всегда перезаписывал причину на 'manual' и подставлял тенанта из JWT
-- (терялась причина creator/assignee/mention/discipline_lead; без JWT тенант становился null).
-- Теперь причина по умолчанию 'manual' (клиент задавать её не может — нет права на колонку),
-- а серверные вызовы (add_watcher) передают свою.
alter table public.watchers alter column reason set default 'manual';

create or replace function private.watchers_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.tenant_id  := coalesce(private.tenant_id(), new.tenant_id);
  new.project_id := coalesce(private.entity_project_id(new.entity_type, new.entity_id),
                             private.entity_project_id_any(new.entity_type, new.entity_id),
                             new.project_id);
  if new.project_id is null then
    raise exception 'entity not found' using errcode = '23503';
  end if;
  return new;
end;
$$;
