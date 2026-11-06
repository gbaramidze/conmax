-- Чтение документов: текст извлекается из загруженных файлов (PDF, Word, Excel, TXT/CSV…) и ищется по содержимому.
-- Воркер — Edge Function extract-texts (раз в минуту будится из БД, как почтовый воркер).

create table public.file_texts (
  file_id      uuid primary key references public.files(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','processing','done','unsupported','failed')),
  method       text,
  text         text,
  tsv          tsvector,
  error        text,
  attempts     integer not null default 0,
  claimed_at   timestamptz,
  extracted_at timestamptz
);
create index on public.file_texts using gin (tsv);
create index on public.file_texts (status) where status in ('pending', 'processing');

alter table public.file_texts enable row level security;
alter table public.file_texts force row level security;
-- Текст виден тем, кто видит сам файл (политика files_select учитывает версии документов и вложения)
create policy file_texts_select on public.file_texts for select to authenticated
  using (tenant_id = (select private.tenant_id()) and exists (select 1 from public.files f where f.id = file_texts.file_id));
revoke all on public.file_texts from authenticated, anon;
-- читать извлечённый текст может тот, кто видит файл (политика выше); служебные колонки очереди наружу не нужны
grant select (file_id, status, method, text, tsv, extracted_at) on public.file_texts to authenticated;

-- Какие файлы читаем: по расширению; DWG и сканы без текстового слоя пока не поддерживаются
create or replace function private.file_text_supported(p_name text) returns boolean
language sql immutable as $$
  select lower(coalesce(substring(p_name from '\.([A-Za-z0-9]{1,8})$'), '')) in
    ('pdf', 'docx', 'xlsx', 'xlsm', 'txt', 'csv', 'md', 'json', 'xml', 'html', 'htm', 'log');
$$;

create or replace function private.files_enqueue_text() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.file_texts (file_id, tenant_id, project_id, status)
  values (new.id, new.tenant_id, new.project_id,
          case when private.file_text_supported(new.name) and new.size_bytes <= 25 * 1024 * 1024 then 'pending' else 'unsupported' end)
  on conflict do nothing;
  return new;
end;
$$;
create trigger files_enqueue_text after insert on public.files
  for each row execute function private.files_enqueue_text();

-- Уже загруженные файлы
insert into public.file_texts (file_id, tenant_id, project_id, status)
select f.id, f.tenant_id, f.project_id,
       case when private.file_text_supported(f.name) and f.size_bytes <= 25 * 1024 * 1024 then 'pending' else 'unsupported' end
  from public.files f
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Воркер: забрать пачку файлов и записать результат
-- ---------------------------------------------------------------------------
create or replace function public.claim_file_texts(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  update public.file_texts set status = 'pending' where status = 'processing' and claimed_at < now() - interval '10 minutes';

  with picked as (
    select ft.file_id from public.file_texts ft
     where ft.status = 'pending' order by ft.file_id limit p_limit for update skip locked),
  upd as (
    update public.file_texts ft set status = 'processing', attempts = ft.attempts + 1, claimed_at = now()
      from picked where ft.file_id = picked.file_id returning ft.file_id)
  select coalesce(jsonb_agg(jsonb_build_object('file_id', f.id, 'storage_key', f.storage_key, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes)), '[]')
    into v_out
    from upd join public.files f on f.id = upd.file_id;
  return v_out;
end;
$$;

create or replace function public.finish_file_text(p_file uuid, p_status text, p_method text default null, p_text text default null, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_attempts integer;
  v_text     text := left(p_text, 600000);
begin
  select attempts into v_attempts from public.file_texts where file_id = p_file;
  if p_status = 'done' then
    update public.file_texts
       set status = case when btrim(coalesce(v_text, '')) = '' then 'unsupported' else 'done' end,
           method = p_method, text = v_text,
           tsv = to_tsvector('russian', coalesce(v_text, '')) || to_tsvector('english', coalesce(v_text, '')),
           error = case when btrim(coalesce(v_text, '')) = '' then 'В файле нет текстового слоя (возможно, скан)' end,
           extracted_at = now()
     where file_id = p_file;
  elsif p_status = 'unsupported' then
    update public.file_texts set status = 'unsupported', error = left(p_error, 500), extracted_at = now() where file_id = p_file;
  elsif v_attempts >= 3 then
    update public.file_texts set status = 'failed', error = left(p_error, 500) where file_id = p_file;
  else
    update public.file_texts set status = 'pending', error = left(p_error, 500) where file_id = p_file;
  end if;
end;
$$;

revoke execute on function public.claim_file_texts(integer), public.finish_file_text(uuid, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.claim_file_texts(integer), public.finish_file_text(uuid, text, text, text, text) to service_role;

create or replace function private.kick_text_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  if not exists (select 1 from public.file_texts where status = 'pending') then return; end if;
  select value into v_url    from private.app_config where key = 'text_worker_url';
  select value into v_secret from private.app_config where key = 'email_worker_secret';
  select value into v_key    from private.app_config where key = 'functions_apikey';
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', coalesce(v_secret, ''), 'apikey', coalesce(v_key, '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
end;
$$;
select cron.schedule('buildos-extract-texts', '* * * * *', $$select private.kick_text_worker()$$);

-- ---------------------------------------------------------------------------
-- Поиск по содержимому документов проекта (с правами вызывающего: видно только то, что он вправе видеть)
-- ---------------------------------------------------------------------------
create or replace function public.search_documents(p_project uuid, p_query text)
returns table (document_id uuid, version_id uuid, revision text, rank real, snippet text)
language sql stable set search_path = '' as $$
  with q as (select websearch_to_tsquery('russian', p_query) || websearch_to_tsquery('english', p_query) as tsq)
  select d.id, v.id, v.revision, ts_rank(ft.tsv, q.tsq),
         ts_headline('russian', ft.text, q.tsq, 'StartSel=«, StopSel=», MaxFragments=2, MaxWords=24, MinWords=8, FragmentDelimiter= … ')
    from q
    join public.file_texts ft on ft.status = 'done' and ft.tsv @@ q.tsq
    join public.document_versions v on v.file_id = ft.file_id
    join public.documents d on d.id = v.document_id and d.project_id = p_project and d.deleted_at is null
   where length(btrim(coalesce(p_query, ''))) >= 3
     and (v.id = d.current_version_id or d.current_version_id is null)
   order by 4 desc
   limit 30;
$$;
revoke execute on function public.search_documents(uuid, text) from public, anon;
grant  execute on function public.search_documents(uuid, text) to authenticated;

grant execute on all functions in schema private to authenticated, supabase_auth_admin;
