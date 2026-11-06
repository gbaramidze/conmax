-- Глобальный поиск (Ctrl+K): проекты, задачи, документы (в том числе по тексту внутри файлов), места.
-- С правами вызывающего: находит только то, что он вправе видеть.
create or replace function public.global_search(p_query text)
returns table (kind text, id uuid, title text, subtitle text, project_code text, ref text, snippet text, rank real)
language sql stable set search_path = '' as $$
  with q as (
    select btrim(coalesce(p_query, '')) as raw,
           '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  tsq as (select websearch_to_tsquery('russian', (select raw from q)) || websearch_to_tsquery('english', (select raw from q)) as v)
  select * from (
    (select 'project', p.id, p.name, p.code, p.code, p.code, null::text, 1.0::real
       from public.projects p, q
      where p.deleted_at is null and length(q.raw) >= 2 and (p.name ilike q.pattern or p.code ilike q.pattern)
      limit 5)
    union all
    (select 'task', t.id, t.title, t.key || ' · ' || coalesce(ws.name, ''), p.code, t.key, null::text, 0.9::real
       from public.tasks t
       join public.projects p on p.id = t.project_id
       left join public.workflow_statuses ws on ws.id = t.status_id, q
      where t.deleted_at is null and length(q.raw) >= 2 and (t.key ilike q.pattern or t.title ilike q.pattern)
      order by (t.key ilike q.raw) desc, t.created_at desc
      limit 8)
    union all
    (select 'document', d.id, d.title, coalesce(d.code, 'Документ'), p.code, d.id::text, null::text, 0.8::real
       from public.documents d
       join public.projects p on p.id = d.project_id, q
      where d.deleted_at is null and length(q.raw) >= 2 and (d.title ilike q.pattern or d.code ilike q.pattern)
      limit 6)
    union all
    (select 'document_text', d.id, d.title, coalesce(d.code, 'Найдено в тексте'), p.code, d.id::text,
            ts_headline('russian', ft.text, tsq.v, 'StartSel=«, StopSel=», MaxFragments=1, MaxWords=22, MinWords=8'),
            ts_rank(ft.tsv, tsq.v)
       from tsq, public.file_texts ft
       join public.document_versions v on v.file_id = ft.file_id
       join public.documents d on d.id = v.document_id and d.deleted_at is null and (v.id = d.current_version_id or d.current_version_id is null)
       join public.projects p on p.id = d.project_id
      where length((select raw from q)) >= 3 and ft.status = 'done' and ft.tsv @@ tsq.v
      order by 8 desc
      limit 6)
    union all
    (select 'location', l.id, l.name, l.path::text, p.code, l.path::text, null::text, 0.7::real
       from public.locations l
       join public.projects p on p.id = l.project_id, q
      where l.deleted_at is null and length(q.raw) >= 2 and (l.name ilike q.pattern or l.path::text ilike q.pattern)
      order by l.path
      limit 6)
  ) r(kind, id, title, subtitle, project_code, ref, snippet, rank);
$$;
revoke execute on function public.global_search(text) from public, anon;
grant  execute on function public.global_search(text) to authenticated;
