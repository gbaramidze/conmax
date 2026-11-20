-- Электронная подпись PDF (этап 1, простая электронная подпись).
-- Человек рисует подпись один раз (`user_signatures`), ставит её на лист PDF в просмотрщике; браузер вшивает в страницу
-- штамп «eSigned by: имя · код · дата». Каждая подпись — строка журнала `signatures`: кто, когда, какой файл, контрольные
-- суммы SHA-256 файла до и после подписи (по ним видно, что подписанный файл потом не меняли). Код подписи = id строки,
-- он же напечатан в штампе — по нему подпись проверяется (`verify_signature`).
-- Документ проекта отправляют на подпись (`signature_requests`): подписанты по очереди или все сразу подписывают рабочую копию
-- файла; когда подписали все — подписанный файл становится новой действующей версией документа. Отказ закрывает запрос.
-- Внешние подписанты по ссылке и квалифицированная подпись (сертификат) — следующие этапы.

-- ---------------------------------------------------------------------------------------------------------------------
-- Моя подпись: рисунок (PNG) — один на человека
-- ---------------------------------------------------------------------------------------------------------------------
create table public.user_signatures (
  user_id    uuid primary key default auth.uid() references public.users(id) on delete cascade,
  tenant_id  uuid not null default private.tenant_id() references public.tenants(id),
  image      text not null check (image like 'data:image/png;base64,%' and char_length(image) <= 400000),
  updated_at timestamptz not null default now()
);
alter table public.user_signatures enable row level security;
alter table public.user_signatures force row level security;
create policy user_signatures_owner on public.user_signatures for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and tenant_id = (select private.tenant_id()));
revoke all on public.user_signatures from anon, authenticated;
grant select, delete on public.user_signatures to authenticated;
grant insert (image), update (image, updated_at) on public.user_signatures to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Запросы на подпись документа проекта
-- ---------------------------------------------------------------------------------------------------------------------
create table public.signature_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id),
  project_id        uuid not null references public.projects(id),
  document_id       uuid not null references public.documents(id) on delete cascade,
  base_version_id   uuid not null references public.document_versions(id),
  /** Рабочая копия: исходный PDF, затем — с подписями тех, кто уже подписал */
  current_file_id   uuid not null references public.files(id),
  sequential        boolean not null default true,
  message           text check (message is null or char_length(message) <= 2000),
  status            text not null default 'pending' check (status in ('pending', 'completed', 'declined', 'cancelled')),
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  result_version_id uuid references public.document_versions(id)
);
create index signature_requests_document on public.signature_requests (document_id, created_at desc);
-- на документ — не больше одного открытого запроса
create unique index signature_requests_one_open on public.signature_requests (document_id) where status = 'pending';

create table public.signature_request_signers (
  request_id     uuid not null references public.signature_requests(id) on delete cascade,
  user_id        uuid not null references public.users(id),
  position       smallint not null check (position between 1 and 50),
  status         text not null default 'pending' check (status in ('pending', 'signed', 'declined')),
  signature_id   uuid,
  decided_at     timestamptz,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 1000),
  primary key (request_id, user_id)
);
create index signature_request_signers_user on public.signature_request_signers (user_id) where status = 'pending';

-- ---------------------------------------------------------------------------------------------------------------------
-- Журнал подписей (документы проекта и PDF из писем)
-- ---------------------------------------------------------------------------------------------------------------------
create table public.signatures (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants(id),
  signer_id   uuid not null references public.users(id),
  signer_name text not null,
  source      text not null check (source in ('document', 'mail')),
  project_id  uuid references public.projects(id),
  document_id uuid references public.documents(id) on delete set null,
  request_id  uuid references public.signature_requests(id) on delete set null,
  file_name   text not null check (char_length(file_name) between 1 and 300),
  hash_before text not null check (hash_before ~ '^[0-9a-f]{64}$'),
  hash_after  text not null check (hash_after ~ '^[0-9a-f]{64}$'),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 400),
  signed_at   timestamptz not null default now()
);
create index signatures_document on public.signatures (document_id, signed_at);
create index signatures_hash_after on public.signatures (hash_after);
alter table public.signature_request_signers
  add constraint signature_request_signers_signature_fkey foreign key (signature_id) references public.signatures(id);

-- Видимость: запрос и подписанты — автору запроса, подписантам и тем, кто видит сам документ
create or replace function private.can_see_signature_request(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.signature_requests r
     where r.id = p_request and r.tenant_id = private.tenant_id()
       and (r.created_by = auth.uid()
            or exists (select 1 from public.signature_request_signers s where s.request_id = r.id and s.user_id = auth.uid())
            or private.user_can_view_document(auth.uid(), r.document_id)));
$$;
grant execute on function private.can_see_signature_request(uuid) to authenticated;

alter table public.signature_requests enable row level security;
alter table public.signature_requests force row level security;
create policy signature_requests_select on public.signature_requests for select to authenticated
  using (private.can_see_signature_request(id));

alter table public.signature_request_signers enable row level security;
alter table public.signature_request_signers force row level security;
create policy signature_request_signers_select on public.signature_request_signers for select to authenticated
  using (private.can_see_signature_request(request_id));

alter table public.signatures enable row level security;
alter table public.signatures force row level security;
create policy signatures_select on public.signatures for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (signer_id = (select auth.uid())
         or (document_id is not null and private.user_can_view_document((select auth.uid()), document_id))
         or (request_id is not null and private.can_see_signature_request(request_id)))
  );

-- всё меняется только функциями ниже
revoke all on public.signature_requests, public.signature_request_signers, public.signatures from anon, authenticated;
grant select on public.signature_requests, public.signature_request_signers, public.signatures to authenticated;

-- Рабочую копию подписываемого файла видят все, кто видит запрос (подзапрос идёт под RLS запросов); остальное — как было
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    tenant_id = (select private.tenant_id())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.attachments a where a.file_id = files.id)
         or exists (select 1 from public.document_versions v where v.file_id = files.id or v.preview_file_id = files.id)
         or private.user_can_hear_file((select auth.uid()), id)
         or exists (select 1 from public.projects p where p.cover_file_id = files.id and p.deleted_at is null and private.can_see_project(p.id))
         or exists (select 1 from public.entity_images i where i.file_id = files.id)
         or exists (select 1 from public.entity_image_versions v where v.file_id = files.id)
         or exists (select 1 from public.inspection_photos ph where ph.file_id = files.id)
         or exists (select 1 from public.inspection_reports r
                     where files.id in (r.scheme_file_id, r.client_sign_file_id, r.contractor_sign_file_id))
         or exists (select 1 from public.board_card_attachments ba where ba.file_id = files.id)
         or exists (select 1 from public.signature_requests sr where sr.current_file_id = files.id))
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- Уведомления
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.signature_link(p_request uuid) returns text
language sql stable security definer set search_path = '' as $$
  select '/projects/' || p.code || '/plan/' || r.document_id
    from public.signature_requests r join public.projects p on p.id = r.project_id where r.id = p_request;
$$;

/** Подписантам, чья очередь: по порядку — первому неподписавшему, «все сразу» — всем неподписавшим, кому ещё не писали. */
create or replace function private.notify_signers_turn(p_request uuid, p_only uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  v_user uuid;
begin
  select sr.*, d.title, p.code into r
    from public.signature_requests sr join public.documents d on d.id = sr.document_id join public.projects p on p.id = sr.project_id
   where sr.id = p_request;
  if r.status <> 'pending' then return; end if;
  for v_user in
    select s.user_id from public.signature_request_signers s
     where s.request_id = p_request and s.status = 'pending'
       and (p_only is null or s.user_id = p_only)
       and (not r.sequential or s.position = (select min(s2.position) from public.signature_request_signers s2
                                               where s2.request_id = p_request and s2.status = 'pending'))
  loop
    perform private.notify_direct(v_user, r.project_id, 'assigned', 'high', 'signature.requested', 'document', r.document_id,
                                  'На подпись · ' || r.code,
                                  format('Просят подписать документ «%s»', r.title),
                                  private.signature_link(p_request));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Отправить на подпись
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.create_signature_request(p_document uuid, p_signers uuid[], p_sequential boolean, p_message text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  d       public.documents;
  v_ver   public.document_versions;
  v_file  public.files;
  v_id    uuid;
  v_user  uuid;
  v_pos   int := 0;
  v_names text[] := '{}';
begin
  select * into d from public.documents where id = p_document and tenant_id = private.tenant_id() and deleted_at is null;
  if not found or not private.user_can_view_document(v_uid, d.id) then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if not private.has_project_permission(d.project_id, 'document.upload') then
    raise exception 'permission denied: document.upload' using errcode = '42501';
  end if;
  select * into v_ver from public.document_versions where id = d.current_version_id;
  if not found then raise exception 'document_not_published' using errcode = '22023'; end if;
  select * into v_file from public.files where id = v_ver.file_id;
  if v_file.mime <> 'application/pdf' and v_file.name !~* '\.pdf$' then raise exception 'not_pdf' using errcode = '22023'; end if;
  if coalesce(array_length(p_signers, 1), 0) = 0 then raise exception 'signers_required' using errcode = '22023'; end if;
  if array_length(p_signers, 1) > 20 then raise exception 'too_many_signers' using errcode = '22023'; end if;
  if exists (select 1 from public.signature_requests where document_id = d.id and status = 'pending') then
    raise exception 'request_exists' using errcode = '23505';
  end if;

  insert into public.signature_requests (tenant_id, project_id, document_id, base_version_id, current_file_id, sequential, message, created_by)
  values (d.tenant_id, d.project_id, d.id, v_ver.id, v_file.id, coalesce(p_sequential, true), nullif(btrim(coalesce(p_message, '')), ''), v_uid)
  returning id into v_id;

  foreach v_user in array p_signers loop
    if exists (select 1 from public.signature_request_signers where request_id = v_id and user_id = v_user) then continue; end if;
    if not exists (select 1 from public.users u where u.id = v_user and u.tenant_id = d.tenant_id and u.status <> 'blocked')
       or not private.user_can_view_version(v_user, v_ver.id) then
      raise exception 'signer_no_access' using errcode = '22023';
    end if;
    v_pos := v_pos + 1;
    insert into public.signature_request_signers (request_id, user_id, position) values (v_id, v_user, v_pos);
    v_names := v_names || (select full_name from public.users where id = v_user);
  end loop;

  perform private.record_event(d.tenant_id, d.project_id, 'document', d.id, 'signature_requested',
                               jsonb_build_object('signers', v_names, 'sequential', coalesce(p_sequential, true)), 'internal');
  perform private.notify_signers_turn(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Подписать: браузер уже вшил штамп в рабочую копию и загрузил новый файл
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.sign_signature_request(
  p_request uuid, p_signature uuid, p_base_file uuid, p_file uuid, p_hash_before text, p_hash_after text, p_user_agent text
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
  -- пока подписывали, другой подписант уже сохранил свою подпись: подписывать нужно свежую копию
  if p_base_file is distinct from r.current_file_id then raise exception 'stale_copy' using errcode = '40001'; end if;
  select * into v_file from public.files where id = p_file and project_id = r.project_id and created_by = v_uid;
  if not found then raise exception 'file_not_found' using errcode = '23503'; end if;

  select full_name into v_name from public.users where id = v_uid;
  select * into d from public.documents where id = r.document_id;
  insert into public.signatures (id, tenant_id, signer_id, signer_name, source, project_id, document_id, request_id, file_name,
                                 hash_before, hash_after, user_agent)
  values (p_signature, r.tenant_id, v_uid, v_name, 'document', r.project_id, r.document_id, r.id, v_file.name,
          lower(p_hash_before), lower(p_hash_after), left(p_user_agent, 400));
  update public.signature_request_signers set status = 'signed', signature_id = p_signature, decided_at = now()
   where request_id = r.id and user_id = v_uid;
  update public.signature_requests set current_file_id = p_file where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'document', r.document_id, 'document_signed',
                               jsonb_build_object('name', v_name, 'code', p_signature), 'internal');

  if exists (select 1 from public.signature_request_signers where request_id = r.id and status = 'pending') then
    perform private.notify_direct(r.created_by, r.project_id, 'watching', 'normal', 'signature.signed', 'document', r.document_id,
                                  'Подпись · ' || (select code from public.projects where id = r.project_id),
                                  format('%s подписал(а) документ «%s»', v_name, d.title), private.signature_link(r.id));
    perform private.notify_signers_turn(r.id);
    return jsonb_build_object('completed', false);
  end if;

  -- подписали все: подписанный файл — новая версия документа (действующая, если подписывали действующую)
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

-- Отказаться подписывать: запрос закрывается, автору — уведомление с причиной
create or replace function public.decline_signature_request(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  r      public.signature_requests;
  v_name text;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into r from public.signature_requests where id = p_request and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'request_closed' using errcode = '22023'; end if;
  if not exists (select 1 from public.signature_request_signers where request_id = r.id and user_id = v_uid and status = 'pending') then
    raise exception 'not_a_signer' using errcode = '42501';
  end if;
  update public.signature_request_signers set status = 'declined', decided_at = now(), decline_reason = left(v_why, 1000)
   where request_id = r.id and user_id = v_uid;
  update public.signature_requests set status = 'declined', finished_at = now() where id = r.id;
  select full_name into v_name from public.users where id = v_uid;
  perform private.record_event(r.tenant_id, r.project_id, 'document', r.document_id, 'signature_declined',
                               jsonb_build_object('name', v_name, 'reason', v_why), 'internal');
  perform private.notify_direct(r.created_by, r.project_id, 'assigned', 'high', 'signature.declined', 'document', r.document_id,
                                'Отказ в подписи · ' || (select code from public.projects where id = r.project_id),
                                format('%s отказался(лась) подписать «%s»', v_name, (select title from public.documents where id = r.document_id))
                                  || coalesce(': ' || v_why, ''),
                                private.signature_link(r.id));
end;
$$;

-- Отозвать запрос: автор или тот, кто может править документ
create or replace function public.cancel_signature_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.signature_requests;
begin
  select * into r from public.signature_requests where id = p_request and tenant_id = private.tenant_id() for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'request_closed' using errcode = '22023'; end if;
  if r.created_by <> auth.uid() and not private.user_can_edit_document(auth.uid(), r.document_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.signature_requests set status = 'cancelled', finished_at = now() where id = r.id;
  perform private.record_event(r.tenant_id, r.project_id, 'document', r.document_id, 'signature_cancelled', '{}'::jsonb, 'internal');
end;
$$;

-- Подпись PDF не из документа проекта (вложение письма): только запись в журнал
create or replace function public.record_signature(p_id uuid, p_file_name text, p_hash_before text, p_hash_after text, p_user_agent text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.signatures (id, tenant_id, signer_id, signer_name, source, file_name, hash_before, hash_after, user_agent)
  values (p_id, private.tenant_id(), auth.uid(), (select full_name from public.users where id = auth.uid()), 'mail',
          left(btrim(p_file_name), 300), lower(p_hash_before), lower(p_hash_after), left(p_user_agent, 400));
end;
$$;

-- Проверка подписи по коду из штампа (или по контрольной сумме файла): любой сотрудник компании
create or replace function public.verify_signature(p_code uuid default null, p_hash text default null)
returns table (id uuid, signer_name text, signed_at timestamptz, file_name text, source text, hash_before text, hash_after text,
               document_title text, project_code text, document_id uuid)
language sql stable security definer set search_path = '' as $$
  select s.id, s.signer_name, s.signed_at, s.file_name, s.source, s.hash_before, s.hash_after,
         case when s.document_id is not null and private.user_can_view_document(auth.uid(), s.document_id) then d.title end,
         case when s.document_id is not null and private.user_can_view_document(auth.uid(), s.document_id) then p.code end,
         case when s.document_id is not null and private.user_can_view_document(auth.uid(), s.document_id) then s.document_id end
    from public.signatures s
    left join public.documents d on d.id = s.document_id
    left join public.projects p on p.id = s.project_id
   where s.tenant_id = private.tenant_id()
     and ((p_code is not null and s.id = p_code) or (p_hash is not null and s.hash_after = lower(p_hash)))
   order by s.signed_at
   limit 50;
$$;

revoke execute on function public.create_signature_request(uuid, uuid[], boolean, text), public.sign_signature_request(uuid, uuid, uuid, uuid, text, text, text),
  public.decline_signature_request(uuid, text), public.cancel_signature_request(uuid), public.record_signature(uuid, text, text, text, text),
  public.verify_signature(uuid, text) from public, anon;
grant execute on function public.create_signature_request(uuid, uuid[], boolean, text), public.sign_signature_request(uuid, uuid, uuid, uuid, text, text, text),
  public.decline_signature_request(uuid, text), public.cancel_signature_request(uuid), public.record_signature(uuid, text, text, text, text),
  public.verify_signature(uuid, text) to authenticated;
revoke execute on function private.notify_signers_turn(uuid, uuid), private.signature_link(uuid) from public, anon, authenticated;
