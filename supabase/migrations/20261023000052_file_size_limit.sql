-- Лимит файла проекта (бакет files): 150 МБ вместо 50 МБ (чертежи, сканы, комплекты PDF, видео обхода).
-- Общий предел сервиса хранилища задаётся в supabase/config.toml ([storage] file_size_limit).
update storage.buckets set file_size_limit = 157286400 where id = 'files';
