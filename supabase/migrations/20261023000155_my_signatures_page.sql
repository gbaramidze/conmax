-- «Мои подписи» в профиле: все подписанные мной файлы с датами, и сами файлы можно открыть.
--  * Документ проекта — у каждой подписи запоминается файл, который получился после неё (`signatures.file_id`):
--    рабочая копия запроса после моих штампов. Его видит подписавший (он его загрузил) и участники запроса.
--  * PDF из письма — копия подписанного файла кладётся в личный приватный бакет `signed-files`
--    (<tenant_id>/<user_id>/<код>.pdf), видит только сам подписавший; путь — `signatures.file_path`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signed-files', 'signed-files', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy signed_files_select on storage.objects for select to authenticated
  using (bucket_id = 'signed-files'
         and (storage.foldername(name))[1] = (select private.tenant_id())::text
         and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy signed_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signed-files'
              and (storage.foldername(name))[1] = (select private.tenant_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy signed_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'signed-files'
         and (storage.foldername(name))[1] = (select private.tenant_id())::text
         and (storage.foldername(name))[2] = (select auth.uid())::text);

alter table public.signatures add column file_id uuid references public.files(id) on delete set null;
alter table public.signatures add column file_path text check (file_path is null or char_length(file_path) <= 300);

-- Подписант сохранил подпись → рабочая копия запроса сменилась: это и есть файл с его штампами
create or replace function private.signatures_remember_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.signatures set file_id = new.current_file_id
   where request_id = new.id and file_id is null and signer_id = auth.uid();
  return new;
end;
$$;
create trigger signature_requests_remember_file after update of current_file_id on public.signature_requests
  for each row when (old.current_file_id is distinct from new.current_file_id)
  execute function private.signatures_remember_file();

-- Подпись PDF из письма: + путь к личной копии подписанного файла
drop function public.record_signature(uuid[], int[], text, text, text, text);
create or replace function public.record_signature(p_codes uuid[], p_pages int[], p_file_name text, p_hash_before text, p_hash_after text,
                                                   p_user_agent text, p_file_path text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
begin
  -- копия — только в своей папке личного бакета
  if p_file_path is not null and p_file_path not like private.tenant_id()::text || '/' || auth.uid()::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  v_batch := private.insert_signature_marks(p_codes, p_pages, 'mail', null, null, null, p_file_name, p_hash_before, p_hash_after, p_user_agent);
  update public.signatures set file_path = p_file_path where batch_id = v_batch and p_file_path is not null;
  return v_batch;
end;
$$;
revoke execute on function public.record_signature(uuid[], int[], text, text, text, text, text) from public, anon;
grant execute on function public.record_signature(uuid[], int[], text, text, text, text, text) to authenticated;

/** Мои подписания (одна строка на подписание, штампы собраны), новые сверху. */
create or replace function public.my_signatures(p_limit int default 500)
returns table (batch_id uuid, signed_at timestamptz, file_name text, source text, marks int, pages int[], codes uuid[],
               document_id uuid, document_title text, project_code text, storage_key text, file_path text, hash_after text)
language sql stable security definer set search_path = '' as $$
  select s.batch_id, min(s.signed_at), min(s.file_name), min(s.source), count(*)::int,
         array_agg(s.page::int order by s.page, s.id), array_agg(s.id order by s.page, s.id),
         min(s.document_id::text)::uuid,
         min(case when private.user_can_view_document(auth.uid(), s.document_id) then d.title end),
         min(case when private.user_can_view_document(auth.uid(), s.document_id) then p.code end),
         min(f.storage_key), min(s.file_path), min(s.hash_after)
    from public.signatures s
    left join public.documents d on d.id = s.document_id
    left join public.projects p on p.id = s.project_id
    left join public.files f on f.id = s.file_id
   where s.signer_id = auth.uid() and s.tenant_id = private.tenant_id()
   group by s.batch_id
   order by min(s.signed_at) desc
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;
revoke execute on function public.my_signatures(int) from public, anon;
grant execute on function public.my_signatures(int) to authenticated;
