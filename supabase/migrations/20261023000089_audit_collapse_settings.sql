-- Лента проекта: подряд идущие переключения технических настроек схлопываются в одну запись.
--
-- Настройка проекта (например, «Подтверждать факт после обхода») — переключатель: включили, передумали, выключили, снова включили.
-- Раньше каждое нажатие попадало в общую ленту «Изменения» отдельной строкой, и их было много подряд.
-- Теперь, если один и тот же человек в течение 10 минут меняет ТОЛЬКО настройки (`settings`), прежняя запись обновляется:
-- «было» остаётся от первого переключения, «стало» — от последнего. Вернули как было — запись исчезает совсем, ничего не менялось.
-- Остальные поля проекта (даты, название, руководитель…) пишутся по-прежнему каждое отдельной записью.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Лента изменений».

create or replace function private.projects_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_changes jsonb;
  v_prev    public.entity_events;
  v_from    jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.record_event(new.tenant_id, new.id, 'project', new.id, 'created',
                                 jsonb_build_object('code', new.code, 'name', new.name), 'external');
  else
    -- {поле: [было, стало]} без служебных полей
    select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}')
      into v_changes
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'updated_by', 'version');
    if v_changes = '{}' then
      return new;
    end if;
    -- только настройки: склеиваем с недавней записью того же человека
    if (select array_agg(k) from jsonb_object_keys(v_changes) k) = array['settings'] then
      select * into v_prev
        from public.entity_events e
       where e.entity_type = 'project' and e.entity_id = new.id and e.event_type = 'field_changed'
         and e.actor_id is not distinct from auth.uid()
         and e.occurred_at > now() - interval '10 minutes'
         and (select array_agg(k) from jsonb_object_keys(e.changes) k) = array['settings']
       order by e.occurred_at desc
       limit 1;
      if found then
        v_from := v_prev.changes -> 'settings' -> 0;
        if v_from = to_jsonb(new.settings) then
          delete from public.entity_events where id = v_prev.id;
        else
          update public.entity_events
             set changes = jsonb_build_object('settings', jsonb_build_array(v_from, to_jsonb(new.settings))), occurred_at = now()
           where id = v_prev.id;
        end if;
        return new;
      end if;
    end if;
    perform private.record_event(new.tenant_id, new.id, 'project', new.id, 'field_changed', v_changes, 'external');
  end if;
  return new;
end;
$$;
