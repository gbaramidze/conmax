#!/usr/bin/env bash
# Выполняется на сервере из GitHub Action после загрузки файлов в /opt/buildos-deploy/incoming.
# 1) миграции БД  2) Edge-функции  3) переключение сайта на новую версию.
set -euo pipefail

SHA="${1:?нужен идентификатор релиза}"
IN=/opt/buildos-deploy/incoming
SUPA=/opt/supabase-project
WEB=/var/www/conmax

PSQL=(docker exec -i supabase-db psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

echo "==> Миграции БД"
"${PSQL[@]}" -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, applied_at timestamptz default now());"
applied=0
for f in $(ls "$IN"/migrations/*.sql | sort); do
  base="$(basename "$f" .sql)"; ver="${base%%_*}"
  if [ -n "$("${PSQL[@]}" -tAc "select 1 from supabase_migrations.schema_migrations where version = '$ver'")" ]; then continue; fi
  echo "  -> $base"
  { cat "$f"; printf "\ninsert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$ver" "$base"; } | "${PSQL[@]}" -1
  applied=$((applied+1))
done
echo "  применено новых: $applied"
# PostgREST перечитывает схему
"${PSQL[@]}" -c "notify pgrst, 'reload schema'" >/dev/null

echo "==> Edge-функции"
mkdir -p "$SUPA/volumes/functions"
for d in "$IN"/functions/*/; do
  n="$(basename "$d")"
  [ "$n" = "main" ] && continue          # main — маршрутизатор из комплекта Supabase, не трогаем
  mkdir -p "$SUPA/volumes/functions/$n"
  rsync -a --delete "$d" "$SUPA/volumes/functions/$n/"
done
( cd "$SUPA" && docker compose restart functions )

echo "==> Сайт"
rm -rf "$WEB/releases/$SHA"
cp -r "$IN/web" "$WEB/releases/$SHA"
ln -sfn "$WEB/releases/$SHA" "$WEB/current.tmp"
mv -T "$WEB/current.tmp" "$WEB/current"
# оставляем 5 последних версий
( cd "$WEB/releases" && ls -1dt -- */ 2>/dev/null | tail -n +6 | xargs -r rm -rf )

echo "Готово: $SHA"
