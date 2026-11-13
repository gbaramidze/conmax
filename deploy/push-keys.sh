#!/usr/bin/env bash
# Создаёт пару ключей VAPID для push-уведомлений чата и дописывает их в /opt/supabase-project/.env.functions.
# Выполняется ОДИН РАЗ на уже работающем сервере (на новом сервере это делает supabase-install.sh). Повторный запуск ключи не меняет:
# смена ключей отключила бы все подписанные устройства.
#   bash /opt/buildos-deploy/push-keys.sh && bash /opt/buildos-deploy/post-install.sh
set -euo pipefail

F=/opt/supabase-project/.env.functions
[ -f "$F" ] || { echo "Нет $F"; exit 1; }
if grep -q '^VAPID_PRIVATE_KEY=.\+' "$F"; then echo "Ключи VAPID уже есть."; exit 0; fi

b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$TMP"
PRIV="$(openssl ec -in "$TMP" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
PUB="$(openssl ec -in "$TMP" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"
[ "${#PRIV}" = 43 ] && [ "${#PUB}" = 87 ] || { echo "Не удалось получить ключи"; exit 1; }

sed -i '/^VAPID_/d' "$F"
cat >> "$F" <<EOF

# Push-уведомления чата (функция send-push). Ключи не менять: подписанные устройства перестанут получать push.
VAPID_PUBLIC_KEY=$PUB
VAPID_PRIVATE_KEY=$PRIV
VAPID_SUBJECT=$(grep '^APP_URL=' "$F" | head -1 | cut -d= -f2-)
EOF
echo "Ключи записаны. Перезапуск функций…"
( cd /opt/supabase-project && docker compose up -d --force-recreate functions )
