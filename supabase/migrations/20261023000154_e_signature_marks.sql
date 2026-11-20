-- Электронная подпись, доработка по просьбе пользователя:
--  1) у каждого штампа на документе — свой код (штампов при одной подписи может быть несколько, например на каждой
--     странице); каждый код — отдельная строка журнала с номером страницы, а общий `batch_id` связывает штампы
--     одного подписания;
--  2) «Мои подписи» — список (полная подпись, инициалы…), а не одна; не больше 10. Раньше сохранение молча падало:
--     клиент слал user_id, а право на вставку было только на image.

-- ---------------------------------------------------------------------------------------------------------------------
-- Мои подписи — списком
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.user_signatures drop constraint user_signatures_pkey;
alter table public.user_signatures add column id uuid not null default gen_random_uuid() primary key;
alter table public.user_signatures add column created_at timestamptz not null default now();
create index user_signatures_user on public.user_signatures (user_id, created_at desc);
revoke update on public.user_signatures from authenticated;

create or replace function private.user_signatures_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.user_signatures where user_id = new.user_id) >= 10 then
    raise exception 'too_many_signatures' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger user_signatures_limit before insert on public.user_signatures for each row execute function private.user_signatures_limit();

-- ---------------------------------------------------------------------------------------------------------------------
-- Журнал: строка на каждый штамп
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.signatures add column page smallint check (page is null or page >= 1);
alter table public.signatures add column batch_id uuid;
update public.signatures set batch_id = id where batch_id is null;
alter table public.signatures alter column batch_id set not null;
create index signatures_batch on public.signatures (batch_id);

drop function public.sign_signature_request(uuid, uuid, uuid, uuid, text, text, text);
drop function public.record_signature(uuid, text, text, text, text);
drop function public.verify_signature(uuid, text);

/** Строки журнала для штампов одного подписания: коды и страницы — параллельные массивы. */
create or replace function private.insert_signature_marks(
  p_codes uuid[], p_pages int[], p_source text, p_project uuid, p_document uuid, p_request uuid, p_file_name text,
  p_hash_before text, p_hash_after text, p_user_agent text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_n     int := coalesce(array_length(p_codes, 1), 0);
  v_name  text;
  v_batch uuid;
begin
  if v_n = 0 then raise exception 'marks_required' using errcode = '22023'; end if;
  if v_n > 200 then raise exception 'too_many_marks' using errcode = '22023'; end if;
  if coalesce(array_length(p_pages, 1), 0) <> v_n then raise exception 'marks_mismatch' using errcode = '22023'; end if;
  v_batch := p_codes[1];
  select full_name into v_name from public.users where id = auth.uid();
  insert into public.signatures (id, tenant_id, signer_id, signer_name, source, project_id, document_id, request_id, file_name,
                                 hash_before, hash_after, user_agent, page, batch_id)
  select c.code, private.tenant_id(), auth.uid(), v_name, p_source, p_project, p_document, p_request, left(btrim(p_file_name), 300),
         lower(p_hash_before), lower(p_hash_after), left(p_user_agent, 400), c.page, v_batch
    from unnest(p_codes, p_pages) as c(code, page);
  return v_batch;
end;
$$;
revoke execute on function private.insert_signature_marks(uuid[], int[], text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Подписать документ по запросу: как раньше, но кодов — по числу штампов
create or replace function public.sign_signature_request(
  p_request uuid, p_codes uuid[], p_pages int[], p_base_file uuid, p_file uuid, p_hash_before text, p_hash_after text, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  r       public.signature_requests;
  s       public.signature_request_signers;
  d       public.documents;
  base    public.document_versions;
  v_file  public.files;
  v_name  text;
  v_batch uuid;
  v_ver   uuid;
  v_no    int;
  v_names text;
begin
  select * into r from public.signature_requests where id = p_request and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'request_closed' using errcode = '22023'; end if;
  select * into s from public.signature_request_signers where request_id = r.id and user_id = v_uid;
  if not found or s.status <> 'pending' then raise exception 'not_a_signer' using errcode = '42501'; end if;
  if r.sequential and s.position <> (select min(position) from public.signature_request_signers where request_id = r.id and status = 'pending') then
    raise exception 'not_your_turn' using errcode = '22023';
  end if;
  if p_base_file is distinct from r.current_file_id then raise exception 'stale_copy' using errcode = '40001'; end if;
  select * into v_file from public.files where id = p_file and project_id = r.project_id and created_by = v_uid;
  if not found then raise exception 'file_not_found' using errcode = '23503'; end if;

  select full_name into v_name from public.users where id = v_uid;
  select * into d from public.documents where id = r.document_id;
  v_batch := private.insert_signature_marks(p_codes, p_pages, 'document', r.project_id, r.document_id, r.id, v_file.name,
                                            p_hash_before, p_hash_after, p_user_agent);
  update public.signature_request_signers set status = 'signed', signature_id = v_batch, decided_at = now()
   where request_id = r.id and user_id = v_uid;
  update public.signature_requests set current_file_id = p_file where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'document', r.document_id, 'document_signed',
                               jsonb_build_object('name', v_name, 'code', v_batch, 'marks', array_length(p_codes, 1)), 'internal');

  if exists (select 1 from public.signature_request_signers where request_id = r.id and status = 'pending') then
    perform private.notify_direct(r.created_by, r.project_id, 'watching', 'normal', 'signature.signed', 'document', r.document_id,
                                  'Подпись · ' || (select code from public.projects where id = r.project_id),
                                  format('%s подписал(а) документ «%s»', v_name, d.title), private.signature_link(r.id));
    perform private.notify_signers_turn(r.id);
    return jsonb_build_object('completed', false);
  end if;

  select * into base from public.document_versions where id = r.base_version_id;
  select string_agg(u.full_name, ', ' order by s2.position) into v_names
    from public.signature_request_signers s2 join public.users u on u.id = s2.user_id where s2.request_id = r.id;
  select coalesce(max(version_no), 0) + 1 into v_no from public.document_versions where document_id = d.id;
  insert into public.document_versions (tenant_id, project_id, document_id, version_no, revision, file_id, note, created_by)
  values (d.tenant_id, d.project_id, d.id, v_no, base.revision, p_file, left('Подписан: ' || v_names, 2000), r.created_by)
  returning id into v_ver;
  if d.current_version_id = base.id then
    update public.document_versions set status = 'superseded' where id = base.id;
    update public.document_versions set status = 'published', published_by = r.created_by, published_at = now() where id = v_ver;
    update public.documents set current_version_id = v_ver where id = d.id;
  end if;
  update public.signature_requests set status = 'completed', finished_at = now(), result_version_id = v_ver where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'document', r.document_id, 'signature_completed',
                               jsonb_build_object('revision', base.revision, 'version_no', v_no), 'internal');
  perform private.notify_direct(r.created_by, r.project_id, 'watching', 'high', 'signature.completed', 'document', r.document_id,
                                'Подписано · ' || (select code from public.projects where id = r.project_id),
                                format('Документ «%s» подписали все', d.title), private.signature_link(r.id));
  return jsonb_build_object('completed', true, 'version_id', v_ver);
end;
$$;

-- PDF не из документа проекта (вложение письма): только в журнал
create or replace function public.record_signature(p_codes uuid[], p_pages int[], p_file_name text, p_hash_before text, p_hash_after text, p_user_agent text)
returns uuid
language sql security definer set search_path = '' as $$
  select private.insert_signature_marks(p_codes, p_pages, 'mail', null, null, null, p_file_name, p_hash_before, p_hash_after, p_user_agent);
$$;

-- Проверка по коду любого штампа (или по контрольной сумме файла); `marks` — сколько штампов в этом подписании
create or replace function public.verify_signature(p_code uuid default null, p_hash text default null)
returns table (id uuid, signer_name text, signed_at timestamptz, file_name text, source text, hash_before text, hash_after text,
               document_title text, project_code text, document_id uuid, page smallint, batch_id uuid, marks int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.signer_name, s.signed_at, s.file_name, s.source, s.hash_before, s.hash_after,
         case when s.document_id is not null and private.user_can_view_document(auth.uid(), s.document_id) then d.title end,
         case when s.document_id is not null and private.user_can_view_document(auth.uid(), s.document_id) then p.code end,
         case when s.document_id is not null and private.user_can_view_document(auth.uid(), s.document_id) then s.document_id end,
         s.page, s.batch_id,
         (select count(*)::int from public.signatures b where b.batch_id = s.batch_id)
    from public.signatures s
    left join public.documents d on d.id = s.document_id
    left join public.projects p on p.id = s.project_id
   where s.tenant_id = private.tenant_id()
     and ((p_code is not null and s.id = p_code)
          -- по файлу — одна строка на подписание (штампы одного подписания показываем одной записью)
          or (p_hash is not null and s.hash_after = lower(p_hash) and s.id = s.batch_id))
   order by s.signed_at
   limit 50;
$$;

revoke execute on function public.sign_signature_request(uuid, uuid[], int[], uuid, uuid, text, text, text),
  public.record_signature(uuid[], int[], text, text, text, text), public.verify_signature(uuid, text) from public, anon;
grant execute on function public.sign_signature_request(uuid, uuid[], int[], uuid, uuid, text, text, text),
  public.record_signature(uuid[], int[], text, text, text, text), public.verify_signature(uuid, text) to authenticated;
