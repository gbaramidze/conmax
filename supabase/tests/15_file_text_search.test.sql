-- Требует сид-данных. Очередь чтения файлов и поиск по содержимому документов.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare u record;
begin
  select id, tenant_id, is_external into u from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.id, 'role', 'authenticated', 'tenant_id', u.tenant_id, 'is_external', u.is_external)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

select id as zk7, tenant_id as tenant from public.projects where code = 'ZK7' \gset
select id as pm1 from public.users where email = 'pm1@demo.test' \gset

-- файлы создаются от имени РП (триггер берёт тенанта и автора из JWT)
select set_config('request.jwt.claims', json_build_object('sub', :'pm1'::text, 'role', 'authenticated', 'tenant_id', :'tenant'::text)::text, true);
insert into public.files (project_id, storage_key, name, mime, size_bytes) values
  (:'zk7', :'tenant' || '/' || :'zk7' || '/t-pdf.pdf', 'Перегородки.pdf', 'application/pdf', 1000),
  (:'zk7', :'tenant' || '/' || :'zk7' || '/t-dwg.dwg', 'План.dwg', 'application/acad', 1000),
  (:'zk7', :'tenant' || '/' || :'zk7' || '/t-scan.pdf', 'Скан.pdf', 'application/pdf', 1000);
select set_config('request.jwt.claims', '', true);
select id as f_pdf from public.files where storage_key like '%/t-pdf.pdf' \gset
select id as f_dwg from public.files where storage_key like '%/t-dwg.dwg' \gset
select id as f_scan from public.files where storage_key like '%/t-scan.pdf' \gset

-- 1. Очередь
select is((select status from public.file_texts where file_id = :'f_pdf'), 'pending', 'PDF ставится в очередь на чтение');
select is((select status from public.file_texts where file_id = :'f_dwg'), 'unsupported', 'DWG пока не читается и сразу помечен');
select ok((select jsonb_array_length(public.claim_file_texts(50))) >= 2, 'воркер забирает файлы пачкой');
select is((select status from public.file_texts where file_id = :'f_pdf'), 'processing', 'забранный файл в обработке');

-- 2. Результат и поиск
select public.finish_file_text(:'f_pdf', 'done', 'pdf', 'Перегородка между комнатами 512 и 513 выполняется из газобетона, толщина 100 мм.');
select is((select status from public.file_texts where file_id = :'f_pdf'), 'done', 'текст сохранён');
select public.finish_file_text(:'f_scan', 'done', 'pdf', '   ');
select is((select status from public.file_texts where file_id = :'f_scan'), 'unsupported', 'файл без текстового слоя (скан) помечается как нечитаемый');

select pg_temp.act_as('pm1@demo.test');
select public.create_document(:'zk7', 'Перегородки 5 этажа', 'ZK7-AR-T15', 'plan', null, 'internal', false, :'f_pdf', 'A', null, '{}'::uuid[], '{}'::uuid[], true) as doc \gset
select is((select count(*)::int from public.search_documents(:'zk7', 'перегородки')), 1, 'поиск находит документ по другой форме слова (перегородка → перегородки)');
select ok((select snippet from public.search_documents(:'zk7', 'газобетон') limit 1) like '%«газобетона»%', 'в ответе есть фрагмент текста с найденным словом');
select is((select count(*)::int from public.search_documents(:'zk7', 'вертолёт')), 0, 'по отсутствующему слову ничего не находится');
select pg_temp.back();

-- 3. Внешний участник не видит внутренний документ в результатах
select pg_temp.act_as('sub1@demo.test');
select is((select count(*)::int from public.search_documents(:'zk7', 'перегородки')), 0, 'подрядчик не находит внутренний документ');
select pg_temp.back();

select * from finish();
rollback;
