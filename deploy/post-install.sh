#!/usr/bin/env bash
# Выполнить ОДИН РАЗ после первого успешного деплоя (когда миграции уже применены).
# Прописывает в БД адреса и секреты, по которым pg_cron будит Edge-функции (почта, тексты документов, погода).
# В локальной разработке это делает supabase/seed.sql — на сервере seed не запускается.
set -euo pipefail

SUPA=/opt/supabase-project
KEY="$(grep '^SUPABASE_PUBLISHABLE_KEY=' "$SUPA/.env" | cut -d= -f2-)"
SECRET="$(grep '^EMAIL_WORKER_SECRET=' "$SUPA/.env.functions" | cut -d= -f2-)"
[ -n "$KEY" ] && [ -n "$SECRET" ] || { echo "Не найден SUPABASE_PUBLISHABLE_KEY в .env или EMAIL_WORKER_SECRET в .env.functions"; exit 1; }

# api-gw — имя шлюза Supabase в сети Docker: БД обращается к функциям напрямую, минуя интернет
docker exec -i supabase-db psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
insert into private.app_config (key, value) values
  ('email_worker_url',   'http://api-gw:8000/functions/v1/send-emails'),
  ('text_worker_url',    'http://api-gw:8000/functions/v1/extract-texts'),
  ('weather_worker_url', 'http://api-gw:8000/functions/v1/weather'),
  ('email_worker_secret', '$SECRET'),
  ('functions_apikey',    '$KEY')
on conflict (key) do update set value = excluded.value;
SQL
echo "Готово."
