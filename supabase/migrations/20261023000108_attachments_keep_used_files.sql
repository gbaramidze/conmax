-- Удаление вложения не должно падать, если тот же файл нужен ещё где-то.
--
-- После снятия последнего вложения файл удалялся, но на него могут ссылаться и другие записи (например, фото инспекции, которое
-- прикреплено и к задаче по замечанию): тогда база отвечала ошибкой и вложение нельзя было убрать. Теперь, если файл ещё используется
-- (любая внешняя ссылка), он просто остаётся.

create or replace function private.attachments_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    delete from public.files f
     where f.id = old.file_id
       and not exists (select 1 from public.attachments a where a.file_id = f.id);
  exception when foreign_key_violation then
    null;
  end;
  return old;
end;
$$;
