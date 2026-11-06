-- Булавки замечаний на плане: у каждого документа своя нумерация 1, 2, 3…
--
-- Раньше на булавке показывался номер задачи из общего счётчика проекта (RTG1-P-37 → «37»), поэтому на новом плане первая
-- булавка могла быть «37». Теперь у булавки есть номер в документе `doc_no`: считается отдельно по каждому документу, по порядку
-- постановки, и никогда не переиспользуется (убрали булавку 2 — следующая будет 4, а не 2: на чертеже и в обсуждении номер
-- остаётся за одним замечанием). Номер хранится у булавки и не зависит от версии документа.
-- Счётчик лежит в `project_counters` (вид `pin:<документ>`), как и остальные номера проекта.
-- Существующие булавки пронумерованы по порядку создания в каждом документе.
-- См. docs: 05-roadmap/05-backlog.md, раздел «Нумерация булавок».

alter table public.task_pins add column doc_no integer;

with n as (select id, row_number() over (partition by document_id order by created_at, id) as rn from public.task_pins)
update public.task_pins p set doc_no = n.rn from n where n.id = p.id;

insert into public.project_counters (project_id, kind, last_number)
select project_id, 'pin:' || document_id, count(*) from public.task_pins group by project_id, document_id
on conflict (project_id, kind) do update set last_number = excluded.last_number;

alter table public.task_pins alter column doc_no set not null;
create unique index task_pins_document_no_key on public.task_pins (document_id, doc_no);

create or replace function private.task_pins_set_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_counters as pc (project_id, kind, last_number) values (new.project_id, 'pin:' || new.document_id, 1)
  on conflict (project_id, kind) do update set last_number = pc.last_number + 1
  returning last_number into new.doc_no;
  return new;
end;
$$;
create trigger task_pins_set_no before insert on public.task_pins
  for each row execute function private.task_pins_set_no();
