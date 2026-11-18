-- Выбор файла проекта для вложения карточки: каталог файлов проекта и прикрепление любого видимого файла.
--
--  • `public.project_file_catalog(project)` — всё, что можно прикрепить, одним списком с разделом (`kind`):
--      document — документы реестра (кроме чертежей и планов);
--      plan     — чертежи и планы реестра, схемы (планы) типов номеров;
--      ffe      — мебель и оборудование (FF&E): позиция и её документ;
--      render   — рендеры и фото типов номеров;
--      photo    — фото, прикреплённые к задачам и другим объектам.
--    Каждый видит только то, что ему и так доступно. Права проверяются один раз на проект и на документ (security definer),
--    а не через RLS каждой версии и каждого файла: через RLS каталог большого проекта не укладывался в лимит 8 с.
--  • Вложение карточки может ссылаться на любой файл проекта, который видит добавляющий (раньше — только на свой).
-- См. docs: 04-modules/28-boards.md.

drop function if exists public.project_file_catalog(uuid);
create function public.project_file_catalog(p_project uuid)
returns table (
  kind        text,
  key         text,
  document_id uuid,
  file_id     uuid,
  title       text,
  subtitle    text,
  -- для миниатюры (как в реестре документов): файл-источник и есть ли уже готовая миниатюра
  file_name         text,
  file_mime         text,
  thumb_file_id     uuid,
  thumb_source_key  text,
  thumb_source_mime text,
  has_thumb         boolean,
  created_at  timestamptz,
  -- сам файл (для просмотра перед прикреплением)
  storage_key text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_me       uuid := auth.uid();
  v_internal boolean;
begin
  -- проект: мой (компания из сессии) и видимый мне — иначе пусто
  if v_me is null
     or not exists (select 1 from public.projects p where p.id = p_project and p.tenant_id = private.tenant_id())
     or not private.can_see_project(p_project) then
    return;
  end if;
  v_internal := private.has_project_permission(p_project, 'comment.internal.view');

  return query
  with docs as materialized (
    -- документы реестра: текущая версия (или последняя, если текущей нет), её файл и источник миниатюры —
    -- как в documents_overview; права — одна проверка на документ
    select d.id, d.code, d.title, d.doc_type, d.updated_at,
           f.name as file_name, f.mime as file_mime, f.storage_key as file_key,
           sf.id as thumb_file_id, sf.storage_key as thumb_key, sf.mime as thumb_mime,
           coalesce((sf.meta ->> 'thumb')::boolean, false) as has_thumb
      from public.documents d
      left join public.document_versions cv on cv.id = d.current_version_id
      left join lateral (select v.file_id, v.preview_file_id from public.document_versions v
                          where v.document_id = d.id order by v.version_no desc limit 1) lv on true
      join public.files f on f.id = coalesce(cv.file_id, lv.file_id)
      left join public.files pf on pf.id = case when cv.id is not null then cv.preview_file_id else lv.preview_file_id end
      left join public.files sf on sf.id = coalesce(pf.id, f.id)
     where d.project_id = p_project and d.deleted_at is null
       and private.user_can_view_document(v_me, d.id)
  )
  select case when d.doc_type in ('plan', 'drawing') then 'plan' else 'document' end,
         'doc:' || d.id,
         d.id, null::uuid,
         coalesce(nullif(d.code, '') || ' — ', '') || d.title,
         d.file_name,
         d.file_name, d.file_mime, d.thumb_file_id, d.thumb_key, d.thumb_mime, d.has_thumb,
         d.updated_at, d.file_key
    from docs d
  union all
  -- мебель и оборудование: позиция (видна только с внутренним доступом) и её документы
  select 'ffe',
         'ffe:' || i.id || ':' || d.id,
         d.id, null::uuid,
         coalesce(nullif(i.code, '') || ' ', '') || i.name,
         concat_ws(' · ', nullif(i.category, ''), d.title),
         d.file_name, d.file_mime, d.thumb_file_id, d.thumb_key, d.thumb_mime, d.has_thumb,
         d.updated_at, d.file_key
    from public.ffe_items i
    join public.document_links l on l.entity_type = 'ffe_item' and l.entity_id = i.id
    join docs d on d.id = l.document_id
   where v_internal and i.project_id = p_project and i.deleted_at is null
  union all
  -- рендеры и схемы типов номеров (видны всем, кто видит проект)
  select case when im.is_plan then 'plan' else 'render' end,
         'img:' || im.id,
         null::uuid, f.id,
         coalesce(nullif(im.caption, ''), f.name),
         concat_ws(' · ', rt.name, nullif(im.folder, '')),
         f.name, f.mime, f.id, f.storage_key, f.mime, coalesce((f.meta ->> 'thumb')::boolean, false),
         im.created_at, f.storage_key
    from public.entity_images im
    join public.files f on f.id = im.file_id
    left join public.room_types rt on im.entity_type = 'room_type' and rt.id = im.entity_id
   where im.project_id = p_project
  union all
  -- фото из задач, мест и комментариев — по тем же правилам, что у вложений
  select 'photo',
         'att:' || a.id,
         null::uuid, f.id,
         f.name,
         coalesce(t.key || ' ' || t.title, ''),
         f.name, f.mime, f.id, f.storage_key, f.mime, coalesce((f.meta ->> 'thumb')::boolean, false),
         a.created_at, f.storage_key
    from public.attachments a
    join public.files f on f.id = a.file_id and f.mime like 'image/%'
    left join public.tasks t on a.entity_type = 'task' and t.id = a.entity_id
   where a.project_id = p_project
     and private.user_can_view_entity(v_me, a.entity_type, a.entity_id)
     and ((a.comment_id is null and (v_internal or a.created_by = v_me))
          or exists (select 1 from public.comments c
                      where c.id = a.comment_id and c.deleted_at is null and (c.visibility = 'external' or v_internal)))
  order by 13 desc
  limit 3000;
end;
$$;
revoke all on function public.project_file_catalog(uuid) from public, anon;
grant execute on function public.project_file_catalog(uuid) to authenticated;

-- Вложение: файл — любой файл этого проекта (видимость проверяет политика вставки, под правами добавляющего)
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
     where f.id = new.file_id and f.tenant_id = new.tenant_id and f.project_id = v_project;
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

-- Один и тот же файл к карточке дважды не прикрепляем
create unique index board_card_attachments_card_file on public.board_card_attachments (card_id, file_id) where file_id is not null;

drop policy board_card_attachments_insert on public.board_card_attachments;
create policy board_card_attachments_insert on public.board_card_attachments for insert to authenticated
  with check (tenant_id = (select private.tenant_id())
              and private.board_can_view(board_id) and private.board_card_visible(card_id)
              -- файл должен быть виден добавляющему (подзапрос идёт под RLS файлов)
              and (file_id is null or exists (select 1 from public.files f where f.id = file_id)));

notify pgrst, 'reload schema';
