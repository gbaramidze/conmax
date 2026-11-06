#!/usr/bin/env bash
# Ночной бэкап: дамп БД + файлы Storage. Хранит 14 дней в /var/backups/buildos.
# Если задана переменная BACKUP_S3 (например s3://conmax-backups/) и на сервере есть aws cli с ролью — копирует и туда.
set -euo pipefail

DIR=/var/backups/buildos
SUPA=/opt/supabase-project
D="$(date +%F)"
mkdir -p "$DIR"

# supabase_admin — суперпользователь БД; пароль берётся из окружения контейнера (PGPASSWORD)
docker exec supabase-db pg_dump -h localhost -U supabase_admin -d postgres -Fc --no-owner > "$DIR/db-$D.dump.tmp"
mv "$DIR/db-$D.dump.tmp" "$DIR/db-$D.dump"

if [ -d "$SUPA/volumes/storage" ]; then
  tar -czf "$DIR/storage-$D.tar.gz" -C "$SUPA/volumes" storage
fi

find "$DIR" -type f \( -name 'db-*.dump' -o -name 'storage-*.tar.gz' \) -mtime +14 -delete

if [ -n "${BACKUP_S3:-}" ] && command -v aws >/dev/null; then
  aws s3 cp "$DIR/db-$D.dump" "$BACKUP_S3"
  [ -f "$DIR/storage-$D.tar.gz" ] && aws s3 cp "$DIR/storage-$D.tar.gz" "$BACKUP_S3"
fi
echo "$(date -Is) бэкап $D готов"
