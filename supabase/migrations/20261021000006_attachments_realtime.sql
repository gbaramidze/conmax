-- Вложения приходят в realtime, чтобы чужие комментарии появлялись сразу с файлами.
alter publication supabase_realtime add table public.attachments;
