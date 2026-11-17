-- Заметка с площадки: точка на схеме места, как у замечания инспекции.
-- Схема берётся из тех же вариантов, что и в инспекции (`inspection_scheme_options`: изображения места и вышестоящих узлов,
-- типа номера, чертежи и планы). В заметке запоминается выбранная схема (файл или версия документа) и точка в долях ширины и высоты (0–1).

alter table public.field_notes
  add column scheme_file_id    uuid references public.files(id),
  add column scheme_version_id uuid references public.document_versions(id),
  add column scheme_x numeric(5, 4) check (scheme_x between 0 and 1),
  add column scheme_y numeric(5, 4) check (scheme_y between 0 and 1),
  add constraint field_notes_point_pair check ((scheme_x is null) = (scheme_y is null)),
  -- точка всегда относится к одной определённой схеме: либо файл, либо версия документа
  add constraint field_notes_point_scheme check (
    scheme_x is null and scheme_file_id is null and scheme_version_id is null
    or scheme_x is not null and (scheme_file_id is null) <> (scheme_version_id is null)
  );

-- Регистрация заметки: адресат, задача и (необязательно) точка на схеме
drop function if exists public.register_field_note(uuid, uuid, uuid, uuid);
create function public.register_field_note(
  p_comment uuid, p_user uuid default null, p_org uuid default null, p_task uuid default null,
  p_scheme_file uuid default null, p_scheme_version uuid default null, p_x numeric default null, p_y numeric default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := auth.uid();
  c          record;
  v_old_user uuid;
  v_old_org  uuid;
  v_point    boolean := p_x is not null or p_y is not null or p_scheme_file is not null or p_scheme_version is not null;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select cm.tenant_id, cm.project_id, cm.entity_id, cm.visibility into c
    from public.comments cm
   where cm.id = p_comment and cm.author_id = v_me and cm.entity_type = 'location' and cm.deleted_at is null
     and cm.tenant_id = private.tenant_id();
  if not found then
    raise exception 'note not found' using errcode = '42501';
  end if;
  perform private.field_note_check_addressee(c.project_id, c.visibility, p_user, p_org);
  if p_task is not null and not exists (
       select 1 from public.tasks t where t.id = p_task and t.project_id = c.project_id and t.reporter_id = v_me) then
    raise exception 'task not found' using errcode = '42501';
  end if;
  if v_point then
    if p_x is null or p_y is null or p_x not between 0 and 1 or p_y not between 0 and 1 or (p_scheme_file is null) = (p_scheme_version is null) then
      raise exception 'invalid scheme point' using errcode = '22023';
    end if;
    -- схема должна быть одной из доступных этому месту
    if not exists (
         select 1 from public.inspection_scheme_options(c.entity_id) o
          where (p_scheme_file is not null and o.file_id = p_scheme_file) or (p_scheme_version is not null and o.version_id = p_scheme_version)) then
      raise exception 'scheme is not available for this place' using errcode = '42501';
    end if;
  end if;

  select f.addressee_user_id, f.addressee_org_id into v_old_user, v_old_org from public.field_notes f where f.comment_id = p_comment;

  insert into public.field_notes (comment_id, tenant_id, project_id, location_id, author_id, addressee_user_id, addressee_org_id, task_id,
                                  scheme_file_id, scheme_version_id, scheme_x, scheme_y)
  values (p_comment, c.tenant_id, c.project_id, c.entity_id, v_me, p_user, p_org, p_task,
          p_scheme_file, p_scheme_version, p_x, p_y)
  on conflict (comment_id) do update
    set addressee_user_id = excluded.addressee_user_id,
        addressee_org_id  = excluded.addressee_org_id,
        task_id           = coalesce(excluded.task_id, public.field_notes.task_id),
        -- повторная регистрация без точки не стирает уже отмеченную
        scheme_file_id    = case when excluded.scheme_x is not null then excluded.scheme_file_id else public.field_notes.scheme_file_id end,
        scheme_version_id = case when excluded.scheme_x is not null then excluded.scheme_version_id else public.field_notes.scheme_version_id end,
        scheme_x          = coalesce(excluded.scheme_x, public.field_notes.scheme_x),
        scheme_y          = coalesce(excluded.scheme_y, public.field_notes.scheme_y);

  perform private.notify_field_note_addressee(p_comment,
    case when p_user is distinct from v_old_user then p_user end,
    case when p_org  is distinct from v_old_org  then p_org  end);
end;
$$;

revoke execute on function public.register_field_note(uuid, uuid, uuid, uuid, uuid, uuid, numeric, numeric) from public, anon;
grant  execute on function public.register_field_note(uuid, uuid, uuid, uuid, uuid, uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
